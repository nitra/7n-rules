//! Native-порт `text/formatting` (`npm/rules/text/formatting/main.mjs`, 149
//! рядків) — FS-existence текстового конфіг-стеку (`.v8rignore`,
//! `.oxfmtrc.json`, `.cspell.json`, `.markdownlint-cli2.jsonc`,
//! `.vscode/{extensions,settings}.json`), обов'язковий абзац про
//! **Український апостроф** у `n-text.mdc`/`text.mdc`, і CI-workflow
//! `lint-text.yml` (крок `n-rules lint text --no-fix`).
//!
//! Усі порушення цього concern-а мають `reason = "formatting"` — точний порт
//! JS-конвенції `createViolationReporter`: `fail(msg)` без явного `opts.reason`
//! дає `reason = ctx.concernId` (`violation-reporter.mjs:27,36`); жоден
//! call site в оригінальному `main.mjs` не передає явний reason. `pass()`
//! викликів (no-op у JS-репортері) тут немає взагалі — вони не впливають на
//! `violations`.

use std::path::Path;

use crate::concerns::gha_workflow::{any_run_step_includes, parse_workflow_yaml};
use crate::diagnostics::{Severity, Violation};

/// Стабільний reason для всіх violations цього concern-а (секція doc-коменту
/// модуля вище).
const REASON: &str = "formatting";

/// Заголовок абзацу про апостроф у text.mdc / n-text.mdc — порт
/// `UK_APOSTROPHE_HEADING` (`main.mjs:10`).
const UK_APOSTROPHE_HEADING: &str = "**Український апостроф:**";

/// Канонічний крок CI, який має викликати `lint-text.yml` — порт `canonRun`
/// (`main.mjs:113`).
const CANON_LINT_TEXT_RUN: &str = "n-rules lint text --no-fix";

fn fail(message: String) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Перевіряє абзац про український апостроф у вмісті правила text — точний
/// порт `verifyUkApostropheRuleParagraph` (`main.mjs:20-34`).
fn verify_uk_apostrophe_rule_paragraph(
    file_path: &str,
    body: &str,
    violations: &mut Vec<Violation>,
) {
    if !body.contains(UK_APOSTROPHE_HEADING) {
        violations.push(fail(format!(
            "{file_path}: додай абзац **Український апостроф:** (U+0027 / U+2019, масив words) — див. text.mdc"
        )));
        return;
    }
    if !body.contains("U+0027") || !body.contains("U+2019") {
        violations.push(fail(format!(
            "{file_path}: абзац про апостроф має містити позначки U+0027 та U+2019"
        )));
        return;
    }
    if !body.contains('’') {
        violations.push(fail(format!(
            "{file_path}: у прикладі має бути типографський символ U+2019 (’)"
        )));
    }
}

/// Перевіряє `.v8rignore` — точний порт `checkV8rIgnore` (`main.mjs:42-63`).
fn check_v8r_ignore(cwd: &Path, violations: &mut Vec<Violation>) {
    const REQUIRED: [&str; 2] = [".vscode/extensions.json", ".vscode/settings.json"];
    let v8r_path = cwd.join(".v8rignore");
    if !v8r_path.exists() {
        violations.push(fail(
            ".v8rignore не існує — створи згідно n-text.mdc (мінімум .vscode/extensions.json і .vscode/settings.json)"
                .to_string(),
        ));
        return;
    }
    let raw = std::fs::read_to_string(&v8r_path).unwrap_or_default();
    let lines: std::collections::HashSet<&str> = raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    for path in REQUIRED {
        if !lines.contains(path) {
            violations.push(fail(format!(
                ".v8rignore: додай рядок \"{path}\" (JSON без схеми в Schema Store — див. n-text.mdc)"
            )));
        }
    }
}

/// FS-existence стек текстових конфігів (контент-валідація — у Rego) —
/// точний порт `checkTextConfigsExistence` (`main.mjs:79-94`).
fn check_text_configs_existence(cwd: &Path, violations: &mut Vec<Violation>) {
    const PATHS: [&str; 5] = [
        ".oxfmtrc.json",
        ".cspell.json",
        ".markdownlint-cli2.jsonc",
        ".vscode/extensions.json",
        ".vscode/settings.json",
    ];
    for path in PATHS {
        if !cwd.join(path).exists() {
            violations.push(fail(format!("{path} не існує — створи згідно n-text.mdc")));
        }
    }
}

