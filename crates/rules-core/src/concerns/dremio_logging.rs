//! Native-порт `k8s/dremio_logging` (`npm/rules/k8s/dremio_logging/main.mjs`,
//! 67 рядків) — JS-доповнення до rego-policy-частини цього ж concern-а
//! (яка тут НЕ портується — rego-шлях лишається в JS/conftest, спека вимагає
//! порт лише `main.mjs`).
//!
//! `main.mjs` перевіряє один конкретний vendored Helm-темплейт —
//! `dremio_v2/templates/zookeeper.yaml` (Go-template синтаксис, тому не
//! валідний YAML/XML і conftest його розпарсити не може). Якщо файл визначає
//! `ConfigMap` з ключем `data["logback.xml"]` (bundled-конфіг образу
//! `zookeeper:3.8.4-jre-17`), його `<root level="...">` має бути
//! `warn`/`error`/`off`, не `info` (дефолт бандлованого файлу) — інакше
//! readiness/liveness-проби (`ruok`, кожні ~10s) заливають Cloud Logging на
//! INFO незалежно від навантаження.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::diagnostics::{Severity, Violation};

/// Порт `ROOT_LEVEL_RE` (`main.mjs:24`, `/<root\s+level\s*=\s*["']([^"']+)["']/iu`).
static ROOT_LEVEL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)<root\s+level\s*=\s*["']([^"']+)["']"#).expect("valid regex")
});

/// Порт `LOGBACK_XML_KEY_RE` (`main.mjs:25`, `/logback\.xml:\s*\|/u`).
static LOGBACK_XML_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"logback\.xml:\s*\|").expect("valid regex"));

/// Порт `ALLOWED_ROOT_LEVELS` (`main.mjs:26`).
const ALLOWED_ROOT_LEVELS: &[&str] = &["warn", "error", "off"];

/// Стабільний machine code — точна копія явного `reason`, який JS-версія
/// передає в `fail(msg, 'zk-logback-root-level')` (`main.mjs:63`), а не
/// дефолт `ctx.concernId` (на відміну від `forbidden_prettier`/`sample_secret`,
/// цей concern явно перекриває reason для свого єдиного типу порушення).
const REASON: &str = "zk-logback-root-level";

/// Чи файл (Helm-темплейт ZooKeeper) визначає вбудований `logback.xml` з
/// надто гучним `<root level="...">` (info/debug/trace, чи взагалі відсутній
/// тег root) — точний порт `zkLogbackRootLevelViolation` (`main.mjs:35-44`).
///
/// Повертає `None`, якщо `logback.xml`-блоку немає (нема чого перевіряти) чи
/// `root level` вже `warn`/`error`/`off`.
pub fn zk_logback_root_level_violation(content: &str) -> Option<String> {
    if !LOGBACK_XML_KEY_RE.is_match(content) {
        return None; // немає вбудованого logback.xml — не наша справа
    }
    let Some(caps) = ROOT_LEVEL_RE.captures(content) else {
        return Some(
            "zookeeper.yaml: вбудований logback.xml без <root level=\"...\"> — додай ConfigMap-оверрайд з level=\"warn\" (k8s.mdc)"
                .to_string(),
        );
    };
    let level_raw = &caps[1];
    let level_lower = level_raw.to_lowercase();
    if ALLOWED_ROOT_LEVELS.contains(&level_lower.as_str()) {
        return None;
    }
    Some(format!(
        "zookeeper.yaml: вбудований logback.xml має <root level=\"{level_raw}\"> — постав \"warn\" або строгіше (error/off), бо ruok-проби кожні ~10s заливають Cloud Logging на INFO (k8s.mdc)"
    ))
}

