//! Порт парсера `concern.json` (`npm/scripts/lib/concern-meta.mjs`) і
//! discovery концернів правил (`readLintConcernsByRule` +
//! `asDetectorConcern`/`deriveLintFromPolicy` з
//! `npm/scripts/lib/lint-surface/run-detectors.mjs`) — зріз 3 фази 8
//! (`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! Це «meta.json у Rust» із плану зрізу: фактичне джерело правди про
//! поверхні правила — `rules/<id>/<concern>/concern.json` (файл `main.json`
//! у `rules/<id>/` описує ЛИШЕ автодетект правила й lint-контуру не
//! стосується — див. `npm/scripts/lib/rule-meta.mjs`), тож портується саме
//! він.
//!
//! Порт 1:1, включно з крайовими:
//! - невалідний/відсутній `concern.json`, `raw` не обʼєкт → концерн
//!   пропускається;
//! - `lint` із невідомим `scope` → увесь концерн невалідний (JS повертає
//!   `null` із `readConcernMeta`), на відміну від відсутнього блоку `lint`;
//! - концерн без жодної з поверхонь `check`/`policy`/`lint` — пропускається;
//! - policy-концерн без явного `lint` отримує ПОХІДНУ lint-поверхню
//!   (`scope: full`, glob із `policy.files`), і лише якщо `files`
//!   резолвиться (`single`-рядок або будь-який `walkGlob`); інакше це
//!   rego-бібліотека для parent-orchestrator-а, не самостійний detector;
//! - порядок концернів у правилі — за іменем через
//!   [`crate::locale::locale_compare`] (JS `toSorted(localeCompare)`).

use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use crate::locale::locale_compare;

/// Область lint-поверхні концерну.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LintScope {
    /// `per-file` — концерн отримує підмножину змінених файлів.
    PerFile,
    /// `full` — концерн запускається на всьому репозиторії.
    Full,
}

impl LintScope {
    /// Рядкове представлення для DTO `rules_core::lint_plan`.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PerFile => "per-file",
            Self::Full => "full",
        }
    }
}

/// Lint-поверхня концерну (порт `LintSurface`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LintSurface {
    /// Область прогону.
    pub scope: LintScope,
    /// Нормалізований масив глобів (порожній — «без glob»).
    pub glob: Vec<String>,
}

/// Двигун policy-поверхні (порт `PolicySurface.engine`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyEngine {
    /// Rego-політика (дефолт).
    Rego,
    /// Template-перевірка (у т.ч. виведена з legacy `check: "template"`).
    Template,
}

/// Значення `policy.files.walkGlob` — форма важлива, бо `asDetectorConcern`
/// перевіряє саме «поле присутнє», а `deriveLintFromPolicy` розрізняє
/// масив і рядок.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalkGlob {
    /// Поля немає.
    Absent,
    /// Рядок — один glob.
    One(String),
    /// Масив глобів (не-рядкові елементи відкинуто).
    Many(Vec<String>),
    /// Поле є, але іншого типу (число/обʼєкт) — резолвить концерн у
    /// detector, проте власних глобів не дає.
    Other,
}

/// Опис файлів policy-поверхні (порт `PolicySurface.files`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyFiles {
    /// `files.single` — рядок або `None`.
    pub single: Option<String>,
    /// `files.walkGlob` у сирій формі.
    pub walk_glob: WalkGlob,
}

/// Policy-поверхня концерну (порт `PolicySurface`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicySurface {
    /// Канонічний двигун.
    pub engine: PolicyEngine,
    /// Блок `files` (може бути відсутній — тоді концерн не самостійний).
    pub files: Option<PolicyFiles>,
    /// Повідомлення про відсутній файл.
    pub missing_message: Option<String>,
}

/// Маршрутизація fix-движка (порт `Fixability`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fixability {
    /// Дефолт — ladder-eligible.
    Code,
    /// Конфігураційний фікс, поза LLM-ladder.
    Config,
    /// Структурний фікс, поза LLM-ladder.
    Structural,
}

