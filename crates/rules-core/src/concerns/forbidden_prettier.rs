//! Native-порт `text/forbidden-prettier`
//! (`npm/rules/text/forbidden-prettier/main.mjs`, 56 рядків) — жоден
//! Prettier-конфіг чи ignore-файл не має лежати в корені проєкту
//! (`text.mdc`).
//!
//! Порт 1:1: той самий список файлів, той самий порядок перевірки
//! (детермінує порядок violations у виводі), той самий текст повідомлення.

use std::path::Path;

use crate::diagnostics::{Severity, Violation};

/// Стабільний machine code — дзеркало дефолтного `reason` JS-версії:
/// `fail(msg)` без `opts` кладе `reason = ctx.concernId`, а `concernId`, з
/// яким реально запускається цей concern у runner-і
/// (`run-detectors.mjs:533` — `entry.concern.name`), це basename каталогу
/// `forbidden-prettier` (не складений `ruleId/concernId`-ключ registry).
const REASON: &str = "forbidden-prettier";

/// Файли, які Prettier шукає у корені; всі заборонені (`text.mdc`) — точна
/// копія `FORBIDDEN_PRETTIER_FILES` (`main.mjs:8-29`), включно з порядком.
const FORBIDDEN_PRETTIER_FILES: &[&str] = &[
    ".prettierignore",
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.jsonc",
    ".prettierrc.json5",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    ".prettierrc.toml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.ts",
    ".prettierrc.cts",
    ".prettierrc.mts",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
    "prettier.config.ts",
    "prettier.config.cts",
    "prettier.config.mts",
];

/// Перевіряє, що жоден Prettier-конфіг чи ignore-файл не лежить у корені
/// `cwd` — точний порт `lint(ctx)` (`main.mjs:36-56`), без `ctx`/reporter:
/// `pass()` у JS — no-op (успіх не накопичує violation, `violation-reporter.mjs:29-31`),
/// тут просто немає відповідного виклику при порожньому результаті.
pub fn forbidden_prettier(cwd: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();
    for file in FORBIDDEN_PRETTIER_FILES {
        if !cwd.join(file).exists() {
            continue;
        }
        violations.push(Violation {
            reason: REASON.to_string(),
            message: format!(
                "{file} заборонено — Prettier не використовуємо, перейди на oxfmt (text.mdc)"
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Дзеркало JS-тесту «успіх: жодного Prettier-артефакту в корені → exit 0»
    /// (`tests/forbidden-prettier.test.mjs:23-28`).
    #[test]
    fn no_forbidden_files_no_violations() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("package.json"), "{}\n").unwrap();
        assert!(forbidden_prettier(tmp.path()).is_empty());
    }

    /// Дзеркало «порушення: .prettierignore у корені → exit 1» (`:30-35`).
    #[test]
    fn prettierignore_in_root_is_violation() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".prettierignore"), "dist\n").unwrap();
        let violations = forbidden_prettier(tmp.path());
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "forbidden-prettier");
        assert_eq!(
            violations[0].message,
            ".prettierignore заборонено — Prettier не використовуємо, перейди на oxfmt (text.mdc)"
        );
        assert!(violations[0].file.is_none());
        assert!(violations[0].data.is_none());
        assert_eq!(violations[0].severity, Severity::Error);
    }

    /// Дзеркало «порушення: .prettierrc у корені → exit 1» (`:37-42`).
    #[test]
    fn prettierrc_in_root_is_violation() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".prettierrc"), "{}\n").unwrap();
        assert_eq!(forbidden_prettier(tmp.path()).len(), 1);
    }

    /// Дзеркало «порушення: prettier.config.mjs у корені → exit 1» (`:44-49`).
    #[test]
    fn prettier_config_mjs_in_root_is_violation() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("prettier.config.mjs"),
            "export default {}\n",
        )
        .unwrap();
        assert_eq!(forbidden_prettier(tmp.path()).len(), 1);
    }

    /// Дзеркало «порушення: .prettierrc.yaml у корені → exit 1» (`:51-56`).
    #[test]
    fn prettierrc_yaml_in_root_is_violation() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".prettierrc.yaml"), "semi: false\n").unwrap();
        assert_eq!(forbidden_prettier(tmp.path()).len(), 1);
    }

    /// Кілька заборонених файлів одночасно → по одному violation на кожен,
    /// у порядку `FORBIDDEN_PRETTIER_FILES` (не покрито окремим JS-тестом,
    /// але дзеркалить цикл `main.mjs:43-50`).
    #[test]
    fn multiple_forbidden_files_yield_multiple_violations_in_list_order() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("prettier.config.js"), "").unwrap();
        fs::write(tmp.path().join(".prettierignore"), "").unwrap();
        let violations = forbidden_prettier(tmp.path());
        assert_eq!(violations.len(), 2);
        assert!(violations[0].message.starts_with(".prettierignore"));
        assert!(violations[1].message.starts_with("prettier.config.js"));
    }
}
