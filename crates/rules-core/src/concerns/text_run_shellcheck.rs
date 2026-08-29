//! Native-порт read-only боку `text/run-shellcheck`
//! (`npm/rules/text/run-shellcheck/main.mjs`, 234 рядки) — лише `lint(ctx)` і
//! `runShellcheckText(cwd, readOnly=true, scopeFiles)` у режимі детектора.
//! Write-режим (`readOnly=false`: цикл `shellcheck -f diff` + `patch -p1`)
//! лишається кодом JS T0-фіксера `fix-run-shellcheck.mjs` — той самий поділ
//! «detector native / fixer JS», що й в інших T0-концернів фази 5.
//!
//! # Канал для відсутнього `shellcheck` — та сама violation, не окрема гілка
//!
//! `main.mjs:101-107`: коли `resolveCmd('shellcheck') === null`,
//! `runShellcheckText` друкує install-підказки в stderr і повертає `1`; далі
//! `lint()` (`main.mjs:141-142`) не розрізняє ЦЕЙ `1` від «shellcheck
//! запустився й знайшов зауваження» — обидва дають рівно те саме `fail(
//! 'shellcheck знайшов порушення у *.sh (text.mdc)', 'shellcheck')`. Порт
//! відтворює це буквально: [`shellcheck_violation`] — єдина точка створення
//! violation-а, викликана з обох гілок ([`ConcernDiagnostic`]-нота
//! додається ЛИШЕ при відсутньому тулі — окремим полем звіту, а не зміною
//! тексту самої violation).
//!
//! Install-підказка, яку канон друкував у stderr
//! (`printShellcheckInstallHints`, `main.mjs:39-50`), не має зникнути — вона
//! йде нотою ([`crate::diagnostics::ConcernDiagnostic::info`]). Свідома
//! розбіжність: канон друкує захардкоджені рядки (macOS
//! `brew`/Debian-Ubuntu `apt-get`/Arch `pacman`); порт бере
//! [`crate::tool_registry::install_hint_for`] — те саме єдине джерело
//! правди про `shellcheck` (запис реєстру вже є, `tool_registry.rs`), що й
//! `k8s/kubeconform`/`rego/opa_check`/`rego/regal` — дублювати ще один набір
//! per-OS рядків тут означало б третю копію тієї самої інформації в
//! репозиторії. Призначення нотатки (сказати користувачу, як встановити
//! тул) збережене; точний текст — ні.
//!
//! `patch` резолвиться в каноні лише у write-режимі (`main.mjs:109`,
//! `readOnly ? null : resolveCmd('patch')`) — у read-only детекторі його
//! відсутність ніяк не впливає, тому порт про `patch` не знає взагалі.
//!
//! # Порядок перевірок — порожній delta-scope виходить РАНІШЕ за резолв тула
//!
//! `main.mjs:138-141`:
//! ```js
//! const scopeFiles = ctx.files === undefined ? undefined : ctx.files.filter(f => SH_EXT_RE.test(f))
//! if (scopeFiles !== undefined && scopeFiles.length === 0) return reporter.result()
//! const code = await runShellcheckText(ctx.cwd, true, scopeFiles)
//! ```
//! Якщо `ctx.files` задано і після фільтра `*.sh` пусто — `lint()` виходить
//! ДО виклику `runShellcheckText`, тобто до будь-якого резолву `shellcheck`.
//! [`text_run_shellcheck_with`] відтворює це тим самим порядком: перевірка
//! порожнього scope-у — перша дія, до першого звернення до `resolve_tool`.
//!
//! Навпаки, коли `ctx.files === undefined` (full-режим) АБО scope непорожній,
//! `runShellcheckText` (`main.mjs:101-118`) резолвить `shellcheck` ПЕРШИМ
//! кроком — раніше за визначення списку файлів
//! ([`list_shell_script_paths`]). Тобто навіть на дереві без жодного `*.sh`
//! відсутній `shellcheck` дає violation, а не тихий «нема що перевіряти».
//! Порт зберігає цей порядок.
//!
//! # Full-режим: список файлів — `git ls-files`, інакше fallback-обхід
//!
//! Порт [`list_shell_script_paths`] — точний семантичний порт
//! `listShellScriptPaths` (`main.mjs:73-92`):
//! - `git` резолвиться (окремим викликом `resolve_tool("git")`, незалежно
//!   від резолву `shellcheck` — так само, як `resolveCmd('git')` у JS не
//!   залежить від `resolveCmd('shellcheck')`) і `git rev-parse
//!   --is-inside-work-tree` дає `true` → `git ls-files -z --
//!   ':(glob)**/*.sh'`; ненульовий exit цієї команди → **порожній** список
//!   (`main.mjs:79-81`, `if (ls.exitCode !== 0) return []` — НЕ fallback);
//! - інакше (`git` не резолвився, або `is-inside-work-tree` дав не-`true`
//!   чи ненульовий exit) → fallback-обхід дерева без git ([`walk_sh_fallback`]).
//!
//! Спавн-помилка (не ненульовий exit, а сам процес не стартував — та сама
//! гонка «тул зник між резолвом і спавном», що й у `text/oxfmt`) на
//! **будь-якому** з двох викликів git (`rev-parse`/`ls-files`) мапиться в
//! [`RulesError::Concern`]: `main.mjs` не огортає ці два виклики
//! `try/catch`, тож `spawnAsync`-виняток (кидає лише на spawn-помилку, не на
//! ненульовий exit — див. доккомент `spawn-async.mjs`) пробився б нагору й
//! завалив увесь прогін — той самий канал, що й у `text/oxfmt`.
//!
//! # Fallback-обхід (`walk_sh_fallback`) — спрощення, не `crate::scan::walk_dir`
//!
//! Канон тут — голий `node:fs` `globSync('**/*.sh', { exclude: p =>
//! p.includes('node_modules') })` (`main.mjs:87-91`), БЕЗ `.gitignore`.
//! [`crate::scan::walk_dir`] (готовий globby-порт) тут свідомо не
//! використаний: його `ALWAYS_IGNORE` анкорить `node_modules/**` лише на
//! верхньому рівні (доккомент `scan.rs`, секція «Ignore-глоби»), а JS-фільтр
//! цього концерну виключає `node_modules` на БУДЬ-ЯКІЙ глибині сегмента
//! шляху. [`walk_sh_fallback`] — прямий рекурсивний обхід, що пропускає
//! кожен каталог з іменем `node_modules` цілим піддеревом, на будь-якому
//! рівні вкладеності — точний відповідник JS-фільтра. Ця гілка практично
//! недосяжна в консюмер-репо (воно завжди git-дерево); спрощення
//! документується, а не приховується.
//!
//! # Фінальний прогін — спавн-помилка ПІСЛЯ резолву теж стає violation
//!
//! `runFinalShellcheck` (`main.mjs:218-230`) явно огортає `spawnAsync` у
//! `try/catch`: спавн-помилка друкує повідомлення в stderr і повертає `1` —
//! той самий код, що й «shellcheck запустився і знайшов зауваження».
//! [`run_final_shellcheck`] відтворює це буквально: `Command::output()`,
//! що впала (`Err`), трактується як «не чисто» (`false`), а НЕ як
//! [`RulesError`] — на відміну від `text/oxfmt`, де відповідний виклик у
//! JS-каноні НЕ огорнутий `try/catch` і тому мапиться в помилку. Це свідома
//! розбіжність каналів між двома сусідніми портами, продиктована самим
//! каноном, а не довільним вибором порту.
//!
//! stdout/stderr фінального прогону (`main.mjs:227-228`, виводяться
//! користувачу як side-effect) тут не передаються нікуди — контракт
//! `ConcernReport` не має каналу для сирого виводу зовнішнього тула; сама
//! violation лишається тим самим фіксованим текстом, що й у каноні
//! (`main.mjs:142`), без вкладених деталей з stdout/stderr.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::tool_registry::install_hint_for;
use crate::tool_resolve::resolve_cmd;
use crate::RulesError;

