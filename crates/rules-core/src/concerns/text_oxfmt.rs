//! Native-порт `text/oxfmt` (`npm/rules/text/oxfmt/main.mjs`, 49 рядків) —
//! read-only detector форматування через `oxfmt --list-different`. `oxfmt` —
//! мандатний форматер проєкту (Prettier заборонено, `text/forbidden-prettier`);
//! конфіг — `.oxfmtrc.json`. Автофікс (`oxfmt --write`) — окремий T0
//! `fix-oxfmt.mjs`, не в цьому detector-і.
//!
//! # Резолв тула — `resolve_cmd`, і мовчазний skip БЕЗ ноти
//!
//! JS-версія бере `oxfmt` через `resolveCmd` (лише PATH, без керованого
//! кешу й без fail-closed) — так само, як `security/scan` бере `trufflehog`.
//! Але, на відміну від `security/scan`, JS `lint()` тут НЕ повертає
//! інформаційну ноту при відсутньому тулі — `main.mjs:30` буквально
//! `if (!oxfmt) return reporter.result() // тул відсутній → skip`, без
//! жодного виклику репортера. Порт дзеркалить це буквально: `Ok(Vec::new())`
//! без [`crate::diagnostics::ConcernDiagnostic`] — вигадувати ноту, якої
//! немає в каноні, означало б розширювати контракт понад те, що видає JS.
//!
//! # Спавн-помилка ПІСЛЯ успішного резолву — помилка виконання, не violation
//!
//! `main.mjs:35` викликає `spawnAsync` без `try/catch` — виняток (гонка
//! «перевірка-потім-використання», бінарник зник між резолвом і спавном)
//! мусить піднятися й стати помилкою ВИКОНАННЯ концерну, а не порушенням
//! лінту. Той самий канал, що й у `security/scan`
//! ([`crate::concerns::security_scan`]) та `k8s/kubeconform`
//! ([`crate::concerns::k8s_kubeconform`]): [`RulesError::Concern`], не
//! вигаданий `reason`.
//!
//! # Exit-код `oxfmt` ігнорується повністю
//!
//! `main.mjs:35-39` читає лише `r.stdout` — код завершення `oxfmt
//! --list-different` ніде не перевіряється (тул сам друкує список
//! неформатованих файлів у stdout незалежно від коду виходу). Порт так само
//! не дивиться на `output.status`.
//!
//! # Спрощення шляху
//!
//! `main.mjs:41` — `relative(cwd, resolve(cwd, f)).split('\\').join('/')`.
//! Порт відтворює це через `join` + `strip_prefix` ([`relative_to_cwd`]),
//! той самий прийом, що й `abie_yaml::rel_posix_or_self` і
//! `find_src_tauri::relative_posix`: без `..`-нормалізації повного
//! `path.relative`, бо `oxfmt --list-different` над цілями під `cwd` завжди
//! друкує шляхи, похідні від `cwd`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;

use regex::Regex;

use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::tool_resolve::resolve_cmd;
use crate::RulesError;

/// Розширення, що їх форматує oxfmt у дельта-режимі — точний порт
/// `FMT_EXT_RE` (`main.mjs:15`).
static FMT_EXT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\.(?:m?[jt]s|c[jt]s|jsx|tsx|vue|css|scss)$").expect("valid regex")
});

/// Full-режим ціль — сам glob, який `oxfmt` розгортає зсередини (не Rust) —
/// точний порт `FMT_GLOB` (`main.mjs:17`).
const FMT_GLOB: &str = "**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,vue,css,scss}";

/// Стабільний machine code — другий аргумент `fail(msg, {reason: ...})`
/// (`main.mjs:43`).
const REASON: &str = "oxfmt-unformatted";

/// Detector `text/oxfmt` — порт `lint(ctx)` (`main.mjs:26-49`).
pub fn text_oxfmt(cwd: &Path, files: Option<&[String]>) -> Result<ConcernReport, RulesError> {
    text_oxfmt_with(cwd, files, &resolve_cmd)
}

