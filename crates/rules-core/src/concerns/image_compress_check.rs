//! Native-порт `image-compress/check` (`npm/rules/image-compress/check/main.mjs`,
//! 80 рядків) — read-only детектор синхронності image-файлів із
//! `.n-minify-image.tsv` через `@nitra/minify-image --json`, запущений
//! через `bunx` (`@nitra/minify-image` v4 використовує `Bun.Image`,
//! bun-only global — запуск через `npx`/Node мовчки провалює компресію).
//! Стиснення (`--write`) — окремий fix, не в цьому детекторі.
//!
//! # Резолв тула — `resolve_cmd`, не `resolve_provisioned_tool`
//!
//! JS-версія бере `bunx` через `resolveCmd` (лише PATH, без керованого
//! кешу й без fail-closed) — так само, як `security/scan` бере
//! `trufflehog`, а не як `k8s/kubeconform`, який іде через повний
//! `ensureTool`. Якщо `bunx` не резолвиться, JS ПРОПУСКАЄ перевірку й
//! повертає інформаційну ноту (`main.mjs:37-43`), а не падає. Native-порт
//! дзеркалить це буквально через [`crate::tool_resolve::resolve_cmd`] і
//! [`ConcernDiagnostic::info`] — той самий канал, що вже використовує
//! `security/scan`.
//!
//! # Чому концерн не повертає `Result<ConcernReport, RulesError>`
//!
//! На відміну від `security/scan`, JS-канон цього концерну загортає
//! `spawnAsync` у власний `try/catch` (`main.mjs:45-55`) — спавн-помилка
//! ПІСЛЯ успішного резолву тула стає звичайним `fail(msg, 'tool-error')`
//! violation-ом, а НЕ винятком, що вилітає з `lint()`. Так само ненульовий
//! exit (`main.mjs:56-61`) і невалідний JSON з `--json` (`main.mjs:63-69`) —
//! обидва `fail(msg, 'tool-error')`, без throw. У всьому тілі `lint(ctx)`
//! немає жодної гілки з непійманим винятком, тож `lint()` завжди
//! завершується успішно, без throw. Native-порт дзеркалить це точно:
//! `Command::output()` повертає `io::Result`, і `Err` тут — та сама
//! «спавн упав» гілка з
//! JS-`catch`, конвертована в violation `tool-error`, а НЕ в
//! `RulesError::Concern` (на відміну від `security/scan`, доккомент якого
//! пояснює протилежний вибір саме тим, що там такого `catch` в JS немає).
//!
//! # Межі порту
//!
//! - JS обмежує `maxBuffer` спавна до 20 МіБ (`JSON_MAX_BUFFER`,
//!   `main.mjs:11,50`) — захист від Node-специфічного ліміту буфера
//!   труби дочірнього процесу. `std::process::Command::output()` збирає
//!   вивід без такого ліміту (і без паніки на переповненні) — це
//!   Node-специфічне обмеження, якого в native-рантаймі просто немає, тож
//!   порт його не відтворює;
//! - `Number(report.summary?.needsCompression ?? 0)` (`main.mjs:71-72`) —
//!   JS зводить довільне JSON-значення до числа. Порт приймає лише
//!   реалістичні форми (`number` і числовий `string`; відсутність/`null`/
//!   будь-що інше → `0`) — `@nitra/minify-image --json` завжди віддає ці
//!   поля як JSON-числа. Вироджені типи (`bool`/масив/об'єкт), яких
//!   реальний тул не видає, дають в порту `0` замість JS-зведення
//!   (`Number(true) === 1` тощо) — розбіжність не впливає на видиму
//!   поведінку для жодного реалістичного виводу тула;
//! - [`image_compress_check_with`] (інжекція резолвера тула) — `pub`, а не
//!   приватна, як у решти `*_with`-хелперів native-концернів
//!   (`security_scan_with`, `k8s_kubeconform_with`): інтеграційний тест
//!   `tests/image_compress_check.rs` мусить дзеркалити fixture-и JS-тестів
//!   (`tests/main.test.mjs`, фейковий `bunx`-скрипт), а мутувати
//!   процес-глобальний `PATH` не можна — паралельні `#[test]` того самого
//!   бінарника змагалися б за одним і тим самим env. Реальний
//!   `bunx @nitra/minify-image` теж не підходить для інтеграційного тесту
//!   (мережевий npm-фетч пакета, недетермінований і офлайн-непридатний) —
//!   на відміну від `security/scan`, де `trufflehog` уже встановлений
//!   бінарник без мережі.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::tool_resolve::resolve_cmd;

