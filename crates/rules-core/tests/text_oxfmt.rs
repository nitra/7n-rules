//! Дзеркальний набір `text/oxfmt` — сценарій-у-сценарій за видаленим
//! `npm/rules/text/oxfmt/tests/oxfmt.test.mjs` (T0-фіксер `fix-oxfmt.mjs`
//! лишається в JS — тут лише сценарії детектора).
//!
//! Публічна `text_oxfmt(cwd, files)`
//! (`crates/rules-core/src/concerns/text_oxfmt.rs`) не приймає інжектований
//! резолвер тула (точний порт сигнатури `lint(ctx)`, яка теж нічого не
//! параметризує) — тож інтеграційний тест працює через РЕАЛЬНИЙ `oxfmt` із
//! `PATH`, як і JS-канон (`oxfmt.test.mjs:3` — «oxfmt стабільно доступний у
//! PATH (homebrew/node_modules) — інтеграційний прогін»). Якщо його немає в
//! середовищі — тест пропускається (`eprintln!` + `return`), не падає:
//! детермінований сценарій «тула немає» (мовчазний skip без ноти) уже
//! покритий unit-тестом модуля з інжекцією резолвера
//! (`missing_binary_is_silently_skipped_without_diagnostic`) — той самий
//! поділ, що й у `security/scan` (`tests/security_scan.rs`).

use std::fs;
use std::process::Command;

use tempfile::TempDir;

use rules_core::concerns::text_oxfmt;

/// Чи є `oxfmt` у `PATH` цього процесу.
fn oxfmt_available() -> bool {
    Command::new("oxfmt")
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success())
}

fn write(tmp: &TempDir, rel: &str, content: &str) {
    let abs = tmp.path().join(rel);
    fs::create_dir_all(abs.parent().expect("шлях має батька")).expect("mkdir");
    fs::write(abs, content).expect("write");
}

/// Дзеркало `describe('text/oxfmt detector')` → «неформатований файл → одне
/// порушення oxfmt-unformatted» (`oxfmt.test.mjs:29-37`).
#[test]
fn unformatted_file_yields_single_oxfmt_unformatted_violation() {
    if !oxfmt_available() {
        eprintln!("text/oxfmt: пропуск — oxfmt відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    write(&tmp, "bad.mjs", "export  const   x=1\n");

    let violations = text_oxfmt(tmp.path(), None).expect("резолв + спавн не падають");
    assert_eq!(violations.violations.len(), 1, "{violations:?}");
    assert_eq!(violations.violations[0].reason, "oxfmt-unformatted");
    assert_eq!(violations.violations[0].file.as_deref(), Some("bad.mjs"));
    assert_eq!(
        violations.violations[0].data,
        Some(serde_json::json!({ "kind": "oxfmt-unformatted" }))
    );
}

/// Дзеркало «відформатований файл → 0 порушень» (`oxfmt.test.mjs:39-45`).
/// Temp-dir без `.oxfmtrc` → oxfmt-defaults (`semi: true`), тож канон тут —
/// крапка з комою, точно як у JS-коментарі фікстури.
#[test]
fn formatted_file_yields_no_violations() {
    if !oxfmt_available() {
        eprintln!("text/oxfmt: пропуск — oxfmt відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    write(&tmp, "good.mjs", "export const x = 1;\n");

    let violations = text_oxfmt(tmp.path(), None).expect("резолв + спавн не падають");
    assert!(violations.violations.is_empty(), "{violations:?}");
}

/// Дзеркало «делта: не-fmt-типи відсіюються» (`oxfmt.test.mjs:47-52`):
/// `.md` не матчить `FMT_EXT_RE`, тож ціль порожня і спавна взагалі немає.
#[test]
fn delta_mode_filters_out_non_fmt_extensions() {
    let tmp = TempDir::new().expect("tempdir");
    write(&tmp, "readme.md", "# unformatted   stuff\n");

    let files = vec!["readme.md".to_string()];
    let violations = text_oxfmt(tmp.path(), Some(&files)).expect("порожня ціль — без резолву");
    assert!(violations.violations.is_empty());
}

/// Делта-режим з реальним fmt-типом серед `ctx.files` — доводить, що фільтр
/// не зʼїдає валідні цілі: конкретний неформатований `.ts`-файл серед
/// `files` так само дає violation, як і full-режим.
#[test]
fn delta_mode_detects_unformatted_fmt_file() {
    if !oxfmt_available() {
        eprintln!("text/oxfmt: пропуск — oxfmt відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    write(&tmp, "bad.ts", "export  const   x:number=1\n");
    write(&tmp, "README.md", "# not a fmt target\n");

    let files = vec!["bad.ts".to_string(), "README.md".to_string()];
    let violations = text_oxfmt(tmp.path(), Some(&files)).expect("резолв + спавн не падають");
    assert_eq!(violations.violations.len(), 1, "{violations:?}");
    assert_eq!(violations.violations[0].file.as_deref(), Some("bad.ts"));
}
