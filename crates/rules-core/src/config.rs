//! cspell:ignore errno
//!
//! Порт read-only читача конфігурації репозиторію
//! (`npm/scripts/lib/read-n-rules-config-lite.mjs`) разом із таблицею
//! міграції застарілих rule-id (`migrateRuleIds` із
//! `npm/scripts/lib/rule-meta-helpers.mjs`) — зріз 3 фази 8
//! (`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! **Свідома ревізія рішення Д.** Зріз 2 лишав читання `.n-rules.json` у
//! `rules-cli` («ядро не знає про конфіг»). Зі зрізом 3 конфіг стає спільним
//! для ДВОХ споживачів ядра (`ci plan` у CLI і — після зрізу 4 — detect-контур
//! `lint`/`hook`), тож за правилом одного власника переїжджає сюди. Ядро
//! як і раніше не знає про argv: приймає корінь репо, повертає дані.
//!
//! Порт 1:1, включно з крайовими:
//! - джерело — ПЕРШИЙ наявний із `.n-rules.json`, `.n-cursor.json`; жодного
//!   файлу → `exists: false` і порожні списки («open by default» для debug);
//! - невалідний JSON — ПОМИЛКА (JS `JSON.parse` кидає, CLI ловить на
//!   верхньому рівні й виходить з кодом 1), а не мовчазний порожній конфіг;
//!   цим lite-читач відрізняється від толерантного `loadCursorIgnorePaths`
//!   (`rules_cli::cursor_ignore`), і різниця навмисна — обидва боки
//!   дзеркалять свої JS-оригінали;
//! - `rules`/`disable-rules` — лише рядкові елементи масиву, далі
//!   [`migrate_rule_ids`]; не масив → порожньо;
//! - `plugins` — лише рядкові елементи масиву; поле відсутнє або не масив →
//!   `None` (для JS це `undefined`, що вмикає автодетект плагінів; порожній
//!   масив — це `Some(vec![])`, тобто «плагіни вимкнено», інша семантика).

use std::path::Path;

/// Файли конфігурації в порядку пріоритету (`CONFIG_FILE`,
/// `LEGACY_CONFIG_FILE`).
const CONFIG_FILES: [&str; 2] = [".n-rules.json", ".n-cursor.json"];

/// Карта міграції застарілих rule-id (`RULE_MIGRATIONS`). Застосовується і до
/// `rules`, і до `disable-rules`.
const RULE_MIGRATIONS: &[(&str, &[&str])] = &[
    ("image", &["image-compress", "image-avif"]),
    ("ci4", &["doc-files"]),
];

/// Розгортає застарілі rule-id згідно з таблицею міграції: порядок
/// зберігається, дублікати відкидаються (порт `migrateRuleIds`).
pub fn migrate_rule_ids(ids: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        let replacement: Vec<String> = RULE_MIGRATIONS
            .iter()
            .find(|(legacy, _)| *legacy == id.as_str())
            .map_or_else(
                || vec![id.clone()],
                |(_, new_ids)| new_ids.iter().map(|s| (*s).to_string()).collect(),
            );
        for new_id in replacement {
            if !out.contains(&new_id) {
                out.push(new_id);
            }
        }
    }
    out
}

/// Розібраний lite-конфіг репозиторію (порт `LiteConfig`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LiteConfig {
    /// Чи знайдено `.n-rules.json` (або legacy `.n-cursor.json`).
    pub exists: bool,
    /// Whitelist rule-id (після міграції).
    pub rules: Vec<String>,
    /// Явно вимкнені rule-id (після міграції).
    pub disable_rules: Vec<String>,
    /// npm-пакети-плагіни; `None` — поля немає (→ автодетект на боці JS).
    pub plugins: Option<Vec<String>>,
}

/// Помилка читання конфігурації.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// Файл є, але не читається (права, зламаний симлінк тощо).
    #[error("не вдалося прочитати {path}: {source}")]
    Read {
        /// Шлях до конфігу.
        path: String,
        /// Причина від ОС.
        source: std::io::Error,
    },
    /// Файл є, але це не валідний JSON-обʼєкт.
    #[error("невалідний JSON у {path}: {message}")]
    Parse {
        /// Шлях до конфігу.
        path: String,
        /// Текст помилки парсера.
        message: String,
    },
}

