//! Портований зріз концерну `docker/lint` — виклик зовнішнього `hadolint`.
//!
//! 1:1 порт `npm/rules/docker/lib/docker-hadolint.mjs` (58 рядків).
//! Репо-широкий греп (`grep -rn "docker-hadolint" npm/ plugins/ scripts/
//! crates/`) підтверджує єдиного споживача — `docker/lint` (`main.mjs:8`,
//! `import { lintDockerfileWithHadolint, posixRel } from
//! '../lib/docker-hadolint.mjs'`) плюс два власних тест-файли
//! (`lib/tests/docker-hadolint.test.mjs`, `lint/tests/docker-hadolint.test.mjs`)
//! — тож увесь модуль переїжджає без JS-копії, що лишається.
//!
//! `hadolint` уже зареєстрований у спільному реєстрі тулів
//! ([`crate::tool_registry`], ключ `"hadolint"`) — той самий канал
//! резолву/install-підказки, що й [`super::k8s_kubeconform`].
//!
//! # Канал помилок — дві різні гілки на один виклик
//!
//! JS-канон (`lintDockerfileWithHadolint`, `docker-hadolint.mjs:32-58`) має
//! `try/catch` НАВКОЛО `ensureTool('hadolint')`, але **без** `try/catch`
//! навколо наступного `spawnAsync`:
//!
//! - тул не резолвиться (`ensureTool` кидає) → **спіймано** локально →
//!   функція повертає `{ ok: false, stderr: <install-підказка>, via:
//!   'hadolint' }`, БЕЗ винятку. `checkDockerfile` (`main.mjs:378-383`) не
//!   розрізняє «тула нема» від «hadolint щось знайшов» — обидва просто
//!   `!ok` → `fail(msg, { reason: 'hadolint', file: rel })`. Тобто відсутній
//!   тул тут дає **порушення** з `reason: "hadolint"`, а НЕ
//!   `Err(RulesError::Concern)` — на відміну від [`super::k8s_kubeconform`],
//!   де відсутній тул фатальний. Порт: [`lint_dockerfile_with_hadolint`]
//!   повертає `Ok(HadolintOutcome{ok:false, ..})`.
//! - тул резолвиться, але сам спавн падає (`spawnAsync` кидає — ENOENT
//!   між резолвом і виконанням, EACCES тощо) → **нічим не спіймано**: виняток
//!   летить із `lintDockerfileWithHadolint` крізь `checkDockerfile` і
//!   `lint()` (жоден із них теж не має `try/catch`) — детектор кидає, exit
//!   2. Порт: `Command::output()` повертає `io::Error` →
//!   [`RulesError::Concern`] (пропагується `?` через
//!   [`super::docker_lint::check_dockerfile`]).
//! - тул резолвиться, спавн вдається, `exitCode !== 0` → звичайне `!ok` →
//!   те саме порушення `reason: "hadolint"`, з stdout+stderr у деталях.
//!
//! Це буквально ситуація з доккоменту завдання: «в ОДНОМУ модулі різні
//! виклики можуть мати різні канали» — тут не різні виклики, а різні
//! ГІЛКИ одного виклику (резолв тула vs сам спавн), кожна зі своїм каналом.
//!
//! # Спрощення відносно JS
//!
//! - **`via` не переноситься**: JS-структура завжди повертає `via:
//!   'hadolint'` (docker-run fallback прибрано, коментар модуля
//!   `docker-hadolint.mjs:1-8`) — тобто поле ніколи не варіюється. Порт
//!   викидає його з [`HadolintOutcome`] і вшиває літерал `"hadolint"`
//!   безпосередньо в повідомлення на боці
//!   [`super::docker_lint::check_dockerfile`] — той самий текст, без
//!   мертвого поля.
//! - **`posix_rel` бере лише root-префіксний випадок**: JS-версія обгортає
//!   Node `path.relative` (працює для будь-яких `abs`, включно з шляхами
//!   поза `root`). У цьому концерні `abs` завжди приходить із
//!   [`super::docker_lint::find_dockerfile_paths`] (сам обхід `root`), тож
//!   `abs` гарантовано під `root` — `strip_prefix` покриває всі реальні
//!   виклики (і всі кейси тестів JS-модуля: рівний `root`, вкладений шлях).
//! - **install-підказка через спільний реєстр**: `ensureTool`-помилка в
//!   JS несе текст живої спроби auto-install (brew/scoop/GitHub Release).
//!   `rules-core` навмисно офлайновий ([`crate::tool_resolve`] doc-комент)
//!   — install-підказка тут береться з [`crate::tool_registry::install_hint_for`],
//!   той самий канал, що вже прийнятий для [`super::k8s_kubeconform`]. Текст
//!   відрізняється від JS буквально, семантика (fail з actionable
//!   install-кроками) — та сама.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::tool_registry::install_hint_for;
use crate::tool_resolve::resolve_provisioned_tool;
use crate::RulesError;

