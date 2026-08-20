//! cspell:ignore NONWORD яіїєґ
//! MADR-каркас — детермінована власність конвеєра (інверсія форматування:
//! модель повертає лише зміст секцій, увесь markdown-каркас будує цей
//! модуль). Порт розділу «Stage 2: gen-MADR» `normalize-pipeline.mjs`:
//! `validateMadr`/`normalizeSections`/`assembleMadr`/`madrDate`/`slugify`.

use std::sync::LazyLock;

use regex::Regex;

static RE_FENCE_LEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*```").expect("regex"));
static RE_FENCE_TRAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"```\s*$").expect("regex"));
static RE_SESSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\bsession:\s").expect("regex"));
static RE_STATUS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\*\*Status:\*\*").expect("regex"));
static RE_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}").expect("regex"));
static RE_YAML_FRONTMATTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)^---\n(.*?)\n---").expect("regex"));
static RE_TYPE_ADR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^type:\s*ADR\s*$").expect("regex"));
static RE_SLUG_NONWORD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)[^a-zа-яіїєґ0-9]+").expect("regex"));
static RE_FNAME_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{2})(\d{2})(\d{2})-").expect("regex"));
static RE_TRAIL_DOT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.+\s*$").expect("regex"));

/// Обов'язкові заголовки MADR — порт `MADR_HEADINGS`.
const MADR_HEADINGS: &[&str] = &[
    "## Context and Problem Statement",
    "## Considered Options",
    "## Decision Outcome",
    "## More Information",
];

/// Результат детермінованого гейта якості MADR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MadrValidation {
    /// Чи пройшов усі перевірки.
    pub ok: bool,
    /// Людські описи порушень (порожньо, коли `ok`).
    pub errors: Vec<String>,
}

/// Порт `validateMadr` — гейт перед прийняттям згенерованого MADR.
#[must_use]
pub fn validate_madr(content: &str) -> MadrValidation {
    let mut errors = Vec::new();
    if content.chars().count() < 80 {
        errors.push("too short".to_string());
    }
    if RE_FENCE_LEAD.is_match(content) || RE_FENCE_TRAIL.is_match(content.trim()) {
        errors.push("code-fence wrapper".to_string());
    }
    let frontmatter_ok = RE_YAML_FRONTMATTER
        .captures(content)
        .is_some_and(|c| RE_TYPE_ADR.is_match(&c[1]));
    if !frontmatter_ok {
        errors.push("missing OKF type: ADR frontmatter".to_string());
    }
    if RE_SESSION.is_match(content) {
        errors.push("leaked session: field".to_string());
    }
    if !RE_STATUS.is_match(content) {
        errors.push("missing Status".to_string());
    }
    if !RE_DATE.is_match(content) {
        errors.push("missing/!ISO Date".to_string());
    }
    for heading in MADR_HEADINGS {
        if !content.contains(heading) {
            errors.push(format!("missing heading {heading}"));
        }
    }
    MadrValidation {
        ok: errors.is_empty(),
        errors,
    }
}

/// Нормалізовані секції-зміст від моделі (порт форми `normalizeSections`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Sections {
    pub context: String,
    pub options: Vec<String>,
    pub chosen: String,
    pub rationale: String,
    pub good: Vec<String>,
    pub bad: Vec<String>,
    pub more: String,
}

fn sec_str(value: Option<&serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(s)) => s.trim().to_string(),
        Some(serde_json::Value::Null) | None => String::new(),
        // Число/bool → рядок (толерантність до малої моделі, як у JS String(v)).
        Some(other) => other.to_string().trim().to_string(),
    }
}

fn sec_arr(value: Option<&serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .map(|v| sec_str(Some(v)))
            .filter(|s| !s.is_empty())
            .collect(),
        other => {
            let s = sec_str(other);
            if s.is_empty() {
                Vec::new()
            } else {
                vec![s]
            }
        }
    }
}

/// Порт `normalizeSections`: сирий JSON моделі → строга форма, толерантна до
/// дрібних відхилень (рядок замість масиву, число/null).
#[must_use]
pub fn normalize_sections(obj: &serde_json::Value) -> Sections {
    Sections {
        context: sec_str(obj.get("context")),
        options: sec_arr(obj.get("options")),
        chosen: sec_str(obj.get("chosen")),
        rationale: sec_str(obj.get("rationale")),
        good: sec_arr(obj.get("good")),
        bad: sec_arr(obj.get("bad")),
        more: sec_str(obj.get("more")),
    }
}

/// Порт `slugify` (ліміт 60 символів, fallback `adr`).
#[must_use]
pub fn slugify(title: &str) -> String {
    let lowered = title.to_lowercase();
    let dashed = RE_SLUG_NONWORD.replace_all(&lowered, "-");
    let no_lead = dashed.trim_start_matches('-');
    let cut: String = no_lead.chars().take(60).collect();
    let slug = cut.trim_end_matches('-').to_string();
    if slug.is_empty() {
        "adr".to_string()
    } else {
        slug
    }
}

/// Порт `madrDate`: ISO-дата з `captured`-frontmatter або з timestamp-префікса
/// імені файлу (`YYMMDD-…` → `20YY-MM-DD`), інакше ''.
#[must_use]
pub fn madr_date(captured: Option<&str>, file: &str) -> String {
    let iso: String = captured.unwrap_or("").chars().take(10).collect();
    if RE_DATE.is_match(&format!("**Date:** {iso}")) {
        return iso;
    }
    RE_FNAME_DATE
        .captures(file)
        .map(|c| format!("20{}-{}-{}", &c[1], &c[2], &c[3]))
        .unwrap_or_default()
}

