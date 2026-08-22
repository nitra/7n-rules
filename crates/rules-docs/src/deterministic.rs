//! Детерміновані примітиви package-knowledge — порт `deterministic.mjs`:
//! канонічний JSON, `sha256:`-хеш поверх нього і versioned-кеш успішних
//! відповідей.
//!
//! Обидва семантичні гейти ([`crate::entailment`], [`crate::gap_mappings`])
//! ключують кеш хешем канонічного представлення входу. Тобто формула хеша —
//! це КОНТРАКТ, а не деталь: розбіжність із JS не ламає нічого гучно, вона
//! лише робить усі накопичені кеш-записи невидимими (кожен ключ — промах,
//! кожен промах — оплачений виклик моделі).

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::Path;

use serde_json::{Map, Value};

/// Порядок ASCII-символів поза `[0-9A-Za-z]` у кореневій колації ICU —
/// знятий із живого `Intl` (Node), не відтворений з памʼяті.
///
/// Потрібен, бо `canonicalize` у JS сортує ключі `localeCompare`-ом, а не
/// побайтово: `{"a_b":…,"ab":…}` дає РІЗНИЙ порядок у цих двох світах, а
/// отже й різний хеш.
const ICU_PUNCTUATION_ORDER: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

/// Ваги одного символу для порівняння в стилі кореневої колації ICU:
/// `(клас, первинна вага, вторинна вага)`.
///
/// Рівнів два, як в ICU: спершу порівнюються ПЕРВИННІ ваги всього рядка
/// (буква без огляду на регістр), і лише за їх рівності — вторинні (регістр,
/// нижній перед верхнім). Саме тому `aA` < `Aa`, хоч побайтово навпаки.
fn collation_weights(ch: char) -> (u8, u32, u8) {
    if let Some(index) = ICU_PUNCTUATION_ORDER.chars().position(|p| p == ch) {
        return (0, index as u32, 0);
    }
    if ch.is_ascii_digit() {
        return (1, u32::from(ch) - u32::from('0'), 0);
    }
    if ch.is_alphabetic() {
        // Складання регістру — по всьому Unicode, не лише ASCII: кирилиця
        // теж дає `ключ` < `Ключ` (перевірено проти Node), і побайтове
        // порівняння тут розійшлося б, бо `К` (U+041A) < `к` (U+043A).
        let lowered = ch.to_lowercase().next().unwrap_or(ch);
        let class = if lowered.is_ascii() { 2 } else { 3 };
        return (class, u32::from(lowered), u8::from(ch.is_uppercase()));
    }
    // Решта (символи поза таблицею, керівні, емодзі) — власний клас за
    // кодпоінтом. Це МЕЖА порту: у просторі ключів knowledge-графа таких
    // символів немає, тож дзеркальність тут не перевірена і не обіцяна.
    (4, u32::from(ch), 0)
}

/// Порівняння рядків у стилі `String.prototype.localeCompare` (коренева
/// колація ICU) для простору ключів, який реально трапляється в графі:
/// ASCII-ідентифікатори, пунктуація, цифри, кирилиця.
///
/// Побайтове порівняння тут НЕ підходить — див. [`collation_weights`].
#[must_use]
pub fn js_locale_cmp(left: &str, right: &str) -> Ordering {
    let weights = |s: &str| -> (Vec<(u8, u32)>, Vec<u8>) {
        let mut primary = Vec::new();
        let mut secondary = Vec::new();
        for ch in s.chars() {
            let (class, primary_weight, secondary_weight) = collation_weights(ch);
            primary.push((class, primary_weight));
            secondary.push(secondary_weight);
        }
        (primary, secondary)
    };
    let (left_primary, left_secondary) = weights(left);
    let (right_primary, right_secondary) = weights(right);
    left_primary
        .cmp(&right_primary)
        .then_with(|| left_secondary.cmp(&right_secondary))
        // Останній рубіж: рядки, нерозрізненні на обох рівнях, впорядковуємо
        // побайтово — щоб сортування лишалось тотальним і відтворюваним.
        .then_with(|| left.cmp(right))
}

