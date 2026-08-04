//! Native-порт `security/trufflehog` (`npm/rules/security/trufflehog/main.mjs`,
//! 45 рядків) — security.mdc: наявність `package.json` і `.trufflehog-exclude`
//! у корені репо, з канонічним вмістом останнього (subset-перевірка супроти
//! `templates/trufflehog/.trufflehog-exclude.snippet.txt`).
//!
//! Канонічний сніпет вбудовується в бінарник через `include_str!` на етапі
//! компіляції (JS-версія читала той самий файл у runtime, відносно
//! `import.meta.url` свого `main.mjs`, — шляху, якого в скомпільованому
//! бінарному файлі немає; вміст стабільний і живе в репо поряд із
//! detector-ом, тож compile-time embed відтворює той самий канон без
//! залежності від шляху встановленого npm-пакета в runtime). Сам
//! файл-шаблон і `templates/`-каталог лишаються на місці — не видаляються.

use std::path::Path;

use crate::concerns::template_subset::check_text_subset;
use crate::diagnostics::{Severity, Violation};

/// Канонічний вміст `.trufflehog-exclude` — порт `SNIPPET_PATH`
/// (`main.mjs:11`), вбудований на етапі компіляції.
const CANON_TRUFFLEHOG_EXCLUDE: &str =
    include_str!("../../../../npm/rules/security/trufflehog/templates/trufflehog/.trufflehog-exclude.snippet.txt");

/// Стабільний reason для всіх violations цього concern-а — дефолтний
/// `ctx.concernId` JS-reporter-а (`violation-reporter.mjs:27`); жоден
/// `fail()`-виклик у `main.mjs` не передає явний reason, тож усі падіння
/// звітуються з reason-ом самого concern-а.
const REASON: &str = "trufflehog";

fn fail(message: impl Into<String>) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message: message.into(),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `security/trufflehog` — точний порт `lint(ctx)` (`main.mjs:18-45`).
pub fn security_trufflehog(cwd: &Path) -> Vec<Violation> {
    if !cwd.join("package.json").exists() {
        return vec![fail(
            "package.json не знайдено в корені — додай (security.mdc)",
        )];
    }

    let truffle_path = cwd.join(".trufflehog-exclude");
    if !truffle_path.exists() {
        return vec![fail(
            ".trufflehog-exclude не знайдено в корені — додай за каноном (security.mdc)",
        )];
    }

    let actual = std::fs::read_to_string(&truffle_path).unwrap_or_default();
    let errors = check_text_subset(
        &actual,
        CANON_TRUFFLEHOG_EXCLUDE,
        ".trufflehog-exclude",
        "security.mdc",
    );
    errors.into_iter().map(fail).collect()
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    const CANON_EXCLUDE: &str = "(^|/)node_modules(/|$)\n(^|/)\\.git(/|$)\n(^|/)dist(/|$)\n(^|/)build(/|$)\n.*\\.lock$\n.*fixtures?/.*\n";

    #[test]
    fn fails_when_package_json_missing() {
        let tmp = TempDir::new().unwrap();
        assert!(!security_trufflehog(tmp.path()).is_empty());
    }

    #[test]
    fn fails_when_trufflehog_exclude_missing() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{}");
        assert!(!security_trufflehog(tmp.path()).is_empty());
    }

    #[test]
    fn fails_when_trufflehog_exclude_lacks_canonical_patterns() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{}");
        write(&tmp, ".trufflehog-exclude", "foo\n");
        assert!(!security_trufflehog(tmp.path()).is_empty());
    }

    #[test]
    fn passes_when_both_files_present_and_exclude_has_canonical_patterns() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{}");
        write(&tmp, ".trufflehog-exclude", CANON_EXCLUDE);
        assert!(security_trufflehog(tmp.path()).is_empty());
    }

    #[test]
    fn all_violations_use_concern_reason() {
        let tmp = TempDir::new().unwrap();
        for v in security_trufflehog(tmp.path()) {
            assert_eq!(v.reason, "trufflehog");
        }
    }
}
