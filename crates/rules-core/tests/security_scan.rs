//! Дзеркальний набір `security/scan` — сценарій-у-сценарій за поведінкою
//! видаленого `npm/rules/security/scan/main.mjs` (тестів у JS-каноні не
//! було, тож сценарії тут виведені прямо з `lint(ctx)`).
//!
//! Публічна `security_scan(cwd)` (`crates/rules-core/src/concerns/security_scan.rs`)
//! не приймає інжектований резолвер тула (точний порт сигнатури `lint(ctx)`,
//! яка теж нічого не параметризує) — тож інтеграційний тест працює через
//! РЕАЛЬНИЙ `trufflehog` із `PATH`. Якщо його немає в середовищі — тест
//! пропускається (`eprintln!` + `return`), а не падає: детерміновані
//! сценарії з фейковим бінарником і інжекцією резолвера вже покриті
//! unit-тестами модуля (`security_scan_with` + `resolver_found`/
//! `resolver_missing`).

use std::process::Command;

use tempfile::TempDir;

use rules_core::concerns::security_scan;

/// Канонічний `.trufflehog-exclude`, без якого сам trufflehog падає з
/// «unable to open filter file» (`--exclude-paths .trufflehog-exclude`
/// резолвиться відносно `cwd` спавна — точно як у `main.mjs`, який теж не
/// передає `cwd` окремо від `ctx.cwd`).
const TRUFFLEHOG_EXCLUDE: &str = "(^|/)\\.git(/|$)\n";

/// Чи є `trufflehog` у `PATH` цього процесу.
fn trufflehog_available() -> bool {
    Command::new("trufflehog")
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success())
}

/// Кладе файл із створенням батьківських каталогів.
fn write(tmp: &TempDir, rel: &str, content: &str) {
    let abs = tmp.path().join(rel);
    std::fs::create_dir_all(abs.parent().expect("шлях має батька")).expect("mkdir");
    std::fs::write(abs, content).expect("write");
}

/// Готує тимчасове дерево з каноном `.trufflehog-exclude` — спільна база
/// «чистого» репо для обох сценаріїв нижче.
fn clean_repo() -> TempDir {
    let tmp = TempDir::new().expect("tempdir");
    write(&tmp, ".trufflehog-exclude", TRUFFLEHOG_EXCLUDE);
    tmp
}

/// Репо без секретів і з каноном `.trufflehog-exclude` → 0 violations,
/// жодних діагностичних нот (реальний `trufflehog` над порожнім деревом
/// завжди завершується з кодом 0).
#[test]
fn clean_repo_with_exclude_file_has_no_violations() {
    if !trufflehog_available() {
        eprintln!("security_scan: пропуск — trufflehog відсутній у PATH");
        return;
    }
    let tmp = clean_repo();
    write(&tmp, "README.md", "нема секретів тут\n");

    let report = security_scan(tmp.path()).expect("резолв + чистий exit не падають");
    assert!(report.violations.is_empty(), "{:?}", report.violations);
    assert!(report.diagnostics.is_empty(), "{:?}", report.diagnostics);
}

/// Каталог без `trufflehog` у `PATH` узагалі не тестується тут окремо —
/// той сценарій детермінований лише через інжекцію резолвера (unit-тест
/// `missing_binary_is_skipped_with_info_diagnostic` у самому модулі):
/// підміняти процес-глобальний `PATH` у файлі, де сусідній тест паралельно
/// спавнить РЕАЛЬНИЙ `trufflehog`, означало б гонку між тестами.
///
/// Натомість тут — smoke: виклик `security_scan` на каталозі БЕЗ
/// `.trufflehog-exclude` доводить, що детектор чесно віддає ненульовий-код
/// шлях (`unable to open filter file` → violation), а не мовчки ковтає
/// помилку самого trufflehog-а. Це той самий контракт, що й у JS: exit-код
/// trufflehog-а — єдине джерело істини, `main.mjs` не аналізує ПРИЧИНУ
/// ненульового коду.
#[test]
fn repo_without_exclude_file_surfaces_trufflehog_failure_as_violation() {
    if !trufflehog_available() {
        eprintln!("security_scan: пропуск — trufflehog відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    write(&tmp, "README.md", "нема секретів тут\n");

    let report = security_scan(tmp.path()).expect("тул резолвився, спавн не впав");
    assert_eq!(report.violations.len(), 1, "{:?}", report.violations);
    assert_eq!(report.violations[0].reason, "secret-found");
    assert!(report.violations[0].file.is_none());
}
