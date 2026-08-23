//! Black-box дзеркало JS-тестів `npm/rules/rego/regal/tests/main.test.mjs`
//! (видалених разом із JS-каноном): ті самі два сценарії, але через
//! публічний [`rules_core::concerns::rego_regal`] замість `lint()`.
//!
//! Сценарій «passes on a well-formed rego» реально спавнить `regal`, тож
//! без нього в `PATH` пропускається — той самий принцип пропуску, що в
//! `k8s_manifests_rego_parity.rs` (без `conftest`/`node`).

use std::fs;
use std::process::Command;

use rules_core::concerns::rego_regal;
use tempfile::TempDir;

/// Чи є `regal` у `PATH`.
fn regal_available() -> bool {
    Command::new("regal")
        .arg("version")
        .output()
        .is_ok_and(|out| out.status.success())
}

/// «returns no violations (skip) when no rego targets exist in cwd»
/// (`main.test.mjs`): порожній корінь без `npm/rules`/`plugins` → 0
/// violations і жодної ноти — до резолву `regal` справа не доходить.
#[test]
fn no_rego_targets_in_cwd_is_clean() {
    let tmp = TempDir::new().unwrap();
    let report = rego_regal(tmp.path(), None).unwrap();
    assert!(report.violations.is_empty());
    assert!(report.diagnostics.is_empty());
}

/// «passes on a well-formed rego under npm/rules/*/policy/» (`main.test.mjs`):
/// коректний rego-пакет плюс `.regal/config.yaml`, що вимикає
/// `directory-package-mismatch`/`unresolved-reference` (той самий конфіг,
/// що й у JS-фікстурі) → чистий звіт із реальним `regal`.
#[test]
fn well_formed_rego_passes_with_real_regal() {
    if !regal_available() {
        eprintln!("rego_regal: пропуск — regal відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let policy_dir = tmp.path().join("npm/rules/sample/policy/concern");
    fs::create_dir_all(&policy_dir).unwrap();
    fs::write(
        policy_dir.join("concern.rego"),
        "package sample.concern\n\nimport rego.v1\n\ndeny contains msg if {\n\tinput.broken == true\n\tmsg := \"broken\"\n}\n",
    )
    .unwrap();
    let regal_dir = tmp.path().join(".regal");
    fs::create_dir_all(&regal_dir).unwrap();
    fs::write(
        regal_dir.join("config.yaml"),
        "rules:\n  idiomatic:\n    directory-package-mismatch:\n      level: ignore\n  imports:\n    unresolved-reference:\n      level: ignore\n",
    )
    .unwrap();

    let report = rego_regal(tmp.path(), None).unwrap();
    assert!(
        report.violations.is_empty(),
        "очікували чистий прогін regal, отримали: {:?}",
        report.violations
    );
    assert!(report.diagnostics.is_empty());
}

/// Delta-режим: `X_test.rego` без policy-пакета флагується `regal`-ом як
/// unresolved-import, а разом із сусіднім `X.rego` (доданим
/// `resolveTargets`) прогін чистий — та сама причина, задля якої
/// `resolveTargets` дописує сусіда, перевірена наскрізь через реальний
/// `regal`.
#[test]
fn delta_mode_adds_sibling_so_regal_resolves_import() {
    if !regal_available() {
        eprintln!("rego_regal: пропуск — regal відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let pkg_dir = tmp.path().join("pkg");
    fs::create_dir_all(&pkg_dir).unwrap();
    fs::write(
        pkg_dir.join("concern.rego"),
        "package pkg.concern\n\nimport rego.v1\n\ndeny contains msg if {\n\tinput.broken == true\n\tmsg := \"broken\"\n}\n",
    )
    .unwrap();
    fs::write(
        pkg_dir.join("concern_test.rego"),
        "package pkg.concern_test\n\nimport rego.v1\nimport data.pkg.concern\n\ntest_deny_flags_broken if {\n\tconcern.deny with input as {\"broken\": true}\n}\n",
    )
    .unwrap();
    let regal_dir = tmp.path().join(".regal");
    fs::create_dir_all(&regal_dir).unwrap();
    // Тест перевіряє резолв сусіда `resolveTargets`, не повний набір
    // style-правил `regal` — тому вимикаємо ще й `opa-fmt`/
    // `no-defined-entrypoint`, щоб їхні (сторонні щодо unresolved-import)
    // знахідки не заважали читати результат.
    fs::write(
        regal_dir.join("config.yaml"),
        "rules:\n  idiomatic:\n    directory-package-mismatch:\n      level: ignore\n    no-defined-entrypoint:\n      level: ignore\n  style:\n    opa-fmt:\n      level: ignore\n",
    )
    .unwrap();

    let files = vec!["pkg/concern_test.rego".to_string()];
    let report = rego_regal(tmp.path(), Some(&files)).unwrap();
    assert!(
        report.violations.is_empty(),
        "сусідній concern.rego мав закрити unresolved-import: {:?}",
        report.violations
    );
}
