//! Native-порт read-only боку `text/run-dotenv-linter`
//! (`npm/rules/text/run-dotenv-linter/main.mjs`, 117 рядків, ВИДАЛЕНИЙ після цього
//! порту) — детектор `lint(ctx)` разом із `runDotenvLinter(cwd, readOnly=true, scopeFiles)`.
//! `dotenv-linter` — швидкий лінтер `.env`-файлів (LowercaseKey, DuplicatedKey,
//! IncorrectDelimiter, UnorderedKey тощо), очікується у `PATH` і не додається в
//! `dependencies`/`devDependencies` (`text.mdc`).
//!
//! Портовано ЛИШЕ read-only детекторний бік (`dotenv-linter check`). Авто-фікс
//! (`dotenv-linter fix`, `readOnly=false` гілка `runDotenvLinter`) лишається T0-фіксером
//! `npm/rules/text/run-dotenv-linter/fix-run-dotenv-linter.mjs` — той тепер самодостатній
//! (переніс `runDotenvLinter`/`printDotenvLinterInstallHints`/`buildTargetArgs` зі
//! зниклого `main.mjs` прямо в себе), у native-реєстр НЕ йде.
//!
//! # Відсутній тул — ТЕ САМЕ порушення, що й «знайдено зауваження», плюс info-нота
//!
//! `main.mjs:70-74`: коли `resolveCmd('dotenv-linter')` дає `null`, канон друкує
//! install-підказки в stderr (`printDotenvLinterInstallHints`) і повертає `1` — той самий
//! код, що й «`check` знайшов залишкові порушення» чи «спавн `check` впав». `lint()`
//! (`main.mjs:104-113`) не розрізняє ці три причини: будь-яке `code !== 0` дає рівно ОДНЕ
//! порушення `fail('dotenv-linter знайшов порушення у .env* (text.mdc)', 'dotenv-linter')`.
//! Порт відтворює це буквально одним [`Violation`] з `reason: "dotenv-linter"` для всіх
//! трьох причин — і ДОДАЄ інформаційну ноту ([`ConcernDiagnostic::info`]) з тим самим
//! текстом, що канон писав у stderr, лише коли причина саме «тула немає»: пропаде
//! `printDotenvLinterInstallHints` — не було б видно, ЧОМУ конкретно перевірка провалилась
//! (stderr не потрапляє у структурований [`ConcernReport`], а нота — потрапляє).
//!
//! # Спавн-помилка ПІСЛЯ успішного резолву — теж violation, не `Err`
//!
//! На відміну від `text/oxfmt` ([`super::text_oxfmt`]) і `security/scan`
//! ([`super::security_scan`]), де відсутній `try/catch` навколо `spawnAsync` означає
//! «виняток мусить піднятися як помилка виконання концерну», `main.mjs:86-92` ЯВНО ловить
//! помилку спавна `check` (`catch (error) { ...; return 1 }`) — це свідомий вибір канону,
//! не недогляд. Тому гонка «резолв успішний → бінарник зник до спавна» тут теж дає
//! рівно ту саму violation, а не [`RulesError::Concern`]: `Result::Err` лишається каналом
//! ЛИШЕ для того, що в каноні впало б винятком повз `lint()`, а тут такого шляху нема.
//!
//! # `buildTargetArgs` — full vs delta
//!
//! Full-режим (`files: None`) → рекурсивно, `-r --exclude node_modules --exclude .envrc .`
//! (`main.mjs:26,54-57`). Delta-режим (`files: Some(...)`) → буквальний перелік файлів без
//! `-r`/`--exclude` (виключення вже враховані відбором git-diff на JS-боці, а тут — лише
//! фільтром [`ENV_BASENAME_RE`], не переліком директорій).
//!
//! # Фільтр `.env*` у delta-режимі
//!
//! `ENV_BASENAME_RE` (`main.mjs:29`, `/(?:^|\/)\.env(?:\.|$)/u`) звіряється з усім
//! relative-шляхом (не лише basename, попри назву константи в JS) — точний порт: `^` або
//! `/` перед `.env`, і `.` або кінець рядка одразу після. Порожній список цілей ПІСЛЯ
//! фільтрації (`ctx.files` був заданий, але жоден елемент не пройшов) → чистий результат
//! без спроби резолву тула (`main.mjs:107-108`).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;

use regex::Regex;

use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::tool_resolve::resolve_cmd;
use crate::RulesError;

/// Каталоги/файли, які виключаємо з рекурсивного full-скану — порт `EXCLUDED_PATHS`
/// (`main.mjs:26`).
const EXCLUDED_PATHS: [&str; 2] = ["node_modules", ".envrc"];

/// `.env`-файли — фільтр delta-списку файлів — точний порт `ENV_BASENAME_RE`
/// (`main.mjs:29`).
static ENV_BASENAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|/)\.env(?:\.|$)").expect("valid regex"));

/// Стабільний machine code — другий аргумент `fail(msg, 'dotenv-linter')` (`main.mjs:111`).
const REASON: &str = "dotenv-linter";