/// Тіло детектора з інжектованим пошуком бінарника.
///
/// Інжекція потрібна тестам: підміняти процес-глобальний `PATH` не можна —
/// у тому ж тест-процесі паралельно біжать тести, що спавнять `git`
/// (`worktree`/`changed_files`), і така підміна валила б їх випадковим
/// чином (той самий прийом, що й `k8s_kubeconform_with`/`security_scan_with`).
fn text_oxfmt_with(
    cwd: &Path,
    files: Option<&[String]>,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<ConcernReport, RulesError> {
    let Some(oxfmt) = resolve_tool("oxfmt") else {
        // Канон тут МОВЧИТЬ (`main.mjs:30`). Порт додає ноту: перевірка,
        // яка зникає на ефемерному раннері й ніде цього не показує, — це той
        // самий fail-open, проти якого написано §5.3 реєстру. Нота нічого не
        // послаблює, лише робить пропуск видним.
        return Ok(ConcernReport {
            violations: Vec::new(),
            diagnostics: vec![ConcernDiagnostic::info(
                "text/oxfmt: `oxfmt` не знайдено в PATH — перевірку пропущено",
            )],
        });
    };

    let targets: Vec<String> = match files {
        None => vec![FMT_GLOB.to_string()],
        Some(list) => list
            .iter()
            .filter(|f| FMT_EXT_RE.is_match(f))
            .cloned()
            .collect(),
    };
    if targets.is_empty() {
        return Ok(ConcernReport::default());
    }

    let output = Command::new(&oxfmt)
        .current_dir(cwd)
        .arg("--list-different")
        .args(&targets)
        .output()
        .map_err(|error| {
            RulesError::Concern(format!("text/oxfmt: не вдалося запустити `oxfmt`: {error}"))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut violations = Vec::new();
    for raw in stdout.split('\n') {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let rel = relative_to_cwd(cwd, trimmed);
        violations.push(Violation {
            reason: REASON.to_string(),
            message: format!("{rel}: не відформатовано (oxfmt --write виправить; text.mdc)"),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "kind": "oxfmt-unformatted" })),
        });
    }
    Ok(ConcernReport::from(violations))
}

