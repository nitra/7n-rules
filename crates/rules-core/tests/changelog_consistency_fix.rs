//! Інтеграційний набір native T0-фіксу `changelog/consistency` (хвиля T4,
//! клас exec-tool) — дзеркало сценаріїв `fix-consistency.mjs`.
//!
//! Вхід — ПУБЛІЧНИЙ диспетчер [`rules_core::concerns::run_concern_fix`], не
//! приватна функція фіксу: той самий продакшн-шлях, яким concern доходить
//! до Rust з JS (`loadT0Patterns` → `nativeFixPattern` → napi
//! `runNativeConcernFix` → `run_concern_fix`), і та сама вимога §2.47
//! реєстру, за якою парність доводиться через реальний канал.
//!
//! Git тут справжній (`git init` + один коміт у tempdir): опис change-файлу
//! бере `resolve_auto_change_message`, який спавнить `git log -1
//! --format=%s`. Без git-а в PATH тести чесно пропускаються.

use std::fs;
use std::process::Command;

use tempfile::TempDir;

use rules_core::concerns::{run_concern_fix, FileEdit, NATIVE_FIXES};
use rules_core::diagnostics::{Severity, Violation};

/// Точний текст, який будує `missing_change_file_message`
/// (`crates/rules-core/src/concerns/changelog_consistency_workspace.rs`) —
/// фіксер матчить саме його.
fn missing_change_violation(label: &str) -> Violation {
    Violation {
        reason: "changelog-consistency".to_string(),
        message: format!(
            "{label}: є релевантні зміни, але немає change-файлу (version у package.json не чіпай вручну)."
        ),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success())
}

/// Репо з рівно одним комітом і відомим subject-ом.
fn init_repo(dir: &std::path::Path, subject: &str) {
    let run = |args: &[&str]| {
        let status = Command::new("git")
            .current_dir(dir)
            .args(args)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?}");
    };
    run(&["init", "-q"]);
    run(&["config", "user.email", "t@example.com"]);
    run(&["config", "user.name", "t"]);
    fs::write(dir.join("README.md"), "x\n").expect("write");
    run(&["add", "."]);
    run(&["commit", "-qm", subject]);
}

/// Ключ фіксу зареєстрований — без цього `loadT0Patterns` ніколи не
/// побудує native-патерн і concern мовчки поїде на JS-канон.
#[test]
fn registry_contains_changelog_consistency() {
    assert!(NATIVE_FIXES.contains(&"changelog/consistency"));
}

/// Порушення без маркера «немає change-файлу» → порожній план (JS:
/// `test()` false).
#[test]
fn unrelated_violations_yield_empty_plan() {
    let tmp = TempDir::new().expect("tempdir");
    let unrelated = Violation {
        reason: "changelog-consistency".to_string(),
        message: "app: version у package.json не збігається з CHANGELOG".to_string(),
        file: None,
        severity: Severity::Error,
        data: None,
    };
    let plan = run_concern_fix("changelog/consistency", tmp.path(), &[unrelated]).expect("план");
    assert!(plan.edits.is_empty(), "{plan:?}");
    let empty = run_concern_fix("changelog/consistency", tmp.path(), &[]).expect("план");
    assert!(empty.edits.is_empty(), "{empty:?}");
}

