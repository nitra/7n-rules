//! Native-порт `rego/conftest_verify` (`npm/rules/rego/conftest_verify/main.mjs`,
//! 57 рядків) — read-only `conftest verify` над `npm/rules`: запускає
//! rego-юніт-тести, оголошені поряд із самими полісі (`rego.mdc`).
//! Концерн перейменований зі старого bundled `rego/check`
//! (`docs/specs/2026-07-02-text-check-per-file-split-design.md` §5-A).
//!
//! `full`, без `lint.glob` (`concern.json#lint.scope`) — `verify` виконує
//! rego-тести, які часто крос-package (`import data.<pkg>`), тож коректний
//! лише на всьому `npm/rules`; у делта-план не входить, спрацьовує лише
//! через `n-rules lint --full` чи scoped `n-rules lint rego`.
//!
//! # Тул відсутній → мовчазний skip, не fail-closed і не diagnostic
//!
//! На відміну від сусіда [`super::rego_opa_check`] (той кличе `ensureTool`
//! і падає fail-closed), цей канон резолвить `conftest` через голий
//! `resolveCmd` (лише `PATH`, без керованого кешу `tools ensure`) і, якщо
//! бінарника немає, повертає результат БЕЗ жодної violation чи diagnostic-
//! ноти — буквально коментар канону:
//!
//! ```text
//! const conftest = resolveCmd('conftest')
//! if (!conftest) return reporter.result() // conftest відсутній → пропускаємо verify (старий код повертав 0)
//! ```
//!
//! Це свідомо **інший** канал, ніж «`resolveCmd` + `diagnostics: info`»
//! (еталон [`super::security_scan`]): той канон сам конструює інформаційну
//! ноту в тілі `lint()`, а цей — ні. Вигадувати ноту, якої немає в JS,
//! означало б розширювати контракт результату понад те, що видає канон.
//! Тому native-порт мовчить так само: [`rego_conftest_verify`] повертає
//! голий `Vec<Violation>` — без `Result`, бо жодна гілка канону не кидає
//! (навіть збій самого спавна `conftest` ловиться в `runStep`-еквіваленті й
//! перетворюється на звичайну violation, а не на виняток, що вилітає з
//! `lint()`).
//!
//! # Чому не перевикористовує `crate::conftest::run_conftest_batch*`
//!
//! [`crate::conftest`] — обгортка над `conftest test --output json` для
//! per-file rego-концернів кластера `k8s` (один спавн на пару
//! `(policyDir, namespace)`, парсинг JSON-масиву `failures`). `conftest
//! verify` — інша підкоманда з іншим контрактом: без вхідних файлів, без
//! `--output json`, без `--namespace`, кілька `-p <dir>` за раз, а вивід —
//! сирий текст на stdout+stderr, що йде у повідомлення як є. Підлаштування
//! спільного хелпера під це додало б розгалуження заради єдиного
//! споживача — той самий мотив, яким `crate::conftest` пояснює, чому
//! `--combine` (`extraArgs`) не портується взагалі.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::tool_resolve::resolve_cmd;

/// `toolId`/імʼя бінарника — той самий `conftest`, що й [`crate::conftest`].
const TOOL_ID: &str = "conftest";

/// Каталоги, по яких `conftest verify` шукає `*_test.rego` — порт
/// `LINT_TARGETS` (`main.mjs:14`). Масив, а не одинична константа: форма
/// канону розрахована на розширення списком, навіть якщо сьогодні в ньому
/// один елемент.
const LINT_TARGETS: &[&str] = &["npm/rules"];

/// Максимум символів обʼєднаного stdout+stderr успішного прогону, що йдуть
/// у повідомлення violation-а — порт `.slice(0, 2000)` (`main.mjs:29`).
const MAX_OUTPUT_CHARS: usize = 2000;

/// Стабільний machine code — другий аргумент `fail(...)` (`main.mjs:54`).
const REASON: &str = "conftest-verify-violation";

/// Наявні цілі — порт `LINT_TARGETS.filter(rel => existsSync(resolve(root, rel)))`
/// (`main.mjs:41`). Повертає самі відносні рядки з [`LINT_TARGETS`]
/// (`Array.filter` не трансформує елементи), не абсолютні шляхи: вони йдуть
/// у `-p` як є, бо `conftest` спавниться з `cwd = root`.
fn resolve_targets(root: &Path) -> Vec<&'static str> {
    LINT_TARGETS
        .iter()
        .copied()
        .filter(|target| root.join(target).exists())
        .collect()
}

/// Аргументи `conftest verify` — порт `['verify', ...targets.flatMap(t => ['-p', t])]`
/// (`main.mjs:46`).
fn conftest_verify_args(targets: &[&str]) -> Vec<String> {
    let mut args = vec!["verify".to_string()];
    for target in targets {
        args.push("-p".to_string());
        args.push((*target).to_string());
    }
    args
}