/// Reason для всіх помилкових гілок спавна/парсингу — порт
/// `fail(msg, 'tool-error')` (`main.mjs:53,59,67`).
const TOOL_ERROR_REASON: &str = "tool-error";

/// Reason фінальної перевірки — порт `fail(msg, 'needs-compression')`
/// (`main.mjs:74-77`).
const NEEDS_COMPRESSION_REASON: &str = "needs-compression";

/// Аргументи виклику `@nitra/minify-image` через `bunx` — буквальна копія
/// `main.mjs:47`.
const MINIFY_IMAGE_ARGS: &[&str] = &["@nitra/minify-image", "--src=.", "--json"];

fn violation(reason: &str, message: String) -> Violation {
    Violation {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `image-compress/check` — порт `lint(ctx)` (`main.mjs:26-80`).
/// Whole-repo (`concern.json#lint.scope = "full"`), `main.mjs` не читає
/// `ctx.files` узагалі — порт так само не приймає `files`.
pub fn image_compress_check(cwd: &Path) -> ConcernReport {
    image_compress_check_with(cwd, &resolve_cmd)
}

/// Тіло детектора з інжектованим пошуком бінарника — доккомент модуля,
/// розділ «Межі порту», пояснює, чому ця функція `pub`.
pub fn image_compress_check_with(
    cwd: &Path,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> ConcernReport {
    let Some(bunx) = resolve_tool("bunx") else {
        return ConcernReport {
            violations: Vec::new(),
            diagnostics: vec![ConcernDiagnostic::info(
                "image-compress: `bunx` не знайдено в PATH — перевірку пропущено",
            )],
        };
    };

    let output = match Command::new(&bunx)
        .args(MINIFY_IMAGE_ARGS)
        .current_dir(cwd)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return ConcernReport::from(vec![violation(
                TOOL_ERROR_REASON,
                format!(
                    "image-compress: не вдалося запустити bunx @nitra/minify-image --json: {error}"
                ),
            )]);
        }
    };

    let code = output.status.code().unwrap_or(1);
    if code != 0 {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Порт `[r.stdout, r.stderr].filter(Boolean).join('\n').trim()`
        // (`main.mjs:57`) — filter відкидає лише ПОРОЖНІ рядки (не
        // whitespace-only), trim ріже готовий об'єднаний рядок, а не
        // кожен доданок окремо.
        let detail = [stdout.as_ref(), stderr.as_ref()]
            .into_iter()
            .filter(|s: &&str| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        let detail = detail.trim();
        let detail_suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(":\n{detail}")
        };
        return ConcernReport::from(vec![violation(
            TOOL_ERROR_REASON,
            format!(
                "image-compress: @nitra/minify-image --json завершився з кодом {code}{detail_suffix}"
            ),
        )]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let Ok(report) = serde_json::from_str::<serde_json::Value>(&stdout) else {
        return ConcernReport::from(vec![violation(
            TOOL_ERROR_REASON,
            "image-compress: @nitra/minify-image --json повернув невалідний JSON".to_string(),
        )]);
    };

    let summary = report.get("summary");
    let needs_compression = numeric_field(summary, "needsCompression");
    let total = numeric_field(summary, "total");
    if needs_compression > 0 {
        return ConcernReport::from(vec![violation(
            NEEDS_COMPRESSION_REASON,
            format!(
                "image-compress: {needs_compression}/{total} image-файлів потребують стиснення — запусти `n-rules lint image-compress` локально"
            ),
        )]);
    }

    ConcernReport::default()
}

/// М'яке зведення JSON-значення до числа — best-effort порт `Number(x ?? 0)`
/// (`main.mjs:71-72`) для реалістичних форм. Деталі розбіжностей —
/// доккомент модуля, розділ «Межі порту».
fn numeric_field(summary: Option<&serde_json::Value>, key: &str) -> u64 {
    let Some(value) = summary.and_then(|s| s.get(key)) else {
        return 0;
    };
    if let Some(n) = value.as_u64() {
        return n;
    }
    if let Some(f) = value.as_f64() {
        return if f.is_finite() && f > 0.0 {
            f as u64
        } else {
            0
        };
    }
    if let Some(s) = value.as_str() {
        if let Ok(f) = s.trim().parse::<f64>() {
            if f.is_finite() && f > 0.0 {
                return f as u64;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Кладе у `dir` виконуваний shell-скрипт-заглушку `bunx`, що друкує
    /// `stdout_text`/`stderr_text` і завершується з `exit_code`, і повертає
    /// шлях до нього — той самий прийом, що й `fake_trufflehog` у
    /// `security_scan.rs`.
    #[cfg(unix)]
    fn fake_bunx(dir: &Path, exit_code: i32, stdout_text: &str, stderr_text: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("bunx");
        fs::write(
            &bin,
            format!(
                "#!/bin/sh\nprintf '%s' '{stdout_text}'\nprintf '%s' '{stderr_text}' >&2\nexit {exit_code}\n"
            ),
        )
        .unwrap();
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

    /// `bunx` не резолвиться → 0 violations, інформаційна нота, без спавна
    /// (`main.mjs:37-43`).
    #[test]
    fn missing_bunx_is_skipped_with_info_diagnostic() {
        let tmp = TempDir::new().unwrap();
        let report = image_compress_check_with(tmp.path(), &resolver_missing);
        assert!(report.violations.is_empty());
        assert_eq!(report.diagnostics.len(), 1);
        assert_eq!(report.diagnostics[0].level, "info");
        assert!(report.diagnostics[0].message.contains("bunx"));
    }

    /// exit 0 + `needsCompression: 0` → 0 violations, жодних нот
    /// (`tests/main.test.mjs:38-48`).
    #[cfg(unix)]
    #[test]
    fn zero_needs_compression_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bunx(
            &tmp.path().join("bin"),
            0,
            r#"{"summary":{"needsCompression":0,"processed":1,"total":1,"unsupported":0},"files":[]}"#,
            "",
        );
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = image_compress_check_with(&repo, &resolver_found(bin));
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// exit 0 + `needsCompression > 0` → violation `needs-compression` із
    /// точним форматом повідомлення (`tests/main.test.mjs:50-62`,
    /// `main.mjs:73-77`).
    #[cfg(unix)]
    #[test]
    fn positive_needs_compression_is_a_violation() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bunx(
            &tmp.path().join("bin"),
            0,
            r#"{"summary":{"needsCompression":2,"processed":1,"total":3,"unsupported":0},"files":[]}"#,
            "",
        );
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = image_compress_check_with(&repo, &resolver_found(bin));
        assert_eq!(report.violations.len(), 1);
        let v = &report.violations[0];
        assert_eq!(v.reason, "needs-compression");
        assert_eq!(
            v.message,
            "image-compress: 2/3 image-файлів потребують стиснення — запусти `n-rules lint image-compress` локально"
        );
        assert!(report.diagnostics.is_empty());
    }

    /// Бінарник зник із диска між резолвом і спавном → JS ловить це у
    /// власному `try/catch` (`main.mjs:45-55`) і віддає violation
    /// `tool-error`, а НЕ кидає з `lint()` — порт мапить `io::Error` так
    /// само (доккомент модуля, розділ «Чому концерн не повертає `Result`»).
    #[test]
    fn vanished_binary_is_a_tool_error_violation_not_a_thrown_error() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("nowhere").join("bunx");
        let report = image_compress_check_with(tmp.path(), &resolver_found(ghost));
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "tool-error");
        assert!(report.diagnostics.is_empty());
    }

    /// Ненульовий exit → violation `tool-error` із хвостом stdout+stderr
    /// (`main.mjs:56-61`).
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_reports_tool_error_with_output_tail() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bunx(&tmp.path().join("bin"), 1, "boom-stdout", "boom-stderr");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = image_compress_check_with(&repo, &resolver_found(bin));
        assert_eq!(report.violations.len(), 1);
        let v = &report.violations[0];
        assert_eq!(v.reason, "tool-error");
        assert!(v.message.contains("кодом 1"), "{}", v.message);
        assert!(v.message.contains("boom-stdout"), "{}", v.message);
        assert!(v.message.contains("boom-stderr"), "{}", v.message);
    }

    /// Ненульовий exit із порожнім виводом → повідомлення без хвоста
    /// (`out_suffix`/`detailSuffix` лишається порожнім, як і в JS).
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_with_empty_output_has_no_tail_suffix() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bunx(&tmp.path().join("bin"), 1, "", "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = image_compress_check_with(&repo, &resolver_found(bin));
        assert_eq!(report.violations.len(), 1);
        assert_eq!(
            report.violations[0].message,
            "image-compress: @nitra/minify-image --json завершився з кодом 1"
        );
    }

    /// Невалідний JSON на exit 0 → violation `tool-error` (`main.mjs:63-69`).
    #[cfg(unix)]
    #[test]
    fn invalid_json_reports_tool_error() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bunx(&tmp.path().join("bin"), 0, "not-json{{{", "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = image_compress_check_with(&repo, &resolver_found(bin));
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "tool-error");
        assert!(report.violations[0].message.contains("невалідний JSON"));
    }
}
