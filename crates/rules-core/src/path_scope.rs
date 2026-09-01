//! Резолвер explicit-files списку для `n-rules lint --path <dir>` — точний
//! порт `npm/scripts/lib/lint-surface/path-scope.mjs` (клас **A**,
//! `docs/plans/2026-08-31-full-rust-migration-plan.md` крок 4).
//!
//! На відміну від `--cwd` (підміняє корінь прогону), `--path` лишає корінь
//! незмінним і лише звужує файловий набір, який `build_lint_plan` бере як
//! `changed` (режим `delta` + `path_mode: true`) — тим самим шляхом, що вже
//! годує `hook --post-tool-use`/`--stop`.
//!
//! Два режими збору:
//! - [`collect_path_scoped_changed_files`] (дефолт `--path`) — перетин
//!   піддерева з git-дельтою vs merge-base;
//! - [`collect_path_scoped_files`] (`--path --full`) — усі файли піддерева.

use std::path::{Path, PathBuf};

use crate::changed_base::resolve_changed_base;
use crate::changed_files::collect_changed_files_since;
use crate::concerns::cursor_ignore::{load_cursor_ignore_paths, to_relative_ignore_globs, walk_under_repo};
use crate::git_policy::read_git_policy;

/// Лексично нормалізує `path` до posix-рядка без залежності від файлової
/// системи — той самий примітив, що [`crate::concerns::cursor_ignore`]
/// використовує для `.n-rules.json:ignore`, тут — для самого `--path`.
fn lexical_normalize_posix(path: &Path) -> String {
    use std::path::Component;
    let mut stack: Vec<String> = Vec::new();
    let mut is_absolute = false;
    for component in path.components() {
        match component {
            Component::Prefix(_) => {}
            Component::RootDir => is_absolute = true,
            Component::CurDir => {}
            Component::ParentDir => {
                stack.pop();
            }
            Component::Normal(seg) => stack.push(seg.to_string_lossy().into_owned()),
        }
    }
    let joined = stack.join("/");
    if is_absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

/// Відносний posix-шлях `target` від `cwd` — порожній рядок, якщо збігаються.
/// Порт `relative(cwd, target).split(sep).join('/')`.
fn relative_posix(cwd: &Path, target: &Path) -> String {
    let cwd_posix = lexical_normalize_posix(cwd);
    let target_posix = lexical_normalize_posix(target);
    let cwd_parts: Vec<&str> = cwd_posix.split('/').filter(|s| !s.is_empty()).collect();
    let target_parts: Vec<&str> = target_posix.split('/').filter(|s| !s.is_empty()).collect();
    let mut i = 0;
    while i < cwd_parts.len() && i < target_parts.len() && cwd_parts[i] == target_parts[i] {
        i += 1;
    }
    target_parts[i..].join("/")
}

/// Перевіряє, що резолвлений `--path` лежить усередині `cwd` (не traversal
/// через `..` і не абсолютний шлях поза коренем прогону) — порт
/// `assertWithinCwd`.
fn assert_within_cwd(cwd: &Path, target: &Path) -> Result<(), String> {
    let cwd_posix = lexical_normalize_posix(cwd);
    let target_posix = lexical_normalize_posix(target);
    if target_posix == cwd_posix {
        return Ok(());
    }
    if !target_posix.starts_with(&format!("{cwd_posix}/")) {
        return Err(format!(
            "--path має вказувати каталог усередині {} (отримано поза межами: {})",
            cwd.display(),
            target.display()
        ));
    }
    Ok(())
}

/// Резолвить `--path` в абсолютний шлях і валідує: усередині `cwd`, існує,
/// є каталогом. Спільний вхід обох режимів збору — порт
/// `resolveAndAssertPathDir`.
pub fn resolve_and_assert_path_dir(cwd: &Path, path_arg: &str) -> Result<PathBuf, String> {
    let target = if Path::new(path_arg).is_absolute() {
        PathBuf::from(path_arg)
    } else {
        cwd.join(path_arg)
    };
    assert_within_cwd(cwd, &target)?;
    match std::fs::metadata(&target) {
        Ok(meta) if meta.is_dir() => Ok(target),
        _ => Err(format!("--path не є каталогом: {}", target.display())),
    }
}

/// Результат [`collect_path_scoped_changed_files`]: відсортований перетин і
/// статус резолву бази (`false` — база не резолвилась, caller має fallback-
/// нути на повне піддерево, як у JS-оригіналі — мовчазного скіпу немає).
pub struct PathScopedChangedFiles {
    pub files: Vec<String>,
    pub base_resolved: bool,
}

/// Перетин git-дельти (vs merge-base) з піддеревом `--path`: posix-відносні
/// шляхи змінених/untracked файлів під каталогом, мінус
/// `.n-rules.json:ignore` — порт `collectPathScopedChangedFiles`.
pub fn collect_path_scoped_changed_files(
    cwd: &Path,
    path_arg: &str,
    base_ref: Option<&str>,
) -> Result<PathScopedChangedFiles, String> {
    let target = resolve_and_assert_path_dir(cwd, path_arg)?;

    let candidates: Vec<String> = if base_ref.is_some() {
        Vec::new()
    } else {
        let policy = read_git_policy(cwd);
        policy
            .integration_branches
            .into_iter()
            .flat_map(|name| [format!("origin/{name}"), name])
            .collect()
    };
    let base = resolve_changed_base(cwd, &candidates, base_ref)
        .map_err(|error| format!("rules-cli lint --path: {error}"))?;
    let Some(base_sha) = base else {
        return Ok(PathScopedChangedFiles {
            files: Vec::new(),
            base_resolved: false,
        });
    };

    let changed = collect_changed_files_since(cwd, Some(&base_sha))
        .map_err(|error| format!("rules-cli lint --path: {error}"))?;

    let rel_dir = relative_posix(cwd, &target);
    let prefix = if rel_dir.is_empty() {
        String::new()
    } else {
        format!("{rel_dir}/")
    };

    // git уже поважає .gitignore; .n-rules.json:ignore застосовуємо явно
    // (як walkDir) — ignore-глоби мають форму `rel/**`, префікс для
    // `startsWith`-фільтра — той самий рядок без `**`.
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let ignore_prefixes: Vec<String> = to_relative_ignore_globs(cwd, &ignore_paths)
        .into_iter()
        .map(|glob| glob.trim_end_matches("**").to_string())
        .collect();

    let mut files: Vec<String> = changed
        .into_iter()
        .filter(|f| f.starts_with(&prefix))
        .filter(|f| ignore_prefixes.iter().all(|ip| !f.starts_with(ip.as_str())))
        .collect();
    files.sort();

    Ok(PathScopedChangedFiles {
        files,
        base_resolved: true,
    })
}

/// Збирає posix-відносні (від `cwd`) шляхи всіх файлів під `--path`-каталогом,
/// поважаючи `.gitignore` і `.n-rules.json:ignore` кореня — порт
/// `collectPathScopedFiles`. Порожній каталог — валідний порожній результат,
/// не помилка.
pub fn collect_path_scoped_files(cwd: &Path, path_arg: &str) -> Result<Vec<String>, String> {
    let target = resolve_and_assert_path_dir(cwd, path_arg)?;
    let rel_dir = relative_posix(cwd, &target);
    let prefix = if rel_dir.is_empty() {
        String::new()
    } else {
        format!("{rel_dir}/")
    };
    let mut files: Vec<String> = walk_under_repo(cwd, &target)
        .into_iter()
        .map(|f| format!("{prefix}{f}"))
        .collect();
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo(dir: &Path) {
        git(dir, &["init", "-q"]);
        git(dir, &["config", "user.email", "t@example.com"]);
        git(dir, &["config", "user.name", "t"]);
    }

    #[test]
    fn resolve_and_assert_rejects_traversal_and_outside_paths() {
        let tmp = TempDir::new().unwrap();
        let cwd = tmp.path();
        std::fs::create_dir(cwd.join("svc")).unwrap();
        assert!(resolve_and_assert_path_dir(cwd, "svc").is_ok());
        assert!(resolve_and_assert_path_dir(cwd, "../outside").is_err());
        assert!(resolve_and_assert_path_dir(cwd, "does-not-exist").is_err());
    }

    #[test]
    fn resolve_and_assert_rejects_non_directory() {
        let tmp = TempDir::new().unwrap();
        let cwd = tmp.path();
        std::fs::write(cwd.join("file.txt"), "x").unwrap();
        assert!(resolve_and_assert_path_dir(cwd, "file.txt").is_err());
    }

    #[test]
    fn collect_path_scoped_files_lists_subtree_relative_to_cwd() {
        let tmp = TempDir::new().unwrap();
        let cwd = tmp.path();
        std::fs::create_dir_all(cwd.join("svc/sub")).unwrap();
        std::fs::write(cwd.join("svc/a.txt"), "a").unwrap();
        std::fs::write(cwd.join("svc/sub/b.txt"), "b").unwrap();
        std::fs::write(cwd.join("root.txt"), "r").unwrap();

        let files = collect_path_scoped_files(cwd, "svc").unwrap();
        assert_eq!(files, vec!["svc/a.txt", "svc/sub/b.txt"]);
    }

    #[test]
    fn collect_path_scoped_files_respects_cursor_ignore_from_cwd_root() {
        let tmp = TempDir::new().unwrap();
        let cwd = tmp.path();
        std::fs::create_dir_all(cwd.join("svc/vendor")).unwrap();
        std::fs::write(cwd.join("svc/a.txt"), "a").unwrap();
        std::fs::write(cwd.join("svc/vendor/b.txt"), "b").unwrap();
        std::fs::write(cwd.join(".n-rules.json"), r#"{"ignore":["svc/vendor"]}"#).unwrap();

        let files = collect_path_scoped_files(cwd, "svc").unwrap();
        assert_eq!(files, vec!["svc/a.txt"]);
    }

    #[test]
    fn collect_path_scoped_changed_files_without_resolvable_base_is_fail_open() {
        let tmp = TempDir::new().unwrap();
        let cwd = tmp.path();
        std::fs::create_dir(cwd.join("svc")).unwrap();
        // Не git-репо взагалі — gix::discover не знайде базу.
        let result = collect_path_scoped_changed_files(cwd, "svc", None).unwrap();
        assert!(!result.base_resolved);
        assert!(result.files.is_empty());
    }

    #[test]
    fn collect_path_scoped_changed_files_intersects_delta_with_subtree() {
        let tmp = TempDir::new().unwrap();
        let cwd = tmp.path();
        init_repo(cwd);
        std::fs::create_dir_all(cwd.join("svc")).unwrap();
        std::fs::write(cwd.join("svc/a.txt"), "a").unwrap();
        std::fs::write(cwd.join("other.txt"), "o").unwrap();
        git(cwd, &["add", "-A"]);
        git(cwd, &["commit", "-q", "-m", "base"]);
        let base = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(cwd)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        std::fs::write(cwd.join("svc/a.txt"), "a2").unwrap();
        std::fs::write(cwd.join("other.txt"), "o2").unwrap();

        let result = collect_path_scoped_changed_files(cwd, "svc", Some(&base)).unwrap();
        assert!(result.base_resolved);
        assert_eq!(result.files, vec!["svc/a.txt"]);
    }
}
