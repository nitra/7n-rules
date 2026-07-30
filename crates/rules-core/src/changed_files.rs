//! Точний порт `collectChangedFiles` / `collectChangedFilesSince` з
//! `npm/scripts/lib/changed-files.mjs` (задача C1 фази 3,
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
//!
//! # Porcelain, свідомо — не gix-status
//!
//! На відміну від [`crate::changed_base`] (де gix `merge_base` покриває
//! потребу для non-shallow репо), тут використано `std::process::Command`
//! (`git diff --name-only`, `git ls-files --others --exclude-standard`) для
//! **всіх** репо, не лише shallow. Причина — не технічна межа gix, а свідомо
//! вузький перший крок (spec §4 фаза 3): gix-parity для working-tree сканів
//! (`--exclude-standard` семантика .gitignore/.git/info/exclude/global
//! excludes, rename-детекція diff-фільтра, submodules) — найважча частина
//! gix-status і потребує окремої parity-роботи. DTO-контракт (`Vec<String>`
//! відносних posix-шляхів) лишається тим самим незалежно від того, чи
//! обчислення підуть через gix, чи лишаться porcelain — перехід на
//! gix-status у майбутній ітерації не зачепить жодного викликача.

use std::{collections::HashSet, path::Path, process::Command};

use crate::RulesError;

/// Чи лежить відносний posix-шлях усередині worktree-чекаута (`.worktrees/`
/// або `.claude/worktrees/`) — точний порт `WORKTREE_CHECKOUT_RE` з
/// `npm/scripts/utils/walkDir.mjs:18` (`/(?:^|\/)(?:\.worktrees|\.claude\/worktrees)\//u`).
///
/// Без regex-крейта: `(?:^|\/)` означає «на початку рядка або одразу після
/// `/`» — тобто межа рівно на початку path-сегмента. Це відтворено обходом
/// сегментів (`split('/')`): для `.worktrees/` шукаємо сегмент, що дорівнює
/// рівно `.worktrees` і за яким є ще хоч один сегмент (тобто після нього був
/// `/`); для `.claude/worktrees/` — пару сусідніх сегментів `.claude` +
/// `worktrees`, за якою теж є ще один сегмент. Це навмисно строгий збіг
/// сегмента цілком (не підрядка) — `foo.worktrees/x` не збігається, бо
/// `.worktrees` там не окремий сегмент, а суфікс сегмента `foo.worktrees`.
///
/// # Приклади
/// - `.worktrees/x` → `true`
/// - `a/.worktrees/b/c.js` → `true`
/// - `.worktrees` (без trailing slash) → `false` (немає сегмента після)
/// - `x/.claude/worktrees/a` → `true`
/// - `.claude/foo/worktrees/a` → `false` (не сусідні сегменти)
/// - `foo.worktrees/x` → `false` (не окремий сегмент, dot-суфікс)
pub fn is_worktree_checkout_path(rel_path: &str) -> bool {
    let segments: Vec<&str> = rel_path.split('/').collect();
    for (i, segment) in segments.iter().enumerate() {
        if *segment == ".worktrees" && i + 1 < segments.len() {
            return true;
        }
        if *segment == ".claude"
            && i + 1 < segments.len()
            && segments[i + 1] == "worktrees"
            && i + 2 < segments.len()
        {
            return true;
        }
    }
    false
}

