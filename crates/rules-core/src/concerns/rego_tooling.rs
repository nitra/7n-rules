//! Native-порт `rego/tooling` (`npm/rules/rego/tooling/main.mjs`, 25 рядків) —
//! `.regal/config.yaml` має існувати у корені проєкту (`rego.mdc`).

use std::path::Path;

use crate::diagnostics::{Severity, Violation};

/// Стабільний machine code — дефолтний `reason` JS-версії (`fail(msg)` без
/// `opts` → `reason = ctx.concernId`, `entry.concern.name` = basename
/// каталогу `tooling`, той самий принцип, що й `forbidden_prettier::REASON`).
const REASON: &str = "tooling";

/// Перевіряє наявність `.regal/config.yaml` у корені `cwd` — точний порт
/// `lint(ctx)` (`main.mjs:12-25`).
pub fn rego_tooling(cwd: &Path) -> Vec<Violation> {
    if cwd.join(".regal").join("config.yaml").exists() {
        return Vec::new();
    }
    vec![Violation {
        reason: REASON.to_string(),
        message: ".regal/config.yaml не існує — створи у корені проєкту (rego.mdc)".to_string(),
        file: None,
        severity: Severity::Error,
        data: None,
    }]
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// «успіх: .regal/config.yaml існує → 0 violations» (`tests/tooling.test.mjs:14-24`).
    #[test]
    fn config_exists_no_violations() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join(".regal")).unwrap();
        fs::write(
            tmp.path().join(".regal").join("config.yaml"),
            "rules:\n  idiomatic:\n    no-defined-entrypoint:\n      level: ignore\n",
        )
        .unwrap();
        assert!(rego_tooling(tmp.path()).is_empty());
    }

    /// «порушення: .regal/config.yaml відсутній → violation» (`:26-31`).
    #[test]
    fn missing_regal_dir_is_violation() {
        let tmp = TempDir::new().unwrap();
        let violations = rego_tooling(tmp.path());
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "tooling");
        assert_eq!(
            violations[0].message,
            ".regal/config.yaml не існує — створи у корені проєкту (rego.mdc)"
        );
        assert!(violations[0].file.is_none());
        assert!(violations[0].data.is_none());
        assert_eq!(violations[0].severity, Severity::Error);
    }

    /// «порушення: є .regal/ без config.yaml → violation» (`:33-39`).
    #[test]
    fn regal_dir_without_config_is_violation() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join(".regal")).unwrap();
        assert_eq!(rego_tooling(tmp.path()).len(), 1);
    }
}
