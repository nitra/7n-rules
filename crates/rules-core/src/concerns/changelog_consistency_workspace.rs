//! `changelog/consistency` — workspace-шар: per-workspace перевірки
//! (`CHANGELOG.md` існування/формату, published vs local-only гілки,
//! автофікс відсутнього change-файлу) для [`super::changelog_consistency`].
//!
//! # АВТОФІКС — навмисно side-effecting детектор
//!
//! [`report_or_fix_missing_change_file`] — не чиста функція: у
//! autofix-режимі (`autofix: true`, керується env `N_RULES_CHANGELOG_AUTOFIX`/
//! `N_CURSOR_CHANGELOG_AUTOFIX` у [`super::changelog_consistency`]) вона
//! МУТУЄ репозиторій — створює `.changes/<timestamp>.md` через
//! [`crate::concerns::change_file::write_change`] і ставить його в
//! git-індекс через `git add`. Native-контракт `run_concern` (`cwd, files ->
//! Result<ConcernReport, RulesError>`) каналу для запису НЕ має — жоден
//! інший native-концерн цієї хвилі не пише у файлову систему консюмер-репо.
//! Це точний і свідомий порт `writeChange`-виклику з `main.mjs:535`
//! (`reportOrFixMissingChangeFile`), а не помилка порту: та сама поверхня,
//! якою користується pre-commit хук репозиторію (`N_RULES_CHANGELOG_AUTOFIX=1
//! bun ./npm/bin/n-rules.js lint changelog`). Якщо колись знадобиться
//! ізолювати запис від читання (dry-run режим лінту тощо) — тут те місце,
//! звідки починати.
//!
//! # Канал помилок
//!
//! - [`check_changelog_format`] читає `CHANGELOG.md` БЕЗ обгортки
//!   (точний порт `checkChangelogFormat`, `main.mjs:441-450`, де
//!   `await readFile(...)` не має `try/catch`) → `Err(RulesError::Concern)`,
//!   якщо файл зник/недоступний між перевіркою існування і читанням.
//! - [`report_or_fix_missing_change_file`] (autofix-гілка) кличе
//!   `write_change` теж БЕЗ обгортки (точний порт `main.mjs:535`) →
//!   `Err(RulesError::Concern)` на файловій помилці (немає прав, диск
//!   повний).
//! - [`has_pending_change_files`] кличе `read_change_files` теж без
//!   обгортки (точний порт `hasPendingChangeFiles`, `main.mjs:497-500`) →
//!   `Err(RulesError::Concern)` на побитому change-файлі (та сама
//!   поведінка, що вже встановлена в `changelog_presence`).
//! - Усі git-виклики (`super::changelog_consistency_git`) і резолв
//!   опублікованої версії (`super::changelog_consistency_version`) — обидва
//!   шари мають власний `try/catch`-еквівалент і НІКОЛИ не дають `Err`
//!   (доккоменти відповідних модулів).
//! - Кожне `fail(...)` у каноні (без явного `reason`) → `Violation` із
//!   `reason = "consistency"` (basename каталогу концерну, `ctx.concernId`
//!   — той самий принцип, що в `super::docker_lint`, REASON `"lint"`).

use std::path::Path;

use crate::concerns::change_file::{read_change_files, write_change, WriteChangeParams};
use crate::concerns::package_manifest::{
    manifest_file_path, parse_pyproject_fields, PackageKind, PackageManifest,
};
use crate::diagnostics::{Severity, Violation};
use crate::git_policy::GitPolicy;
use crate::RulesError;

use super::changelog_consistency_git::{
    current_branch_name, git_add, is_inside_git_repo, last_commit_subject,
    resolve_changelog_comparison_point, show_file_at_ref,
    workspace_has_relevant_changes_against_base,
};
use super::changelog_consistency_version::{
    compare_semver_core, version_is_ahead, GetPublishedVersionFn,
};

/// `reason` за замовчуванням усіх violations цього концерну — `ctx.concernId`
/// (basename каталогу `consistency/`), той самий принцип, що в
/// `super::docker_lint` (`REASON = "lint"`).
const REASON: &str = "consistency";