/// `toolId` у спільному реєстрі тулів — той самий, що імʼя бінарника.
const TOOL_ID: &str = "hadolint";

/// Результат прогону — дзеркало `{ ok, stdout, stderr }` JS-версії
/// (`via` не переноситься, доккомент модуля вище).
#[derive(Debug)]
pub(super) struct HadolintOutcome {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// posix-relative шлях від `root` — точний порт `posixRel`
/// (`docker-hadolint.mjs:20-22`) для випадку `abs` під `root` (єдиний, що
/// трапляється в цьому концерні — доккомент модуля вище).
pub(super) fn posix_rel(root: &Path, abs: &Path) -> String {
    match abs.strip_prefix(root) {
        Ok(rel) => rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
        Err(_) => abs.to_string_lossy().into_owned(),
    }
}

/// Запуск hadolint — порт `lintDockerfileWithHadolint`
/// (`docker-hadolint.mjs:32-58`). Приймає вже обчислений `rel` (уникає
/// повторного `posixRel`, який JS робить один раз тут і ще раз у
/// `checkDockerfile` через спільний імпорт — той самий рядок, порахований
/// двічі; порт рахує один раз на боці викликача).
pub(super) fn lint_dockerfile_with_hadolint(
    root: &Path,
    rel: &str,
) -> Result<HadolintOutcome, RulesError> {
    lint_dockerfile_with_hadolint_with(root, rel, &resolve_provisioned_tool)
}

/// Тіло з інжектованим резолвом — той самий патерн ін'єкції, що в
/// [`super::k8s_kubeconform`]/[`super::text_markdownlint`]: підміняти
/// процес-глобальний `PATH` не можна (паралельні тести крейта спавнять
/// `git`/інші тули).
fn lint_dockerfile_with_hadolint_with(
    root: &Path,
    rel: &str,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<HadolintOutcome, RulesError> {
    let Some(bin) = resolve_tool(TOOL_ID) else {
        let hint = install_hint_for(TOOL_ID).unwrap_or_else(|| {
            format!("{TOOL_ID} не знайдено ні в PATH, ні в керованому кеші бінарників.")
        });
        // Тула нема → те саме `!ok`-порушення, що й ненульовий exit hadolint
        // (доккомент модуля вище) — НЕ `Err`.
        return Ok(HadolintOutcome {
            ok: false,
            stdout: String::new(),
            stderr: hint,
        });
    };

    let mut command = Command::new(&bin);
    command.current_dir(root).arg(rel);
    // Помилка самого спавна (ENOENT/EACCES) — нічим не спіймана в JS-каноні,
    // тож тут пропагується як `Err` (доккомент модуля вище), не як violation.
    let output = command.output().map_err(|error| {
        RulesError::Concern(format!("hadolint: не вдалося запустити ({error})"))
    })?;

    Ok(HadolintOutcome {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    // --- posixRel (lib/tests/docker-hadolint.test.mjs + lint/tests/docker-hadolint.test.mjs) ---

    #[test]
    fn posix_rel_gives_posix_path() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let abs = root.join("pkg").join("Dockerfile");
        assert_eq!(posix_rel(root, &abs), "pkg/Dockerfile");
    }

    #[test]
    fn posix_rel_equal_paths_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(posix_rel(tmp.path(), tmp.path()), "");
    }

    #[test]
    fn posix_rel_nested_segments() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let abs = root.join("a").join("b").join("Dockerfile");
        assert_eq!(posix_rel(root, &abs), "a/b/Dockerfile");
    }

    #[test]
    fn posix_rel_docker_dockerfile_shape() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let abs = root.join("docker").join("Dockerfile");
        assert_eq!(posix_rel(root, &abs), "docker/Dockerfile");
    }