/// Нормалізовані метадані одного концерну (порт `ConcernMeta`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcernMeta {
    /// Імʼя концерну (basename каталогу).
    pub name: String,
    /// Абсолютний шлях каталогу концерну.
    pub dir: PathBuf,
    /// Чи є JS check-поверхня.
    pub check: bool,
    /// Policy-поверхня.
    pub policy: Option<PolicySurface>,
    /// Lint-поверхня.
    pub lint: Option<LintSurface>,
    /// `requires.capability` — концерн активний лише з відповідним плагіном.
    pub requires_capability: Option<String>,
    /// Маршрутизація fix-движка.
    pub fixability: Fixability,
    /// Пропустити local-tier rung-и LLM-ladder.
    pub skip_local_tier: bool,
    /// Власний бюджет cloud-rung-а (мс).
    pub cloud_timeout_ms: Option<u64>,
    /// `fixHint` — рецепт для МОДЕЛІ, коли повідомлення детектора адресоване
    /// людині й радить команду, якої в циклу немає (`llm_lib::fix::FixRequest`).
    pub fix_hint: Option<String>,
}

/// Читає й нормалізує `concern.json` каталогу концерну (порт
/// `readConcernMeta`). `None` — файлу немає, він невалідний, або концерн не
/// має жодної поверхні.
#[must_use]
pub fn read_concern_meta(concern_dir: &Path, name: &str) -> Option<ConcernMeta> {
    let text = std::fs::read_to_string(concern_dir.join("concern.json")).ok()?;
    let raw: serde_json::Value = serde_json::from_str(&text).ok()?;
    let raw = raw.as_object()?;

    // `null` у `parseLintSurface` означає «є блок lint, але scope невідомий»
    // — тоді весь концерн невалідний (окремо від «блоку немає»).
    let lint = match parse_lint_surface(raw.get("lint")) {
        Ok(lint) => lint,
        Err(()) => return None,
    };
    let policy = parse_policy_surface(raw.get("policy"));
    let check = raw.get("check") == Some(&serde_json::Value::Bool(true));

    if !check && policy.is_none() && lint.is_none() {
        return None;
    }

    Some(ConcernMeta {
        name: name.to_string(),
        dir: concern_dir.to_path_buf(),
        check,
        policy,
        lint,
        requires_capability: raw
            .get("requires")
            .and_then(|value| value.get("capability"))
            .and_then(|value| value.as_str())
            .map(String::from),
        fixability: match raw.get("fixability").and_then(|value| value.as_str()) {
            Some("config") => Fixability::Config,
            Some("structural") => Fixability::Structural,
            _ => Fixability::Code,
        },
        skip_local_tier: raw.get("skipLocalTier") == Some(&serde_json::Value::Bool(true)),
        cloud_timeout_ms: raw
            .get("cloudTimeoutMs")
            .and_then(serde_json::Value::as_u64)
            .filter(|ms| *ms > 0),
        // Порожній рядок відкидаємо як відсутність: підказка, що нічого не
        // каже, у промпті гірша за її брак — вона займає місце й натякає, що
        // рецепт уже дано.
        fix_hint: raw
            .get("fixHint")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|hint| !hint.is_empty())
            .map(String::from),
    })
}

/// Сканує підкаталоги `rule_dir` і повертає всі концерни, впорядковані за
/// іменем (порт `listConcerns`). Недоступний каталог → порожньо.
#[must_use]
pub fn list_concerns(rule_dir: &Path) -> Vec<ConcernMeta> {
    let mut out: Vec<ConcernMeta> = subdirectory_names(rule_dir)
        .iter()
        .filter_map(|name| read_concern_meta(&rule_dir.join(name), name))
        .collect();
    out.sort_by(|a, b| locale_compare(&a.name, &b.name));
    out
}

/// Концерни правила, придатні як detector-и (порт `asDetectorConcern`):
/// концерн із явним `lint` береться як є, policy-концерн без `lint` отримує
/// похідну поверхню. Решта відкидається — у результаті кожен елемент має
/// `lint == Some(_)`.
#[must_use]
pub fn list_detector_concerns(rule_dir: &Path) -> Vec<ConcernMeta> {
    list_concerns(rule_dir)
        .into_iter()
        .filter_map(as_detector_concern)
        .collect()
}

/// Імена підкаталогів (без прихованих), відсортовані байтово — порядок
/// читання, який далі перекриває сортування за локаллю.
#[must_use]
pub fn subdirectory_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().to_str().map(String::from))
        .filter(|name| !name.starts_with('.'))
        .collect();
    names.sort_by(|a: &String, b: &String| -> Ordering { a.cmp(b) });
    names
}