/// Detector `k8s/dremio_logging` для ZooKeeper-темплейту (per-file,
/// read-only) — точний порт `lint(ctx)` (`main.mjs:51-67`).
///
/// `files` дзеркалить `ctx.files ?? []` (`main.mjs:55`): `None` чи порожній
/// список → жодних ітерацій, жодних violations (той самий whole-repo-байпас,
/// що й у JS — цей concern per-file, whole-repo прогін для нього не
/// визначений).
pub fn dremio_logging(cwd: &Path, files: Option<&[String]>) -> Vec<Violation> {
    let mut violations = Vec::new();
    for rel in files.unwrap_or(&[]) {
        let abs = cwd.join(rel);
        // Лояльне UTF-8 декодування — той самий fail-safe принцип, що й у
        // `sample_secret` (doc-комент там): I/O-помилка → пропустити файл
        // (`try { ... } catch { continue }`, `main.mjs:56-61`).
        let bytes = match std::fs::read(&abs) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let content = String::from_utf8_lossy(&bytes);
        let Some(violation_text) = zk_logback_root_level_violation(&content) else {
            continue;
        };
        violations.push(Violation {
            reason: REASON.to_string(),
            message: format!("{rel}: {violation_text}"),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    violations
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::concerns::test_support::write;

    // --- zk_logback_root_level_violation: дзеркало tests/zk-logback-root-level.test.mjs ---

    /// «немає вбудованого logback.xml — null (не наша справа)» (`:10-13`).
    #[test]
    fn no_logback_block_returns_none() {
        let src = "apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: zk\n";
        assert_eq!(zk_logback_root_level_violation(src), None);
    }

    /// «root level="WARN" — null (валідно)» (`:15-27`).
    #[test]
    fn root_level_warn_is_valid() {
        let src = [
            "data:",
            "  logback.xml: |",
            "    <configuration>",
            "      <root level=\"WARN\">",
            "        <appender-ref ref=\"CONSOLE\" />",
            "      </root>",
            "    </configuration>",
            "",
        ]
        .join("\n");
        assert_eq!(zk_logback_root_level_violation(&src), None);
    }

    /// «root level="ERROR"/"OFF" — теж валідно (строгіше за warn)» (`:29-34`).
    #[test]
    fn root_level_error_and_off_are_valid_any_case() {
        for level in ["ERROR", "OFF", "error", "off"] {
            let src = format!("data:\n  logback.xml: |\n    <root level=\"{level}\">\n");
            assert_eq!(zk_logback_root_level_violation(&src), None, "level={level}");
        }
    }

    /// «root level="INFO" — порушення» (`:36-50`).
    #[test]
    fn root_level_info_is_violation() {
        let src = [
            "data:",
            "  logback.xml: |",
            "    <configuration>",
            "      <root level=\"INFO\">",
            "        <appender-ref ref=\"CONSOLE\" />",
            "      </root>",
            "    </configuration>",
            "",
        ]
        .join("\n");
        let v = zk_logback_root_level_violation(&src);
        assert!(v.is_some());
        assert!(v.unwrap().contains("INFO"));
    }

    /// «логер-вміст присутній, але <root> відсутній — порушення» (`:52-58`).
    #[test]
    fn missing_root_tag_is_violation() {
        let src = "data:\n  logback.xml: |\n    <configuration>\n      <appender name=\"CONSOLE\" />\n    </configuration>\n";
        let v = zk_logback_root_level_violation(src);
        assert!(v.is_some());
        assert!(v.unwrap().contains("без <root level"));
    }

    /// «case-insensitive: level="Warn" — валідно» (`:60-63`).
    #[test]
    fn root_level_mixed_case_warn_is_valid() {
        let src = "data:\n  logback.xml: |\n    <root level=\"Warn\">\n";
        assert_eq!(zk_logback_root_level_violation(src), None);
    }

    // --- dremio_logging(cwd, files): per-file detector-обгортка ---

    /// `files: None` → жодних ітерацій, жодних violations (дзеркало
    /// `ctx.files ?? []` при `undefined`, `main.mjs:55`).
    #[test]
    fn none_files_yields_no_violations() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(dremio_logging(tmp.path(), None).is_empty());
    }

    /// `files: Some(&[])` (порожній список) — той самий байпас, що й `None`.
    #[test]
    fn empty_files_yields_no_violations() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(dremio_logging(tmp.path(), Some(&[])).is_empty());
    }

    /// Порушення на конкретному файлі зі списку `files` → reason
    /// `"zk-logback-root-level"`, message з префіксом відносного шляху.
    #[test]
    fn violation_on_listed_file_has_explicit_reason_and_path_prefix() {
        let tmp = tempfile::TempDir::new().unwrap();
        let rel = "dremio_v2/templates/zookeeper.yaml";
        write(
            &tmp,
            rel,
            "data:\n  logback.xml: |\n    <root level=\"info\">\n",
        );
        let violations = dremio_logging(tmp.path(), Some(&[rel.to_string()]));
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "zk-logback-root-level");
        assert!(violations[0].message.starts_with(rel));
        assert!(violations[0].message.contains("INFO") || violations[0].message.contains("info"));
        assert!(violations[0].file.is_none());
        assert!(violations[0].data.is_none());
        assert_eq!(violations[0].severity, Severity::Error);
    }

    /// Валідний файл (WARN) у `files` → без violations.
    #[test]
    fn valid_listed_file_yields_no_violations() {
        let tmp = tempfile::TempDir::new().unwrap();
        let rel = "dremio_v2/templates/zookeeper.yaml";
        write(
            &tmp,
            rel,
            "data:\n  logback.xml: |\n    <root level=\"warn\">\n",
        );
        assert!(dremio_logging(tmp.path(), Some(&[rel.to_string()])).is_empty());
    }

    /// Файл зі списку `files`, якого немає на диску — пропускається
    /// (`try { ... } catch { continue }`, `main.mjs:56-61`), не фатальна помилка.
    #[test]
    fn missing_listed_file_is_skipped_not_fatal() {
        let tmp = tempfile::TempDir::new().unwrap();
        let violations = dremio_logging(tmp.path(), Some(&["nope.yaml".to_string()]));
        assert!(violations.is_empty());
    }
}
