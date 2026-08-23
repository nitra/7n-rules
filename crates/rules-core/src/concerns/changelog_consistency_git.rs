//! `changelog/consistency` — git-шар: точний порт git-хелперів `main.mjs`
//! (`gitOrNull` і все, що на ньому побудоване) для
//! [`super::changelog_consistency`].
//!
//! # Канал помилок
//!
//! Кожен git-виклик тут — точний порт `gitOrNull`: JS обгортає `execFile` у
//! `try/catch`, що ковтає БУДЬ-ЯКУ помилку (spawn, non-zero exit) і повертає
//! `null`. Жоден git-виклик у цьому файлі НЕ пропагує `Err` — усі негаразди
//! git (не git-репо, ref не існує, HEAD відсутній) зводяться до `None`/
//! `false`, так само як JS-канон. Це відрізняється від
//! [`super::changelog_consistency_workspace`], де `readFile`/`writeChange`
//! БЕЗ `try/catch` навколо себе й тому пропагують помилку.

use std::path::Path;
use std::process::Command;

use crate::git_policy::GitPolicy;

/// Префікси шляхів (posix), які не вважаються релізними змінами — точний
/// порт `CHANGELOG_IGNORE_PATH_PREFIXES` (`main.mjs:46`).
const CHANGELOG_IGNORE_PATH_PREFIXES: &[&str] = &["docs/", "doc/", ".cursor/", ".claude/"];

/// Точка порівняння git для changelog: ref/SHA + людяна мітка — порт
/// повернення `resolveChangelogComparisonPoint` (`main.mjs:186`).
pub(super) struct ComparisonPoint {
    pub(super) reference: String,
    pub(super) label: String,
}

/// Тихо запускає `git` у заданому `cwd` — точний порт `gitOrNull`
/// (`main.mjs:59-66`). `None` при БУДЬ-ЯКІЙ помилці (spawn/non-zero exit).
fn git_or_null(args: &[&str], cwd: &Path) -> Option<String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Точний порт `isInsideGitRepo` (`main.mjs:72-75`).
pub(super) fn is_inside_git_repo(cwd: &Path) -> bool {
    git_or_null(&["rev-parse", "--is-inside-work-tree"], cwd)
        .map(|out| out.trim() == "true")
        .unwrap_or(false)
}

/// Точний порт `currentBranchName` (`main.mjs:81-84`).
pub(super) fn current_branch_name(cwd: &Path) -> Option<String> {
    git_or_null(&["rev-parse", "--abbrev-ref", "HEAD"], cwd).map(|out| out.trim().to_string())
}

/// Subject останнього коміту (HEAD) — фрагмент `gitOrNull(['log', '-1',
/// '--format=%s'], cwd)`, застосований у `resolveAutoChangeMessage`
/// (`main.mjs:509-515`).
pub(super) fn last_commit_subject(cwd: &Path) -> Option<String> {
    git_or_null(&["log", "-1", "--format=%s"], cwd).map(|out| out.trim().to_string())
}

/// `git show <ref>:<path>` — вміст файлу на заданому ref/SHA, фрагмент
/// `readBaseVersion` (`main.mjs:289-302`, `gitOrNull(['show', ...])`).
pub(super) fn show_file_at_ref(base_ref: &str, rel_path: &str, cwd: &Path) -> Option<String> {
    git_or_null(&["show", &format!("{base_ref}:{rel_path}")], cwd)
}

/// `git add -- <path>` — точний порт фрагмента `reportOrFixMissingChangeFile`
/// (`main.mjs:539`): ставить свіжостворений autofix-файл у git-індекс.
/// Результат ігнорується (як у JS — `gitOrNull` тут кличуть заради
/// побічного ефекту, не значення).
pub(super) fn git_add(rel_path: &str, cwd: &Path) {
    let _ = git_or_null(&["add", "--", rel_path], cwd);
}

