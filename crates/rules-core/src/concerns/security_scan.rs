//! Native-порт `security/scan` (`npm/rules/security/scan/main.mjs`,
//! 48 рядків) — read-only filesystem-скан усього репо тулом `trufflehog` на
//! секрети (`security.mdc`). Фіксу немає свідомо: детектор лише сигналить
//! про знайдені секрети, автоматичне виправлення секрету — не задача лінтера.
//!
//! Concern whole-repo (`concern.json#lint.scope = "full"`), і `main.mjs`
//! не читає `ctx.files` узагалі — `security_scan` так само не приймає
//! `files`.
//!
//! # Резолв тула — `resolve_cmd`, не `resolve_provisioned_tool`
//!
//! JS-версія бере `trufflehog` через `resolveCmd` (лише PATH, без керованого
//! кешу й без fail-closed) — на відміну від `k8s/kubeconform`, який іде
//! через повний `ensureTool`. Якщо `trufflehog` не резолвиться, JS
//! ПРОПУСКАЄ скан і повертає інформаційну ноту, а не падає. Native-порт
//! дзеркалить це буквально через [`crate::tool_resolve::resolve_cmd`] і
//! [`ConcernDiagnostic::info`] — той самий канал, що вже використовує
//! `security/tracked_symlink`.
//!
//! # Межі порту
//!
//! - `spawn` дитини — синхронний `Command::output()` (native-концерни й так
//!   виконуються поза event loop-ом, паралельність тримає план лінта, як і
//!   в `text/cspell-fix`);
//! - обрізання виводу до 4000 символів — порт `.slice(0, 4000)` на
//!   **символах** (`chars().take(4000)`), а не байтах/UTF-16 code units, як
//!   у JS: у межах output-у trufflehog різниця між UTF-16 code units і
//!   Unicode-скалярами дає щонайбільше кілька символів навколо сурогатних
//!   пар — несуттєво для діагностичного тексту, обрізаного «десь тут»;
//! - **спавн упав ПІСЛЯ успішного резолву** (гонка «перевірка-потім-
//!   використання» — бінарник зник між резолвом і викликом, чи інша
//!   ОС-помилка спавна) — у JS немає власного `catch` навколо
//!   `spawnAsync` САМЕ ТОМУ, що виняток мусить піднятися і стати помилкою
//!   ВИКОНАННЯ детектора, а не порушенням лінту — це інший канал, ніж
//!   `LintResult.violations`. Вигадувати новий код порушення (якого немає
//!   в JS-каноні) під це — розширювати контракт, за яким можуть матчити
//!   споживачі. Симетричний канал тут — `Result::Err`, той самий приймач
//!   помилки виконання концерну, що й у `k8s/kubeconform`
//!   ([`crate::concerns::k8s_kubeconform`]): спавн-помилка мапиться в
//!   [`crate::RulesError::Concern`], не в `Violation`.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::tool_resolve::resolve_cmd;
use crate::RulesError;

/// Reason знайденого секрету — другий аргумент `fail(msg, 'secret-found')`
/// (`main.mjs:45`).
const SECRET_FOUND_REASON: &str = "secret-found";

/// Максимум символів хвоста виводу trufflehog у повідомленні — порт
/// `.slice(0, 4000)` (`main.mjs:43`).
const OUTPUT_TAIL_LIMIT: usize = 4000;

/// Аргументи виклику `trufflehog` — буквальна копія `main.mjs:31-39`.
const TRUFFLEHOG_ARGS: &[&str] = &[
    "filesystem",
    ".",
    "--no-update",
    "--exclude-paths",
    ".trufflehog-exclude",
    "--results=verified,unknown",
    "--fail",
];