/// Повідомлення єдиної можливої violation — буквально той самий рядок, що в JS
/// (`main.mjs:111`).
const MESSAGE: &str = "dotenv-linter знайшов порушення у .env* (text.mdc)";

/// Install-підказки — порт `printDotenvLinterInstallHints` (`main.mjs:35-46`), текст
/// без ведучого `❌`/хвостового порожнього рядка stderr-виводу (тут — вміст
/// [`ConcernDiagnostic`], не сирий stderr).
const INSTALL_HINT: &str = "dotenv-linter не знайдено в PATH. Встанови інструмент і повтори lint-text:\n  macOS:    brew install dotenv-linter\n  Linux:    curl -sSfL https://git.io/JLbXn | sh -s -- -b /usr/local/bin\n  cargo:    cargo install dotenv-linter";

/// Єдина можлива violation детектора — конструюється з ідентичним `reason`/`message` для
/// всіх трьох причин `code !== 0` (доккомент модуля, секція «Відсутній тул»).
fn violation() -> Violation {
    Violation {
        reason: REASON.to_string(),
        message: MESSAGE.to_string(),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Будує позиційні аргументи-цілі для `dotenv-linter check`: явний перелік файлів (delta)
/// або рекурсивний `-r --exclude … .` (full) — точний порт `buildTargetArgs`
/// (`main.mjs:54-57`).
fn build_target_args(scope_files: Option<&[String]>) -> Vec<String> {
    match scope_files {
        Some(files) => files.to_vec(),
        None => {
            let mut args = vec!["-r".to_string()];
            for excluded in EXCLUDED_PATHS {
                args.push("--exclude".to_string());
                args.push(excluded.to_string());
            }
            args.push(".".to_string());
            args
        }
    }
}

/// Detector `text/run-dotenv-linter` — порт `lint(ctx)` + read-only гілка
/// `runDotenvLinter(cwd, true, scopeFiles)` (`main.mjs:68-113`).
pub fn text_run_dotenv_linter(
    cwd: &Path,
    files: Option<&[String]>,
) -> Result<ConcernReport, RulesError> {
    text_run_dotenv_linter_with(cwd, files, &resolve_cmd)
}

/// Тіло детектора з інжектованим пошуком бінарника.
///
/// Інжекція потрібна тестам: підміняти процес-глобальний `PATH` не можна — у тому ж
/// тест-процесі паралельно біжать тести, що спавнять `git` (`worktree`/`changed_files`),
/// і така підміна валила б їх випадковим чином (той самий прийом, що й
/// `text_oxfmt_with`/`security_scan_with`).
fn text_run_dotenv_linter_with(
    cwd: &Path,
    files: Option<&[String]>,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<ConcernReport, RulesError> {
    // Delta-режим: фільтр `.env*` (`main.mjs:107`); порожньо після фільтрації → чистий
    // результат без спроби резолву (`main.mjs:108`).
    let scope_files: Option<Vec<String>> = files.map(|list| {
        list.iter()
            .filter(|f| ENV_BASENAME_RE.is_match(f))
            .cloned()
            .collect()
    });
    if let Some(ref filtered) = scope_files {
        if filtered.is_empty() {
            return Ok(ConcernReport::default());
        }
    }

    let Some(bin) = resolve_tool("dotenv-linter") else {
        return Ok(ConcernReport {
            violations: vec![violation()],
            diagnostics: vec![ConcernDiagnostic::info(INSTALL_HINT)],
        });
    };

    let targets = build_target_args(scope_files.as_deref());
    let mut command = Command::new(&bin);
    command
        .current_dir(cwd)
        .arg("check")
        .arg("--quiet")
        .args(&targets);

    // Спавн-помилка ПІСЛЯ успішного резолву (гонка) → та сама violation, що й «знайдено
    // порушення» — канон явно ловить цю помилку сам (доккомент модуля, секція
    // «Спавн-помилка»), не дає їй піднятись як винятку.
    let success = command.output().is_ok_and(|output| output.status.success());
    if success {
        Ok(ConcernReport::default())
    } else {
        Ok(ConcernReport::from(vec![violation()]))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Кладе у `dir` виконуваний shell-скрипт-заглушку `dotenv-linter`: `check` завершується
    /// з `exit_code` (stdout/stderr не мають значення для повернутого [`ConcernReport`] —
    /// лінт() дивиться лише на код завершення).
    #[cfg(unix)]
    fn fake_dotenv_linter(dir: &Path, exit_code: i32) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("dotenv-linter");
        fs::write(&bin, format!("#!/bin/sh\nexit {exit_code}\n")).unwrap();
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

    /// `dotenv-linter` не резолвиться → одна violation `reason: "dotenv-linter"` ПЛЮС
    /// info-нота з install-підказкою (доккомент модуля, секція «Відсутній тул»).
    #[test]
    fn missing_binary_gives_violation_and_install_hint_diagnostic() {
        let tmp = TempDir::new().unwrap();
        let report = text_run_dotenv_linter_with(tmp.path(), None, &resolver_missing).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "dotenv-linter");
        assert_eq!(
            report.violations[0].message,
            "dotenv-linter знайшов порушення у .env* (text.mdc)"
        );
        assert_eq!(report.diagnostics.len(), 1);
        assert!(report.diagnostics[0].message.contains("dotenv-linter"));
        assert!(report.diagnostics[0].message.contains("brew install"));
    }

    /// Delta-режим з порожнім `ctx.files` (`Some(&[])`) → 0 цілей → чистий результат без
    /// спроби резолву тула взагалі (резолвер «нічого не знаходить», тож дійти до нього
    /// неможливо, якщо гілка відпрацює правильно).
    #[test]
    fn empty_delta_files_yields_no_violations_without_resolve() {
        let tmp = TempDir::new().unwrap();
        let report = text_run_dotenv_linter_with(tmp.path(), Some(&[]), &resolver_missing).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Delta-режим фільтрує не-`.env*` файли (`ENV_BASENAME_RE`); якщо після фільтра
    /// порожньо — та сама поведінка, що й порожній вхідний список.
    #[test]
    fn delta_mode_filters_non_env_files_before_resolve() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["README.md".to_string(), "src/lib.rs".to_string()];
        let report =
            text_run_dotenv_linter_with(tmp.path(), Some(&files), &resolver_missing).unwrap();
        assert!(report.violations.is_empty());
    }

    /// `ENV_BASENAME_RE` звіряється з усім шляхом: `.env`, `.env.local`,
    /// `packages/api/.env.production` проходять; `app.env`/`.environment` — ні.
    #[test]
    fn env_basename_regex_matches_dotenv_paths_only() {
        assert!(ENV_BASENAME_RE.is_match(".env"));
        assert!(ENV_BASENAME_RE.is_match(".env.local"));
        assert!(ENV_BASENAME_RE.is_match("packages/api/.env.production"));
        assert!(!ENV_BASENAME_RE.is_match("app.env"));
        assert!(!ENV_BASENAME_RE.is_match(".environment"));
    }

    /// Full-режим (`files: None`) завжди дає непорожні цілі — навіть на порожньому дереві
    /// доходить до резолву тула; `check` exit 0 → чистий результат, без violation.
    #[cfg(unix)]
    #[test]
    fn clean_check_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_dotenv_linter(&tmp.path().join("bin"), 0);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = text_run_dotenv_linter_with(&repo, None, &resolver_found(bin)).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// `check` завершується ненульовим кодом (знайдені порушення) → одна violation, БЕЗ
    /// install-нот (ті — лише для «тула немає»).
    #[cfg(unix)]
    #[test]
    fn dirty_check_gives_single_violation_without_install_hint() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_dotenv_linter(&tmp.path().join("bin"), 1);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        let report = text_run_dotenv_linter_with(&repo, None, &resolver_found(bin)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "dotenv-linter");
        assert!(report.diagnostics.is_empty());
    }

    /// Full-режим передає `-r --exclude node_modules --exclude .envrc .` — перевіряємо
    /// побічно через `build_target_args`, бо доступу до фактичних argv фейкового процесу
    /// тут немає без додаткової інфраструктури логування.
    #[test]
    fn build_target_args_full_mode_excludes_node_modules_and_envrc() {
        let args = build_target_args(None);
        assert_eq!(
            args,
            vec![
                "-r",
                "--exclude",
                "node_modules",
                "--exclude",
                ".envrc",
                "."
            ]
        );
    }

    /// Delta-режим передає буквальний перелік файлів, без `-r`/`--exclude`.
    #[test]
    fn build_target_args_delta_mode_passes_files_literally() {
        let files = vec![".env".to_string(), "packages/api/.env.local".to_string()];
        assert_eq!(build_target_args(Some(&files)), files);
    }

    /// Гонка «резолв успішний → бінарник зник до спавна» → та сама violation, що й
    /// «знайдено порушення», НЕ `Err` (доккомент модуля, секція «Спавн-помилка»).
    #[test]
    fn vanished_binary_after_resolve_gives_violation_not_error() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("nowhere").join("dotenv-linter");
        let report = text_run_dotenv_linter_with(tmp.path(), None, &resolver_found(ghost)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "dotenv-linter");
    }

    /// Delta-режим з реальними `.env*`-цілями доходить до резолву й до спавна — full vs
    /// delta обидві гілки покриті (доккомент модуля, секція «full vs delta»).
    #[cfg(unix)]
    #[test]
    fn delta_mode_with_env_targets_reaches_spawn() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_dotenv_linter(&tmp.path().join("bin"), 0);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let files = vec![
            "README.md".to_string(),
            ".env".to_string(),
            "packages/api/.env.local".to_string(),
        ];

        let report =
            text_run_dotenv_linter_with(&repo, Some(&files), &resolver_found(bin)).unwrap();
        assert!(report.violations.is_empty());
    }
}