/// Порт `assembleMadr` — детермінована збірка канонічного MADR 4.0.0.
/// Байтова відповідність JS-версії критична: гейт `validate_madr` і людські
/// diff-и дивляться на той самий текст.
#[must_use]
pub fn assemble_madr(title: &str, date: &str, s: &Sections) -> String {
    let no_dot = |x: &str| RE_TRAIL_DOT.replace(x, "").into_owned();
    let opt_block = if s.options.is_empty() {
        "Інші варіанти не обговорювалися.".to_string()
    } else {
        s.options
            .iter()
            .map(|o| format!("* {o}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let cons: Vec<String> = s
        .good
        .iter()
        .map(|g| format!("* Good, because {}.", no_dot(g)))
        .chain(
            s.bad
                .iter()
                .map(|b| format!("* Bad, because {}.", no_dot(b))),
        )
        .collect();
    let cons_block = if cons.is_empty() {
        "Підтверджених наслідків не зафіксовано.".to_string()
    } else {
        cons.join("\n")
    };
    let outcome = if !s.chosen.is_empty() {
        let because = if s.rationale.is_empty() {
            String::new()
        } else {
            format!(", because {}", no_dot(&s.rationale))
        };
        format!("Chosen option: \"{}\"{because}.", s.chosen)
    } else if !s.rationale.is_empty() {
        format!("{}.", no_dot(&s.rationale))
    } else {
        "Рішення зафіксовано у чернетці.".to_string()
    };
    let title_yaml = title.replace('\\', "\\\\").replace('"', "\\\"");
    [
        "---".to_string(),
        "type: ADR".to_string(),
        format!("title: \"{title_yaml}\""),
        "---".to_string(),
        String::new(),
        "**Status:** Accepted".to_string(),
        format!("**Date:** {date}"),
        String::new(),
        "## Context and Problem Statement".to_string(),
        if s.context.is_empty() {
            "Контекст не зафіксовано у чернетці.".to_string()
        } else {
            s.context.clone()
        },
        String::new(),
        "## Considered Options".to_string(),
        opt_block,
        String::new(),
        "## Decision Outcome".to_string(),
        outcome,
        String::new(),
        "### Consequences".to_string(),
        cons_block,
        String::new(),
        "## More Information".to_string(),
        if s.more.is_empty() {
            "Додаткової інформації не зафіксовано.".to_string()
        } else {
            s.more.clone()
        },
        String::new(),
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_sections() -> Sections {
        Sections {
            context: "Проблема вибору сервера.".to_string(),
            options: vec!["omlx".to_string(), "llama.cpp".to_string()],
            chosen: "omlx".to_string(),
            rationale: "швидший prefill".to_string(),
            good: vec!["швидко".to_string()],
            bad: vec!["менше спільнота.".to_string()],
            more: "`docs/omlx.md`".to_string(),
        }
    }

    #[test]
    fn assembled_madr_passes_validation() {
        let content = assemble_madr("Вибір сервера", "2026-08-01", &full_sections());
        let v = validate_madr(&content);
        assert!(v.ok, "{:?}", v.errors);
        assert!(content.contains("Chosen option: \"omlx\", because швидший prefill."));
        assert!(
            content.contains("* Bad, because менше спільнота."),
            "кінцева крапка знята перед шаблонною"
        );
        assert!(content.ends_with("`docs/omlx.md`\n"));
    }

    #[test]
    fn validation_names_each_failure() {
        let v = validate_madr("---\nsession: x\n---\nкоротко");
        assert!(!v.ok);
        assert!(v.errors.iter().any(|e| e == "too short"));
        assert!(v
            .errors
            .iter()
            .any(|e| e == "missing OKF type: ADR frontmatter"));
        assert!(v.errors.iter().any(|e| e == "leaked session: field"));
        assert!(v.errors.iter().any(|e| e.starts_with("missing heading")));
    }

    #[test]
    fn sections_tolerate_small_model_output() {
        let raw = serde_json::json!({
            "context": "  ctx  ",
            "options": "один варіант",
            "chosen": null,
            "good": ["", "плюс"],
            "bad": 42,
            "more": null
        });
        let s = normalize_sections(&raw);
        assert_eq!(s.context, "ctx");
        assert_eq!(s.options, vec!["один варіант"]);
        assert_eq!(s.chosen, "");
        assert_eq!(s.good, vec!["плюс"]);
        assert_eq!(s.bad, vec!["42"]);
    }

    #[test]
    fn slug_and_date_ports() {
        assert_eq!(slugify("Вибір OMLX-сервера!"), "вибір-omlx-сервера");
        assert_eq!(slugify("///"), "adr");
        assert_eq!(madr_date(Some("2026-08-01T12:00:00Z"), ""), "2026-08-01");
        assert_eq!(madr_date(None, "260801-1200-x.md"), "2026-08-01");
        assert_eq!(madr_date(Some("сміття"), "без-префікса.md"), "");
    }

    #[test]
    fn empty_sections_get_fallback_phrases() {
        let content = assemble_madr("t", "2026-01-01", &Sections::default());
        assert!(content.contains("Контекст не зафіксовано у чернетці."));
        assert!(content.contains("Інші варіанти не обговорювалися."));
        assert!(content.contains("Рішення зафіксовано у чернетці."));
        assert!(content.contains("Підтверджених наслідків не зафіксовано."));
        assert!(content.contains("Додаткової інформації не зафіксовано."));
    }
}