/// Перевіряє CI-workflow текстового стеку: крок `n-rules lint text --no-fix`
/// у `.github/workflows/lint-text.yml` — точний порт `checkLintTextWorkflow`
/// (`main.mjs:105-120`). Existence самого workflow — окремий провайдер-плагін
/// мандат (не тут, як і в JS).
fn check_lint_text_workflow(cwd: &Path, violations: &mut Vec<Violation>) {
    let path = cwd.join(".github/workflows/lint-text.yml");
    if !path.exists() {
        return;
    }
    let Ok(wf) = std::fs::read_to_string(&path) else {
        return;
    };
    let root = parse_workflow_yaml(&wf);
    let ok = match &root {
        Some(r) => any_run_step_includes(r, CANON_LINT_TEXT_RUN),
        None => wf.contains(CANON_LINT_TEXT_RUN),
    };
    if !ok {
        violations.push(fail(format!(
            "lint-text.yml має містити крок {CANON_LINT_TEXT_RUN} (CI — read-only, нуль мутацій)"
        )));
    }
}

/// Detector `text/formatting` — точний порт `lint(ctx)` (`main.mjs:127-149`).
pub fn text_formatting(cwd: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();

    check_v8r_ignore(cwd, &mut violations);
    check_text_configs_existence(cwd, &mut violations);

    let text_rule_paths: Vec<&str> = [".cursor/rules/n-text.mdc", "npm/mdc/text.mdc"]
        .into_iter()
        .filter(|p| cwd.join(p).exists())
        .collect();
    for p in text_rule_paths {
        if let Ok(body) = std::fs::read_to_string(cwd.join(p)) {
            verify_uk_apostrophe_rule_paragraph(p, &body, &mut violations);
        }
    }

    check_lint_text_workflow(cwd, &mut violations);

    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn write_json(tmp: &TempDir, rel: &str, value: serde_json::Value) {
        write(tmp, rel, &value.to_string());
    }

    fn write_full_minimal_project(tmp: &TempDir) {
        write(
            tmp,
            ".v8rignore",
            ".vscode/extensions.json\n.vscode/settings.json\n",
        );
        write_json(
            tmp,
            ".vscode/extensions.json",
            serde_json::json!({
                "recommendations": ["DavidAnson.vscode-markdownlint", "oxc.oxc-vscode", "timonwong.shellcheck"]
            }),
        );
        let mut oxfmt_block = serde_json::Map::new();
        for lang in ["css", "html", "javascript", "json", "typescript", "vue"] {
            oxfmt_block.insert(
                format!("[{lang}]"),
                serde_json::json!({ "editor.defaultFormatter": "oxc.oxc-vscode" }),
            );
        }
        let mut settings = serde_json::Map::new();
        settings.insert("editor.formatOnSave".to_string(), serde_json::json!(true));
        settings.extend(oxfmt_block);
        write_json(
            tmp,
            ".vscode/settings.json",
            serde_json::Value::Object(settings),
        );
        write_json(
            tmp,
            ".oxfmtrc.json",
            serde_json::json!({
                "ignorePatterns": ["**/hasura/metadata/**", "**/schema.graphql", "**/auto-imports.d.ts"],
                "arrowParens": "avoid",
                "printWidth": 120,
                "bracketSpacing": true,
                "bracketSameLine": true,
                "semi": false,
                "singleQuote": true,
                "tabWidth": 2,
                "trailingComma": "none",
                "useTabs": false
            }),
        );
        write_json(
            tmp,
            ".markdownlint-cli2.jsonc",
            serde_json::json!({ "gitignore": true, "config": { "default": true, "MD013": false } }),
        );
        write_json(
            tmp,
            ".cspell.json",
            serde_json::json!({
                "version": "0.2",
                "language": "en,nitra",
                "ignorePaths": [
                    "**/node_modules/**",
                    "**/vscode-extension/**",
                    "**/.git/**",
                    ".vscode",
                    "report",
                    "*.svg",
                    "**/k8s/**/*.yaml"
                ],
                "import": ["@nitra/cspell-dict/cspell-ext.json"],
                "words": []
            }),
        );
        write(
            tmp,
            ".cursor/rules/n-text.mdc",
            "---\ndescription: test\n---\n**Український апостроф:** U+0027 та U+2019; у прикладі символ ’\n",
        );
        write_json(
            tmp,
            "package.json",
            serde_json::json!({
                "name": "text-fixture",
                "private": true,
                "devDependencies": { "@nitra/cspell-dict": "^2.0.0" }
            }),
        );
        write(
            tmp,
            ".github/workflows/lint-text.yml",
            "name: T\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: n-rules lint text --no-fix\n",
        );
    }

    // --- дзеркало check-fixture.test.mjs ---

    #[test]
    fn full_minimal_set_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_full_minimal_project(&tmp);
        assert!(text_formatting(tmp.path()).is_empty());
    }

    #[test]
    fn missing_v8rignore_is_violation() {
        let tmp = TempDir::new().unwrap();
        assert!(!text_formatting(tmp.path()).is_empty());
    }

    #[test]
    fn v8rignore_without_required_paths_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".v8rignore", "# empty\n");
        assert!(!text_formatting(tmp.path()).is_empty());
    }

    #[test]
    fn v8rignore_with_one_of_two_paths_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".v8rignore", ".vscode/extensions.json\n");
        assert!(!text_formatting(tmp.path()).is_empty());
    }

    #[test]
    fn missing_config_files_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            ".v8rignore",
            ".vscode/extensions.json\n.vscode/settings.json\n",
        );
        assert!(!text_formatting(tmp.path()).is_empty());
    }

    #[test]
    fn n_text_mdc_without_apostrophe_heading_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            ".v8rignore",
            ".vscode/extensions.json\n.vscode/settings.json\n",
        );
        write(
            &tmp,
            ".cursor/rules/n-text.mdc",
            "# text\nno apostrophe paragraph here\n",
        );
        assert!(!text_formatting(tmp.path()).is_empty());
    }

    #[test]
    fn n_text_mdc_with_heading_but_no_codes_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            ".v8rignore",
            ".vscode/extensions.json\n.vscode/settings.json\n",
        );
        write(
            &tmp,
            ".cursor/rules/n-text.mdc",
            "**Український апостроф:** без кодових позначок\n",
        );
        assert!(!text_formatting(tmp.path()).is_empty());
    }

    #[test]
    fn n_text_mdc_with_codes_but_no_symbol_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            ".v8rignore",
            ".vscode/extensions.json\n.vscode/settings.json\n",
        );
        write(
            &tmp,
            ".cursor/rules/n-text.mdc",
            "**Український апостроф:** U+0027 та U+2019 — без самого символу\n",
        );
        assert!(!text_formatting(tmp.path()).is_empty());
    }

    // --- усі violations мають reason "formatting" ---

    #[test]
    fn all_violations_have_formatting_reason() {
        let tmp = TempDir::new().unwrap();
        let violations = text_formatting(tmp.path());
        assert!(!violations.is_empty());
        assert!(violations.iter().all(|v| v.reason == "formatting"));
    }

    #[test]
    fn lint_text_workflow_without_canonical_step_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_full_minimal_project(&tmp);
        write(
            &tmp,
            ".github/workflows/lint-text.yml",
            "name: T\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
        );
        let violations = text_formatting(tmp.path());
        assert!(violations
            .iter()
            .any(|v| v.message.contains("lint-text.yml")));
    }

    #[test]
    fn missing_lint_text_workflow_is_not_checked() {
        let tmp = TempDir::new().unwrap();
        write_full_minimal_project(&tmp);
        fs::remove_file(tmp.path().join(".github/workflows/lint-text.yml")).unwrap();
        assert!(text_formatting(tmp.path()).is_empty());
    }
}