/// `<root>` → `.changes/…` у корені; subject останнього коміту стає описом,
/// bump/section — `patch`/`Changed` (порт `CHANGE_BUMP`/`CHANGE_SECTION`).
#[test]
fn root_label_plans_change_file_with_commit_subject() {
    if !git_available() {
        eprintln!("changelog/consistency fix: пропуск — git відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    init_repo(tmp.path(), "feat: щось корисне");

    let plan = run_concern_fix(
        "changelog/consistency",
        tmp.path(),
        &[missing_change_violation("<root>")],
    )
    .expect("план");

    assert_eq!(plan.edits.len(), 1, "{plan:?}");
    let FileEdit::Write(write) = &plan.edits[0] else {
        panic!("очікували write: {plan:?}");
    };
    assert!(
        write.path.starts_with(".changes/") && write.path.ends_with(".md"),
        "{}",
        write.path
    );
    assert_eq!(
        write.content,
        "---\nbump: patch\nsection: Changed\n---\nfeat: щось корисне\n"
    );
}

/// Мітка воркспейсу (не `<root>`) → шлях із префіксом воркспейсу; кілька
/// порушень одного воркспейсу дедуплікуються в ОДИН edit (JS: `new Set`).
#[test]
fn workspace_labels_are_deduplicated_and_prefixed() {
    if !git_available() {
        eprintln!("changelog/consistency fix: пропуск — git відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    init_repo(tmp.path(), "chore: оновлення");

    let plan = run_concern_fix(
        "changelog/consistency",
        tmp.path(),
        &[
            missing_change_violation("npm"),
            missing_change_violation("npm"),
            missing_change_violation("<root>"),
        ],
    )
    .expect("план");

    let paths: Vec<&str> = plan
        .edits
        .iter()
        .map(|e| match e {
            FileEdit::Write(w) => w.path.as_str(),
            FileEdit::Delete { path } => path.as_str(),
        })
        .collect();
    assert_eq!(paths.len(), 2, "{plan:?}");
    assert!(paths[0].starts_with("npm/.changes/"), "{paths:?}");
    assert!(paths[1].starts_with(".changes/"), "{paths:?}");
}

/// Колізія імені за ту саму хвилину → суфікс `-2` (порт create-only циклу
/// `writeChange`).
#[test]
fn existing_change_file_for_same_minute_gets_numeric_suffix() {
    if !git_available() {
        eprintln!("changelog/consistency fix: пропуск — git відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    init_repo(tmp.path(), "fix: колізія");

    let first = run_concern_fix(
        "changelog/consistency",
        tmp.path(),
        &[missing_change_violation("<root>")],
    )
    .expect("план");
    let FileEdit::Write(write) = &first.edits[0] else {
        panic!("очікували write");
    };
    let occupied = tmp.path().join(&write.path);
    fs::create_dir_all(occupied.parent().expect("батько")).expect("mkdir");
    fs::write(&occupied, "зайнято\n").expect("write");

    let second = run_concern_fix(
        "changelog/consistency",
        tmp.path(),
        &[missing_change_violation("<root>")],
    )
    .expect("план");
    let FileEdit::Write(next) = &second.edits[0] else {
        panic!("очікували write");
    };
    assert_ne!(next.path, write.path, "ім'я має відрізнятись");
    assert!(next.path.ends_with("-2.md"), "{}", next.path);
}

/// Полагоджений дефект канону №1: маркер є, але мітку витягти не вдалось —
/// JS мовчки повертав `{ touchedFiles: [] }`, native кидає гучну помилку.
#[test]
fn unparsable_label_is_loud_error_not_silent_noop() {
    let tmp = TempDir::new().expect("tempdir");
    let malformed = Violation {
        reason: "changelog-consistency".to_string(),
        // Пробіл усередині «мітки» — `^(\S+):` не матчиться.
        message: "два слова: є релевантні зміни, але немає change-файлу".to_string(),
        file: None,
        severity: Severity::Error,
        data: None,
    };
    let error = run_concern_fix("changelog/consistency", tmp.path(), &[malformed])
        .expect_err("мовчазний skip — вада");
    let text = error.to_string();
    assert!(text.contains("мітку воркспейсу"), "{text}");
}

/// Полагоджений дефект канону №2: коміт із ПОРОЖНІМ subject-ом. JS-фіксер
/// (`autoChangeMessage`) тут мовчки писав літерал «оновлення»; канонічний
/// `resolve_auto_change_message` детектора йде далі по ланцюжку і бере ім'я
/// гілки. Native-фікс кличе саме канонічну версію — дві реалізації одного
/// concern-а більше не розходяться.
#[test]
fn empty_commit_subject_falls_back_to_branch_name_not_literal() {
    if !git_available() {
        eprintln!("changelog/consistency fix: пропуск — git відсутній у PATH");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    let run = |args: &[&str]| {
        let status = Command::new("git")
            .current_dir(tmp.path())
            .args(args)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?}");
    };
    run(&["init", "-q", "-b", "feature-gilka"]);
    run(&["config", "user.email", "t@example.com"]);
    run(&["config", "user.name", "t"]);
    fs::write(tmp.path().join("README.md"), "x\n").expect("write");
    run(&["add", "."]);
    run(&["commit", "-q", "--allow-empty-message", "-m", ""]);

    let plan = run_concern_fix(
        "changelog/consistency",
        tmp.path(),
        &[missing_change_violation("<root>")],
    )
    .expect("план");
    let FileEdit::Write(write) = &plan.edits[0] else {
        panic!("очікували write");
    };
    assert!(
        write.content.contains("feature-gilka"),
        "опис має бути іменем гілки, не літералом «оновлення»: {}",
        write.content
    );
}