/// Стабільний machine code — той самий `'shellcheck'`, що й
/// `fail(msg, 'shellcheck')` (`main.mjs:142`). T0-фіксер
/// (`fix-run-shellcheck.mjs`, `patterns[0].test`) читає рівно цей рядок —
/// міняти не можна.
const LINT_REASON: &str = "shellcheck";

/// Буквальний текст violation-а — той самий рядок для обох причин (тул
/// відсутній / shellcheck знайшов зауваження), точний порт `main.mjs:142`.
const LINT_MESSAGE: &str = "shellcheck знайшов порушення у *.sh (text.mdc)";

/// `SH_EXT_RE` (`main.mjs:27`, `/\.sh$/u`) — фільтр delta-списку файлів.
fn is_sh_target(rel: &str) -> bool {
    rel.ends_with(".sh")
}

/// Detector `text/run-shellcheck` — порт `lint(ctx)` (`main.mjs:135-144`).
pub fn text_run_shellcheck(
    cwd: &Path,
    files: Option<&[String]>,
) -> Result<ConcernReport, RulesError> {
    text_run_shellcheck_with(cwd, files, &resolve_cmd)
}

/// Тіло детектора з інжектованим резолвом зовнішніх тулів (`shellcheck` і
/// `git`) — та сама інжекція, що в `text::oxfmt`/`text::markdownlint`:
/// підміняти процес-глобальний `PATH` не можна, бо в тому ж тест-процесі
/// паралельно біжать тести, що спавнять `git`.
fn text_run_shellcheck_with(
    cwd: &Path,
    files: Option<&[String]>,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<ConcernReport, RulesError> {
    // Порожній delta-scope виходить РАНІШЕ за будь-який резолв тула
    // (секція «Порядок перевірок» доккоменту модуля, `main.mjs:139`).
    let scope_files: Option<Vec<String>> =
        files.map(|list| list.iter().filter(|f| is_sh_target(f)).cloned().collect());
    if let Some(scope) = &scope_files {
        if scope.is_empty() {
            return Ok(ConcernReport::default());
        }
    }

    let Some(shellcheck) = resolve_tool("shellcheck") else {
        return Ok(ConcernReport {
            violations: vec![shellcheck_violation()],
            diagnostics: vec![ConcernDiagnostic::info(missing_shellcheck_hint())],
        });
    };

    let target_files: Vec<String> = match scope_files {
        Some(list) => list,
        None => list_shell_script_paths(cwd, resolve_tool)?,
    };
    if target_files.is_empty() {
        return Ok(ConcernReport::default());
    }

    if run_final_shellcheck(&shellcheck, cwd, &target_files) {
        Ok(ConcernReport::default())
    } else {
        Ok(ConcernReport::from(vec![shellcheck_violation()]))
    }
}

/// Єдина точка створення violation-а — обидві причини (тул відсутній /
/// shellcheck знайшов зауваження) дають буквально той самий об'єкт (секція
/// «Канал для відсутнього shellcheck» доккоменту модуля).
fn shellcheck_violation() -> Violation {
    Violation {
        reason: LINT_REASON.to_string(),
        message: LINT_MESSAGE.to_string(),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Install-підказка для нотатки при відсутньому `shellcheck` — з реєстру
/// тулів ([`crate::tool_registry::install_hint_for`]), не захардкоджені
/// per-OS рядки канону (секція «Канал для відсутнього shellcheck»
/// доккоменту модуля).
fn missing_shellcheck_hint() -> String {
    let hint = install_hint_for("shellcheck")
        .unwrap_or_else(|| "shellcheck не знайдено в PATH.".to_string());
    format!("text/run-shellcheck: {hint}")
}

/// Список shell-скриптів для full-режиму — порт `listShellScriptPaths`
/// (`main.mjs:73-92`, секція «Full-режим» доккоменту модуля).
///
/// `pub(crate)`, бо той самий список потрібен T0-фіксу цього ж концерну
/// (`concerns::fix::text_run_shellcheck_fix`, §2.82): JS-канон мав дві
/// копії — `listShellScriptPaths` жила і в `main.mjs`, і (після його
/// видалення) у `fix-run-shellcheck.mjs`; native-бік тримає ОДНУ.
pub(crate) fn list_shell_script_paths(
    cwd: &Path,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<Vec<String>, RulesError> {
    if let Some(git) = resolve_tool("git") {
        if is_inside_work_tree(&git, cwd)? {
            return git_ls_sh_files(&git, cwd);
        }
    }
    Ok(walk_sh_fallback(cwd))
}

/// `git rev-parse --is-inside-work-tree` — `true` лише коли exit 0 і stdout
/// (trim) дорівнює рядку `"true"` (`main.mjs:77`). Спавн-помилка →
/// [`RulesError::Concern`] (секція «Full-режим» доккоменту модуля).
fn is_inside_work_tree(git: &Path, cwd: &Path) -> Result<bool, RulesError> {
    let output = Command::new(git)
        .current_dir(cwd)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|error| {
            RulesError::Concern(format!(
                "text/run-shellcheck: не вдалося запустити `git rev-parse --is-inside-work-tree`: {error}"
            ))
        })?;
    Ok(output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true")
}

/// `git ls-files -z -- ':(glob)**/*.sh'` → відсортований дедуплікований
/// список (`main.mjs:78-83`, `[...new Set(files)].toSorted()` — `BTreeSet`
/// дає те саме за один прохід). Ненульовий exit → порожній список, НЕ
/// fallback (`main.mjs:79-81`). Спавн-помилка → [`RulesError::Concern`].
fn git_ls_sh_files(git: &Path, cwd: &Path) -> Result<Vec<String>, RulesError> {
    let output = Command::new(git)
        .current_dir(cwd)
        .args(["ls-files", "-z", "--", ":(glob)**/*.sh"])
        .output()
        .map_err(|error| {
            RulesError::Concern(format!(
                "text/run-shellcheck: не вдалося запустити `git ls-files`: {error}"
            ))
        })?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: BTreeSet<String> = stdout
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    Ok(files.into_iter().collect())
}

/// Fallback-обхід без git — спрощений порт `globSync('**/*.sh', {exclude:
/// node_modules})` (секція «Fallback-обхід» доккоменту модуля).
fn walk_sh_fallback(cwd: &Path) -> Vec<String> {
    let mut out = BTreeSet::new();
    walk_sh_dir(cwd, cwd, &mut out);
    out.into_iter().collect()
}

/// Рекурсивний крок [`walk_sh_fallback`]. Недоступні каталоги (`read_dir`
/// падає) мовчки пропускаються — fail-safe, той самий дух, що й решта
/// native filesystem-сканів у крейті.
fn walk_sh_dir(root: &Path, dir: &Path, out: &mut BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            // Виключення на БУДЬ-ЯКІЙ глибині — точний відповідник
            // `p.includes('node_modules')` (секція «Fallback-обхід»).
            if entry.file_name() == "node_modules" {
                continue;
            }
            walk_sh_dir(root, &entry.path(), out);
        } else if file_type.is_file() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "sh") {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.insert(to_posix_rel(rel));
                }
            }
        }
    }
}

