//! Black-box дзеркало JS-тестів `npm/rules/text/markdownlint/tests/main.test.mjs`
//! (видалених разом із JS-каноном): ті самі два сценарії, але через публічний
//! [`rules_core::concerns::text_markdownlint`] замість `lint()`.
//!
//! Обидва сценарії реально спавнять `npx markdownlint-cli2`, тож без нього в середовищі
//! пропускаються (`eprintln!` + `return`) — той самий принцип пропуску, що в
//! `rego_opa_check.rs`/`rego_regal.rs`/`security_scan.rs`: предмет цих тестів — розбір
//! результату (target-фільтр, збір stderr-деталі), не встановлення `markdownlint-cli2`.
//! Детерміновані сценарії з фейковим `npx` та інжекцією резолвера вже покриті
//! unit-тестами модуля (`text_markdownlint_with` + `resolver_found`/`resolver_missing`).
//!
//! `.markdownlint-cli2.jsonc` у жодному з тимчасових дерев немає, тож policy-шар
//! (`policy_violations`) мовчить (`main.mjs`-паритет: `files.required` не виставлений) —
//! ці тести перевіряють лише lint-поверхню, як і JS-канон.

use std::fs;
use std::process::Command;

use rules_core::concerns::text_markdownlint;
use tempfile::TempDir;

/// Чи резолвиться `markdownlint-cli2` через `npx` у цьому середовищі.
fn markdownlint_cli2_available() -> bool {
    Command::new("npx")
        .arg("markdownlint-cli2")
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success())
}

fn write(root: &std::path::Path, rel: &str, content: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().expect("є батько")).expect("тека");
    fs::write(path, content).expect("файл");
}

/// «markdown без топ-рівневого заголовка (MD041) → violation несе file+rule+опис»
/// (`main.test.mjs:16-28`).
#[test]
fn markdown_without_top_level_heading_violation_carries_file_and_rule() {
    if !markdownlint_cli2_available() {
        eprintln!("text/markdownlint: пропуск — markdownlint-cli2 недоступний через npx");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    fs::create_dir_all(tmp.path().join(".cursor")).expect(".cursor");
    write(tmp.path(), "bad.md", "без заголовка на першому рядку\n");

    let violations = text_markdownlint(tmp.path(), None)
        .expect("markdownlint-cli2 резолвиться — не fail-closed гілка");
    let md_violation = violations
        .iter()
        .find(|v| v.reason == "markdownlint")
        .expect("має бути violation з reason markdownlint");
    assert!(
        md_violation.message.contains("bad.md"),
        "{}",
        md_violation.message
    );
    assert!(
        md_violation.message.contains("MD041"),
        "{}",
        md_violation.message
    );
}

/// «валідний markdown → без markdownlint-violation» (`main.test.mjs:30-37`).
#[test]
fn valid_markdown_has_no_markdownlint_violation() {
    if !markdownlint_cli2_available() {
        eprintln!("text/markdownlint: пропуск — markdownlint-cli2 недоступний через npx");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    write(tmp.path(), "good.md", "# Заголовок\n\nАбзац тексту.\n");

    let violations = text_markdownlint(tmp.path(), None)
        .expect("markdownlint-cli2 резолвиться — не fail-closed гілка");
    assert!(
        violations.iter().all(|v| v.reason != "markdownlint"),
        "{violations:?}"
    );
}
