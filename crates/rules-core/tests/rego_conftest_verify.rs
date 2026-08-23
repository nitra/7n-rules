//! Дзеркальний набір `rego/conftest_verify` — сценарій-у-сценарій із
//! видаленого `npm/rules/rego/conftest_verify/tests/main.test.mjs` плюс
//! реальні спавни `conftest verify`, яких у скупому JS-каноні (одна
//! перевірка) не було.
//!
//! Сценарії, що реально спавнять `conftest`, гейтяться наявністю тула в
//! середовищі — на голому CI-раннері без прогрітого кешу вони пропускаються
//! (`eprintln!` + `return`), а не падають: предмет цих тестів —
//! `resolve_targets`/агрегація результату, а не встановлення `conftest`
//! (той самий прийом, що в `tests/rego_opa_check.rs`).

use std::fs;
use std::path::Path;

use rules_core::concerns::rego_conftest_verify;
use rules_core::tool_resolve::resolve_cmd;

/// Чи резолвиться `conftest` у цьому середовищі — той самий резолв, що
/// використовує сам детектор (голий `resolve_cmd`, без керованого кешу —
/// доккомент модуля концерну).
fn conftest_available() -> bool {
    resolve_cmd("conftest").is_some()
}

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().expect("є батько")).expect("тека");
    fs::write(path, content).expect("файл");
}

/// Порожній репо (без `npm/rules`) → 0 violations — детектор виходить ДО
/// будь-якого резолву `conftest` (`main.mjs:42`). Порт єдиного сценарію
/// видаленого `main.test.mjs`.
#[test]
fn no_rego_targets_returns_no_violations() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let violations = rego_conftest_verify(tmp.path());
    assert!(violations.violations.is_empty());
}

/// `npm/rules` існує, і всі rego-юніт-тести під ним проходять → 0 violations.
#[test]
fn well_formed_rego_tests_are_clean() {
    if !conftest_available() {
        eprintln!("conftest недоступний у середовищі — пропускаю сценарій");
        return;
    }
    let tmp = tempfile::tempdir().expect("tempdir");
    write(
        tmp.path(),
        "npm/rules/sample/policy/concern/concern.rego",
        "package sample.concern\n\nimport rego.v1\n\ndeny contains msg if {\n\tinput.broken == true\n\tmsg := \"broken\"\n}\n",
    );
    write(
        tmp.path(),
        "npm/rules/sample/policy/concern/concern_test.rego",
        "package sample.concern\n\nimport rego.v1\n\ntest_pass if {\n\tnot deny[\"broken\"] with input as {\"broken\": false}\n}\n",
    );
    let violations = rego_conftest_verify(tmp.path());
    assert!(violations.violations.is_empty());
}

/// `npm/rules` існує, і серед rego-юніт-тестів є провальний →
/// одна violation з reason `conftest-verify-violation`, текст несе і код
/// виходу, і вивід `conftest verify`.
#[test]
fn failing_rego_test_yields_single_violation() {
    if !conftest_available() {
        eprintln!("conftest недоступний у середовищі — пропускаю сценарій");
        return;
    }
    let tmp = tempfile::tempdir().expect("tempdir");
    write(
        tmp.path(),
        "npm/rules/sample/policy/concern/concern.rego",
        "package sample.concern\n\nimport rego.v1\n\ndeny contains msg if {\n\tinput.broken == true\n\tmsg := \"broken\"\n}\n",
    );
    write(
        tmp.path(),
        "npm/rules/sample/policy/concern/concern_test.rego",
        "package sample.concern\n\nimport rego.v1\n\ntest_fail if {\n\tdeny[\"broken\"] with input as {\"broken\": false}\n}\n",
    );
    let violations = rego_conftest_verify(tmp.path());
    assert_eq!(violations.violations.len(), 1);
    assert_eq!(violations.violations[0].reason, "conftest-verify-violation");
    assert!(violations.violations[0].message.contains("conftest verify"));
    assert!(violations.violations[0].message.contains("код 1"));
    assert!(violations.violations[0].message.contains("test_fail"));
    assert!(violations.violations[0].file.is_none());
}