/// Число у формі `JSON.stringify`: ціле — без дробової частини.
///
/// `serde_json` друкує `1.0` там, де JS друкує `1`, і цього досить, щоб хеш
/// розійшовся. Показникова форма (`1e+21` і більші) — МЕЖА порту: у claim-ах
/// таких величин немає, тому вона не відтворюється і не тестується.
fn write_number(out: &mut String, number: &serde_json::Number) {
    if let Some(float) = number.as_f64() {
        if number.as_i64().is_none() && number.as_u64().is_none() && float.fract() == 0.0 {
            out.push_str(&format!("{float:.0}"));
            return;
        }
    }
    out.push_str(&number.to_string());
}

/// Пише значення в канонічній формі — дзеркало
/// `JSON.stringify(canonicalize(value))`: ключі обʼєктів упорядковані
/// [`js_locale_cmp`], масиви лишаються в своєму порядку (він змістовний).
fn write_canonical(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => write_number(out, number),
        // Екранування рядків беремо в `serde_json` — воно збігається з
        // `JSON.stringify` на всьому просторі, який тут трапляється.
        Value::String(text) => out.push_str(&Value::String(text.clone()).to_string()),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(out, item);
            }
            out.push(']');
        }
        Value::Object(entries) => {
            let mut keys: Vec<&String> = entries.keys().collect();
            keys.sort_by(|left, right| js_locale_cmp(left, right));
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                write_canonical(out, &entries[key]);
            }
            out.push('}');
        }
    }
}

/// Канонічний JSON-рядок значення — порт `JSON.stringify(canonicalize(v))`.
#[must_use]
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(&mut out, value);
    out
}

/// Канонічний JSON із відступами — порт `JSON.stringify(canonicalize(v), null, 2)`.
///
/// Власний писемник, а не `serde_json::to_string_pretty` поверх
/// [`canonical_value`]: той зберігав би порядок ключів лише поки в графі
/// увімкнена фіча `preserve_order` (вона приходить транзитивно), тобто
/// байтова стабільність серіалізації залежала б від чужого `Cargo.toml`.
#[must_use]
pub fn canonical_json_pretty(value: &Value) -> String {
    let mut out = String::new();
    write_pretty(&mut out, value, 0);
    out
}

/// Один рівень відступу `JSON.stringify(..., null, 2)`.
fn indent(out: &mut String, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push_str("  ");
    }
}

fn write_pretty(out: &mut String, value: &Value, depth: usize) {
    match value {
        Value::Array(items) if !items.is_empty() => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                write_pretty(out, item, depth + 1);
            }
            indent(out, depth);
            out.push(']');
        }
        Value::Object(entries) if !entries.is_empty() => {
            let mut keys: Vec<&String> = entries.keys().collect();
            keys.sort_by(|left, right| js_locale_cmp(left, right));
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                out.push_str(&Value::String(key.clone()).to_string());
                out.push_str(": ");
                write_pretty(out, &entries[key], depth + 1);
            }
            indent(out, depth);
            out.push('}');
        }
        // Порожні контейнери і скаляри — та сама форма, що в компактного
        // писемника (`[]`, `{}`, число, рядок).
        other => write_canonical(out, other),
    }
}

/// Канонічна копія значення — порт `canonicalize`.
///
/// У Rust порядок ключів у [`Value`] не спостережний для споживача (його
/// задає серіалізація), тож канонізація тут — це нормалізація ЗМІСТУ через
/// той самий писемник, яким рахуються хеші: одна дорога, одні правила.
#[must_use]
pub fn canonical_value(value: &Value) -> Value {
    serde_json::from_str(&canonical_json(value)).unwrap_or_else(|_| value.clone())
}

/// `sha256:`-префіксований digest канонічного JSON — порт `canonicalHash`.
#[must_use]
pub fn canonical_hash(value: &Value) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(canonical_json(value).as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest.iter() {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256:{hex}")
}

/// Кеш успішних відповідей верифікатора: `version` + `entries` (ключ →
/// СИРИЙ текст відповіді моделі).
///
/// Значення лишається [`Value`], а не `String`, свідомо: чужий чи побитий
/// файл може мати там що завгодно, і відкидати таке має ПАРСЕР відповіді
/// (тим самим кодом, що й для живої відповіді), а не десеріалізація кешу.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionedCache {
    pub version: u64,
    pub entries: BTreeMap<String, Value>,
}