/// Виконує git-команду в `cwd`, повертає непорожні trim-нуті рядки stdout.
/// Будь-яка помилка (не-репо, spawn-фейл, ненульовий exit) → `[]` — точний
/// порт `gitLines` (changed-files.mjs:19-26): `spawnSync` у JS не кидає,
/// просто дає `status !== 0`, і викликачі це мовчки ковтають.
fn git_lines(cwd: &Path, args: &[&str]) -> Vec<String> {
    let Ok(output) = Command::new("git").current_dir(cwd).args(args).output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    // lossy, не `from_utf8` fail-closed: голий `spawnSync(..., { encoding:
    // 'utf8' })` теж не кидає на невалідний UTF-8 у шляхах, а мовчки дає
    // replacement-символи — той самий дух «не падати на екзотичних байтах».
    String::from_utf8_lossy(&output.stdout)
        .split('\n')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// Прибирає дублікати зі збереженням порядку першої появи — порт `[...new
/// Set([...a, ...b])]`.
fn unique_preserve_order(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::with_capacity(paths.len());
    paths
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

/// Обʼєднує `modified`/`untracked`, прибирає дублікати зі збереженням
/// порядку і відкидає worktree-чекаути — спільний хвіст `collectChangedFiles`
/// і `collectChangedFilesSince` (changed-files.mjs:
/// `dropWorktreeCheckouts([...new Set([...a, ...b])])`).
fn combine_and_filter(primary: Vec<String>, untracked: Vec<String>) -> Vec<String> {
    let combined = primary.into_iter().chain(untracked).collect();
    unique_preserve_order(combined)
        .into_iter()
        .filter(|p| !is_worktree_checkout_path(p))
        .collect()
}

/// Relative-posix список змінених + untracked файлів робочого дерева —
/// точний порт `collectChangedFiles` (changed-files.mjs:33-37):
/// `git diff HEAD --name-only --diff-filter=ACMR` (tracked-modified + staged,
/// без видалених — `D` не в фільтрі) обʼєднано з `git ls-files --others
/// --exclude-standard` (нові untracked). Поза git-репо або при будь-якій
/// помилці git — порожній список (не помилка).
pub fn collect_changed_files(cwd: &Path) -> Vec<String> {
    let modified = git_lines(cwd, &["diff", "HEAD", "--name-only", "--diff-filter=ACMR"]);
    let untracked = git_lines(cwd, &["ls-files", "--others", "--exclude-standard"]);
    combine_and_filter(modified, untracked)
}

/// Список змінених + untracked файлів **відносно базового комміту** —
/// точний порт `collectChangedFilesSince` (changed-files.mjs:85-105).
///
/// - `base = None` → fallback на [`collect_changed_files`] (робоче дерево
///   vs HEAD), той самий контракт, що й JS.
/// - `base = Some(_)` → fail-closed верифікація `git rev-parse --verify
///   --quiet <base>^{commit}`: недосяжний base (rebase/force-update/shallow
///   prune) інакше дав би `git diff` exit 128 → порожній список → виклик
///   мовчки пройшов би без реальної перевірки; замість цього — явна
///   [`RulesError::Git`] з повідомленням, що містить «недосяжний» і сам
///   `base` (той самий текст-контракт, що й JS-тест `/недосяжний/`). Далі
///   `git diff <base> --name-only --diff-filter=ACMR` (без `..`/`...`, без
///   `HEAD`) — порівнює `base` з поточним робочим деревом, тож однаково
///   ловить і закомічене від `base`, і staged, і незакомічені зміни.
pub fn collect_changed_files_since(
    cwd: &Path,
    base: Option<&str>,
) -> Result<Vec<String>, RulesError> {
    let Some(base) = base else {
        return Ok(collect_changed_files(cwd));
    };

    let verify_ok = Command::new("git")
        .current_dir(cwd)
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{base}^{{commit}}"),
        ])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !verify_ok {
        return Err(RulesError::Git(format!(
            "collect_changed_files_since: base-комміт «{base}» недосяжний у {} \
             (rebase/force-update?) — scope змінених файлів не визначити",
            cwd.display()
        )));
    }

    let changed = git_lines(cwd, &["diff", base, "--name-only", "--diff-filter=ACMR"]);
    let untracked = git_lines(cwd, &["ls-files", "--others", "--exclude-standard"]);
    Ok(combine_and_filter(changed, untracked))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use tempfile::TempDir;

    use super::{collect_changed_files, collect_changed_files_since, is_worktree_checkout_path};

    // --- is_worktree_checkout_path -----------------------------------------

    #[test]
    fn worktree_checkout_path_cases() {
        let cases: &[(&str, bool)] = &[
            (".worktrees/x", true),
            ("a/.worktrees/b/c.js", true),
            (".worktrees", false),
            ("x/.claude/worktrees/a", true),
            (".claude/worktrees/x", true),
            (".claude/foo/worktrees/a", false),
            ("foo.worktrees/x", false),
            ("normal/path.js", false),
            ("", false),
        ];
        for (input, expected) in cases {
            assert_eq!(
                is_worktree_checkout_path(input),
                *expected,
                "is_worktree_checkout_path({input:?})"
            );
        }
    }

    // --- shared git fixture helpers (за зразком changed_base.rs) -----------

    /// Запускає git-команду у фікстурі, панікує при non-zero exit.
    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
        assert!(status.success(), "git {args:?} failed у {}", dir.display());
    }

    /// Порожній репо з ізольованою identity.
    fn init_repo(dir: &Path) {
        git(dir, &["init", "--quiet", "--initial-branch=main"]);
        git(dir, &["config", "user.name", "rules-core-test"]);
        git(dir, &["config", "user.email", "rules-core-test@localhost"]);
    }

    fn write_file(dir: &Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn commit_all(dir: &Path, message: &str) {
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "--quiet", "-m", message]);
    }

    fn head_sha(dir: &Path) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    // --- collect_changed_files ----------------------------------------------

    #[test]
    fn modified_and_untracked_together() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "base.js", "export const a = 1\n");
        commit_all(dir, "init");

        write_file(dir, "base.js", "export const a = 2\n");
        write_file(dir, "new.ts", "export const b = 3\n");

        let files = collect_changed_files(dir);
        assert!(files.contains(&"base.js".to_string()));
        assert!(files.contains(&"new.ts".to_string()));
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn deleted_file_not_in_list() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "gone.js", "export const g = 1\n");
        write_file(dir, "stay.js", "export const s = 1\n");
        commit_all(dir, "init");

        fs::remove_file(dir.join("gone.js")).unwrap();
        write_file(dir, "stay.js", "export const s = 2\n");

        let files = collect_changed_files(dir);
        assert!(!files.contains(&"gone.js".to_string()));
        assert!(files.contains(&"stay.js".to_string()));
    }

    #[test]
    fn clean_tree_is_empty() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "base.js", "export const a = 1\n");
        commit_all(dir, "init");

        assert_eq!(collect_changed_files(dir), Vec::<String>::new());
    }

    #[test]
    fn non_git_dir_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(collect_changed_files(tmp.path()), Vec::<String>::new());
    }

    #[test]
    fn worktree_checkout_untracked_filtered_out() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "base.js", "export const a = 1\n");
        commit_all(dir, "init");

        // Фікстура: не справжній `git worktree add`, лише untracked-шлях
        // усередині `.worktrees/`/`.claude/worktrees/` — цього достатньо,
        // бо фільтр діє на рядок шляху, не на факт існування worktree.
        write_file(dir, ".worktrees/feature-x/copy.js", "export const w = 1\n");
        write_file(dir, ".claude/worktrees/agent-y/COVERAGE.md", "# x\n");
        write_file(dir, "new.ts", "export const b = 3\n");

        assert_eq!(collect_changed_files(dir), vec!["new.ts".to_string()]);
    }

    // --- collect_changed_files_since -----------------------------------------

    #[test]
    fn since_base_catches_committed_and_uncommitted() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "base.js", "export const a = 1\n");
        commit_all(dir, "init");
        let base = head_sha(dir);

        write_file(dir, "committed.js", "export const c = 1\n");
        commit_all(dir, "step");

        write_file(dir, "base.js", "export const a = 9\n");
        write_file(dir, "untracked.ts", "export const u = 1\n");

        let files = collect_changed_files_since(dir, Some(&base)).unwrap();
        assert!(files.contains(&"committed.js".to_string()));
        assert!(files.contains(&"base.js".to_string()));
        assert!(files.contains(&"untracked.ts".to_string()));
    }

    #[test]
    fn since_base_none_falls_back_to_collect_changed_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "base.js", "export const a = 1\n");
        commit_all(dir, "init");
        write_file(dir, "base.js", "export const a = 2\n");

        assert_eq!(
            collect_changed_files_since(dir, None).unwrap(),
            collect_changed_files(dir)
        );
    }

    #[test]
    fn since_base_head_on_clean_tree_is_empty() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "base.js", "export const a = 1\n");
        commit_all(dir, "init");
        let base = head_sha(dir);

        assert_eq!(
            collect_changed_files_since(dir, Some(&base)).unwrap(),
            Vec::<String>::new()
        );
    }

    #[test]
    fn since_unreachable_base_fails_closed() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        write_file(dir, "base.js", "export const a = 1\n");
        commit_all(dir, "init");

        // sha з цілком іншого репо-фікстури — синтаксично валідний, але
        // недосяжний у `dir`.
        let other = TempDir::new().unwrap();
        init_repo(other.path());
        write_file(other.path(), "other.js", "export const o = 1\n");
        commit_all(other.path(), "init");
        let foreign_sha = head_sha(other.path());

        let err = collect_changed_files_since(dir, Some(&foreign_sha)).unwrap_err();
        let message = err.to_string();
        assert!(message.contains("недосяжний"), "message: {message}");
        assert!(message.contains(&foreign_sha), "message: {message}");
    }
}