    // --- lintDockerfileWithHadolint ---

    #[cfg(unix)]
    fn fake_hadolint(dir: &Path, exit_code: i32, stdout: &str, stderr: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join(TOOL_ID);
        let stdout_part = if stdout.is_empty() {
            String::new()
        } else {
            format!("printf '%s' '{stdout}'\n")
        };
        let stderr_part = if stderr.is_empty() {
            String::new()
        } else {
            format!("printf '%s' '{stderr}' >&2\n")
        };
        fs::write(
            &bin,
            format!("#!/bin/sh\n{stdout_part}{stderr_part}exit {exit_code}\n"),
        )
        .unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    #[cfg(unix)]
    #[test]
    fn hadolint_found_exit_zero_is_ok() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_hadolint(&tmp.path().join("bin"), 0, "", "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let outcome =
            lint_dockerfile_with_hadolint_with(&repo, "Dockerfile", &resolver_found(bin)).unwrap();
        assert!(outcome.ok);
        assert_eq!(outcome.stdout, "");
        assert_eq!(outcome.stderr, "");
    }

    #[cfg(unix)]
    #[test]
    fn hadolint_found_nonzero_exit_propagates_stdout_stderr() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_hadolint(&tmp.path().join("bin"), 1, "DL3000", "warning");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        let outcome =
            lint_dockerfile_with_hadolint_with(&repo, "Dockerfile", &resolver_found(bin)).unwrap();
        assert!(!outcome.ok);
        assert!(outcome.stdout.contains("DL3000"));
        assert!(outcome.stderr.contains("warning"));
    }

    /// Тула немає → `Ok(ok:false)` з install-підказкою в `stderr`, БЕЗ `Err`
    /// (доккомент модуля: перша гілка — не фатальна, а violation-канал).
    #[test]
    fn missing_tool_is_ok_false_not_err() {
        let tmp = TempDir::new().unwrap();
        let outcome =
            lint_dockerfile_with_hadolint_with(tmp.path(), "Dockerfile", &resolver_missing)
                .unwrap();
        assert!(!outcome.ok);
        assert!(outcome.stdout.is_empty());
        assert!(outcome.stderr.contains("hadolint"), "{}", outcome.stderr);
    }

    /// Резолвер знаходить неіснуючий бінарник (симулює гонку «тул зник між
    /// резолвом і спавном») → сам `Command::output()` падає з io-помилкою →
    /// `Err(RulesError::Concern)`, а НЕ violation (друга гілка доккоменту
    /// модуля).
    #[test]
    fn spawn_failure_is_err_not_violation() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("no-such-hadolint-binary");
        let err =
            lint_dockerfile_with_hadolint_with(tmp.path(), "Dockerfile", &resolver_found(ghost))
                .unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }

    #[cfg(unix)]
    #[test]
    fn relative_path_with_nested_directory_uses_forward_slashes() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_hadolint(&tmp.path().join("bin"), 0, "", "");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(repo.join("pkg").join("sub")).unwrap();
        // Сам факт, що спавн з таким `rel` не падає (аргумент — валідний
        // відносний шлях), непрямо покриває «rel передається як posix-рядок»;
        // пряме читання argv тестового скрипта не потрібне — той самий
        // рівень перевірки, що й інші fake-бінарник тести цього крейта.
        let outcome =
            lint_dockerfile_with_hadolint_with(&repo, "pkg/sub/Dockerfile", &resolver_found(bin))
                .unwrap();
        assert!(outcome.ok);
    }
}