impl VersionedCache {
    /// Порожній кеш заданої версії.
    #[must_use]
    pub fn empty(version: u64) -> Self {
        Self {
            version,
            entries: BTreeMap::new(),
        }
    }

    /// Кеш як [`Value`] — форма, яку гейти повертають назовні (і JS-гейти
    /// теж повертають `cache` у результаті, не лише пишуть у файл).
    #[must_use]
    pub fn to_value(&self) -> Value {
        let mut entries = Map::new();
        for (key, value) in &self.entries {
            entries.insert(key.clone(), value.clone());
        }
        let mut root = Map::new();
        root.insert("version".to_string(), Value::from(self.version));
        root.insert("entries".to_string(), Value::Object(entries));
        Value::Object(root)
    }
}

/// Відкриває інʼєктований або файловий кеш — порт `loadVersionedCache`.
///
/// Інʼєктований кеш ПЕРЕМАГАЄ файл (так і в JS: тест підсовує свій), а
/// невалідні `entries` мовчки замінюються порожніми. Версія завжди
/// перезаписується запитаною: кеш іншої версії — не помилка, а промах.
///
/// # Errors
/// Помилка читання файлу, відмінна від «немає файлу», — fail-closed: мовчки
/// продовжити означало б оплатити повний прогін моделі там, де насправді
/// зламані права чи диск.
pub fn load_versioned_cache(
    cache_path: Option<&Path>,
    supplied: Option<VersionedCache>,
    version: u64,
) -> Result<VersionedCache, String> {
    if let Some(mut cache) = supplied {
        cache.version = version;
        return Ok(cache);
    }
    let Some(path) = cache_path else {
        return Ok(VersionedCache::empty(version));
    };
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VersionedCache::empty(version))
        }
        Err(error) => return Err(format!("кеш не читається {}: {error}", path.display())),
    };
    let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(&text) else {
        return Ok(VersionedCache::empty(version));
    };
    if parsed.get("version").and_then(Value::as_u64) != Some(version) {
        return Ok(VersionedCache::empty(version));
    }
    let Some(Value::Object(entries)) = parsed.get("entries") else {
        return Ok(VersionedCache::empty(version));
    };
    Ok(VersionedCache {
        version,
        entries: entries
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    })
}

