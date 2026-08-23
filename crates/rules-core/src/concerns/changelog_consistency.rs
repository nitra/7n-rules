//! Native-порт `changelog/consistency` (`npm/rules/changelog/consistency/main.mjs`,
//! 822 рядки) — найбільший концерн changelog-правила: перевіряє, що
//! workspace, у якому є релевантні git-зміни, або вже опублікована
//! version-drift, справді потребує bump/change-файлу, а не тільки що
//! `CHANGELOG.md` формально існує (це робить дешевший сусід
//! [`super::changelog_presence`]).
//!
//! Розкладено на шари за патерном [`super::docker_lint`] +
//! `k8s_manifests*`:
//!
//! | Шар JS-канону | Native |
//! |---|---|
//! | git-хелпери (`gitOrNull` і все на ньому) | [`super::changelog_consistency_git`] |
//! | semver + резолв опублікованої версії (npm view / PyPI) | [`super::changelog_consistency_version`] |
//! | per-workspace перевірки + автофікс | [`super::changelog_consistency_workspace`] |
//! | `lint(ctx)` — оркестрація, merge-скіп, split published/local-only | цей модуль |
//!
//! Три залежності без прямого Rust-відповідника (портовані як частина цієї
//! задачі, не тут):
//! - `writeChange` (`npm/rules/release/change.mjs`) →
//!   [`crate::concerns::change_file::write_change`] (розширення вже
//!   існуючого read-only порту `change-file.mjs`);
//! - `readGitPolicy` (`npm/scripts/lib/git-policy.mjs`) →
//!   [`crate::git_policy::read_git_policy`] (переїхав із `rules-cli` у
//!   `rules-core` — доккомент цього модуля, `rules-cli` лишився тонким
//!   реекспортом);
//! - `readPackageManifest`/`manifestFilePath`/`parsePyprojectFields`
//!   (`npm/rules/changelog/lib/package-manifest.mjs`) →
//!   [`crate::concerns::package_manifest`] (розширення вже існуючого
//!   `get_monorepo_project_root_dirs`).
//!
//! # `ctx.files` ігнорується
//!
//! `concern.json` цього концерну — `"lint": { "scope": "full" }`
//! (`npm/rules/changelog/consistency/concern.json`), і `lint(ctx)`
//! (`main.mjs:762-822`) ніколи не читає `ctx.files` — завжди повний обхід
//! усіх workspace-ів від `ctx.cwd`. Той самий випадок, що
//! [`super::docker_lint`]/[`super::k8s_manifests`]; `files`-параметр тут
//! лишається лише заради єдиної сигнатури диспетчера [`super::run_concern`].
//!
//! # Канал помилок
//!
//! Кожен git-виклик і резолв опублікованої версії в цьому концерні мають
//! власний `try/catch`-еквівалент у каноні (JS `gitOrNull`, `execFileAsync`
//! з `catch`, `fetch` з `catch`) — жоден з них НЕ дає native `Err`, усі
//! зводяться до `None`/`false` (доккоменти [`super::changelog_consistency_git`]
//! і [`super::changelog_consistency_version`]). `Err(RulesError::Concern)`
//! дають лише два місця БЕЗ обгортки в каноні — `readFile(CHANGELOG.md)` і
//! autofix-`writeChange` — обидва в [`super::changelog_consistency_workspace`]
//! (доккомент того модуля).
//!
//! # Promise.all → послідовний цикл
//!
//! `lint(ctx)` (`main.mjs:813-817`) обробляє `published`-воркспейси через
//! `Promise.all` (паралельні мережеві запити) — spec
//! `docs/specs/2026-07-02-text-check-per-file-split-design.md` §7. Rust-порт
//! іде послідовним циклом: `rules-core` синхронний (доккомент `lib.rs`
//! §«Синхронна поверхня», жодного `tokio_rt`), а видимий результат
//! (перелік violations, незалежно один від одного за визначенням кожного
//! `checkPublishedWorkspace`-виклику) ідентичний — паралелізація в JS була
//! суто продуктивністю, не семантикою.

use std::path::Path;

use crate::concerns::package_manifest::{
    get_monorepo_project_root_dirs, read_package_manifest, PackageManifest,
};
use crate::diagnostics::ConcernReport;
use crate::git_policy::read_git_policy;
use crate::RulesError;

use super::changelog_consistency_git::is_merge_commit;
use super::changelog_consistency_version::{default_get_published_version, GetPublishedVersionFn};
use super::changelog_consistency_workspace::{check_published_workspace, run_local_only_checks};

/// Env-прапорець, що вмикає autofix — точний порт `AUTOFIX_ENV_VAR`
/// (`main.mjs:26`).
const AUTOFIX_ENV_VAR: &str = "N_RULES_CHANGELOG_AUTOFIX";
/// Застаріла назва env до перейменування пакету — читається як fallback,
/// точний порт `LEGACY_AUTOFIX_ENV_VAR` (`main.mjs:28`).
const LEGACY_AUTOFIX_ENV_VAR: &str = "N_CURSOR_CHANGELOG_AUTOFIX";