/// posix-relative рядок (`/`-роздільники) незалежно від платформи.
fn to_posix_rel(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Фінальний прогін `shellcheck <files>` (без `-f diff`) — порт
/// `runFinalShellcheck` (`main.mjs:218-230`). `true` — чисто (exit 0);
/// `false` — і ненульовий exit, і спавн-помилка (секція «Фінальний прогін»
/// доккоменту модуля: обидва канон трактує однаково, `catch` перетворює
/// виняток у `return 1`).
fn run_final_shellcheck(shellcheck: &Path, cwd: &Path, files: &[String]) -> bool {
    Command::new(shellcheck)
        .current_dir(cwd)
        .args(files)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Кладе у `dir` виконуваний shell-скрипт-заглушку з іменем `name`, що
    /// завершується з `exit_code`, ігноруючи аргументи.
    #[cfg(unix)]
    fn fake_bin(dir: &Path, name: &str, exit_code: i32) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join(name);
        fs::write(&bin, format!("#!/bin/sh\nexit {exit_code}\n")).unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// Резолвер, що знаходить лише `shellcheck` за заданим шляхом, і нічого
    /// іншого (git лишається "не встановлено" — потрібно для delta-тестів,
    /// де git узагалі не має бути викликаний).
    fn resolver_shellcheck_only(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |tool| (tool == "shellcheck").then(|| bin.clone())
    }

    /// Резолвер, що не знаходить нічого.
    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    // --- канал відсутнього тула ---

    /// `shellcheck` не резолвиться → violation `reason: "shellcheck"` з
    /// текстом канону, ПЛЮС info-нота з install-підказкою.
    #[test]
    fn missing_tool_gives_violation_with_reason_and_install_hint_note() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["deploy.sh".to_string()];
        let report = text_run_shellcheck_with(tmp.path(), Some(&files), &resolver_missing).unwrap();

        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, LINT_REASON);
        assert_eq!(report.violations[0].message, LINT_MESSAGE);
        assert!(report.violations[0].file.is_none());
        assert_eq!(report.violations[0].severity, Severity::Error);

        assert_eq!(report.diagnostics.len(), 1);
        assert_eq!(report.diagnostics[0].level, "info");
        assert!(report.diagnostics[0].message.contains("shellcheck"));
    }

    // --- порожній scope ---

    /// Delta-режим: `ctx.files` після фільтра `*.sh` — порожній → чистий
    /// результат, і резолвер жодного разу НЕ покликаний (тул "відсутній",
    /// але це ніяк не проявляється — інакше отримали б violation).
    #[test]
    fn empty_scope_after_filter_is_clean_without_resolving_tool() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["README.md".to_string(), "docs/index.md".to_string()];
        let report = text_run_shellcheck_with(tmp.path(), Some(&files), &resolver_missing).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Той самий випадок, коли `ctx.files` явно порожній масив.
    #[test]
    fn explicit_empty_files_list_is_clean_without_resolving_tool() {
        let tmp = TempDir::new().unwrap();
        let report = text_run_shellcheck_with(tmp.path(), Some(&[]), &resolver_missing).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    // --- чистий / брудний .sh (delta-режим) ---

    /// `shellcheck` знайдено, exit 0 → чистий результат.
    #[cfg(unix)]
    #[test]
    fn clean_sh_file_gives_no_violations() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bin(&tmp.path().join("bin"), "shellcheck", 0);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("clean.sh"), "#!/bin/sh\necho ok\n").unwrap();

        let files = vec!["clean.sh".to_string()];
        let report =
            text_run_shellcheck_with(&repo, Some(&files), &resolver_shellcheck_only(bin)).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// `shellcheck` знайдено, exit ненульовий (зауваження) → одна violation,
    /// той самий текст, що й у missing-tool гілці.
    #[cfg(unix)]
    #[test]
    fn dirty_sh_file_gives_single_violation() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bin(&tmp.path().join("bin"), "shellcheck", 1);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("bad.sh"), "#!/bin/sh\necho $1\n").unwrap();

        let files = vec!["bad.sh".to_string()];
        let report =
            text_run_shellcheck_with(&repo, Some(&files), &resolver_shellcheck_only(bin)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, LINT_REASON);
        assert_eq!(report.violations[0].message, LINT_MESSAGE);
        assert!(report.diagnostics.is_empty());
    }

    /// Delta-фільтр: не-`.sh` файли відкидаються, `.sh` лишається і доходить
    /// до спавна.
    #[cfg(unix)]
    #[test]
    fn delta_mode_filters_non_sh_files_before_spawn() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_bin(&tmp.path().join("bin"), "shellcheck", 0);
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("script.sh"), "#!/bin/sh\necho ok\n").unwrap();

        let files = vec![
            "README.md".to_string(),
            "script.sh".to_string(),
            "notes.txt".to_string(),
        ];
        let report =
            text_run_shellcheck_with(&repo, Some(&files), &resolver_shellcheck_only(bin)).unwrap();
        assert!(report.violations.is_empty());
    }

    /// Спавн-помилка на фінальному прогоні (бінарник зник після резолву) —
    /// НЕ `RulesError`, а та сама violation (секція «Фінальний прогін»
    /// доккоменту модуля) — на відміну від `text/oxfmt`.
    #[test]
    fn vanished_shellcheck_binary_on_final_run_is_a_violation_not_an_error() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("nowhere").join("shellcheck");
        let files = vec!["bad.sh".to_string()];
        let report =
            text_run_shellcheck_with(tmp.path(), Some(&files), &resolver_shellcheck_only(ghost))
                .unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, LINT_REASON);
    }

    // --- is_sh_target ---

    #[test]
    fn is_sh_target_matches_only_sh_suffix() {
        assert!(is_sh_target("deploy.sh"));
        assert!(is_sh_target("a/b/c.sh"));
        assert!(!is_sh_target("deploy.SH"));
        assert!(!is_sh_target("deploy.bash"));
    }

    // --- full-режим: list_shell_script_paths ---

    /// Запускає git-команду у фікстурі, панікує при non-zero exit — той
    /// самий хелпер-патерн, що в `changed_files.rs`/`changed_base.rs`.
    #[cfg(unix)]
    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
        assert!(status.success(), "git {args:?} failed у {}", dir.display());
    }

    #[cfg(unix)]
    fn init_repo(dir: &Path) {
        git(dir, &["init", "--quiet", "--initial-branch=main"]);
        git(dir, &["config", "user.name", "rules-core-test"]);
        git(dir, &["config", "user.email", "rules-core-test@localhost"]);
    }

    /// Всередині git-робочого дерева full-режим бере tracked `*.sh` через
    /// `git ls-files`, ігноруючи untracked і не-`.sh` файли.
    #[cfg(unix)]
    #[test]
    fn full_mode_inside_git_repo_lists_tracked_sh_via_git_ls_files() {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().join("repo");
        fs::create_dir_all(repo.join("sub")).unwrap();
        init_repo(&repo);
        fs::write(repo.join("root.sh"), "#!/bin/sh\ntrue\n").unwrap();
        fs::write(repo.join("sub/nested.sh"), "#!/bin/sh\ntrue\n").unwrap();
        fs::write(repo.join("readme.txt"), "hello\n").unwrap();
        git(&repo, &["add", "-A"]);
        // untracked .sh не має потрапити у список.
        fs::write(repo.join("untracked.sh"), "#!/bin/sh\ntrue\n").unwrap();

        let files = list_shell_script_paths(&repo, &resolve_cmd).unwrap();
        assert_eq!(files, vec!["root.sh", "sub/nested.sh"]);
    }

    /// Поза git-робочим деревом (git-резолвер "відсутній") full-режим падає
    /// у fallback-обхід, який теж виключає `node_modules` на будь-якій
    /// глибині.
    #[test]
    fn full_mode_without_git_falls_back_to_filesystem_walk() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("a/b")).unwrap();
        fs::create_dir_all(tmp.path().join("vendor/node_modules/pkg")).unwrap();
        fs::write(tmp.path().join("a/b/x.sh"), "#!/bin/sh\ntrue\n").unwrap();
        fs::write(tmp.path().join("root.sh"), "#!/bin/sh\ntrue\n").unwrap();
        fs::write(
            tmp.path().join("vendor/node_modules/pkg/ignored.sh"),
            "#!/bin/sh\ntrue\n",
        )
        .unwrap();

        let files = list_shell_script_paths(tmp.path(), &resolver_missing).unwrap();
        assert_eq!(files, vec!["a/b/x.sh", "root.sh"]);
    }

    /// `git ls-files` повертає ненульовий exit → порожній список, НЕ
    /// fallback (секція «Full-режим» доккоменту модуля).
    #[cfg(unix)]
    #[test]
    fn git_ls_files_nonzero_exit_gives_empty_list_not_fallback() {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        // Файл, який fallback-обхід теоретично міг би знайти — доказ, що
        // саме `git`-гілка відпрацювала (інакше тест побачив би цей файл).
        fs::write(repo.join("would-be-found-by-fallback.sh"), "true\n").unwrap();

        let bin_dir = tmp.path().join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let git_stub = bin_dir.join("git");
        // rev-parse --is-inside-work-tree -> true; ls-files -> ненульовий exit.
        fs::write(
            &git_stub,
            "#!/bin/sh\ncase \"$*\" in\n  *rev-parse*) echo true; exit 0 ;;\n  *) exit 1 ;;\nesac\n",
        )
        .unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&git_stub, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let resolver = move |tool: &str| (tool == "git").then(|| git_stub.clone());

        let files = list_shell_script_paths(&repo, &resolver).unwrap();
        assert!(files.is_empty());
    }

    /// Спавн-помилка на `git rev-parse` (бінарник зник після резолву) →
    /// `RulesError::Concern` — той самий канал, що в `text/oxfmt`.
    #[test]
    fn vanished_git_binary_during_full_mode_listing_maps_to_concern_error() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("nowhere").join("git");
        let resolver = move |tool: &str| (tool == "git").then(|| ghost.clone());
        let err = list_shell_script_paths(tmp.path(), &resolver).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }

    /// Full-режим: тул є, git-репо без жодного `.sh` → ціль порожня →
    /// чистий результат без спавна `shellcheck` (`main.mjs:116-118`).
    #[cfg(unix)]
    #[test]
    fn full_mode_with_no_sh_files_is_clean_without_final_spawn() {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        init_repo(&repo);
        fs::write(repo.join("readme.txt"), "hello\n").unwrap();
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "--quiet", "-m", "init"]);

        // shellcheck-заглушка, що впала б, якби її взагалі покликали (exit 1
        // означало б "знайдено зауваження" — тест довів би, що спавн НЕ
        // стався, лише якщо результат лишається чистим).
        let bin = fake_bin(&tmp.path().join("bin"), "shellcheck", 1);
        let resolver = move |tool: &str| match tool {
            "shellcheck" => Some(bin.clone()),
            "git" => resolve_cmd("git"),
            _ => None,
        };

        let report = text_run_shellcheck_with(&repo, None, &resolver).unwrap();
        assert!(report.violations.is_empty());
    }
}