fn violation(reason: &str, message: String) -> Violation {
    Violation {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `security/scan` — порт `lint(ctx)` (`main.mjs:16-48`).
///
/// Whole-repo (`scope: "full"`), тому єдиний параметр — `cwd`. `Result` —
/// не `ConcernReport` напряму: спавн-помилка ПІСЛЯ успішного резолву тула
/// (доккомент модуля, розділ «Межі порту») — це помилка виконання
/// концерну, не порушення лінту.
pub fn security_scan(cwd: &Path) -> Result<ConcernReport, RulesError> {
    security_scan_with(cwd, &resolve_cmd)
}

/// Тіло детектора з інжектованим пошуком бінарника.
///
/// Інжекція потрібна тестам: підміняти процес-глобальний `PATH` не можна —
/// у тому ж тест-процесі паралельно біжать тести, що спавнять `git`
/// (`worktree`/`changed_files`), і така підміна валила б їх випадковим
/// чином (той самий прийом, що й `k8s_kubeconform_with`).
fn security_scan_with(
    cwd: &Path,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<ConcernReport, RulesError> {
    let Some(trufflehog) = resolve_tool("trufflehog") else {
        return Ok(ConcernReport {
            violations: Vec::new(),
            diagnostics: vec![ConcernDiagnostic::info(
                "security/scan: `trufflehog` не знайдено в PATH — скан пропущено",
            )],
        });
    };

    let output = Command::new(&trufflehog)
        .args(TRUFFLEHOG_ARGS)
        .current_dir(cwd)
        .output()
        .map_err(|error| {
            RulesError::Concern(format!(
                "security/scan: не вдалося запустити `trufflehog`: {error}"
            ))
        })?;

    let code = output.status.code().unwrap_or(1);
    if code == 0 {
        return Ok(ConcernReport::default());
    }

    let mut out = String::from_utf8_lossy(&output.stdout).into_owned();
    out.push_str(&String::from_utf8_lossy(&output.stderr));
    let trimmed = out.trim();
    let truncated: String = trimmed.chars().take(OUTPUT_TAIL_LIMIT).collect();
    let out_suffix = if truncated.is_empty() {
        String::new()
    } else {
        format!("\n{truncated}")
    };

    Ok(ConcernReport::from(vec![violation(
        SECRET_FOUND_REASON,
        format!("security/scan: trufflehog знайшов секрети (код {code}){out_suffix}"),
    )]))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Кладе у `dir` виконуваний shell-скрипт-заглушку `trufflehog`, що
    /// друкує `stdout_text`/`stderr_text` і завершується з `exit_code`, і
    /// повертає шлях до нього.
    #[cfg(unix)]
    fn fake_trufflehog(
        dir: &Path,
        exit_code: i32,
        stdout_text: &str,
        stderr_text: &str,
    ) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("trufflehog");
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

    /// `trufflehog` не резолвиться → `Ok` з 0 violations, інформаційна
    /// нота, без спавна (резолвер тут «нічого не знаходить», тож дійти до
    /// `Command` узагалі неможливо).
    #[test]
    fn missing_binary_is_skipped_with_info_diagnostic() {
        let tmp = TempDir::new().unwrap();
        let report = security_scan_with(tmp.path(), &resolver_missing).unwrap();
        assert!(report.violations.is_empty());
        assert_eq!(report.diagnostics.len(), 1);
        assert_eq!(report.diagnostics[0].level, "info");
        assert!(report.diagnostics[0].message.contains("trufflehog"));
    }

    /// exit 0 → `Ok` з 0 violations, жодних нот.
    #[cfg(unix)]
    #[test]
    fn exit_zero_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_trufflehog(&tmp.path().join("bin"), 0, "", "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = security_scan_with(&repo, &resolver_found(bin)).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Ненульовий exit → `Ok` з однією violation reason `secret-found` і
    /// хвостом stdout+stderr у повідомленні.
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_reports_secret_found_with_output_tail() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_trufflehog(
            &tmp.path().join("bin"),
            183,
            "FOUND-SECRET-STDOUT",
            "FOUND-SECRET-STDERR",
        );
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = security_scan_with(&repo, &resolver_found(bin)).unwrap();
        assert_eq!(report.violations.len(), 1);
        let v = &report.violations[0];
        assert_eq!(v.reason, "secret-found");
        assert!(v.message.contains("код 183"), "{}", v.message);
        assert!(v.message.contains("FOUND-SECRET-STDOUT"), "{}", v.message);
        assert!(v.message.contains("FOUND-SECRET-STDERR"), "{}", v.message);
        assert!(v.file.is_none());
        assert_eq!(v.severity, Severity::Error);
        assert!(report.diagnostics.is_empty());
    }

    /// Порожній вивід при ненульовому exit → повідомлення без хвоста
    /// (`out_suffix` лишається порожнім, як і в JS-версії).
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_with_empty_output_has_no_tail_suffix() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_trufflehog(&tmp.path().join("bin"), 1, "", "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = security_scan_with(&repo, &resolver_found(bin)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(
            report.violations[0].message,
            "security/scan: trufflehog знайшов секрети (код 1)"
        );
    }

    /// Вивід, довший за ліміт, обрізається до `OUTPUT_TAIL_LIMIT` символів —
    /// порт `.slice(0, 4000)`.
    #[cfg(unix)]
    #[test]
    fn long_output_is_truncated_to_limit() {
        let tmp = TempDir::new().unwrap();
        let long = "x".repeat(OUTPUT_TAIL_LIMIT + 500);
        let bin = fake_trufflehog(&tmp.path().join("bin"), 183, &long, "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = security_scan_with(&repo, &resolver_found(bin)).unwrap();
        let message = &report.violations[0].message;
        let tail = message.split_once('\n').map(|(_, t)| t).unwrap_or("");
        assert_eq!(tail.chars().count(), OUTPUT_TAIL_LIMIT);
    }

    /// Бінарник зник із диска між резолвом і спавном (гонка
    /// «перевірка-потім-використання») → `Command::output()` дає помилку,
    /// яка мапиться в `Err(RulesError::Concern)` — ту саму помилку
    /// виконання концерну, що й у `k8s/kubeconform`, — а НЕ у вигадане
    /// порушення й НЕ в мовчазний `Ok` з порожнім результатом (доккомент
    /// модуля, розділ «Межі порту»).
    #[test]
    fn vanished_binary_maps_to_concern_error() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("nowhere").join("trufflehog");
        let err = security_scan_with(tmp.path(), &resolver_found(ghost)).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("trufflehog"), "{err}");
    }
}
