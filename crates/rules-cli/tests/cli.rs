//! Інтеграційні тести бінаря `rules-cli` (зріз 1 фази 8): native-команди
//! (`lint --help`, `changed-files`) і транзитна делегація в JS-entrypoint.
//! Byte-exact parity з JS-боком гейтиться окремо vitest-тестом
//! `npm/scripts/lib/tests/rules-cli-parity.test.mjs` — тут перевіряється
//! поведінка самого бінаря без node/bun (делегація — через runtime-стаб).

use std::path::Path;
use std::process::{Command, Output};

use tempfile::TempDir;

/// Команда до зібраного бінаря крейта (шлях дає cargo).
fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_rules-cli"))
}

/// Запускає git у `dir`, панікує на непорожньому exit-коді (фікстури).
fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git недоступний");
    assert!(
        out.status.success(),
        "git {args:?} упав: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Мінімальний git-репо з одним комітом файлу `a.txt`.
fn init_repo() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "test"]);
    std::fs::write(dir.join("a.txt"), "a\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "init"]);
    tmp
}

fn stdout(out: &Output) -> String {
    String::from_utf8(out.stdout.clone()).unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8(out.stderr.clone()).unwrap()
}

#[test]
fn lint_help_is_native_and_byte_exact_with_fixture() {
    let expected = include_str!("../src/lint_help.txt");
    for flag in ["--help", "-h"] {
        let out = bin().args(["lint", flag]).output().unwrap();
        assert!(out.status.success());
        assert_eq!(stdout(&out), expected);
    }
}

#[test]
fn changed_files_lists_worktree_changes() {
    let tmp = init_repo();
    std::fs::write(tmp.path().join("a.txt"), "змінено\n").unwrap();
    std::fs::write(tmp.path().join("b.txt"), "новий\n").unwrap();
    let out = bin()
        .args(["changed-files", "--cwd"])
        .arg(tmp.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "a.txt\nb.txt\n");
}

#[test]
fn changed_files_with_explicit_base_reports_delta() {
    let tmp = init_repo();
    std::fs::write(tmp.path().join("c.txt"), "c\n").unwrap();
    git(tmp.path(), &["add", "."]);
    git(tmp.path(), &["commit", "-q", "-m", "second"]);
    let out = bin()
        .current_dir(tmp.path())
        .args(["changed-files", "--base", "HEAD~1"])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "c.txt\n");
}

#[test]
fn changed_files_with_unresolvable_base_fails_closed() {
    let tmp = init_repo();
    let out = bin()
        .current_dir(tmp.path())
        .args(["changed-files", "--base", "no-such-ref"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("не резолвиться"));
}

#[test]
fn changed_files_delta_falls_back_to_worktree_without_base() {
    // Репо без origin і з єдиною гілкою main == HEAD: merge-base(main, HEAD)
    // резолвиться в HEAD → дельта порожня, але робоче дерево має untracked.
    let tmp = init_repo();
    std::fs::write(tmp.path().join("d.txt"), "d\n").unwrap();
    let out = bin()
        .current_dir(tmp.path())
        .args(["changed-files", "--delta"])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "d.txt\n");
}

#[test]
fn changed_files_rejects_unknown_argument() {
    let out = bin().args(["changed-files", "--unknown"]).output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("невідомий аргумент"));
}

#[cfg(unix)]
#[test]
fn unknown_command_delegates_argv_and_exit_code_to_js_entrypoint() {
    use std::os::unix::fs::PermissionsExt;

    // Runtime-стаб замість bun/node: друкує отримані аргументи
    // (entrypoint + argv) і завершується кодом 42 — перевіряє і
    // argv-passthrough, і пропагацію exit-коду без залежності від node.
    let tmp = TempDir::new().unwrap();
    let stub = tmp.path().join("runtime.sh");
    std::fs::write(&stub, "#!/bin/sh\necho \"$@\"\nexit 42\n").unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    let out = bin()
        .current_dir(tmp.path())
        .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
        .env("N_RULES_JS_RUNTIME", &stub)
        .args(["lint", "--full", "--no-fix"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(42));
    assert_eq!(stdout(&out), "/fake/n-rules.js lint --full --no-fix\n");
}

#[cfg(unix)]
#[test]
fn delegation_without_entrypoint_fails_with_hint() {
    let tmp = TempDir::new().unwrap();
    let out = bin()
        .current_dir(tmp.path())
        .env_remove("N_RULES_JS_ENTRY")
        .args(["docs", "domains"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("N_RULES_JS_ENTRY"));
}
