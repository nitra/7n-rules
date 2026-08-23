//! Дзеркальний набір `rego/opa_check` — сценарій-у-сценарій із видаленого
//! `npm/rules/rego/opa_check/tests/main.test.mjs`.
//!
//! Сценарії, що реально спавнять `opa`, гейтяться наявністю тула в
//! середовищі — на голому CI-раннері без прогрітого кешу вони пропускаються
//! (`eprintln!` + `return`), а не падають: предмет цих тестів —
//! `resolve_targets`/агрегація результату, а не встановлення `opa`.

use std::fs;
use std::path::Path;

use rules_core::concerns::rego_opa_check;
use rules_core::tool_resolve::{resolve_cmd, resolve_provisioned_tool};

/// Чи резолвиться `opa` у цьому середовищі — той самий резолв, що використовує
/// сам детектор ([`crate::concerns::rego_opa_check`] інжектує PATH-фолбек
/// поверх керованого кешу).
fn opa_available() -> bool {
    resolve_provisioned_tool("opa")
        .or_else(|| resolve_cmd("opa"))
        .is_some()
}

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().expect("є батько")).expect("тека");
    fs::write(path, content).expect("файл");
}

/// Порожній репо (без `npm/rules`/`plugins`) → 0 targets → 0 violations, 0
/// нот — детектор виходить ДО будь-якого резолву `opa` (`main.mjs:22`).
#[test]
fn no_rego_targets_in_full_mode_is_clean_without_notes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let report = rego_opa_check(tmp.path(), None).expect("порожні цілі — без резолву opa");
    assert!(report.violations.is_empty());
    assert!(report.diagnostics.is_empty());
}

/// Делта-режим без `.rego`-файлів серед `files` → 0 targets → так само чисто.
#[test]
fn delta_mode_without_rego_files_is_clean() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let files = vec!["README.md".to_string(), "src/lib.rs".to_string()];
    let report = rego_opa_check(tmp.path(), Some(&files)).expect("порожні цілі — без резолву opa");
    assert!(report.violations.is_empty());
    assert!(report.diagnostics.is_empty());
}

/// Full-режим: `npm/rules/**/*.rego` зі зламаним синтаксисом → одна
/// violation з reason `opa-check-violation`.
#[test]
fn detects_broken_rego_syntax_under_full_target() {
    if !opa_available() {
        eprintln!("opa недоступний у середовищі — пропускаю сценарій");
        return;
    }
    let tmp = tempfile::tempdir().expect("tempdir");
    write(
        tmp.path(),
        "npm/rules/sample/policy/concern/concern.rego",
        "package sample.concern\n\nthis is not valid rego syntax\n",
    );
    let report = rego_opa_check(tmp.path(), None).expect("opa резолвиться — не fail-closed гілка");
    assert!(report.diagnostics.is_empty());
    assert_eq!(report.violations.len(), 1);
    assert_eq!(report.violations[0].reason, "opa-check-violation");
    assert!(report.violations[0].message.contains("opa check --strict"));
}

/// Full-режим: коректний rego під `npm/rules/*/policy/` → 0 violations.
#[test]
fn well_formed_rego_under_policy_root_is_clean() {
    if !opa_available() {
        eprintln!("opa недоступний у середовищі — пропускаю сценарій");
        return;
    }
    let tmp = tempfile::tempdir().expect("tempdir");
    write(
        tmp.path(),
        "npm/rules/sample/policy/concern/concern.rego",
        "package sample.concern\n\nimport rego.v1\n\ndeny contains msg if {\n\tinput.broken == true\n\tmsg := \"broken\"\n}\n",
    );
    let report = rego_opa_check(tmp.path(), None).expect("opa резолвиться — не fail-closed гілка");
    assert!(report.violations.is_empty());
    assert!(report.diagnostics.is_empty());
}

/// Делта-режим: конкретний `.rego`-файл зі зламаним синтаксисом →
/// перевіряється САМЕ він (не весь `npm/rules`).
#[test]
fn detects_broken_rego_syntax_in_delta_mode() {
    if !opa_available() {
        eprintln!("opa недоступний у середовищі — пропускаю сценарій");
        return;
    }
    let tmp = tempfile::tempdir().expect("tempdir");
    write(
        tmp.path(),
        "pkg/broken.rego",
        "package pkg\n\nthis is not valid rego syntax\n",
    );
    let files = vec!["pkg/broken.rego".to_string()];
    let report =
        rego_opa_check(tmp.path(), Some(&files)).expect("opa резолвиться — не fail-closed гілка");
    assert_eq!(report.violations.len(), 1);
    assert_eq!(report.violations[0].reason, "opa-check-violation");
}