/// Читає lite-конфіг із кореня `cwd` (порт `readNRulesConfigLite`).
///
/// # Errors
///
/// [`ConfigError`] — конфіг знайдено, але прочитати/розпарсити його не
/// вдалося. Дзеркало `JSON.parse`, який у JS кидає з того самого місця;
/// САМ ТЕКСТ повідомлення відрізняється (у Node це формат помилки рантайму,
/// різний навіть між `node` і `bun`) — та сама межа порту, що для errno-
/// повідомлень зрізу 2. Паритетним лишається факт помилки й exit-код.
pub fn read_n_rules_config_lite(cwd: &Path) -> Result<LiteConfig, ConfigError> {
    let Some(path) = CONFIG_FILES
        .iter()
        .map(|file| cwd.join(file))
        .find(|path| path.exists())
    else {
        return Ok(LiteConfig::default());
    };
    let text = std::fs::read_to_string(&path).map_err(|source| ConfigError::Read {
        path: path.display().to_string(),
        source,
    })?;
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| ConfigError::Parse {
            path: path.display().to_string(),
            message: error.to_string(),
        })?;

    Ok(LiteConfig {
        exists: true,
        rules: migrate_rule_ids(&string_array(&parsed, "rules")),
        disable_rules: migrate_rule_ids(&string_array(&parsed, "disable-rules")),
        plugins: parsed
            .get("plugins")
            .and_then(|value| value.as_array())
            .map(|items| collect_strings(items)),
    })
}

/// Чи активне правило згідно з конфігом (порт `isRuleEnabled`): немає файлу →
/// `true` (open by default для debug), явний `disable-rules` перемагає
/// whitelist.
#[must_use]
pub fn is_rule_enabled(config: &LiteConfig, rule_id: &str) -> bool {
    if !config.exists {
        return true;
    }
    if config.disable_rules.iter().any(|id| id == rule_id) {
        return false;
    }
    config.rules.iter().any(|id| id == rule_id)
}

/// Рядкові елементи масиву за ключем; не масив/немає ключа → порожньо
/// (дзеркало `Array.isArray(x) ? x.filter(typeof === 'string') : []`).
fn string_array(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|field| field.as_array())
        .map_or_else(Vec::new, |items| collect_strings(items))
}

/// Лише рядкові елементи масиву, порядок збережено.
fn collect_strings(items: &[serde_json::Value]) -> Vec<String> {
    items
        .iter()
        .filter_map(|item| item.as_str().map(String::from))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(dir: &Path, file: &str, text: &str) {
        std::fs::write(dir.join(file), text).unwrap();
    }

    #[test]
    fn missing_config_is_open_by_default() {
        let tmp = TempDir::new().unwrap();
        let config = read_n_rules_config_lite(tmp.path()).unwrap();
        assert!(!config.exists);
        assert!(config.plugins.is_none());
        assert!(is_rule_enabled(&config, "js"));
    }

    #[test]
    fn whitelist_and_disable_rules_are_migrated() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            ".n-rules.json",
            r#"{"rules":["image","js",7],"disable-rules":["ci4"]}"#,
        );
        let config = read_n_rules_config_lite(tmp.path()).unwrap();
        assert_eq!(config.rules, ["image-compress", "image-avif", "js"]);
        assert_eq!(config.disable_rules, ["doc-files"]);
        assert!(is_rule_enabled(&config, "image-avif"));
        assert!(!is_rule_enabled(&config, "doc-files"));
        assert!(!is_rule_enabled(&config, "rego"));
    }

    #[test]
    fn legacy_config_file_is_the_fallback() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".n-cursor.json", r#"{"rules":["text"]}"#);
        let config = read_n_rules_config_lite(tmp.path()).unwrap();
        assert!(config.exists);
        assert_eq!(config.rules, ["text"]);
    }

    #[test]
    fn plugins_field_distinguishes_absent_from_empty() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".n-rules.json", r#"{"plugins":[]}"#);
        assert_eq!(
            read_n_rules_config_lite(tmp.path()).unwrap().plugins,
            Some(Vec::new())
        );
        write(
            tmp.path(),
            ".n-rules.json",
            r#"{"plugins":"@7n/rules-lang-js"}"#,
        );
        assert_eq!(read_n_rules_config_lite(tmp.path()).unwrap().plugins, None);
        write(
            tmp.path(),
            ".n-rules.json",
            r#"{"plugins":["@7n/rules-lang-js",5]}"#,
        );
        assert_eq!(
            read_n_rules_config_lite(tmp.path()).unwrap().plugins,
            Some(vec!["@7n/rules-lang-js".to_string()])
        );
    }

    #[test]
    fn broken_json_is_an_error_not_an_empty_config() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".n-rules.json", "{ зламаний");
        write(tmp.path(), ".n-cursor.json", r#"{"rules":["text"]}"#);
        let error = read_n_rules_config_lite(tmp.path()).unwrap_err();
        assert!(matches!(error, ConfigError::Parse { .. }));
    }

    #[test]
    fn migrate_rule_ids_dedupes_and_keeps_order() {
        let ids = ["image", "image-compress", "js", "js"].map(String::from);
        assert_eq!(
            migrate_rule_ids(&ids),
            ["image-compress", "image-avif", "js"]
        );
    }
}