/// Запускає `conftest verify <targets>` у `cwd` — порт `runStep`
/// (`main.mjs:20-31`) звужений до потреб цього концерну. Повертає exit-код
/// і супровідний текст:
///
/// - успішний спавн → `stdout+stderr`, обрізаний `trim().slice(0, 2000)`
///   (`main.mjs:29`);
/// - спавн не вдався (гонка «резолв-потім-виклик» чи інша I/O-помилка) —
///   текст помилки БЕЗ обрізання, точно як `catch`-гілка `runStep`
///   (`main.mjs:24-26`), яка формує `output` окремо від успішного шляху.
fn run_conftest_verify(bin: &Path, cwd: &Path, targets: &[&str]) -> (i32, String) {
    let mut command = Command::new(bin);
    command
        .current_dir(cwd)
        .args(conftest_verify_args(targets))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match command.output() {
        Ok(output) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            let clipped: String = combined.trim().chars().take(MAX_OUTPUT_CHARS).collect();
            (output.status.code().unwrap_or(1), clipped)
        }
        Err(error) => (
            1,
            format!("Не вдалося запустити {}: {error}", bin.display()),
        ),
    }
}

/// Violation одного невдалого прогону — порт хвоста `lint(ctx)`
/// (`main.mjs:52-55`): один `fail()` на весь прогін `verify`, не по файлу
/// (сам `conftest verify` агрегує помилки всіх переданих полісі-каталогів у
/// своєму виводі).
fn violation(status: i32, output: &str) -> Violation {
    let suffix = if output.is_empty() {
        String::new()
    } else {
        format!("\n{output}")
    };
    Violation {
        reason: REASON.to_string(),
        message: format!("lint-rego: conftest verify — помилка (код {status}){suffix}"),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `rego/conftest_verify` — порт `lint(ctx)` (`main.mjs:33-56`).
pub fn rego_conftest_verify(cwd: &Path) -> ConcernReport {
    rego_conftest_verify_with(cwd, &resolve_cmd)
}

/// Тіло [`rego_conftest_verify`] з інжектованим резолвом бінарника — та сама
/// інжекція, що в `concerns::k8s_kubeconform`/`concerns::rego_opa_check`:
/// підміняти процес-глобальний `PATH` не можна, бо в тому самому
/// тест-процесі паралельно біжать тести, що спавнять `git`.
fn rego_conftest_verify_with(
    cwd: &Path,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> ConcernReport {
    let targets = resolve_targets(cwd);
    // Порожні цілі — «нема rego-дерева» (напр. tmp-каталог у тестах), не
    // «тул недоступний»: JS-версія (`main.mjs:42`) виходить тут ДО будь-якого
    // резолву `conftest`.
    if targets.is_empty() {
        return ConcernReport::default();
    }

    let Some(conftest) = resolve_tool(TOOL_ID) else {
        // Канон тут МОВЧИТЬ (`main.mjs:45`), і власний коментар видає чому:
        // «старий код повертав 0» — інерція сумісності, не рішення. Порт
        // додає ноту: перевірка, яка зникає на ефемерному раннері й ніде
        // цього не показує, — це той самий fail-open, проти якого написано
        // §5.3 реєстру. Нота нічого не послаблює, лише робить пропуск видним.
        return ConcernReport {
            violations: Vec::new(),
            diagnostics: vec![ConcernDiagnostic::info(format!(
                "rego/conftest_verify: `{TOOL_ID}` не знайдено в PATH — перевірку пропущено"
            ))],
        };
    };

    let (status, output) = run_conftest_verify(&conftest, cwd, &targets);
    if status == 0 {
        return ConcernReport::default();
    }
    ConcernReport::from(vec![violation(status, &output)])
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Резолвер, що не знаходить нічого (тул «не встановлено»).
    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    /// Кладе виконуваний стаб `conftest`, що виходить з `exit_code` і друкує
    /// `stdout`/`stderr`.
    #[cfg(unix)]
    fn fake_conftest(dir: &Path, exit_code: i32, stdout: &str, stderr: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join(TOOL_ID);
        fs::write(
            &bin,
            format!(
                "#!/bin/sh\nprintf '%s' '{stdout}'\nprintf '%s' '{stderr}' 1>&2\nexit {exit_code}\n"
            ),
        )
        .unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    #[cfg(unix)]
    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    /// Без `npm/rules` у дереві — 0 targets, 0 violations, БЕЗ спавна
    /// (резолвер «нічого не знаходить» доводить, що до нього не дійшло).
    #[test]
    fn no_rules_root_skips_without_tool_resolution() {
        let tmp = TempDir::new().unwrap();
        assert!(rego_conftest_verify_with(tmp.path(), &resolver_missing)
            .violations
            .is_empty());
    }

    /// `npm/rules` існує, але `conftest` не резолвиться → мовчазний skip
    /// (0 violations), а НЕ fail-closed помилка — на відміну від
    /// `rego/opa_check`/`k8s/kubeconform`, які тут падали б.
    #[test]
    fn missing_tool_is_silent_skip_not_error() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        assert!(rego_conftest_verify_with(tmp.path(), &resolver_missing)
            .violations
            .is_empty());
    }

    /// `resolve_targets` фільтрує за реальним існуванням каталогу, а не
    /// повертає весь `LINT_TARGETS` безумовно.
    #[test]
    fn resolve_targets_filters_by_existence() {
        let tmp = TempDir::new().unwrap();
        assert!(resolve_targets(tmp.path()).is_empty());
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        assert_eq!(resolve_targets(tmp.path()), vec!["npm/rules"]);
    }

    /// Аргументи — рядок-у-рядок за JS-каноном: `verify` перед усіма `-p`.
    #[test]
    fn args_match_js_canon_layout() {
        assert_eq!(
            conftest_verify_args(&["npm/rules"]),
            vec!["verify", "-p", "npm/rules"]
        );
    }

    /// Успішний прогін (`exit 0`) → 0 violations.
    #[cfg(unix)]
    #[test]
    fn clean_verify_run_yields_no_violations() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let bin = fake_conftest(&tmp.path().join("bin"), 0, "", "");
        assert!(rego_conftest_verify_with(tmp.path(), &resolver_found(bin))
            .violations
            .is_empty());
    }

    /// Ненульовий exit → одна violation з reason `conftest-verify-violation`
    /// і виводом тула в повідомленні.
    #[cfg(unix)]
    #[test]
    fn failing_verify_yields_single_violation_with_output() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let bin = fake_conftest(&tmp.path().join("bin"), 1, "FAIL: пакет x\n", "");
        let violations = rego_conftest_verify_with(tmp.path(), &resolver_found(bin));
        assert_eq!(violations.violations.len(), 1);
        assert_eq!(violations.violations[0].reason, "conftest-verify-violation");
        assert!(
            violations.violations[0].message.contains("код 1"),
            "{}",
            violations.violations[0].message
        );
        assert!(
            violations.violations[0].message.contains("FAIL: пакет x"),
            "{}",
            violations.violations[0].message
        );
        assert!(violations.violations[0].file.is_none());
        assert_eq!(violations.violations[0].severity, Severity::Error);
    }

    /// Порожній вивід при ненульовому exit → повідомлення без суфікса
    /// (`verifySuffix` лишається порожнім, як і в JS-версії).
    #[cfg(unix)]
    #[test]
    fn failing_verify_with_empty_output_has_no_suffix() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let bin = fake_conftest(&tmp.path().join("bin"), 2, "", "");
        let violations = rego_conftest_verify_with(tmp.path(), &resolver_found(bin));
        assert_eq!(
            violations.violations[0].message,
            "lint-rego: conftest verify — помилка (код 2)"
        );
    }

    /// Вивід, довший за ліміт, обрізається до [`MAX_OUTPUT_CHARS`] символів —
    /// порт `.slice(0, 2000)`.
    #[cfg(unix)]
    #[test]
    fn long_output_is_truncated_to_limit() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let long = "x".repeat(MAX_OUTPUT_CHARS + 500);
        let bin = fake_conftest(&tmp.path().join("bin"), 1, &long, "");
        let violations = rego_conftest_verify_with(tmp.path(), &resolver_found(bin));
        let tail = violations.violations[0]
            .message
            .split_once('\n')
            .map(|(_, t)| t)
            .unwrap_or("");
        assert_eq!(tail.chars().count(), MAX_OUTPUT_CHARS);
    }

    /// Бінарник зник із диска між резолвом і спавном (гонка
    /// «перевірка-потім-використання») → `Command::output()` дає I/O-помилку,
    /// яка мапиться в звичайну violation з текстом помилки (не в паніку і не
    /// в мовчазний `Ok` без результату) — та сама поведінка, що `catch` у
    /// `runStep` JS-канону.
    #[test]
    fn vanished_binary_yields_violation_with_error_text() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("npm/rules")).unwrap();
        let ghost = tmp.path().join("nowhere").join(TOOL_ID);
        let violations = rego_conftest_verify_with(tmp.path(), &resolver_found(ghost));
        assert_eq!(violations.violations.len(), 1);
        assert!(
            violations.violations[0]
                .message
                .contains("Не вдалося запустити"),
            "{}",
            violations.violations[0].message
        );
    }
}
