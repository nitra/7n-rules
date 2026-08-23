//! Дзеркальний набір `image-compress/check` — сценарій-у-сценарій за
//! видаленим `npm/rules/image-compress/tests/main.test.mjs`.
//!
//! JS-тест підмінює `bunx` фейковим shell-скриптом і на час тесту додає
//! його теку на початок процес-глобального `env.PATH`
//! (`withFakeBunx`/`tests/main.test.mjs:21-35`). Тут так само не можна:
//! `cargo test` ганяє `#[test]`-и цього ж інтеграційного бінарника
//! паралельними потоками того самого процесу, і мутація `PATH` в одному
//! тесті була б видна іншому. Замість цього — інжекція резолвера через
//! `pub` [`rules_core::concerns::image_compress_check_with`] (доккомент
//! модуля `crates/rules-core/src/concerns/image_compress_check.rs`,
//! розділ «Межі порту»): той самий фейковий `bunx`-скрипт, але переданий
//! напряму, без торкання `PATH`. Реальний `bunx @nitra/minify-image` тут
//! теж не підходить (на відміну від `security/scan`, де `trufflehog` —
//! уже встановлений офлайн-бінарник): `@nitra/minify-image` довелося б
//! тягнути з npm-реєстру мережею, що недетерміновано в тестовому оточенні.

use std::path::{Path, PathBuf};

use tempfile::TempDir;

use rules_core::concerns::image_compress_check_with;

/// Кладе у `dir` виконуваний shell-скрипт-заглушку `bunx`, що друкує
/// `stdout_json` і завершується кодом 0 — той самий фейковий бінарник, що
/// й `withFakeBunx` у видаленому JS-тесті.
#[cfg(unix)]
fn fake_bunx(dir: &Path, stdout_json: &str) -> PathBuf {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(dir).unwrap();
    let bin = dir.join("bunx");
    fs::write(&bin, format!("#!/bin/sh\nprintf '%s' '{stdout_json}'\n")).unwrap();
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

/// Резолвер, що завжди повертає заданий шлях (тул «встановлено»).
fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
    move |_| Some(bin.clone())
}

/// Резолвер, що не знаходить нічого (тул «не встановлено»).
fn resolver_missing(_tool: &str) -> Option<PathBuf> {
    None
}

/// «0 violations якщо --json не має needsCompression»
/// (`tests/main.test.mjs:38-48`).
#[cfg(unix)]
#[test]
fn zero_needs_compression_gives_no_violations() {
    let tmp = TempDir::new().unwrap();
    let bin = fake_bunx(
        &tmp.path().join("bin"),
        r#"{"summary":{"needsCompression":0,"processed":1,"total":1,"unsupported":0},"files":[]}"#,
    );
    let repo = tmp.path().join("repo");
    std::fs::create_dir_all(&repo).unwrap();

    let report = image_compress_check_with(&repo, &resolver_found(bin));
    assert!(report.violations.is_empty(), "{:?}", report.violations);
}

/// «violation якщо --json має needsCompression» (`tests/main.test.mjs:50-62`).
#[cfg(unix)]
#[test]
fn positive_needs_compression_is_a_violation() {
    let tmp = TempDir::new().unwrap();
    let bin = fake_bunx(
        &tmp.path().join("bin"),
        r#"{"summary":{"needsCompression":2,"processed":1,"total":3,"unsupported":0},"files":[]}"#,
    );
    let repo = tmp.path().join("repo");
    std::fs::create_dir_all(&repo).unwrap();

    let report = image_compress_check_with(&repo, &resolver_found(bin));
    assert!(!report.violations.is_empty());
    assert!(report
        .violations
        .iter()
        .any(|v| v.reason == "needs-compression"));
}

/// «0 violations + info-діагностика якщо bunx відсутній у PATH»
/// (`tests/main.test.mjs:64-77`).
#[test]
fn missing_bunx_gives_no_violations_with_info_diagnostic() {
    let tmp = TempDir::new().unwrap();

    let report = image_compress_check_with(tmp.path(), &resolver_missing);
    assert!(report.violations.is_empty());
    assert!(report
        .diagnostics
        .iter()
        .any(|d| d.level == "info" && d.message.contains("bunx")));
}
