//! Порт `npm/rules/doc-files/docgen-extract-anchors/main.mjs` (118 рядків) —
//! текстовий екстрактор посилань/анкорів для post-generation валідації.
//! Жодного дискового вводу: єдиний вхід — вже прочитаний `src` (той самий
//! контракт, що JS-оригінал: `extractAnchors(src)` бере рядок, не шлях).
//!
//! # Розходження з картою розвідки: `regex`-крейт НЕ підтримує lookbehind
//! JS `CONFIG_REF_RE` спирається на негативний lookbehind `(?<![\w.])`, щоб
//! не почати матч усередині складеного імені (`settings.local.json` →
//! правильний анкор — ЦІЛЕ імʼя, а не хибний фрагмент `.local.json`,
//! доккомент JS-оригіналу `main.mjs:8-11`). Rust-крейт `regex` (той самий,
//! що вже тягне [`crate::crc`]/`crate::lib`) НЕ підтримує lookaround —
//! свідома відмова крейту від зворотного трекінгу заради лінійного часу.
//! Карта розвідки (`docs/specs/2026-08-31-recon-docgen-surface.md` §2)
//! називає `extract-anchors` «текстовим екстрактором» без застережень —
//! на практиці ця РІВНО одна деталь виявилась не тривіальним 1:1 regex-портом.
//! Розв'язок [`config_refs`] — ручне сканування позицій-кандидатів із
//! перевіркою попереднього символу замість lookbehind (емуляція
//! ідентична семантиці, без нового Cargo-dep).

use regex::Regex;
use std::sync::OnceLock;

fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"https?://[^\s'"`)<>]+"#).expect("URL_RE"))
}

fn static_url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^https?://[^/${]+").expect("STATIC_URL_RE"))
}

fn export_const_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"export\s+const\s+([A-Z][A-Z0-9_]+)\s*=\s*(['"`])([^'"`]+)['"`]"#)
            .expect("EXPORT_CONST_RE")
    })
}

fn error_marker_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\(([a-z][\w-]*\.mdc)\)").expect("ERROR_MARKER_RE"))
}

fn file_header_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)^\s*/\*\*(.*?)\*/").expect("FILE_HEADER_RE"))
}

fn code_block_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?s)```[a-z]{0,12}\n(.*?)\n[ \t]{0,8}\*?[ \t]{0,8}```").expect("CODE_BLOCK_RE")
    })
}

/// Dedup, зберігаючи порядок появи — порт `uniq` (`main.mjs:21-33`).
fn uniq(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for x in items {
        if seen.insert(x.clone()) {
            out.push(x);
        }
    }
    out
}

/// Магічна константа-рядок з `export const NAME = "value"` — елемент
/// `magicStrings` (`main.mjs:58-67`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MagicString {
    pub name: String,
    pub value: String,
}

/// Категоризовані анкори файлу — структурний відповідник обʼєкта, який
/// повертає `extractAnchors` (`main.mjs:38-44`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Anchors {
    pub urls: Vec<String>,
    pub magic_strings: Vec<MagicString>,
    pub error_markers: Vec<String>,
    pub config_refs: Vec<String>,
    pub examples: Vec<String>,
}

/// Чи символ належить до `\w` (regex-семантика: `[A-Za-z0-9_]`, ASCII —
/// той самий діапазон, який реально трапляється у файлових іменах).
fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Ручна емуляція `CONFIG_REF_RE` (`(?<![\w.])(\.?[a-z][\w.-]*\.json)\b`,
/// прапорець `/gi`) — доккомент модуля. Сканує кандидатські позиції старту
/// (буква, або крапка перед буквою), відкидає ті, де попередній символ —
/// `\w` або `.` (те, що дав би lookbehind), і для дозволених позицій жадібно
/// матчить `[\w.-]*\.json` через `regex::Regex::find` над зрізом рядка, що
/// природно захоплює ЦІЛЕ складене імʼя (жадібний `*` з правильної точки
/// старту), а не хибний хвіст.
pub fn config_refs(src: &str) -> Vec<String> {
    fn body_re() -> &'static Regex {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| Regex::new(r"(?i)^\.?[a-z][\w.-]*\.json\b").expect("CONFIG_REF body"))
    }

    let chars: Vec<char> = src.chars().collect();
    let n = chars.len();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < n {
        let c = chars[i];
        let is_candidate_start = c.is_ascii_alphabetic()
            || (c == '.' && i + 1 < n && chars[i + 1].is_ascii_alphabetic());
        if !is_candidate_start {
            i += 1;
            continue;
        }
        let prev_blocks = i > 0 && (is_word_char(chars[i - 1]) || chars[i - 1] == '.');
        if prev_blocks {
            i += 1;
            continue;
        }
        let rest: String = chars[i..].iter().collect();
        if let Some(m) = body_re().find(&rest) {
            let matched = m.as_str().to_string();
            let consumed_chars = matched.chars().count();
            out.push(matched);
            i += consumed_chars.max(1);
        } else {
            i += 1;
        }
    }
    uniq(out)
}