/// Концерн із гарантованою lint-поверхнею або `None`.
fn as_detector_concern(concern: ConcernMeta) -> Option<ConcernMeta> {
    if concern.lint.is_some() {
        return Some(concern);
    }
    let files = concern.policy.as_ref()?.files.as_ref()?;
    // Резолвиться, лише якщо є `single`-рядок або будь-який `walkGlob`.
    if files.single.is_none() && files.walk_glob == WalkGlob::Absent {
        return None;
    }
    let lint = derive_lint_from_policy(files);
    Some(ConcernMeta {
        lint: Some(lint),
        ..concern
    })
}

/// Похідна lint-поверхня policy-концерну (порт `deriveLintFromPolicy`):
/// `scope: full`, глоби з `policy.files` — щоб delta-режим тригерив концерн
/// на зміні таргета.
fn derive_lint_from_policy(files: &PolicyFiles) -> LintSurface {
    let glob = if let Some(single) = files.single.clone() {
        vec![single]
    } else {
        match &files.walk_glob {
            WalkGlob::Many(globs) => globs.clone(),
            WalkGlob::One(glob) => vec![glob.clone()],
            WalkGlob::Absent | WalkGlob::Other => Vec::new(),
        }
    };
    LintSurface {
        scope: LintScope::Full,
        glob,
    }
}

/// Порт `parseLintSurface`: `Ok(None)` — блоку немає; `Err(())` — блок є, але
/// `scope` невідомий (весь концерн невалідний).
fn parse_lint_surface(raw: Option<&serde_json::Value>) -> Result<Option<LintSurface>, ()> {
    let Some(raw) = raw.filter(|value| value.is_object() || value.is_array()) else {
        return Ok(None);
    };
    let scope = match raw.get("scope").and_then(|value| value.as_str()) {
        Some("per-file") => LintScope::PerFile,
        Some("full") => LintScope::Full,
        _ => return Err(()),
    };
    Ok(Some(LintSurface {
        scope,
        glob: string_or_string_array(raw.get("glob")),
    }))
}

/// Порт `parsePolicySurface` (engine derived з legacy `check: "template"`).
fn parse_policy_surface(raw: Option<&serde_json::Value>) -> Option<PolicySurface> {
    let raw = raw.filter(|value| value.is_object() || value.is_array())?;
    let legacy_template = raw.get("check").and_then(|value| value.as_str()) == Some("template");
    let engine = match raw.get("engine").and_then(|value| value.as_str()) {
        Some("template") => PolicyEngine::Template,
        Some("rego") => PolicyEngine::Rego,
        _ => {
            if legacy_template {
                PolicyEngine::Template
            } else {
                PolicyEngine::Rego
            }
        }
    };
    Some(PolicySurface {
        engine,
        files: raw
            .get("files")
            .filter(|value| value.is_object())
            .map(|files| PolicyFiles {
                single: files
                    .get("single")
                    .and_then(|value| value.as_str())
                    .map(String::from),
                walk_glob: match files.get("walkGlob") {
                    None => WalkGlob::Absent,
                    Some(serde_json::Value::String(glob)) => WalkGlob::One(glob.clone()),
                    Some(serde_json::Value::Array(items)) => WalkGlob::Many(
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(String::from))
                            .collect(),
                    ),
                    Some(_) => WalkGlob::Other,
                },
            }),
        missing_message: raw
            .get("missingMessage")
            .and_then(|value| value.as_str())
            .map(String::from),
    })
}