/// Чи HEAD — merge-коміт (2-й предок) АБО merge зараз у процесі
/// (`MERGE_HEAD`) — точний порт `isMergeCommit` (`main.mjs:98-103`).
pub(super) fn is_merge_commit(cwd: &Path) -> bool {
    let head_parent2 = git_or_null(&["rev-parse", "--verify", "--quiet", "HEAD^2"], cwd);
    if head_parent2.map(|s| !s.trim().is_empty()).unwrap_or(false) {
        return true;
    }
    let merge_head = git_or_null(&["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], cwd);
    merge_head.map(|s| !s.trim().is_empty()).unwrap_or(false)
}

/// Точний порт `isGitAncestor` (`main.mjs:113-116`): успіх `git merge-base
/// --is-ancestor` (exit 0) — незалежно від друкованого виводу (команда
/// нічого не друкує).
fn is_git_ancestor(ancestor: &str, descendant: &str, cwd: &Path) -> bool {
    git_or_null(&["merge-base", "--is-ancestor", ancestor, descendant], cwd).is_some()
}

/// Точний порт `resolveMergeBase` (`main.mjs:175-180`).
fn resolve_merge_base(base_ref: &str, cwd: &Path) -> Option<String> {
    let out = git_or_null(&["merge-base", base_ref, "HEAD"], cwd)?;
    let sha = out.trim();
    (!sha.is_empty()).then(|| sha.to_string())
}

/// Merge-base найновішої з локальної та origin-версії `branch_name` проти
/// HEAD — точний порт `resolveNewestMergeBase` (`main.mjs:130-145`).
fn resolve_newest_merge_base(branch_name: &str, cwd: &Path) -> Option<String> {
    let origin_ref = format!("origin/{branch_name}");
    let mut bases: Vec<String> = Vec::new();
    for reference in [branch_name, origin_ref.as_str()] {
        let exists = git_or_null(&["rev-parse", "--verify", "--quiet", reference], cwd);
        if !exists.map(|s| !s.trim().is_empty()).unwrap_or(false) {
            continue;
        }
        if let Some(merge_base) = resolve_merge_base(reference, cwd) {
            bases.push(merge_base);
        }
    }
    if bases.is_empty() {
        return None;
    }
    let mut newest = bases[0].clone();
    for candidate in &bases[1..] {
        if *candidate != newest && is_git_ancestor(&newest, candidate, cwd) {
            newest = candidate.clone();
        }
    }
    Some(newest)
}

/// Точний порт `isChangelogIgnoredPath` (`main.mjs:151-154`).
pub(super) fn is_changelog_ignored_path(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/");
    let p = normalized.strip_prefix("./").unwrap_or(&normalized);
    CHANGELOG_IGNORE_PATH_PREFIXES
        .iter()
        .any(|prefix| p.starts_with(prefix))
}

/// Точний порт `isPathGitIgnored` (`main.mjs:161-168`): `git check-ignore
/// -q` — exit 0 (ignored) → `true`, будь-що інше (не ignored/помилка) →
/// `false`. Не через [`git_or_null`] — `check-ignore` навмисно НЕ друкує
/// з `-q`, тож нема різниці stdout, лише exit-код.
fn is_path_git_ignored(rel_path: &str, cwd: &Path) -> bool {
    Command::new("git")
        .current_dir(cwd)
        .args(["check-ignore", "-q", "--", rel_path])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Точний порт `resolveChangelogComparisonPoint` (`main.mjs:188-220`).
pub(super) fn resolve_changelog_comparison_point(
    branch: Option<&str>,
    cwd: &Path,
    policy: &GitPolicy,
) -> Option<ComparisonPoint> {
    if branch == Some(policy.base_branch.as_str()) {
        return None;
    }

    if policy
        .release_branches
        .iter()
        .any(|b| Some(b.as_str()) == branch)
    {
        let branch = branch.unwrap_or_default();
        let origin_ref = format!("origin/{branch}");
        let origin_sha = git_or_null(&["rev-parse", "--verify", "--quiet", &origin_ref], cwd)
            .map(|s| s.trim().to_string());
        let head_sha = git_or_null(&["rev-parse", "HEAD"], cwd).map(|s| s.trim().to_string());
        if let (Some(origin_sha), Some(head_sha)) = (&origin_sha, &head_sha) {
            if !origin_sha.is_empty()
                && !head_sha.is_empty()
                && (origin_sha == head_sha || is_git_ancestor(&origin_ref, "HEAD", cwd))
            {
                return Some(ComparisonPoint {
                    reference: origin_ref,
                    label: branch.to_string(),
                });
            }
        }
        let parent = git_or_null(&["rev-parse", "--verify", "--quiet", "HEAD~1"], cwd)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        return parent.map(|sha| ComparisonPoint {
            reference: sha,
            label: format!("{branch}~1"),
        });
    }

    // Feature-гілка: база — новіший merge-base серед локальної та
    // origin-версії кандидата (застарілий локальний `main` не має
    // перекривати origin).
    for name in &policy.integration_branches {
        if let Some(merge_base) = resolve_newest_merge_base(name, cwd) {
            return Some(ComparisonPoint {
                reference: merge_base,
                label: name.clone(),
            });
        }
    }
    None
}

/// Точний порт `pathspecForWorkspace` (`main.mjs:227-230`).
fn pathspec_for_workspace(ws: &str, sub_workspaces: &[String]) -> Vec<String> {
    if ws != "." {
        return vec![format!("{ws}/")];
    }
    let mut spec = vec![".".to_string()];
    spec.extend(
        sub_workspaces
            .iter()
            .filter(|s| s.as_str() != ".")
            .map(|s| format!(":(exclude){s}/")),
    );
    spec
}

/// Точний порт `splitNulPaths` (`main.mjs:241-246`).
fn split_nul_paths(nul_separated: Option<&str>) -> Vec<String> {
    match nul_separated {
        None => Vec::new(),
        Some(text) => text
            .split('\0')
            .filter(|p| !p.is_empty())
            .map(str::to_string)
            .collect(),
    }
}

/// Точний порт `listChangedPathsAgainstBase` (`main.mjs:254-258`) —
/// insertion-order dedup (перший вхід зберігає позицію), як JS `Set`.
fn list_changed_paths_against_base(base_ref: &str, pathspec: &[String], cwd: &Path) -> Vec<String> {
    let mut args: Vec<&str> = vec!["diff", "--name-only", "-z", base_ref, "--"];
    args.extend(pathspec.iter().map(String::as_str));
    let diff_out = git_or_null(&args, cwd);

    let mut untracked_args: Vec<&str> =
        vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
    untracked_args.extend(pathspec.iter().map(String::as_str));
    let untracked_out = git_or_null(&untracked_args, cwd);

    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for p in split_nul_paths(diff_out.as_deref())
        .into_iter()
        .chain(split_nul_paths(untracked_out.as_deref()))
    {
        if seen.insert(p.clone()) {
            result.push(p);
        }
    }
    result
}

/// Точний порт `workspaceHasRelevantChangesAgainstBase` (`main.mjs:267-280`).
pub(super) fn workspace_has_relevant_changes_against_base(
    base_ref: &str,
    ws: &str,
    sub_workspaces: &[String],
    cwd: &Path,
) -> bool {
    let pathspec = pathspec_for_workspace(ws, sub_workspaces);
    let paths = list_changed_paths_against_base(base_ref, &pathspec, cwd);
    for p in paths {
        if is_changelog_ignored_path(&p) {
            continue;
        }
        if is_path_git_ignored(&p, cwd) {
            continue;
        }
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    use crate::concerns::test_support::{commit_all, git, init_repo, write};

    #[test]
    fn is_changelog_ignored_path_matches_prefixes() {
        assert!(is_changelog_ignored_path("docs/readme.md"));
        assert!(is_changelog_ignored_path("./doc/x.md"));
        assert!(is_changelog_ignored_path(".cursor/rules/n-adr.mdc"));
        assert!(is_changelog_ignored_path(".claude/hooks/x.sh"));
        assert!(!is_changelog_ignored_path("src/index.mjs"));
    }

    #[test]
    fn is_changelog_ignored_path_normalizes_backslashes() {
        assert!(is_changelog_ignored_path("docs\\readme.md"));
    }

    #[test]
    fn non_git_directory_is_not_inside_git_repo() {
        let tmp = TempDir::new().unwrap();
        assert!(!is_inside_git_repo(tmp.path()));
        assert!(!is_merge_commit(tmp.path()));
        assert_eq!(current_branch_name(tmp.path()), None);
    }

    #[test]
    fn git_repo_reports_inside_and_branch_name() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        assert!(is_inside_git_repo(tmp.path()));
        assert_eq!(current_branch_name(tmp.path()), Some("dev".to_string()));
        assert!(!is_merge_commit(tmp.path()));
    }

    #[test]
    fn merge_commit_head_is_detected() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "main");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        git(tmp.path(), &["checkout", "-q", "-b", "feat"]);
        write(&tmp, "b.txt", "b");
        commit_all(tmp.path(), "feat");
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
        assert!(is_merge_commit(tmp.path()));
    }

    #[test]
    fn merge_in_progress_head_parent2_missing_but_merge_head_present() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "main");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        write(&tmp, "base.txt", "base");
        commit_all(tmp.path(), "base");
        git(tmp.path(), &["checkout", "-q", "-b", "feat"]);
        write(&tmp, "app.txt", "x");
        commit_all(tmp.path(), "feat: app");
        git(tmp.path(), &["checkout", "-q", "main"]);
        git(
            tmp.path(),
            &["merge", "--no-ff", "--no-commit", "-q", "feat"],
        );
        assert!(is_merge_commit(tmp.path()));
    }

    #[test]
    fn workspace_has_relevant_changes_ignores_docs_only() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        let base = head_sha(tmp.path());
        git(tmp.path(), &["checkout", "-q", "-b", "feat/docs"]);
        write(&tmp, "docs/note.md", "x");
        assert!(!workspace_has_relevant_changes_against_base(
            &base,
            ".",
            &[],
            tmp.path()
        ));
    }

    #[test]
    fn workspace_has_relevant_changes_true_for_code_change() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        let base = head_sha(tmp.path());
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "app.js", "x");
        assert!(workspace_has_relevant_changes_against_base(
            &base,
            ".",
            &[],
            tmp.path()
        ));
    }

    #[test]
    fn workspace_has_relevant_changes_handles_non_ascii_untracked_path() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        let base = head_sha(tmp.path());
        git(tmp.path(), &["checkout", "-q", "-b", "feat/docs"]);
        write(&tmp, "docs/нотатка-про-зміни.md", "# нотатка\n");
        assert!(!workspace_has_relevant_changes_against_base(
            &base,
            ".",
            &[],
            tmp.path()
        ));
    }

    #[test]
    fn resolve_changelog_comparison_point_none_on_base_branch() {
        let tmp = TempDir::new().unwrap();
        let policy = GitPolicy {
            base_branch: "main".to_string(),
            release_branches: vec!["main".to_string()],
            integration_branches: vec!["main".to_string()],
            protected_branches: vec!["main".to_string()],
        };
        assert!(resolve_changelog_comparison_point(Some("main"), tmp.path(), &policy).is_none());
    }

    #[test]
    fn resolve_changelog_comparison_point_feature_branch_uses_merge_base() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "dev");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        let base = head_sha(tmp.path());
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);
        write(&tmp, "app.js", "x");
        commit_all(tmp.path(), "feat");

        let policy = GitPolicy {
            base_branch: "dev".to_string(),
            release_branches: vec!["main".to_string()],
            integration_branches: vec!["dev".to_string(), "main".to_string()],
            protected_branches: vec!["dev".to_string(), "main".to_string()],
        };
        let point =
            resolve_changelog_comparison_point(Some("feat/x"), tmp.path(), &policy).unwrap();
        assert_eq!(point.reference, base);
        assert_eq!(point.label, "dev");
    }

    #[test]
    fn resolve_changelog_comparison_point_none_without_any_ref() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "other-base");
        write(&tmp, "a.txt", "a");
        commit_all(tmp.path(), "init");
        git(tmp.path(), &["checkout", "-q", "-b", "feat/x"]);

        let policy = GitPolicy {
            base_branch: "dev".to_string(),
            release_branches: vec!["main".to_string()],
            integration_branches: vec!["dev".to_string(), "main".to_string()],
            protected_branches: vec!["dev".to_string(), "main".to_string()],
        };
        assert!(resolve_changelog_comparison_point(Some("feat/x"), tmp.path(), &policy).is_none());
    }

    fn head_sha(dir: &std::path::Path) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }
}
