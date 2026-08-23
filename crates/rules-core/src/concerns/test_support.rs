//! Спільні тест-хелпери concern-модулів.
//!
//! До цього модуля кожен `#[cfg(test)] mod tests` мав власну байт-у-байт копію
//! `fn write(&TempDir, rel, content)`. 28 копій однакової преамбули давали
//! jscpd-клони ≥25 рядків між парами concern-файлів (гейт `Lint repo-wide`,
//! `js/jscpd_duplicates`) — клон був не «випадковою схожістю», а реальним
//! копіюванням хелпера, тож правильна відповідь — одне джерело, а не виняток
//! у `.jscpd.json`.
//!
//! Модуль компілюється лише під `cfg(test)` — у звичайній збірці його немає.

use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

/// Пише `content` у `tmp/rel`, створюючи проміжні каталоги. Panic-on-error —
/// це тест-хелпер: збій підготовки fixture має валити тест голосно.
pub(crate) fn write(tmp: &TempDir, rel: &str, content: &str) {
    let path = tmp.path().join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

/// Запускає `git` у `dir`, панікує при non-zero exit — setup-хелпер тестів
/// git-орієнтованих concern-ів (`changelog_consistency*`) має бути «тихим» і
/// надійним, помилки тут завжди баг тесту, не кейс під перевірку.
pub(crate) fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
    assert!(status.success(), "git {args:?} failed у {}", dir.display());
}

/// Порожній репо з ізольованою identity (без залежності від глобального
/// git-config середовища CI/локальної машини) + фіксована Git policy
/// (`.n-rules.json`: `baseBranch: "dev"`, `releaseBranches: ["main"]`) —
/// точний відповідник тестового хелпера `git()` у JS-каноні
/// (`npm/rules/changelog/consistency/tests/check.test.mjs:130-137`), який
/// ЗАВЖДИ дописує цей конфіг після `git init`, НЕЗАЛЕЖНО від того, яку
/// назву гілки передали `--initial-branch`/`-b` — обидва навмисно
/// незалежні: частина сценаріїв ініціалізує репо прямо на `main`, лишаючи
/// `dev` неіснуючим рефом (перевіряє fallback-логіку
/// `resolveChangelogComparisonPoint`).
pub(crate) fn init_repo(dir: &Path, branch: &str) {
    git(
        dir,
        &["init", "--quiet", &format!("--initial-branch={branch}")],
    );
    git(dir, &["config", "user.name", "rules-core-test"]);
    git(dir, &["config", "user.email", "rules-core-test@localhost"]);
    write_n_rules_git_policy(dir);
}

/// Пише `.n-rules.json` з фіксованою Git policy (`baseBranch: "dev"`,
/// `releaseBranches: ["main"]`) — той самий вміст, що дописує JS-тестовий
/// хелпер `git()` після кожного `init` (доккомент [`init_repo`]).
fn write_n_rules_git_policy(dir: &Path) {
    fs::write(
        dir.join(".n-rules.json"),
        r#"{"git":{"baseBranch":"dev","releaseBranches":["main"]}}"#,
    )
    .unwrap();
}

/// Комітить усі зміни в `dir` з фіксованим повідомленням.
pub(crate) fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "--quiet", "-m", message]);
}