/// Нормалізує `string | string[] | інше` у масив рядків (дзеркало
/// нормалізації `glob` у `parseLintSurface`).
fn string_or_string_array(raw: Option<&serde_json::Value>) -> Vec<String> {
    match raw {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str().map(String::from))
            .collect(),
        Some(serde_json::Value::String(single)) => vec![single.clone()],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn concern(root: &Path, rule: &str, name: &str, json: &str) {
        let dir = root.join(rule).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("concern.json"), json).unwrap();
    }

    /// `fixHint` доїжджає до метаданих — саме звідси його бере промпт циклу
    /// для concern-ів, чиє повідомлення радить недосяжну команду.
    #[test]
    fn reads_fix_hint() {
        let tmp = TempDir::new().unwrap();
        concern(
            tmp.path(),
            "changelog",
            "presence",
            r#"{"check":true,"fixHint":"створи `.changes/<імʼя>.md` з `bump:` і `section:`"}"#,
        );
        let concerns = list_concerns(&tmp.path().join("changelog"));
        assert_eq!(
            concerns[0].fix_hint.as_deref(),
            Some("створи `.changes/<імʼя>.md` з `bump:` і `section:`")
        );
    }

    /// Порожня (чи пробільна) підказка = її немає: у промпті вона зайняла б
    /// місце й натякнула, що рецепт уже дано, нічого не сказавши.
    #[test]
    fn blank_fix_hint_is_absent() {
        let tmp = TempDir::new().unwrap();
        concern(
            tmp.path(),
            "changelog",
            "presence",
            r#"{"check":true,"fixHint":"   "}"#,
        );
        let concerns = list_concerns(&tmp.path().join("changelog"));
        assert!(concerns[0].fix_hint.is_none());
    }

    /// Поле опційне: переважна більшість concern-ів його не має.
    #[test]
    fn missing_fix_hint_is_none() {
        let tmp = TempDir::new().unwrap();
        concern(tmp.path(), "changelog", "presence", r#"{"check":true}"#);
        let concerns = list_concerns(&tmp.path().join("changelog"));
        assert!(concerns[0].fix_hint.is_none());
    }

    #[test]
    fn reads_lint_surface_and_normalizes_glob() {
        let tmp = TempDir::new().unwrap();
        concern(
            tmp.path(),
            "js",
            "eslint",
            r#"{"lint":{"scope":"per-file","glob":"**/*.js"},"check":true,"fixability":"config"}"#,
        );
        let concerns = list_concerns(&tmp.path().join("js"));
        assert_eq!(concerns.len(), 1);
        let meta = &concerns[0];
        assert_eq!(meta.name, "eslint");
        assert!(meta.check);
        assert_eq!(meta.fixability, Fixability::Config);
        assert_eq!(
            meta.lint,
            Some(LintSurface {
                scope: LintScope::PerFile,
                glob: vec!["**/*.js".to_string()]
            })
        );
    }

    #[test]
    fn invalid_scope_drops_the_whole_concern() {
        let tmp = TempDir::new().unwrap();
        concern(
            tmp.path(),
            "js",
            "broken",
            r#"{"lint":{"scope":"кожен-другий"},"check":true}"#,
        );
        assert!(list_concerns(&tmp.path().join("js")).is_empty());
    }

    #[test]
    fn concern_without_any_surface_is_skipped() {
        let tmp = TempDir::new().unwrap();
        concern(tmp.path(), "js", "docs-only", r#"{"fixability":"code"}"#);
        assert!(list_concerns(&tmp.path().join("js")).is_empty());
    }

    #[test]
    fn policy_concern_gets_derived_full_lint_surface() {
        let tmp = TempDir::new().unwrap();
        concern(
            tmp.path(),
            "k8s",
            "tree",
            r#"{"policy":{"files":{"walkGlob":["k8s/**/*.yaml"]}}}"#,
        );
        let detectors = list_detector_concerns(&tmp.path().join("k8s"));
        assert_eq!(
            detectors[0].lint,
            Some(LintSurface {
                scope: LintScope::Full,
                glob: vec!["k8s/**/*.yaml".to_string()]
            })
        );
    }

    #[test]
    fn policy_library_without_files_is_not_a_detector() {
        let tmp = TempDir::new().unwrap();
        concern(tmp.path(), "k8s", "lib", r#"{"policy":{"engine":"rego"}}"#);
        assert_eq!(list_concerns(&tmp.path().join("k8s")).len(), 1);
        assert!(list_detector_concerns(&tmp.path().join("k8s")).is_empty());
    }

    #[test]
    fn legacy_template_check_derives_engine() {
        let tmp = TempDir::new().unwrap();
        concern(
            tmp.path(),
            "ga",
            "workflow",
            r#"{"policy":{"check":"template","files":{"single":".github/workflows/ci.yml"}},"requires":{"capability":"ci:github"}}"#,
        );
        let detectors = list_detector_concerns(&tmp.path().join("ga"));
        let meta = &detectors[0];
        assert_eq!(meta.policy.as_ref().unwrap().engine, PolicyEngine::Template);
        assert_eq!(meta.requires_capability.as_deref(), Some("ci:github"));
        assert_eq!(
            meta.lint.as_ref().unwrap().glob,
            [".github/workflows/ci.yml"]
        );
    }

    #[test]
    fn concerns_are_sorted_by_locale_not_bytes() {
        let tmp = TempDir::new().unwrap();
        for name in ["a-b", "a_b", "Ab"] {
            concern(
                tmp.path(),
                "r",
                name,
                r#"{"lint":{"scope":"full","glob":[]}}"#,
            );
        }
        let names: Vec<String> = list_concerns(&tmp.path().join("r"))
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, ["a_b", "a-b", "Ab"]);
    }
}
