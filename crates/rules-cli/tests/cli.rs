//! Інтеграційні тести бінаря `rules-cli` (зрізи 1–4 фази 8): native-команди
//! (`lint --help`, `changed-files`, `skill list`, `rename-yaml-extensions`,
//! native-гілки `hook`) і транзитна делегація в JS-entrypoint.
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

/// Фейковий встановлений пакет `@7n/rules`: каталог зі `skills/<id>/SKILL.md`
/// і шляхом entrypoint, який резолвиться через `N_RULES_JS_ENTRY` (сам файл
/// entrypoint для native-команд не потрібен — читається лише корінь пакета).
fn fake_package(skill_ids: &[&str]) -> TempDir {
    let tmp = TempDir::new().unwrap();
    for id in skill_ids {
        let dir = tmp.path().join("skills").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), "# skill\n").unwrap();
    }
    tmp
}

/// Шлях до entrypoint усередині фейкового пакета (`<root>/bin/n-rules.js`).
fn fake_entry(package: &TempDir) -> std::path::PathBuf {
    package.path().join("bin").join("n-rules.js")
}

#[test]
fn skill_list_prints_bundled_skill_ids() {
    let package = fake_package(&["taze", "lint", "doc-files"]);
    let out = bin()
        .env("N_RULES_JS_ENTRY", fake_entry(&package))
        .args(["skill", "list"])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(
        stdout(&out),
        "Available skills:\n- doc-files\n- lint\n- taze\n"
    );
}

#[test]
fn skill_list_without_skills_dir_prints_only_header() {
    let package = fake_package(&[]);
    let out = bin()
        .env("N_RULES_JS_ENTRY", fake_entry(&package))
        .args(["skill", "list"])
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(stdout(&out), "Available skills:\n");
}

#[test]
fn skill_list_ignores_extra_arguments_like_js() {
    let package = fake_package(&["lint"]);
    let out = bin()
        .env("N_RULES_JS_ENTRY", fake_entry(&package))
        .args(["skill", "list", "зайве"])
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(stdout(&out), "Available skills:\n- lint\n");
}

/// Дерево з k8s- і `.github`-маніфестами для `rename-yaml-extensions`.
fn yaml_fixture() -> TempDir {
    let tmp = TempDir::new().unwrap();
    for rel in [
        "k8s/web.yml",
        "k8s/api.yml",
        ".github/workflows/ci.yaml",
        "k8s/keep.yaml",
        "docs/notes.yml",
    ] {
        let path = tmp.path().join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "kind: Test\n").unwrap();
    }
    tmp
}

#[test]
fn rename_yaml_extensions_renames_k8s_and_github_manifests() {
    let tmp = yaml_fixture();
    let out = bin()
        .current_dir(tmp.path())
        .args(["rename-yaml-extensions"])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(
        stdout(&out),
        "k8s/api.yml → k8s/api.yaml\nk8s/web.yml → k8s/web.yaml\n\
         .github/workflows/ci.yaml → .github/workflows/ci.yml\n"
    );
    assert!(tmp.path().join("k8s/web.yaml").exists());
    assert!(!tmp.path().join("k8s/web.yml").exists());
    assert!(tmp.path().join(".github/workflows/ci.yml").exists());
    // Поза правилами — недоторкані.
    assert!(tmp.path().join("docs/notes.yml").exists());
    assert!(tmp.path().join("k8s/keep.yaml").exists());
}

#[test]
fn rename_yaml_extensions_dry_run_prefixes_and_keeps_disk_intact() {
    let tmp = yaml_fixture();
    let out = bin()
        .args(["rename-yaml-extensions", "--dry-run"])
        .arg(format!("--root={}", tmp.path().display()))
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert!(stdout(&out).starts_with("[dry-run] k8s/api.yml → k8s/api.yaml\n"));
    assert!(tmp.path().join("k8s/web.yml").exists());
    assert!(!tmp.path().join("k8s/web.yaml").exists());
}

#[test]
fn rename_yaml_extensions_reports_empty_result_and_is_idempotent() {
    let tmp = yaml_fixture();
    assert!(bin()
        .current_dir(tmp.path())
        .args(["rename-yaml-extensions"])
        .output()
        .unwrap()
        .status
        .success());

    let out = bin()
        .current_dir(tmp.path())
        .args(["rename-yaml-extensions"])
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(
        stdout(&out),
        "Немає файлів для перейменування (k8s + .yml → .yaml; .github + .yaml → .yml).\n"
    );
}

