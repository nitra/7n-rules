//! Worktree lifecycle через `mt-core` (Р3 спеки, фаза 2 задача B1
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`) — тонка
//! обгортка над крейтом `mt-core` (git dep `nitra/mt-rust`) з
//! rules-конвенцією: `worktrees_dir` завжди `<repo_root>/.worktrees` (на
//! відміну від `mt` CLI, де шлях резолвиться з `.mt.json` — конфіг-парсинг
//! лишається в JS, Р5 спеки; тут дефолт той самий `./.worktrees`, тож
//! поведінка збігається для repos без кастомного `.mt.json`).
//!
//! Власних `git worktree`-викликів тут немає (Р3 спеки) — уся lifecycle-
//! логіка делегується в `mt_core::worktree`, звірена з CLI-семантикою
//! `mt worktree create|remove` (`crates/mt/src/commands/worktree.rs` у
//! mt-rust, READ-ONLY референс).

use std::path::{Path, PathBuf};

use crate::RulesError;

/// Санітизує довільний рядок (наприклад, `<current-branch>-<suffix>`) до
/// безпечного компонента шляху worktree — прямий делегат у `mt_core::sanitize`
/// (`crates/mt-core/src/lib.rs`): не-alphanum/не-`_`/не-`-` символи → `-`,
/// без collapse/trim (на відміну від `mt_core::sanitize_branch`, яка йде
/// іншим шляхом і тут не застосовна).
///
/// `mt worktree create <name>` (CLI) приймає ім'я як є, без власної
/// санітизації — `mt_core::sanitize` є єдиною спільною нормалізацією імені
/// worktree в самому крейті (вживається для worktree-prefix/task-matching у
/// `mt_core::worktree::find_worktree_match`/`worktree_inventory`). Р3 спеки
/// («Санітизація імені») обирає саме її як канон замість поточного JS
/// `replaceAll('/', '-')` в `auto-worktree.mjs`.
pub fn sanitize_name(raw: &str) -> String {
    mt_core::sanitize(raw)
}

/// Каталог worktree за rules-конвенцією — завжди `<repo_root>/.worktrees`.
fn worktrees_dir(repo_root: &Path) -> PathBuf {
    repo_root.join(".worktrees")
}

/// Ім'я гілки, якою володіє `mt` для dev-worktree `name` (`mt/<name>`) — той
/// самий формат, що приватна `dev_branch` у `mt_core::worktree`.
fn dev_branch(name: &str) -> String {
    format!("mt/{name}")
}

/// Відтворює `mt worktree create <name> [--base <ref>] --description <d>`
/// (`WorktreeAction::Create` у `crates/mt/src/commands/worktree.rs`):
///
/// 1. `mt_core::worktree::create_dev_worktree(repo_root, worktrees_dir, name,
///    base)` — гілковий (не detached) worktree `mt/<name>` від `base`
///    (`git worktree add -b mt/<name> <worktrees_dir>/<name> <base>`).
/// 2. `mt_core::worktree::set_branch_description(repo_root, "mt/<name>",
///    description)` — той самий порядок кроків, що й CLI.
///
/// `base: None` мапиться на `"main"` — той самий дефолт, що clap
/// `#[arg(long, default_value = "main")]` у CLI (на відміну від CLI, тут
/// `description` не `Option`: rules-конвенція завжди її передає — консюмер
/// `auto-worktree.mjs` теж завжди задає `--description`).
///
/// Повертає абсолютний шлях щойно створеного worktree.
pub fn create_dev_worktree(
    repo_root: &Path,
    name: &str,
    description: &str,
    base: Option<&str>,
) -> Result<PathBuf, RulesError> {
    let base = base.unwrap_or("main");
    let dir = worktrees_dir(repo_root);
    let path = mt_core::worktree::create_dev_worktree(repo_root, &dir, name, base)
        .map_err(RulesError::Worktree)?;
    mt_core::worktree::set_branch_description(repo_root, &dev_branch(name), description)
        .map_err(RulesError::Worktree)?;
    Ok(path)
}

/// Відтворює `mt worktree remove <name> [--force]`
/// (`WorktreeAction::Remove` у `crates/mt/src/commands/worktree.rs`):
/// знаходить запис `mt worktree list` за іменем (останній компонент шляху)
/// і прибирає worktree РАЗОМ з гілкою `mt/<name>`, якою він володіє —
/// `mt_core::worktree::remove_dev_worktree` відмовляє у видаленні, якщо запис
/// worktree належить іншій гілці (foreign branch guard), той самий інваріант,
/// що й CLI.
///
/// `force: false` відмовляє на брудному worktree (git-поведінка за
/// замовчуванням, як у `mt_core::worktree::remove_worktree`); `force: true` —
/// примусово, той самий прапорець, що CLI `--force`.
pub fn remove_worktree(repo_root: &Path, name: &str, force: bool) -> Result<(), RulesError> {
    let entries = mt_core::worktree::list_worktrees(repo_root).map_err(RulesError::Worktree)?;
    let entry = entries
        .iter()
        .find(|entry| entry.name == name)
        .ok_or_else(|| RulesError::Worktree(format!("worktree не знайдено: {name}")))?;
    mt_core::worktree::remove_dev_worktree(repo_root, entry, name, force)
        .map_err(RulesError::Worktree)
}

#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use tempfile::TempDir;

    use super::*;

    /// Запускає git-команду у фікстурі, панікує при non-zero exit — за
    /// зразком хелпера `changed_base::tests::git`.
    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
        assert!(status.success(), "git {args:?} failed у {}", dir.display());
    }

    /// Ізольований репозиторій з одним комітом на `main` — той самий setup,
    /// що `changed_base::tests::init_repo` + перший коміт (щоб `main` мав
    /// валідний base для `git worktree add`).
    fn init_repo() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "--quiet", "--initial-branch=main"]);
        git(dir, &["config", "user.name", "rules-core-test"]);
        git(dir, &["config", "user.email", "rules-core-test@localhost"]);
        std::fs::write(dir.join("README.md"), "x").unwrap();
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "--quiet", "-m", "init"]);
        tmp
    }

    // ── sanitize_name ──

    #[test]
    fn sanitize_name_matches_mt_core_vectors() {
        // Ті самі вектори, що mt_core::lib::tests::sanitize_vectors — і
        // приклад Р3 спеки: `<current-branch>-<suffix>` замість `replaceAll`.
        assert_eq!(
            sanitize_name("research/collect data"),
            "research-collect-data"
        );
        assert_eq!(sanitize_name("my-task_01"), "my-task_01");
        assert_eq!(sanitize_name(""), "");
        assert_eq!(
            sanitize_name("feat/rules-v2-worktree"),
            "feat-rules-v2-worktree"
        );
    }

    // ── create_dev_worktree ──

    #[test]
    fn create_dev_worktree_creates_directory_branch_and_description() {
        let repo = init_repo();
        let path = create_dev_worktree(repo.path(), "my-task", "Ізольований lint", None).unwrap();

        assert_eq!(path, repo.path().join(".worktrees").join("my-task"));
        assert!(path.join("README.md").is_file());

        let entries = mt_core::worktree::list_worktrees(repo.path()).unwrap();
        let entry = entries
            .iter()
            .find(|entry| entry.name == "my-task")
            .expect("worktree list бачить щойно створений worktree");
        assert_eq!(entry.branch.as_deref(), Some("refs/heads/mt/my-task"));

        let description = mt_core::worktree::branch_description(repo.path(), "mt/my-task")
            .unwrap()
            .expect("branch description проставлений");
        assert_eq!(description, "Ізольований lint");
    }

    #[test]
    fn create_dev_worktree_defaults_base_to_main() {
        let repo = init_repo();
        // Гілка "off-main" рухається вперед — якщо base за замовчуванням
        // "main" (не HEAD поточної гілки), worktree стане на коміт "init",
        // не на "off-main"-коміт.
        git(repo.path(), &["checkout", "-q", "-b", "off-main"]);
        std::fs::write(repo.path().join("extra.txt"), "x").unwrap();
        git(repo.path(), &["add", "-A"]);
        git(repo.path(), &["commit", "--quiet", "-m", "off-main commit"]);
        git(repo.path(), &["checkout", "-q", "main"]);

        let path = create_dev_worktree(repo.path(), "demo", "d", None).unwrap();
        assert!(!path.join("extra.txt").exists());
        assert!(path.join("README.md").is_file());
    }

    #[test]
    fn create_dev_worktree_respects_explicit_base() {
        let repo = init_repo();
        git(repo.path(), &["branch", "custom-base"]);
        std::fs::write(repo.path().join("main-only.txt"), "x").unwrap();
        git(repo.path(), &["add", "-A"]);
        git(repo.path(), &["commit", "--quiet", "-m", "main-only"]);

        let path = create_dev_worktree(repo.path(), "demo", "d", Some("custom-base")).unwrap();
        assert!(!path.join("main-only.txt").exists());
    }

    // ── remove_worktree ──

    #[test]
    fn remove_worktree_force_removes_directory_and_branch() {
        let repo = init_repo();
        let path = create_dev_worktree(repo.path(), "demo", "d", None).unwrap();
        std::fs::write(path.join("uncommitted.txt"), "x").unwrap();

        remove_worktree(repo.path(), "demo", true).unwrap();

        assert!(!path.exists());
        let entries = mt_core::worktree::list_worktrees(repo.path()).unwrap();
        assert!(!entries.iter().any(|entry| entry.name == "demo"));
        assert!(
            mt_core::worktree::branch_description(repo.path(), "mt/demo")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn remove_worktree_without_force_fails_on_dirty_tree() {
        let repo = init_repo();
        let path = create_dev_worktree(repo.path(), "demo", "d", None).unwrap();
        std::fs::write(path.join("uncommitted.txt"), "x").unwrap();

        assert!(remove_worktree(repo.path(), "demo", false).is_err());
        assert!(path.exists());

        remove_worktree(repo.path(), "demo", true).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn remove_worktree_missing_name_errors() {
        let repo = init_repo();
        let error = remove_worktree(repo.path(), "does-not-exist", true).unwrap_err();
        assert!(error.to_string().contains("does-not-exist"));
    }
}