/// posix-relative шлях від `cwd` — спрощений порт
/// `relative(cwd, resolve(cwd, f)).split('\\').join('/')` (`main.mjs:41`,
/// секція «Спрощення шляху» в доккоменті модуля).
fn relative_to_cwd(cwd: &Path, raw: &str) -> String {
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        cwd.join(raw)
    };
    match abs.strip_prefix(cwd) {
        Ok(rel) if !rel.as_os_str().is_empty() => rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
        _ => raw.replace('\\', "/"),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Кладе у `dir` виконуваний shell-скрипт-заглушку `oxfmt`, що друкує
    /// `stdout_lines` (по рядку на елемент) і завершується з `exit_code`
    /// (ігнорується детектором — секція «Exit-код ігнорується» доккоменту
    /// модуля), і повертає шлях до нього.
    #[cfg(unix)]
    fn fake_oxfmt(dir: &Path, exit_code: i32, stdout_lines: &[&str]) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("oxfmt");
        let body = stdout_lines
            .iter()
            .map(|line| format!("printf '%s\\n' '{line}'\n"))
            .collect::<String>();
        fs::write(&bin, format!("#!/bin/sh\n{body}exit {exit_code}\n")).unwrap();
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

    /// `oxfmt` не резолвиться → `Ok` з 0 violations, БЕЗ жодної ноти — на
    /// відміну від `security/scan`, JS-канон тут мовчить (`main.mjs:30`).
    #[test]
    fn missing_binary_is_silently_skipped_without_diagnostic() {
        let tmp = TempDir::new().unwrap();
        let violations = text_oxfmt_with(tmp.path(), None, &resolver_missing).unwrap();
        assert!(violations.violations.is_empty());
    }

    /// Дельта-режим без жодного fmt-типу серед `files` → 0 цілей → 0
    /// violations без спавна (резолвер «нічого не знаходить», тож дійти до
    /// `Command` узагалі неможливо).
    #[test]
    fn delta_without_fmt_extensions_skips_without_spawn() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["README.md".to_string(), "docs/index.md".to_string()];
        let violations = text_oxfmt_with(tmp.path(), Some(&files), &resolver_missing).unwrap();
        assert!(violations.violations.is_empty());
    }

    /// `oxfmt --list-different` не друкує нічого → 0 violations.
    #[cfg(unix)]
    #[test]
    fn no_unformatted_files_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_oxfmt(&tmp.path().join("bin"), 0, &[]);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let violations = text_oxfmt_with(&repo, None, &resolver_found(bin)).unwrap();
        assert!(violations.violations.is_empty());
    }

    /// Один неформатований файл у stdout → одна violation з reason
    /// `oxfmt-unformatted`, `file`, і `data.kind`.
    #[cfg(unix)]
    #[test]
    fn one_unformatted_file_gives_one_violation_with_reason_and_data() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_oxfmt(&tmp.path().join("bin"), 1, &["bad.mjs"]);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let violations = text_oxfmt_with(&repo, None, &resolver_found(bin)).unwrap();
        assert_eq!(violations.violations.len(), 1);
        let v = &violations.violations[0];
        assert_eq!(v.reason, "oxfmt-unformatted");
        assert_eq!(v.file.as_deref(), Some("bad.mjs"));
        assert_eq!(v.severity, Severity::Error);
        assert_eq!(
            v.data,
            Some(serde_json::json!({ "kind": "oxfmt-unformatted" }))
        );
        assert!(v.message.contains("bad.mjs"));
        assert!(v.message.contains("не відформатовано"));
    }

    /// Кілька неформатованих файлів у stdout, з порожніми рядками між ними
    /// (типовий хвіст `\n`) → по одній violation на непорожній рядок,
    /// порожні рядки відкидаються (`main.mjs:39` `.filter(Boolean)`).
    #[cfg(unix)]
    #[test]
    fn multiple_unformatted_files_each_get_a_violation() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_oxfmt(&tmp.path().join("bin"), 1, &["a.mjs", "b.ts", ""]);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let violations = text_oxfmt_with(&repo, None, &resolver_found(bin)).unwrap();
        assert_eq!(violations.violations.len(), 2);
        assert_eq!(violations.violations[0].file.as_deref(), Some("a.mjs"));
        assert_eq!(violations.violations[1].file.as_deref(), Some("b.ts"));
    }

    /// Ненульовий exit-код `oxfmt` не впливає на результат — читається лише
    /// stdout (секція «Exit-код ігнорується» доккоменту модуля): тут exit=7,
    /// stdout порожній → 0 violations, не помилка.
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_with_empty_stdout_is_clean() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_oxfmt(&tmp.path().join("bin"), 7, &[]);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let violations = text_oxfmt_with(&repo, None, &resolver_found(bin)).unwrap();
        assert!(violations.violations.is_empty());
    }

    /// Дельта-режим: не-fmt-типи відфільтровуються (`FMT_EXT_RE`), fmt-типи
    /// лишаються й доходять до спавна.
    #[cfg(unix)]
    #[test]
    fn delta_mode_filters_non_fmt_extensions_before_spawn() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_oxfmt(&tmp.path().join("bin"), 1, &["src/app.vue"]);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let files = vec![
            "README.md".to_string(),
            "src/app.vue".to_string(),
            "notes.txt".to_string(),
        ];
        let violations = text_oxfmt_with(&repo, Some(&files), &resolver_found(bin)).unwrap();
        assert_eq!(violations.violations.len(), 1);
        assert_eq!(
            violations.violations[0].file.as_deref(),
            Some("src/app.vue")
        );
    }

    /// Бінарник зник із диска між резолвом і спавном (гонка
    /// «перевірка-потім-використання») → `Command::output()` дає помилку,
    /// яка мапиться в `Err(RulesError::Concern)` — та сама помилка виконання
    /// концерну, що й у `security/scan`/`k8s/kubeconform` (секція «Спавн-
    /// помилка» доккоменту модуля).
    #[test]
    fn vanished_binary_maps_to_concern_error() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("nowhere").join("oxfmt");
        let err = text_oxfmt_with(tmp.path(), None, &resolver_found(ghost)).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("oxfmt"), "{err}");
    }

    // --- relative_to_cwd ---

    #[test]
    fn relative_to_cwd_strips_cwd_prefix_and_normalizes_separators() {
        let cwd = Path::new("/repo");
        assert_eq!(relative_to_cwd(cwd, "bad.mjs"), "bad.mjs");
        assert_eq!(relative_to_cwd(cwd, "src/app.vue"), "src/app.vue");
    }
}