/// Витягує анкори з вихідного коду файла — порт `extractAnchors`
/// (`main.mjs:46-77`).
pub fn extract_anchors(src: &str) -> Anchors {
    // R10: template-literal URL — обрізаємо на `${`, лишаючи статичний префікс.
    let urls: Vec<String> = uniq(
        url_re()
            .find_iter(src)
            .map(|m| m.as_str())
            .map(|u| match u.find("${") {
                Some(i) => &u[..i],
                None => u,
            })
            .filter(|u| static_url_re().is_match(u))
            .map(|u| u.to_string())
            .collect(),
    );

    let mut magic_strings = Vec::new();
    let mut seen_names = std::collections::HashSet::new();
    for caps in export_const_re().captures_iter(src) {
        let name = caps.get(1).expect("group 1").as_str().to_string();
        let value = caps.get(3).expect("group 3").as_str().to_string();
        if !seen_names.contains(&name) && value.chars().count() <= 120 {
            seen_names.insert(name.clone());
            magic_strings.push(MagicString { name, value });
        }
    }

    let error_markers = uniq(
        error_marker_re()
            .captures_iter(src)
            .map(|c| c.get(1).expect("group 1").as_str().to_string())
            .collect(),
    );
    let config_refs = config_refs(src);

    // Code-block приклади лише з file-header — там автор зазвичай показує контракт.
    let examples = match file_header_re().captures(src) {
        Some(m) => {
            let header = m.get(1).expect("group 1").as_str();
            uniq(
                code_block_re()
                    .captures_iter(header)
                    .map(|c| c.get(1).expect("group 1").as_str().trim().to_string())
                    .collect(),
            )
        }
        None => Vec::new(),
    };

    Anchors {
        urls,
        magic_strings,
        error_markers,
        config_refs,
        examples,
    }
}

/// Плоский список анкор-токенів, які мають дослівно зʼявитися в документі
/// (R5) — порт `anchorTokens` (`main.mjs:86-88`).
pub fn anchor_tokens(a: &Anchors) -> Vec<String> {
    let mut out = Vec::new();
    out.extend(a.urls.iter().cloned());
    out.extend(a.magic_strings.iter().map(|s| s.name.clone()));
    out.extend(a.error_markers.iter().map(|m| format!("({m})")));
    out.extend(a.config_refs.iter().cloned());
    out
}

/// Форматує анкори у компактний текст для system-промпта — порт
/// `anchorsToPrompt` (`main.mjs:97-118`). Порожній результат — анкорів
/// немає взагалі (системний блок не додається).
pub fn anchors_to_prompt(a: &Anchors) -> String {
    let mut blocks: Vec<String> = Vec::new();
    if !a.urls.is_empty() {
        blocks.push(format!("URLs (згадай у тексті): {}", a.urls.join(", ")));
    }
    if !a.magic_strings.is_empty() {
        let consts = a
            .magic_strings
            .iter()
            .map(|s| format!("{}={}", s.name, json_quote(&s.value)))
            .collect::<Vec<_>>()
            .join("; ");
        blocks.push(format!(
            "Експортовані константи-рядки (наведи назву і призначення): {consts}"
        ));
    }
    if !a.error_markers.is_empty() {
        let markers = a
            .error_markers
            .iter()
            .map(|m| format!("({m})"))
            .collect::<Vec<_>>()
            .join(", ");
        blocks.push(format!(
            "Маркери повідомлень (згадай у Поведінці): {markers}"
        ));
    }
    if !a.config_refs.is_empty() {
        blocks.push(format!(
            "Конфіги, на які спирається код: {}",
            a.config_refs.join(", ")
        ));
    }
    if !a.examples.is_empty() {
        let fenced = a
            .examples
            .iter()
            .map(|e| format!("```\n{e}\n```"))
            .collect::<Vec<_>>()
            .join("\n");
        blocks.push(format!(
            "Приклади з документації автора (наведи дослівно у Поведінці):\n{fenced}"
        ));
    }
    if blocks.is_empty() {
        return String::new();
    }
    format!(
        "АНКОРИ ДО ОБОВ'ЯЗКОВОГО ВКЛЮЧЕННЯ (кожен згадай РІВНО ОДИН раз, у найдоречнішому місці — не повторюй у кількох секціях):\n{}",
        blocks.join("\n")
    )
}

