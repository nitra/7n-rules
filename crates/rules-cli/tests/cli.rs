//! cspell:ignore одруківка runn
//!
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

/// Власна поверхня бінаря — fail-closed, і тепер із кодом `2` (той самий, що
/// вже був у `tools`, і що дає `clap` за замовчуванням).
#[test]
fn changed_files_rejects_unknown_argument() {
    let out = bin().args(["changed-files", "--unknown"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(
        stderr(&out).contains("невідомий аргумент"),
        "{}",
        stderr(&out)
    );
}

/// Уніфікована граматика: значення можна давати і через пробіл, і через `=`.
/// Раніше `changed-files` розумів лише першу форму, `rename-yaml-extensions` —
/// лише другу.
#[test]
fn value_flags_accept_both_forms() {
    let tmp = init_repo();
    std::fs::write(tmp.path().join("a.txt"), "змінено\n").unwrap();
    let spaced = bin()
        .args(["changed-files", "--cwd"])
        .arg(tmp.path())
        .output()
        .unwrap();
    let joined = bin()
        .arg("changed-files")
        .arg(format!("--cwd={}", tmp.path().display()))
        .output()
        .unwrap();
    assert!(spaced.status.success(), "stderr: {}", stderr(&spaced));
    assert!(joined.status.success(), "stderr: {}", stderr(&joined));
    assert_eq!(stdout(&spaced), "a.txt\n");
    assert_eq!(stdout(&joined), stdout(&spaced));
}

/// Прапорець без значення більше не читається як «значення відсутнє».
#[test]
fn value_flag_without_value_is_a_usage_error() {
    let out = bin().args(["changed-files", "--base"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("бракує значення"), "{}", stderr(&out));
}

/// Довідка команд, чию поверхню тримає сам бінар, — згенерована `clap`, з
/// українськими заголовками (раніше `--help` там не існувало взагалі).
#[test]
fn owned_commands_have_generated_ukrainian_help() {
    for args in [
        vec!["changed-files", "--help"],
        vec!["rename-yaml-extensions", "-h"],
        vec!["tools", "ensure", "--help"],
    ] {
        let label = args.join(" ");
        let out = bin().args(&args).output().unwrap();
        assert!(out.status.success(), "{label}: {}", stderr(&out));
        assert!(stdout(&out).contains("Використання: n-rules"), "{label}");
    }
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

/// `skill <id>` друкує зібраний промпт і не кличе жодної моделі.
#[test]
fn skill_prompt_branch_is_native_and_llm_free() {
    let package = fake_package(&["lint"]);
    let out = bin()
        .env("N_RULES_JS_ENTRY", fake_entry(&package))
        .args(["skill", "n-lint", "прибери", "борг"])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    let text = stdout(&out);
    // Задача склеюється з решти argv, префікс `n-` знімається.
    assert!(text.starts_with("# Task\n\nприбери борг\n\n# Skill\n"));
    assert!(text.contains("# Current project"));
}

/// Невідомий скіл називає наявні — те саме повідомлення, що й у JS.
#[test]
fn skill_prompt_branch_names_available_skills_on_typo() {
    let package = fake_package(&["lint", "taze"]);
    let out = bin()
        .env("N_RULES_JS_ENTRY", fake_entry(&package))
        .args(["skill", "no-such-skill"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(
        stderr(&out).contains("Unknown skill \"no-such-skill\". Available skills: lint, taze"),
        "stderr: {}",
        stderr(&out)
    );
}

/// Скіли з власним JS-оркестратором лишаються делегованими: їхній прогін —
/// конвеєр кроків, а не один агентний хід, і підміна мовчки з'їла б кроки.
#[test]
fn orchestrated_skills_still_delegate_to_js() {
    let package = fake_package(&["taze", "git-reconcile"]);
    for skill in ["taze", "git-reconcile"] {
        let out = bin()
            .env("N_RULES_JS_ENTRY", fake_entry(&package))
            .args(["skill", "pi", skill])
            .output()
            .unwrap();
        // Делегація йде у неіснуючий фейковий entrypoint — важливий сам факт
        // спроби (native-шлях не друкував би нічого про node/модуль).
        assert!(
            !out.status.success(),
            "{skill}: очікували делегацію, а не native-шлях"
        );
        assert!(
            !stderr(&out).contains("невідомий раннер"),
            "{skill}: native-раннер не мав братися за оркестрований скіл"
        );
    }
}

/// Deprecated раннер `claude` Rust не моделює — він теж делегується.
#[test]
fn claude_runner_still_delegates_to_js() {
    let package = fake_package(&["lint"]);
    let out = bin()
        .env("N_RULES_JS_ENTRY", fake_entry(&package))
        .args(["skill", "claude", "lint"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(!stderr(&out).contains("невідомий раннер"));
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

/// Найважливіша зміна поведінки цієї команди: JS-двійник мовчки ковтав
/// невідомий аргумент, тобто одруківка в прапорці ТИХО запускала мутацію
/// дерева. Тепер це usage-помилка, і диск лишається недоторканим.
#[test]
fn rename_yaml_extensions_rejects_unknown_argument_without_touching_disk() {
    let tmp = yaml_fixture();
    let out = bin()
        .current_dir(tmp.path())
        .args(["rename-yaml-extensions", "--dry-runn"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(
        stderr(&out).contains("невідомий аргумент"),
        "{}",
        stderr(&out)
    );
    assert!(tmp.path().join("k8s/web.yml").exists());
}

/// А `--root` тепер приймається і через пробіл — форма, якої в JS не було.
#[test]
fn rename_yaml_extensions_accepts_spaced_root() {
    let tmp = yaml_fixture();
    let out = bin()
        .args(["rename-yaml-extensions", "--dry-run", "--root"])
        .arg(tmp.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert!(stdout(&out).starts_with("[dry-run] k8s/api.yml → k8s/api.yaml\n"));
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

/// Оркестрований скіл їде в JS із незміненим argv і його exit-кодом.
///
/// Раніше цей тест звався «будь-яка не-`list` підкоманда делегується» — межа
/// зсунулась: тепер делегуються рівно оркестровані скіли й `claude`, а
/// звичайні раннери йдуть нативним ACP-шляхом.
#[cfg(unix)]
#[test]
fn orchestrated_skill_delegates_argv_and_exit_code() {
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

// Позитивної перевірки «звичайний скіл під раннером іде нативно» тут НЕМАЄ
// свідомо: цей шлях спавнить справжнього ACP-агента, і процесний тест на
// нього означав би живий агент у тестовому наборі — з мережею, підпискою і
// довільними діями в робочій теці. Спроба такого тесту це й довела: агент
// піднявся, побачив у теці стаб-скрипт і ВИКОНАВ його.
//
// Рішення роутера (яка гілка native, яка делегується) перевіряється
// детерміновано юніт-тестами `skill_runner_is_native`/`skill_prompt_is_native`
// у `main.rs`, а делегаційний бік — тестами вище.

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

/// Поверхні, які фаза 8 свідомо лишає в JS (інвентаризація — реєстр
/// відкладених питань, §3.5): `release`, `docs`, `taze` і дефолтний sync
/// без підкоманди. (`adr-normalize-local` цю групу ПОКИНУВ — конвеєр
/// портовано в `crates/rules-adr`, команда нативна.) Native-гілки в решти
/// немає й не планується, тож єдиний контракт бінаря щодо них — довезти
/// argv незміненим і повернути exit-код. Саме це й ламається мовчки, якщо
/// граматика [`crate::cli`] колись почне їх «розуміти» — тому воно
/// закріплене тут.
#[cfg(unix)]
#[test]
fn commands_kept_in_js_delegate_argv_verbatim() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = TempDir::new().unwrap();
    let stub = tmp.path().join("runtime.sh");
    std::fs::write(&stub, "#!/bin/sh\necho \"$@\"\nexit 17\n").unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    for args in [
        // Дефолтний sync: порожній argv — теж делегація, а не usage-помилка.
        vec![],
        vec!["release"],
        vec!["docs", "domains"],
        vec!["docs", "build", "--domain", "npm-rules", "--publish"],
        vec!["taze", "diff", "--backup-suffix", ".taze-bak"],
    ] {
        let label = args.join(" ");
        let out = bin()
            .current_dir(tmp.path())
            .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
            .env("N_RULES_JS_RUNTIME", &stub)
            .args(&args)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(17), "«{label}»");
        let expected: String = std::iter::once("/fake/n-rules.js")
            .chain(args.iter().copied())
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(stdout(&out), format!("{expected}\n"), "«{label}»");
    }
}

/// Найважливіша гарантія розділення політик: на поверхні, яку бінар ЩЕ
/// ділить із JS-CLI, невідомий прапорець не стає помилкою — інакше argv, який
/// JS розуміє, не доїхав би до виконавця.
#[cfg(unix)]
#[test]
fn unknown_flag_on_a_shared_surface_still_reaches_the_js_entrypoint() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = TempDir::new().unwrap();
    let stub = tmp.path().join("runtime.sh");
    std::fs::write(&stub, "#!/bin/sh\necho \"$@\"\nexit 3\n").unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    for args in [
        vec!["lint", "--no-fix", "--майбутній-прапорець"],
        vec!["ci", "plan", "--майбутній-прапорець"],
    ] {
        let label = args.join(" ");
        let out = bin()
            .current_dir(tmp.path())
            .env("N_RULES_JS_ENTRY", "/fake/n-rules.js")
            .env("N_RULES_JS_RUNTIME", &stub)
            .args(&args)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(3), "{label}");
        assert_eq!(
            stdout(&out),
            format!("/fake/n-rules.js {label}\n"),
            "{label}"
        );
    }
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

/// E2E: ACP-сесія реально доходить до відповіді (opt-in, `N_RULES_E2E_ACP=1`).
///
/// Поза прапорцем тест мовчки пропускається: він піднімає СПРАВЖНЬОГО агента
/// — мережа, підписка, чужий процес. У звичайному `cargo test` таким місце
/// не тут (реєстр відкритих питань, §6.3).
///
/// Три умови роблять його безпечним, і кожна — наслідок реального інциденту.
/// Робоча тека — порожній tempdir: агент бачить її вміст, і в одній зі спроб
/// виконав знайдений там стаб-скрипт. Скіл-проба нічого не просить робити з
/// ФС. Раннер — `codex`: він авторизований підпискою, тож ключ у середовищі
/// не потрібен.
#[test]
fn acp_session_reaches_a_reply_end_to_end() {
    if std::env::var_os("N_RULES_E2E_ACP").is_none() {
        return;
    }

    let package = TempDir::new().unwrap();
    let skill_dir = package.path().join("skills").join("probe");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "# Проба\n\nВідповідай рівно одним словом: OK.\n\
         Не читай файлів, не запускай команд, нічого не створюй і не змінюй.\n",
    )
    .unwrap();
    std::fs::write(skill_dir.join("main.json"), r#"{"tier":"min"}"#).unwrap();
    std::fs::create_dir_all(package.path().join("bin")).unwrap();
    std::fs::write(package.path().join("bin").join("n-rules.js"), "// stub\n").unwrap();

    let work = TempDir::new().unwrap();
    let out = bin()
        .current_dir(work.path())
        .env("N_RULES_JS_ENTRY", package.path().join("bin/n-rules.js"))
        .args(["skill", "codex", "probe"])
        .output()
        .unwrap();

    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert!(
        stdout(&out).contains("OK"),
        "агент мав відповісти; stdout: {}",
        stdout(&out)
    );
    // Проба не просила нічого писати — тека має лишитись порожньою.
    assert_eq!(
        std::fs::read_dir(work.path()).unwrap().count(),
        0,
        "агент не мав нічого створювати в робочій теці"
    );
}
