//! Дзеркальний набір `security/tracked_symlink` — сценарій-у-сценарій із
//! видаленого `tests/tracked_symlink.test.mjs`.
//!
//! Предмет перевірки — ІНДЕКС git, тож фікстура будується справжніми
//! командами git у тимчасовому дереві: підміна індексу вручну перевіряла б
//! не те, що читає детектор.

use std::path::Path;
use std::process::Command;

use rules_core::concerns::tracked_symlink;

/// Тимчасове git-дерево з одним комітом.
fn repo(label: &str) -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix(&format!("tracked-symlink-{label}-"))
        .tempdir()
        .expect("tempdir");
    git(dir.path(), &["init", "-q"]);
    git(dir.path(), &["config", "user.email", "t@example.com"]);
    git(dir.path(), &["config", "user.name", "t"]);
    dir
}

fn git(cwd: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git запускається");
    assert!(
        status.status.success(),
        "git {args:?} впав: {}",
        String::from_utf8_lossy(&status.stderr)
    );
}

/// Кладе symlink і додає його в індекс.
fn add_symlink(root: &Path, link: &str, target: &str) {
    let path = root.join(link);
    std::fs::create_dir_all(path.parent().expect("є батько")).expect("тека");
    std::os::unix::fs::symlink(target, &path).expect("symlink");
    git(root, &["add", "-f", link]);
}

fn reasons(report: &rules_core::diagnostics::ConcernReport) -> Vec<&str> {
    report
        .violations
        .iter()
        .map(|v| v.reason.as_str())
        .collect()
}

#[test]
fn tracked_symlink_to_absolute_path_is_a_violation() {
    let dir = repo("absolute");
    add_symlink(dir.path(), "target", "/private/tmp/cargo-target-x");
    let found = tracked_symlink(dir.path());
    assert_eq!(reasons(&found), ["absolute-target"]);
    assert_eq!(found.violations[0].file.as_deref(), Some("target"));
    assert_eq!(
        found.violations[0]
            .data
            .as_ref()
            .and_then(|d| d.get("target")),
        Some(&serde_json::json!("/private/tmp/cargo-target-x"))
    );
}

/// Windows-шлях із літерою диска — теж абсолютний, хоч POSIX так не вважає.
#[test]
fn windows_drive_target_counts_as_absolute() {
    let dir = repo("windows");
    add_symlink(dir.path(), "target", "C:\\Users\\x\\build");
    assert_eq!(reasons(&tracked_symlink(dir.path())), ["absolute-target"]);
}

#[test]
fn relative_target_escaping_the_root_is_a_violation() {
    let dir = repo("escapes");
    add_symlink(dir.path(), "pkg/link", "../../outside");
    let found = tracked_symlink(dir.path());
    assert_eq!(reasons(&found), ["escapes-repo"]);
    assert_eq!(found.violations[0].file.as_deref(), Some("pkg/link"));
}

/// `..` У СЕРЕДИНІ шляху — не вихід за корінь, поки результат лишається в
/// дереві.
#[test]
fn symlink_inside_the_tree_is_clean() {
    let dir = repo("inside");
    std::fs::create_dir_all(dir.path().join("a/b")).expect("тека");
    std::fs::write(dir.path().join("a/b/file"), "x").expect("файл");
    add_symlink(dir.path(), "a/link", "b/../b/file");
    assert!(tracked_symlink(dir.path()).violations.is_empty());
}

#[test]
fn repository_without_symlinks_is_clean() {
    let dir = repo("plain");
    std::fs::write(dir.path().join("a.txt"), "x").expect("файл");
    git(dir.path(), &["add", "a.txt"]);
    assert!(tracked_symlink(dir.path()).violations.is_empty());
}

/// Поза git-робочим деревом предмета перевірки немає — пропуск без
/// порушень.
#[test]
fn outside_a_git_worktree_the_check_is_skipped() {
    let dir = tempfile::tempdir().expect("tempdir");
    assert!(tracked_symlink(dir.path()).violations.is_empty());
}

#[test]
fn every_bad_symlink_gets_its_own_violation() {
    let dir = repo("multi");
    add_symlink(dir.path(), "one", "/abs/one");
    add_symlink(dir.path(), "pkg/two", "../../two");
    let found = tracked_symlink(dir.path());
    let mut files: Vec<&str> = found
        .violations
        .iter()
        .filter_map(|v| v.file.as_deref())
        .collect();
    files.sort_unstable();
    assert_eq!(files, ["one", "pkg/two"]);
}