/// Detector `changelog/consistency` — точний порт `lint(ctx)`
/// (`main.mjs:762-822`).
pub fn changelog_consistency(
    cwd: &Path,
    _files: Option<&[String]>,
) -> Result<ConcernReport, RulesError> {
    // Merge-коміт інтегрує вже задокументовану роботу — changeset не
    // потрібен (інакше autofix створив би шумний «Merge…» changeset → CI
    // commit-back каскадить у зайвий patch-реліз).
    if is_merge_commit(cwd) {
        return Ok(ConcernReport::default());
    }

    let autofix = std::env::var(AUTOFIX_ENV_VAR).as_deref() == Ok("1")
        || std::env::var(LEGACY_AUTOFIX_ENV_VAR).as_deref() == Ok("1");

    let workspaces = get_monorepo_project_root_dirs(cwd);
    let sub_workspaces: Vec<String> = workspaces
        .iter()
        .filter(|w| w.as_str() != ".")
        .cloned()
        .collect();
    // Корінь монорепо (`.` за наявності підпакетів) — glue/конфіг/tooling,
    // не логіка продукту: власного CHANGELOG він не веде.
    let is_monorepo_root = !sub_workspaces.is_empty();

    let mut published: Vec<PackageManifest> = Vec::new();
    let mut local_only: Vec<PackageManifest> = Vec::new();

    for ws in &workspaces {
        if ws == "." && is_monorepo_root {
            continue;
        }
        let Some(manifest) = read_package_manifest(ws, cwd) else {
            continue;
        };
        if manifest.registry_publishable {
            published.push(manifest);
        } else {
            local_only.push(manifest);
        }
    }

    let policy = read_git_policy(cwd);
    let get_published_version: &GetPublishedVersionFn = &default_get_published_version;

    let mut violations = Vec::new();
    for manifest in &published {
        check_published_workspace(
            manifest,
            &sub_workspaces,
            get_published_version,
            autofix,
            cwd,
            &mut violations,
            &policy,
        )?;
    }

    run_local_only_checks(
        &local_only,
        &sub_workspaces,
        autofix,
        cwd,
        &mut violations,
        &policy,
    )?;

    Ok(ConcernReport {
        violations,
        diagnostics: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use tempfile::TempDir;

    use crate::concerns::test_support::{commit_all, git, init_repo, write};

    /// Env-змінні autofix — глобальний процесний стан, тести цього модуля
    /// мутують його по черзі; серіалізуємо через мʼютекс, аби паралельні
    /// `cargo test` не гонялись за одним і тим самим env (той самий клас
    /// застереження, що ADR `docs/adr/20260527-163025-withtmpdir-заміна-process-chdir-у-тестах.md`
    /// формулює для `process.chdir` у JS-тестах — тут аналогічний ризик для
    /// `std::env::set_var`, не файлової системи).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Лок навмисно НЕ пропагує poison між тестами: один тест, що впав
    /// усередині `f()`, не має валити решту через `PoisonError` — guard тут
    /// лише серіалізує доступ до env, не захищає інваріант даних.
    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn with_autofix_env<T>(f: impl FnOnce() -> T) -> T {
        let _guard = lock_env();
        std::env::set_var(AUTOFIX_ENV_VAR, "1");
        let result = f();
        std::env::remove_var(AUTOFIX_ENV_VAR);
        result
    }

    fn without_autofix_env<T>(f: impl FnOnce() -> T) -> T {
        let _guard = lock_env();
        std::env::remove_var(AUTOFIX_ENV_VAR);
        std::env::remove_var(LEGACY_AUTOFIX_ENV_VAR);
        f()
    }

    #[test]
    fn merge_commit_head_skips_entirely_even_with_undocumented_change() {
        without_autofix_env(|| {
            let tmp = TempDir::new().unwrap();
            write(
                &tmp,
                "package.json",
                r#"{"name":"@x/lib","version":"1.0.0","files":["lib"]}"#,
            );
            write(&tmp, "CHANGELOG.md", "# Changelog\n");
            init_repo(tmp.path(), "main");
            commit_all(tmp.path(), "init");
            git(tmp.path(), &["checkout", "-qb", "feat"]);
            write(&tmp, "lib.mjs", "export const x = 1\n");
            commit_all(tmp.path(), "feat: add lib");
            git(tmp.path(), &["checkout", "-q", "main"]);
            git(
                tmp.path(),
                &[
                    "merge",
                    "--no-ff",
                    "-q",
                    "feat",
                    "-m",
                    "Merge branch 'feat'",
                ],
            );

            let report = changelog_consistency(tmp.path(), None).unwrap();
            assert!(report.violations.is_empty());
        });
    }

    #[test]
    fn single_package_repo_without_git_matching_registry_passes() {
        without_autofix_env(|| {
            let tmp = TempDir::new().unwrap();
            write(
                &tmp,
                "package.json",
                r#"{"name":"@x/lib","version":"1.0.0","files":["types"]}"#,
            );
            write(
                &tmp,
                "CHANGELOG.md",
                "# Changelog\n\n## [1.0.0] - 2026-05-05\n",
            );
            let report = changelog_consistency(tmp.path(), None).unwrap();
            // Реєстр недосяжний у тестовому оточенні (без мережі/PATH-стабу) →
            // fail-safe pass, той самий контракт, що й `реєстр недосяжний (null)
            // → fail-safe pass` у JS-каноні.
            assert!(report.violations.is_empty());
        });
    }

    #[test]
    fn monorepo_root_only_change_does_not_require_root_bump() {
        without_autofix_env(|| {
            let tmp = TempDir::new().unwrap();
            init_repo(tmp.path(), "dev");
            write(
                &tmp,
                "package.json",
                r#"{"name":"mono","version":"1.0.0","private":true,"workspaces":["pkg"]}"#,
            );
            write(&tmp, "CHANGELOG.md", "# Changelog\n");
            write(
                &tmp,
                "pkg/package.json",
                r#"{"name":"pkg","version":"1.0.0","private":true}"#,
            );
            write(&tmp, "pkg/CHANGELOG.md", "# Changelog\n");
            commit_all(tmp.path(), "init");
            git(tmp.path(), &["checkout", "-q", "-b", "feat/root"]);
            write(&tmp, "root-tool.js", "x\n");

            let report = changelog_consistency(tmp.path(), None).unwrap();
            assert!(report.violations.is_empty());
        });
    }

    #[test]
    fn local_only_feature_branch_without_change_file_fails() {
        without_autofix_env(|| {
            let tmp = TempDir::new().unwrap();
            init_repo(tmp.path(), "dev");
            write(
                &tmp,
                "package.json",
                r#"{"name":"mono","version":"1.0.0","private":true}"#,
            );
            write(&tmp, "CHANGELOG.md", "# Changelog\n");
            commit_all(tmp.path(), "init");
            git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
            write(&tmp, "app.js", "x\n");

            let report = changelog_consistency(tmp.path(), None).unwrap();
            assert_eq!(report.violations.len(), 1);
        });
    }

    #[test]
    fn autofix_env_creates_change_file_and_reports_clean() {
        with_autofix_env(|| {
            let tmp = TempDir::new().unwrap();
            init_repo(tmp.path(), "dev");
            write(
                &tmp,
                "package.json",
                r#"{"name":"mono","version":"1.0.0","private":true}"#,
            );
            write(&tmp, "CHANGELOG.md", "# Changelog\n");
            commit_all(tmp.path(), "init");
            git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
            write(&tmp, "app.js", "x\n");

            let report = changelog_consistency(tmp.path(), None).unwrap();
            assert!(report.violations.is_empty());
            let entries = crate::concerns::change_file::read_change_files(".", tmp.path()).unwrap();
            assert_eq!(entries.len(), 1);
        });
    }

    #[test]
    fn autofix_disabled_by_default_does_not_create_change_file() {
        without_autofix_env(|| {
            let tmp = TempDir::new().unwrap();
            init_repo(tmp.path(), "dev");
            write(
                &tmp,
                "package.json",
                r#"{"name":"mono","version":"1.0.0","private":true}"#,
            );
            write(&tmp, "CHANGELOG.md", "# Changelog\n");
            commit_all(tmp.path(), "init");
            git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
            write(&tmp, "app.js", "x\n");

            let report = changelog_consistency(tmp.path(), None).unwrap();
            assert_eq!(report.violations.len(), 1);
            let entries = crate::concerns::change_file::read_change_files(".", tmp.path()).unwrap();
            assert!(entries.is_empty());
        });
    }

    #[test]
    fn legacy_autofix_env_var_is_honored() {
        let _guard = lock_env();
        std::env::remove_var(AUTOFIX_ENV_VAR);
        std::env::set_var(LEGACY_AUTOFIX_ENV_VAR, "1");

        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(
            &tmp,
            "package.json",
            r#"{"name":"mono","version":"1.0.0","private":true}"#,
        );
        write(&tmp, "CHANGELOG.md", "# Changelog\n");
        commit_all(tmp.path(), "init");
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "app.js", "x\n");

        let report = changelog_consistency(tmp.path(), None).unwrap();
        std::env::remove_var(LEGACY_AUTOFIX_ENV_VAR);
        assert!(report.violations.is_empty());
    }

    #[test]
    fn invalid_sub_workspace_manifest_is_skipped_not_fatal() {
        without_autofix_env(|| {
            let tmp = TempDir::new().unwrap();
            write(
                &tmp,
                "package.json",
                r#"{"name":"mono","workspaces":["sub"]}"#,
            );
            write(&tmp, "sub/package.json", "\"not-an-object\"");
            let report = changelog_consistency(tmp.path(), None).unwrap();
            assert!(report.violations.is_empty());
        });
    }
}