/// Дефолтний `bump` для autofix-створеного change-файлу — точний порт
/// `AUTOFIX_BUMP` (`main.mjs:31`).
pub(super) const AUTOFIX_BUMP: &str = "patch";
/// Дефолтна секція — точний порт `AUTOFIX_SECTION` (`main.mjs:34`).
pub(super) const AUTOFIX_SECTION: &str = "Changed";
/// Fallback-опис, коли subject останнього коміту порожній — точний порт
/// `AUTOFIX_FALLBACK_MESSAGE` (`main.mjs:37`).
const AUTOFIX_FALLBACK_MESSAGE: &str = "оновлення";

fn violation(message: String) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// JS-truthy для `Option<String>`: `None` І порожній рядок — обидва falsy
/// (дзеркало `!Vcurrent`/`!name`-перевірок у `main.mjs`).
fn is_truthy(value: &Option<String>) -> bool {
    value.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
}

/// Мітка воркспейсу (`<root>` для кореня) — точний порт `workspaceLabel`
/// (`main.mjs:473-475`).
fn workspace_label(manifest: &PackageManifest) -> String {
    if manifest.ws == "." {
        "<root>".to_string()
    } else {
        manifest.ws.clone()
    }
}

/// Наявність `CHANGELOG.md` у воркспейсі — точний порт
/// `checkChangelogFileExists` (`main.mjs:421-429`).
fn check_changelog_file_exists(
    ws: &str,
    label: &str,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> bool {
    let path = cwd.join(ws).join("CHANGELOG.md");
    if path.exists() {
        return true;
    }
    violations.push(violation(format!(
        "{label}: CHANGELOG.md відсутній — створи файл за форматом Keep a Changelog (n-changelog.mdc)"
    )));
    false
}

/// Базовий формат `CHANGELOG.md` (наявність H1 `# Changelog`) — точний порт
/// `checkChangelogFormat` (`main.mjs:441-450`). `readFile` БЕЗ `try/catch` у
/// каноні → `Err` (доккомент модуля).
fn check_changelog_format(
    ws: &str,
    label: &str,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let path = cwd.join(ws).join("CHANGELOG.md");
    let content = std::fs::read_to_string(&path).map_err(|e| {
        RulesError::Concern(format!(
            "changelog/consistency: не вдалося прочитати {}: {e}",
            path.display()
        ))
    })?;
    let has_h1 = content.split('\n').any(|l| l.trim_end() == "# Changelog");
    if !has_h1 {
        violations.push(violation(format!(
            "{label}: CHANGELOG.md не має рядка \"# Changelog\" — перший рядок має бути H1-заголовком (n-changelog.mdc)"
        )));
    }
    Ok(())
}

/// `files` npm-маніфесту містить `CHANGELOG.md` — точний порт
/// `checkNpmFilesArrayContainsChangelog` (`main.mjs:459-467`).
fn check_npm_files_array_contains_changelog(
    manifest: &PackageManifest,
    violations: &mut Vec<Violation>,
) {
    if manifest.kind != PackageKind::Npm {
        return;
    }
    let Some(files) = &manifest.npm_files else {
        return;
    };
    let pkg_path = manifest_file_path(&manifest.ws, manifest);
    if !files.iter().any(|f| f == "CHANGELOG.md") {
        violations.push(violation(format!(
            "{pkg_path}: масив files має містити \"CHANGELOG.md\", щоб публікувати changelog із пакетом"
        )));
    }
}

/// Повідомлення «поклади change-файл» — точний порт
/// `missingChangeFileMessage` (`main.mjs:483-489`).
fn missing_change_file_message(label: &str, mf: &str) -> String {
    format!(
        "{label}: є релевантні зміни, але немає change-файлу (version у {mf} не чіпай вручну). \
Поклади change-файл: npx @7n/n ch [--bump <major|minor|patch>] [--section <Added|Changed|Fixed|Removed>] [--message \"<…>\"]; \
bump зробить CI на main (n-changelog.mdc)"
    )
}

/// Чи має workspace незрелізні change-файли — точний порт
/// `hasPendingChangeFiles` (`main.mjs:497-500`). `read_change_files` БЕЗ
/// обгортки в каноні → `Err` (доккомент модуля).
fn has_pending_change_files(ws: &str, cwd: &Path) -> Result<bool, RulesError> {
    let files = read_change_files(ws, cwd)
        .map_err(|e| RulesError::Concern(format!("changelog/consistency: {e}")))?;
    Ok(!files.is_empty())
}

/// Опис для autofix-change-файлу — точний порт `resolveAutoChangeMessage`
/// (`main.mjs:509-515`).
pub(super) fn resolve_auto_change_message(cwd: &Path) -> String {
    if let Some(subject) = last_commit_subject(cwd) {
        if !subject.is_empty() {
            return subject;
        }
    }
    if let Some(branch) = current_branch_name(cwd) {
        if branch != "HEAD" {
            return branch;
        }
    }
    AUTOFIX_FALLBACK_MESSAGE.to_string()
}

/// Реакція на відсутній change-файл — точний порт
/// `reportOrFixMissingChangeFile` (`main.mjs:529-545`, доккомент модуля щодо
/// автофіксу). Повертає `true`, коли change-файл СТВОРЕНО (autofix).
fn report_or_fix_missing_change_file(
    ws: &str,
    label: &str,
    mf: &str,
    autofix: bool,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<bool, RulesError> {
    if !autofix {
        violations.push(violation(missing_change_file_message(label, mf)));
        return Ok(false);
    }
    let message = resolve_auto_change_message(cwd);
    let rel_from_ws = write_change(WriteChangeParams {
        bump: AUTOFIX_BUMP,
        section: AUTOFIX_SECTION,
        message: &message,
        ws,
        cwd,
        timestamp_millis: chrono::Utc::now().timestamp_millis(),
    })
    .map_err(|e| RulesError::Concern(format!("changelog/consistency: {e}")))?;
    let created = if ws == "." {
        rel_from_ws
    } else {
        format!("{ws}/{rel_from_ws}")
    };
    // Ставимо новий файл у індекс одразу — pre-commit-хук комітить уже
    // застейджені зміни, а свіжостворений untracked-файл інакше лишився б
    // поза комітом (точний порт коментаря `main.mjs:537-538`).
    git_add(&created, cwd);
    Ok(true)
}

/// Published-варіант реакції на відсутній change-файл — точний порт
/// `fixOrFailPublishedWorkspace` (`main.mjs:560-564`).
fn fix_or_fail_published_workspace(
    manifest: &PackageManifest,
    label: &str,
    mf: &str,
    autofix: bool,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    if report_or_fix_missing_change_file(&manifest.ws, label, mf, autofix, cwd, violations)? {
        check_npm_files_array_contains_changelog(manifest, violations);
    }
    Ok(())
}

/// Версія з маніфесту на `base_ref` — точний порт `readBaseVersion`
/// (`main.mjs:289-302`).
fn read_base_version(base_ref: &str, manifest: &PackageManifest, cwd: &Path) -> Option<String> {
    let ws_path = if manifest.ws == "." {
        manifest.manifest_rel.clone()
    } else {
        format!("{}/{}", manifest.ws, manifest.manifest_rel)
    };
    let out = show_file_at_ref(base_ref, &ws_path, cwd)?;
    match manifest.kind {
        PackageKind::Npm => {
            let parsed: serde_json::Value = serde_json::from_str(&out).ok()?;
            parsed
                .get("version")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        }
        PackageKind::Python => parse_pyproject_fields(&out).version,
    }
}

/// Перевірка одного published (npm/PyPI) воркспейсу — точний порт
/// `checkPublishedWorkspace` (`main.mjs:623-679`).
#[allow(clippy::too_many_arguments)]
pub(super) fn check_published_workspace(
    manifest: &PackageManifest,
    sub_workspaces: &[String],
    get_published_version: &GetPublishedVersionFn,
    autofix: bool,
    cwd: &Path,
    violations: &mut Vec<Violation>,
    policy: &GitPolicy,
) -> Result<(), RulesError> {
    let label = workspace_label(manifest);
    let mf = manifest_file_path(&manifest.ws, manifest);
    let changelog_exists = check_changelog_file_exists(&manifest.ws, &label, cwd, violations);
    if changelog_exists {
        check_changelog_format(&manifest.ws, &label, cwd, violations)?;
    }

    let v_current = &manifest.version;
    if !is_truthy(v_current) {
        violations.push(violation(format!(
            "{label}: у {mf} відсутнє поле version (registry-published воркспейс)"
        )));
        return Ok(());
    }
    let name = &manifest.name;
    if !is_truthy(name) {
        violations.push(violation(format!(
            "{label}: у {mf} відсутнє ім'я пакета (registry-published воркспейс)"
        )));
        return Ok(());
    }

    // Autofix/hook-режим: жодної мережі — реєстровий резолв і drift-перевірка
    // пропускаються, лишається наявність change-файлу (+ autofix) і git-diff
    // (точний порт коментаря `main.mjs:640-644`).
    if autofix {
        return check_published_workspace_pending_git_changes(
            manifest,
            sub_workspaces,
            autofix,
            cwd,
            violations,
            policy,
        );
    }

    let v_published = get_published_version(name.as_deref().unwrap_or_default(), manifest.kind);
    let Some(v_published) = v_published else {
        // Реєстр недосяжний — fail-safe pass, перевірку пропущено.
        return Ok(());
    };

    // Лише drift УПЕРЕД має пріоритет над change-файлом; версія ПОЗАДУ
    // реєстру — локаль відстала від уже опублікованого релізу, не порушення.
    if version_is_ahead(v_current.as_deref(), Some(v_published.as_str())) {
        violations.push(violation(format!(
            "{label}: version у {mf} ({}) випереджає опубліковану ({v_published}) — \
ручний bump поза CI заборонено. Відкоти version і поклади change-файл \
(npx @7n/n ch); bump зробить CI на main (n-changelog.mdc)",
            v_current.as_deref().unwrap_or_default()
        )));
        return Ok(());
    }
    // Компаратор нерозпізнаного semver дає `None`, що в JS еквівалентно
    // `null < 0 === false` — тож нерозпізнана пара НЕ потрапляє в «позаду»
    // гілку, падає у фінальну «збігається» (точний порт `main.mjs:666`).
    if compare_semver_core(v_current.as_deref(), Some(v_published.as_str()))
        == Some(std::cmp::Ordering::Less)
    {
        return check_published_workspace_pending_git_changes(
            manifest,
            sub_workspaces,
            autofix,
            cwd,
            violations,
            policy,
        );
    }
    check_published_workspace_pending_git_changes(
        manifest,
        sub_workspaces,
        autofix,
        cwd,
        violations,
        policy,
    )
}

/// Точний порт `checkPublishedWorkspacePendingGitChanges` (`main.mjs:576-611`).
fn check_published_workspace_pending_git_changes(
    manifest: &PackageManifest,
    sub_workspaces: &[String],
    autofix: bool,
    cwd: &Path,
    violations: &mut Vec<Violation>,
    policy: &GitPolicy,
) -> Result<(), RulesError> {
    let label = workspace_label(manifest);
    let mf = manifest_file_path(&manifest.ws, manifest);
    if has_pending_change_files(&manifest.ws, cwd)? {
        check_npm_files_array_contains_changelog(manifest, violations);
        return Ok(());
    }
    if !is_inside_git_repo(cwd) {
        return Ok(());
    }

    let branch = current_branch_name(cwd);

    if branch.as_deref() == Some(policy.base_branch.as_str()) {
        if workspace_has_relevant_changes_against_base("HEAD", &manifest.ws, sub_workspaces, cwd) {
            fix_or_fail_published_workspace(manifest, &label, &mf, autofix, cwd, violations)?;
        }
        return Ok(());
    }

    let comparison = resolve_changelog_comparison_point(branch.as_deref(), cwd, policy);
    if let Some(cp) = &comparison {
        if workspace_has_relevant_changes_against_base(
            &cp.reference,
            &manifest.ws,
            sub_workspaces,
            cwd,
        ) {
            fix_or_fail_published_workspace(manifest, &label, &mf, autofix, cwd, violations)?;
            return Ok(());
        }
    }

    if policy
        .release_branches
        .iter()
        .any(|b| Some(b.as_str()) == branch.as_deref())
        && workspace_has_relevant_changes_against_base("HEAD", &manifest.ws, sub_workspaces, cwd)
    {
        fix_or_fail_published_workspace(manifest, &label, &mf, autofix, cwd, violations)?;
    }
    Ok(())
}

/// Точний порт `checkLocalOnlyChangedWorkspace` (`main.mjs:690-710`).
fn check_local_only_changed_workspace(
    comparison_ref: &str,
    manifest: &PackageManifest,
    base_label: &str,
    autofix: bool,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let label = workspace_label(manifest);
    let mf = manifest_file_path(&manifest.ws, manifest);
    let v_current = &manifest.version;
    let v_base = read_base_version(comparison_ref, manifest, cwd);
    if let (Some(base), Some(current)) = (v_base.as_deref(), v_current.as_deref()) {
        if version_is_ahead(Some(current), Some(base)) {
            violations.push(violation(format!(
                "{label}: version у {mf} змінено поза CI ({base} → {current}) — ручний bump заборонено (на {base_label} — {base}). \
Відкоти version і поклади change-файл (npx @7n/n ch); bump зробить CI (n-changelog.mdc)"
            )));
            return Ok(());
        }
    }
    if has_pending_change_files(&manifest.ws, cwd)? {
        return Ok(());
    }
    report_or_fix_missing_change_file(&manifest.ws, &label, &mf, autofix, cwd, violations)?;
    Ok(())
}

/// Точний порт `runLocalOnlyChecks` (`main.mjs:720-756`).
pub(super) fn run_local_only_checks(
    local_only: &[PackageManifest],
    sub_workspaces: &[String],
    autofix: bool,
    cwd: &Path,
    violations: &mut Vec<Violation>,
    policy: &GitPolicy,
) -> Result<(), RulesError> {
    if local_only.is_empty() {
        return Ok(());
    }

    for manifest in local_only {
        let label = workspace_label(manifest);
        let exists = check_changelog_file_exists(&manifest.ws, &label, cwd, violations);
        if exists {
            check_changelog_format(&manifest.ws, &label, cwd, violations)?;
        }
    }

    if !is_inside_git_repo(cwd) {
        return Ok(());
    }
    let branch = current_branch_name(cwd);
    if branch.as_deref() == Some(policy.base_branch.as_str()) {
        return Ok(());
    }
    let Some(comparison) = resolve_changelog_comparison_point(branch.as_deref(), cwd, policy)
    else {
        return Ok(());
    };

    for manifest in local_only {
        if !workspace_has_relevant_changes_against_base(
            &comparison.reference,
            &manifest.ws,
            sub_workspaces,
            cwd,
        ) {
            continue;
        }
        check_local_only_changed_workspace(
            &comparison.reference,
            manifest,
            &comparison.label,
            autofix,
            cwd,
            violations,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    use crate::concerns::test_support::{commit_all, git, init_repo, write};

    fn npm_manifest(
        ws: &str,
        version: &str,
        name: &str,
        files: Option<Vec<&str>>,
    ) -> PackageManifest {
        PackageManifest {
            kind: PackageKind::Npm,
            ws: ws.to_string(),
            manifest_rel: "package.json".to_string(),
            name: Some(name.to_string()),
            version: Some(version.to_string()),
            registry_publishable: true,
            npm_files: files.map(|f| f.into_iter().map(str::to_string).collect()),
        }
    }

    fn local_manifest(ws: &str, version: &str, name: &str) -> PackageManifest {
        PackageManifest {
            kind: PackageKind::Npm,
            ws: ws.to_string(),
            manifest_rel: "package.json".to_string(),
            name: Some(name.to_string()),
            version: Some(version.to_string()),
            registry_publishable: false,
            npm_files: None,
        }
    }

    fn default_policy() -> GitPolicy {
        GitPolicy {
            base_branch: "dev".to_string(),
            release_branches: vec!["main".to_string()],
            integration_branches: vec!["dev".to_string(), "main".to_string()],
            protected_branches: vec!["dev".to_string(), "main".to_string()],
        }
    }

    #[test]
    fn missing_change_file_message_matches_fix_consistency_regex() {
        let msg = missing_change_file_message("app", "app/package.json");
        // fix-consistency.mjs MISSING_CHANGE_LABEL_RE = /^(\S+): є релевантні
        // зміни, але немає change-файлу/u — має лишатись сумісним.
        assert!(msg.starts_with("app: є релевантні зміни, але немає change-файлу"));
    }

    #[test]
    fn check_changelog_file_exists_reports_missing() {
        let tmp = TempDir::new().unwrap();
        let mut violations = Vec::new();
        let exists = check_changelog_file_exists(".", "<root>", tmp.path(), &mut violations);
        assert!(!exists);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "consistency");
    }

    #[test]
    fn check_changelog_format_requires_h1() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "CHANGELOG.md", "## [1.0.0]\n");
        let mut violations = Vec::new();
        check_changelog_format(".", "<root>", tmp.path(), &mut violations).unwrap();
        assert_eq!(violations.len(), 1);
    }

    #[test]
    fn check_changelog_format_passes_with_h1_only() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        let mut violations = Vec::new();
        check_changelog_format(".", "<root>", tmp.path(), &mut violations).unwrap();
        assert!(violations.is_empty());
    }

    #[test]
    fn check_changelog_format_missing_file_is_err() {
        let tmp = TempDir::new().unwrap();
        let mut violations = Vec::new();
        assert!(check_changelog_format(".", "<root>", tmp.path(), &mut violations).is_err());
    }

    #[test]
    fn check_npm_files_requires_changelog_entry() {
        let manifest = npm_manifest(".", "1.0.0", "@x/lib", Some(vec!["lib"]));
        let mut violations = Vec::new();
        check_npm_files_array_contains_changelog(&manifest, &mut violations);
        assert_eq!(violations.len(), 1);

        let manifest_ok = npm_manifest(".", "1.0.0", "@x/lib", Some(vec!["lib", "CHANGELOG.md"]));
        let mut violations_ok = Vec::new();
        check_npm_files_array_contains_changelog(&manifest_ok, &mut violations_ok);
        assert!(violations_ok.is_empty());
    }

    #[test]
    fn check_published_workspace_version_ahead_of_registry_fails() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "CHANGELOG.md", "# Changelog\n\n## [1.0.1]\n");
        let manifest = npm_manifest(".", "1.0.1", "@x/lib", Some(vec!["lib", "CHANGELOG.md"]));
        let mut violations = Vec::new();
        let policy = default_policy();
        let resolver: &GetPublishedVersionFn = &|_name, _kind| Some("1.0.0".to_string());
        check_published_workspace(
            &manifest,
            &[],
            resolver,
            false,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains("випереджає опубліковану"));
    }

    #[test]
    fn check_published_workspace_registry_unreachable_is_fail_safe_pass() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        let manifest = npm_manifest(".", "1.0.1", "@x/lib", Some(vec!["types"]));
        let mut violations = Vec::new();
        let policy = default_policy();
        let resolver: &GetPublishedVersionFn = &|_name, _kind| None;
        check_published_workspace(
            &manifest,
            &[],
            resolver,
            false,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert!(violations.is_empty());
    }

    #[test]
    fn check_published_workspace_missing_version_field_fails() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        let manifest = PackageManifest {
            kind: PackageKind::Npm,
            ws: ".".to_string(),
            manifest_rel: "package.json".to_string(),
            name: Some("@x/lib".to_string()),
            version: None,
            registry_publishable: true,
            npm_files: Some(vec!["types".to_string()]),
        };
        let mut violations = Vec::new();
        let policy = default_policy();
        let resolver: &GetPublishedVersionFn = &|_name, _kind| Some("1.0.0".to_string());
        check_published_workspace(
            &manifest,
            &[],
            resolver,
            false,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains("відсутнє поле version"));
    }

    #[test]
    fn check_published_workspace_autofix_skips_registry_and_creates_change_file() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(
            &tmp,
            "package.json",
            r#"{"name":"@x/lib","version":"1.0.0","files":["lib","CHANGELOG.md"]}"#,
        );
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        write(&tmp, "lib/x.js", "//\n");
        commit_all(tmp.path(), "feat: щось важливе");
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "lib/x.js", "changed\n");

        let manifest = npm_manifest(".", "1.0.0", "@x/lib", Some(vec!["lib", "CHANGELOG.md"]));
        let mut violations = Vec::new();
        let policy = default_policy();
        let resolver: &GetPublishedVersionFn =
            &|_name, _kind| panic!("autofix не має кликати резолвер опублікованої версії");
        check_published_workspace(
            &manifest,
            &[],
            resolver,
            true,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert!(violations.is_empty());
        let entries = read_change_files(".", tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description, "feat: щось важливе");
        assert_eq!(entries[0].bump, "patch");
    }

    #[test]
    fn check_published_workspace_feature_branch_without_change_file_fails() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(
            &tmp,
            "package.json",
            r#"{"name":"@x/lib","version":"1.0.0","files":["lib","CHANGELOG.md"]}"#,
        );
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        write(&tmp, "lib/x.js", "//\n");
        commit_all(tmp.path(), "init");
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "lib/x.js", "changed\n");

        let manifest = npm_manifest(".", "1.0.0", "@x/lib", Some(vec!["lib", "CHANGELOG.md"]));
        let mut violations = Vec::new();
        let policy = default_policy();
        let resolver: &GetPublishedVersionFn = &|_name, _kind| Some("1.0.0".to_string());
        check_published_workspace(
            &manifest,
            &[],
            resolver,
            false,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains("є релевантні зміни"));
    }

    #[test]
    fn run_local_only_checks_skips_on_base_branch() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        write(
            &tmp,
            "package.json",
            r#"{"name":"mono","version":"1.0.0","private":true}"#,
        );
        commit_all(tmp.path(), "init");

        let manifest = local_manifest(".", "1.0.0", "mono");
        let mut violations = Vec::new();
        let policy = default_policy();
        run_local_only_checks(
            &[manifest],
            &[],
            false,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert!(violations.is_empty());
    }

    #[test]
    fn run_local_only_checks_feature_branch_without_change_file_fails() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        write(
            &tmp,
            "package.json",
            r#"{"name":"mono","version":"1.0.0","private":true}"#,
        );
        commit_all(tmp.path(), "init");
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "app.js", "x\n");

        let manifest = local_manifest(".", "1.0.0", "mono");
        let mut violations = Vec::new();
        let policy = default_policy();
        run_local_only_checks(
            &[manifest],
            &[],
            false,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert_eq!(violations.len(), 1);
    }

    #[test]
    fn run_local_only_checks_manual_version_bump_fails_even_with_change_file() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        write(
            &tmp,
            "package.json",
            r#"{"name":"mono","version":"1.0.0","private":true}"#,
        );
        commit_all(tmp.path(), "init");
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "app.js", "x\n");
        write(
            &tmp,
            "package.json",
            r#"{"name":"mono","version":"1.1.0","private":true}"#,
        );
        write(
            &tmp,
            ".changes/1-a.md",
            "---\nbump: minor\nsection: Changed\n---\nx\n",
        );

        let manifest = local_manifest(".", "1.1.0", "mono");
        let mut violations = Vec::new();
        let policy = default_policy();
        run_local_only_checks(
            &[manifest],
            &[],
            false,
            tmp.path(),
            &mut violations,
            &policy,
        )
        .unwrap();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains("змінено поза CI"));
    }

    #[test]
    fn run_local_only_checks_autofix_creates_change_file_and_passes() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        write(
            &tmp,
            "package.json",
            r#"{"name":"mono","version":"1.0.0","private":true}"#,
        );
        commit_all(tmp.path(), "init");
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "app.js", "x\n");

        let manifest = local_manifest(".", "1.0.0", "mono");
        let mut violations = Vec::new();
        let policy = default_policy();
        run_local_only_checks(&[manifest], &[], true, tmp.path(), &mut violations, &policy)
            .unwrap();
        assert!(violations.is_empty());
        assert_eq!(read_change_files(".", tmp.path()).unwrap().len(), 1);
    }
}