/// Атомарно зберігає кеш — порт `saveVersionedCache` (tmp + rename, як у JS).
///
/// # Errors
/// Будь-яка помилка запису: кеш — не найважливіше, але тихо втратити його
/// означало б наступного разу знову платити за ті самі виклики.
pub fn save_versioned_cache(
    cache_path: Option<&Path>,
    cache: &VersionedCache,
) -> Result<(), String> {
    let Some(path) = cache_path else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("тека кешу не створюється {}: {error}", parent.display()))?;
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(
        &temporary,
        format!("{}\n", canonical_json(&cache.to_value())),
    )
    .map_err(|error| format!("кеш не пишеться {}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| format!("кеш не перейменовується на {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Вектори зняті з ЖИВОГО Node (`localeCompare`), не вигадані: саме вони
    /// показують, що побайтове сортування дало б інший порядок — а отже
    /// інший хеш і повністю холодний кеш.
    #[test]
    fn key_order_matches_js_locale_compare_not_byte_order() {
        fn sorted(mut keys: Vec<&str>) -> Vec<&str> {
            keys.sort_by(|left, right| js_locale_cmp(left, right));
            keys
        }
        assert_eq!(sorted(vec!["b", "A", "a", "B"]), vec!["a", "A", "b", "B"]);
        assert_eq!(
            sorted(vec!["_x", "-y", "$z", "0a", "Za", "za"]),
            vec!["_x", "-y", "$z", "0a", "za", "Za"]
        );
        assert_eq!(
            sorted(vec!["item2", "item10", "item1"]),
            vec!["item1", "item10", "item2"]
        );
        assert_eq!(
            sorted(vec!["Ключ", "ключ", "Aa", "aA"]),
            vec!["aA", "Aa", "ключ", "Ключ"]
        );
        assert_eq!(
            sorted(vec!["a-b", "a_b", "ab", "aB"]),
            vec!["a_b", "a-b", "ab", "aB"]
        );
    }

    /// Ключі графа — camelCase, де ICU і байти збігаються; тест фіксує, що
    /// саме на них порт не робить нічого несподіваного.
    #[test]
    fn canonical_json_sorts_object_keys_recursively() {
        let value = json!({"value": {"b": 1, "A": 2}, "id": "c1", "evidenceIds": ["e2", "e1"]});
        assert_eq!(
            canonical_json(&value),
            r#"{"evidenceIds":["e2","e1"],"id":"c1","value":{"A":2,"b":1}}"#
        );
    }

    /// Масив НЕ сортується — його порядок змістовний (`evidenceIds` вище
    /// лишились `e2,e1`). Сортує їх сам гейт, там, де це доречно.
    #[test]
    fn arrays_keep_their_order() {
        assert_eq!(canonical_json(&json!([3, 1, 2])), "[3,1,2]");
    }

    /// `JSON.stringify(1)` — це `1`, а не `1.0`: інакше хеш розійшовся б на
    /// будь-якому цілому, що приїхало з JSON як float.
    #[test]
    fn integral_numbers_print_without_a_fraction() {
        let value: Value = serde_json::from_str("{\"a\": 1.0, \"b\": 2.5, \"c\": 3}").unwrap();
        assert_eq!(canonical_json(&value), r#"{"a":1,"b":2.5,"c":3}"#);
    }

    #[test]
    fn hash_is_prefixed_sha256_of_the_canonical_form() {
        let left = canonical_hash(&json!({"a": 1, "b": 2}));
        let right = canonical_hash(&json!({"b": 2, "a": 1}));
        assert_eq!(left, right, "порядок ключів на вході не впливає");
        assert!(left.starts_with("sha256:"));
        assert_eq!(left.len(), "sha256:".len() + 64);
    }

    #[test]
    fn supplied_cache_wins_over_the_file_and_gets_the_requested_version() {
        let mut supplied = VersionedCache::empty(99);
        supplied.entries.insert("k".to_string(), json!("v"));
        let loaded = load_versioned_cache(None, Some(supplied), 1).expect("кеш відкривається");
        assert_eq!(loaded.version, 1);
        assert_eq!(loaded.entries["k"], json!("v"));
    }

    #[test]
    fn cache_of_another_version_reads_as_empty_not_as_an_error() {
        let dir = std::env::temp_dir().join(format!("rules-docs-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("other-version.json");
        std::fs::write(&path, r#"{"version": 42, "entries": {"k": "v"}}"#).unwrap();
        let loaded = load_versioned_cache(Some(&path), None, 1).expect("кеш відкривається");
        assert!(loaded.entries.is_empty());
        assert_eq!(loaded.version, 1);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_cache_file_is_an_empty_cache_not_an_error() {
        let path = std::env::temp_dir().join("rules-docs-cache-missing/never-written.json");
        let loaded =
            load_versioned_cache(Some(&path), None, 1).expect("відсутній файл — не помилка");
        assert!(loaded.entries.is_empty());
    }

    #[test]
    fn save_then_load_round_trips_through_a_real_file() {
        let dir = std::env::temp_dir().join(format!("rules-docs-cache-rt-{}", std::process::id()));
        let path = dir.join("cache.json");
        let mut cache = VersionedCache::empty(1);
        cache
            .entries
            .insert("key".to_string(), json!("{\"ok\":true}"));
        save_versioned_cache(Some(&path), &cache).expect("кеш пишеться");
        let loaded = load_versioned_cache(Some(&path), None, 1).expect("кеш читається");
        assert_eq!(loaded, cache);
        std::fs::remove_dir_all(&dir).ok();
    }
}