/// Мінімальний JSON-quote рядка (лапки + `\`/`"` escape) — порт
/// `JSON.stringify(s.value)` (`main.mjs:101`), без нового Cargo-dep
/// (`serde_json::Value::String` дало б те саме, але для одного рядка
/// ручний escape достатній і без alloc обгортки Value).
fn json_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_refs_keeps_dotted_name_whole_settings_local_json() {
        let refs = config_refs("const REL = '.claude/settings.local.json'\n");
        assert!(refs.contains(&"settings.local.json".to_string()));
        assert!(!refs.contains(&".local.json".to_string()));
    }

    #[test]
    fn config_refs_keeps_dotted_name_whole_capacitor_config_json() {
        let refs = config_refs("existsSync(join(root, 'capacitor.config.json'))\n");
        assert!(refs.contains(&"capacitor.config.json".to_string()));
        assert!(!refs.contains(&".config.json".to_string()));
    }

    #[test]
    fn config_refs_captures_leading_dot_config() {
        let refs = config_refs("import cfg from '.n-rules.json'\n");
        assert!(refs.contains(&".n-rules.json".to_string()));
    }

    #[test]
    fn config_refs_captures_plain_package_json() {
        let refs = config_refs("await readFile('package.json', 'utf8')\n");
        assert!(refs.contains(&"package.json".to_string()));
    }

    #[test]
    fn config_refs_every_ref_is_a_literal_substring_of_source() {
        let src = "const A = '.claude/settings.local.json'\nconst B = 'capacitor.config.json'\n";
        for r in config_refs(src) {
            assert!(src.contains(&r), "{r} має бути дослівним підрядком джерела");
        }
    }

    #[test]
    fn extract_anchors_trims_template_literal_url_to_static_prefix() {
        let a = extract_anchors("const u = `https://example.com/${id}/x`\n");
        assert_eq!(a.urls, vec!["https://example.com/".to_string()]);
    }

    #[test]
    fn extract_anchors_collects_export_const_under_length_limit() {
        let a = extract_anchors("export const FOO = 'bar'\n");
        assert_eq!(
            a.magic_strings,
            vec![MagicString {
                name: "FOO".to_string(),
                value: "bar".to_string()
            }]
        );
    }

    #[test]
    fn extract_anchors_collects_error_markers() {
        let a = extract_anchors("throw new Error('bad state (n-style.mdc)')\n");
        assert_eq!(a.error_markers, vec!["n-style.mdc".to_string()]);
    }

    #[test]
    fn extract_anchors_examples_only_from_file_header() {
        // Регекс не стрипає JSDoc-префікс " * " з рядків усередині code-block —
        // порт зберігає ту саму поведінку, що JS-оригінал (лише зовнішній
        // `.trim()`, не пер-рядкове очищення коментарних зірочок).
        let src = "/**\n * ```\n * foo()\n * ```\n */\nfunction f() {\n  // ```\n  // bar()\n  // ```\n}\n";
        let a = extract_anchors(src);
        assert_eq!(a.examples, vec!["* foo()".to_string()]);
    }

    #[test]
    fn anchor_tokens_wraps_error_markers_in_parens() {
        let a = Anchors {
            error_markers: vec!["n-style.mdc".to_string()],
            ..Default::default()
        };
        assert_eq!(anchor_tokens(&a), vec!["(n-style.mdc)".to_string()]);
    }

    #[test]
    fn anchors_to_prompt_empty_when_no_anchors() {
        assert_eq!(anchors_to_prompt(&Anchors::default()), "");
    }

    #[test]
    fn anchors_to_prompt_mentions_config_refs_block() {
        let a = Anchors {
            config_refs: vec!["package.json".to_string()],
            ..Default::default()
        };
        let txt = anchors_to_prompt(&a);
        assert!(txt.contains("package.json"));
        assert!(txt.contains("АНКОРИ"));
    }
}