#[test]
fn rename_yaml_extensions_fails_when_target_exists() {
    let tmp = TempDir::new().unwrap();
    std::fs::create_dir_all(tmp.path().join("k8s")).unwrap();
    std::fs::write(tmp.path().join("k8s/app.yml"), "a\n").unwrap();
    std::fs::write(tmp.path().join("k8s/app.yaml"), "b\n").unwrap();

    let out = bin()
        .current_dir(tmp.path())
        .args(["rename-yaml-extensions"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stdout(&out), "");
    assert_eq!(
        stderr(&out),
        "  ❌ k8s/app.yml → k8s/app.yaml: цільовий файл уже існує, пропущено\n"
    );
    // Обидва файли лишились на місці — конфлікт не мутує диск.
    assert_eq!(
        std::fs::read_to_string(tmp.path().join("k8s/app.yml")).unwrap(),
        "a\n"
    );
}

#[test]
fn rename_yaml_extensions_respects_config_ignore() {
    let tmp = yaml_fixture();
    std::fs::write(tmp.path().join(".n-rules.json"), r#"{"ignore":["k8s"]}"#).unwrap();
    let out = bin()
        .current_dir(tmp.path())
        .args(["rename-yaml-extensions"])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(
        stdout(&out),
        ".github/workflows/ci.yaml → .github/workflows/ci.yml\n"
    );
    assert!(tmp.path().join("k8s/web.yml").exists());
}

#[cfg(unix)]
#[test]
fn non_list_skill_subcommand_still_delegates() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = TempDir::new().unwrap();
    let stub = tmp.path().join("runtime.sh");
    std::fs::write(&stub, "#!/bin/sh\necho \"$@\"\nexit 7\n").unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    let out = bin()
        .current_dir(tmp.path())
        .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
        .env("N_RULES_JS_RUNTIME", &stub)
        .args(["skill", "pi", "taze"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(7));
    assert_eq!(stdout(&out), "/fake/n-rules.js skill pi taze\n");
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

/// Виконуваний shell-стаб замість bun/node: друкує argv, віддає stdin у
/// stdout і завершується заданим кодом. Дозволяє перевіряти делегацію
/// (включно з переграним stdin) без залежності від рантайму.
#[cfg(unix)]
fn runtime_stub(dir: &Path, exit_code: u8) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let stub = dir.join("runtime.sh");
    std::fs::write(
        &stub,
        format!("#!/bin/sh\necho \"$@\"\ncat\nexit {exit_code}\n"),
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
    stub
}

/// Запускає бінар із заданим stdin (`Command::output` дає stdin=null, чого
/// для hook-гілок замало).
fn run_with_stdin(mut command: Command, input: &[u8]) -> Output {
    use std::io::Write as _;

    let mut child = command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn hook_without_mode_flag_is_native_and_exits_one() {
    let tmp = TempDir::new().unwrap();
    let mut command = bin();
    command
        .current_dir(tmp.path())
        // Недосяжні і entrypoint, і runtime: якби гілка делегувалась, тут був
        // би зовсім інший stderr.
        .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
        .env("N_RULES_JS_RUNTIME", "definitely-not-a-runtime")
        .args(["hook"]);
    let out = run_with_stdin(command, b"");
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stdout(&out), "");
    assert_eq!(stderr(&out), "hook: потрібен --post-tool-use або --stop\n");
}

#[test]
fn hook_post_tool_use_without_paths_exits_zero_without_delegating() {
    let tmp = TempDir::new().unwrap();
    for payload in [
        &b""[..],
        "не json".as_bytes(),
        br#"{"tool_name":"Bash","tool_input":{"command":"ls"}}"#,
        br#"{"tool_name":"apply_patch","tool_input":{"command":"*** Delete File: g.rs\n"}}"#,
    ] {
        let mut command = bin();
        command
            .current_dir(tmp.path())
            .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
            .env("N_RULES_JS_RUNTIME", "definitely-not-a-runtime")
            .args(["hook", "--post-tool-use"]);
        let out = run_with_stdin(command, payload);
        let shown = String::from_utf8_lossy(payload);
        assert_eq!(out.status.code(), Some(0), "payload: {shown}");
        assert_eq!(stdout(&out), "", "payload: {shown}");
        assert_eq!(stderr(&out), "", "payload: {shown}");
    }
}

#[cfg(unix)]
#[test]
fn hook_post_tool_use_with_paths_delegates_argv_and_stdin() {
    let tmp = TempDir::new().unwrap();
    let stub = runtime_stub(tmp.path(), 2);
    let payload = br#"{"tool_name":"Edit","tool_input":{"file_path":"a.js"}}"#;

    let mut command = bin();
    command
        .current_dir(tmp.path())
        .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
        .env("N_RULES_JS_RUNTIME", &stub)
        .args(["hook", "--post-tool-use"]);
    let out = run_with_stdin(command, payload);

    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        stdout(&out),
        format!(
            "/fake/n-rules.js hook --post-tool-use\n{}",
            String::from_utf8_lossy(payload)
        )
    );
}

#[cfg(unix)]
#[test]
fn hook_stop_delegates_regardless_of_stdin() {
    let tmp = TempDir::new().unwrap();
    let stub = runtime_stub(tmp.path(), 0);

    let mut command = bin();
    command
        .current_dir(tmp.path())
        .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
        .env("N_RULES_JS_RUNTIME", &stub)
        .args(["hook", "--stop"]);
    // Payload без жодного шляху: для `--stop` він нічого не вирішує.
    let out = run_with_stdin(command, br#"{"tool_name":"Bash"}"#);

    assert_eq!(out.status.code(), Some(0));
    assert!(
        stdout(&out).starts_with("/fake/n-rules.js hook --stop\n"),
        "stdout: {}",
        stdout(&out)
    );
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
