//! Test-gate — сестринський тест як частина верифікації (spec addendum
//! 2026-07-24, ladder-collateral-in-file). Rust-порт
//! `npm/scripts/lib/lint-surface/test-gate.mjs` (виклик у `run-fix.mjs`,
//! функція `detectBrokenTest`), спека `2026-08-08-llm-lib-acp-only-rust-goose.md`
//! §3.7 — оркестрація поза LLM.
//!
//! [`collateral`](super::collateral) детектує колатеральні правки лише ПОЗА
//! target-set (інші файли) — правки ВСЕРЕДИНІ вже-таргетованого файлу (напр.
//! видалення навмисного, задокументованого workaround поряд із фіксованим
//! порушенням) нею не покриваються, а canonical re-detect бачить лише той
//! самий детектор/те саме порушення, тож теж не ловить. Test-gate — легша
//! альтернатива hunk-level diff: якщо рунг торкнувся файлу з target-set, для
//! якого існує сестринський тест-файл за конвенцією
//! `<dir>/tests/<stem>.test.{mjs,js,ts}` (n-test.mdc), той тест виконується
//! як частина verify. Провал тесту → veto, як і collateral.
//!
//! # Fail-open за дизайном
//!
//! Як і collateral-veto: відсутній test-runner (бінар недоступний),
//! відсутній сестринський тест, таймаут прогону чи інша інфраструктурна
//! проблема — це НЕ відхилення. Мета test-gate — зловити семантичну
//! регресію, а не стати новою точкою відмови ladder-а. Асиметрія навмисна й
//! збережена дослівно з JS-джерела: відхиляє лише реальний провал тесту.
//!
//! # Композиція з `FixDeps::verify`, а не петля оркестрації
//!
//! Цей гейт НЕ вбудований у цикл ходів агента чи в петлю оркестрації
//! (`pipeline`/`runner`) — він природно стає складовою верифікації на боці
//! споживача: [`compose_verify_report`] бере вже обчислений
//! [`super::VerifyReport`] канонічного детектора і, лише якщо той зелений
//! (і не інфра-помилка), запускає test-gate для файлів того самого рунга в межах
//! target-set. Обидва мусять бути зелені — інакше повертається перший
//! зафіксований провал. Споживач збирає результат у власне замикання
//! `FixDeps::verify`; сам цей модуль зсередини петлі не викликається.
//!
//! # Injectable test-runner
//!
//! Команда test-runner-а (JS-дефолт — `bunx vitest run`) НЕ захардкоджена як
//! єдино можлива: [`TestRunner`] — інʼєктований тип, [`default_test_runner`]
//! дає розумний дефолт із JS-джерела, а реальний спавн процесу
//! ([`run_command_with_timeout`]) ізольований від пошуку/композиції, тож
//! легко замінний у тестах.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

use super::{BoxFuture, VerifyReport};

/// Суфікси сестринських тест-файлів (n-test.mdc), той самий перелік, що й
/// `TEST_SUFFIXES` у `test-gate.mjs`.
pub const TEST_SUFFIXES: &[&str] = &[".test.mjs", ".test.js", ".test.ts"];

/// Розширення вихідних файлів, для яких шукаємо сестринський тест —
/// дзеркалить `SOURCE_SUFFIXES` у JS-джерелі.
pub const SOURCE_SUFFIXES: &[&str] = &[".mjs", ".js", ".ts", ".vue"];

/// Таймаут одного прогону тест-файлу за замовчуванням — дзеркалить
/// `TEST_RUN_TIMEOUT_MS = 30_000` у JS-джерелі. Fail-open при перевищенні.
pub const DEFAULT_TEST_RUN_TIMEOUT: Duration = Duration::from_secs(30);

/// Бінар test-runner-а за замовчуванням (JS-дефолт: `bunx vitest run`).
const DEFAULT_TEST_RUNNER_PROGRAM: &str = "bunx";

/// Скільки символів хвоста виводу (stdout+stderr) лишати — дзеркалить
/// `slice(-2000)` у JS-джерелі.
const OUTPUT_TAIL_CHARS: usize = 2000;

/// Результат прогону одного тест-файлу.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestRunResult {
    /// Тест пройшов (або test-runner недоступний / вичерпав таймаут —
    /// fail-open теж дає `true`).
    pub passed: bool,
    /// Хвіст stdout+stderr прогону (порожньо на fail-open-гілках).
    pub output: String,
}

/// Перший зафіксований провал сестринського тесту.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokenSiblingTest {
    /// Вихідний файл, змінений цим спробою, для якого впав сестринський тест.
    pub file: PathBuf,
    /// Сестринський тест-файл, що впав.
    pub test_file: PathBuf,
    /// Хвіст виводу провального прогону.
    pub output: String,
}

/// Інʼєктований test-runner: споживач знає свій раннер (vitest/cargo
/// test/...). Аргументи — абсолютний шлях тест-файлу і робоча директорія
/// запуску; повертає [`TestRunResult`]. `'static` — замикання володіє своїми
/// даними, як і `FixDeps::verify` у батьківському модулі.
pub type TestRunner =
    Arc<dyn Fn(PathBuf, PathBuf) -> BoxFuture<'static, TestRunResult> + Send + Sync>;

/// Сестринські тест-файли за конвенцією `<dir>/tests/<stem>.test.*`
/// (n-test.mdc, той самий шаблон, що й зворотний `inferSourcePath` у
/// coverage-provider). Fail-open (порожній список), якщо розширення
/// вихідного файлу не входить у [`SOURCE_SUFFIXES`].
#[must_use]
pub fn find_sibling_test_files(source_abs_path: &Path) -> Vec<PathBuf> {
    let Some(base) = source_abs_path.file_name().and_then(|n| n.to_str()) else {
        return Vec::new();
    };
    let Some(&suffix) = SOURCE_SUFFIXES.iter().find(|s| base.ends_with(*s)) else {
        return Vec::new();
    };
    let stem = &base[..base.len() - suffix.len()];
    let tests_dir = source_abs_path
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .join("tests");
    TEST_SUFFIXES
        .iter()
        .map(|ext| tests_dir.join(format!("{stem}{ext}")))
        .filter(|p| p.exists())
        .collect()
}

/// Лишає останні `max` символів рядка (не байтів — дзеркалить `String.slice`
/// у JS-джерелі, що індексує за UTF-16 code unit, для практичних ASCII/UTF-8
/// логів test-runner-ів різниця не проявляється).
fn tail_chars(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        s.to_string()
    } else {
        s.chars().skip(count - max).collect()
    }
}

/// Виконує довільну команду з таймаутом. Fail-open (`passed: true`, порожній
/// вивід) на spawn-помилку (бінар відсутній тощо) чи вичерпання таймауту —
/// дзеркалить `runTestFile` у JS-джерелі (`result.error` / `status === null`
/// → `passed: true`). Це єдине місце реального спавну процесу в модулі —
/// ізольоване від пошуку/композиції саме для підміни в тестах.
async fn run_command_with_timeout(
    program: &str,
    args: &[String],
    cwd: &Path,
    timeout_dur: Duration,
) -> TestRunResult {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(cwd).kill_on_drop(true);
    let output = match timeout(timeout_dur, cmd.output()).await {
        Ok(Ok(output)) => output,
        // `Ok(Err(_))` — spawn сам не зміг стартувати (ENOENT тощо);
        // `Err(_)` — таймаут `tokio::time::timeout`. Обидва — інфраструктурна
        // невдача, не сигнал про код; fail-open.
        Ok(Err(_)) | Err(_) => {
            return TestRunResult {
                passed: true,
                output: String::new(),
            }
        }
    };
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    TestRunResult {
        passed: output.status.success(),
        output: tail_chars(&combined, OUTPUT_TAIL_CHARS),
    }
}

/// Test-runner за замовчуванням: `bunx vitest run --reporter=verbose
/// <тест-файл>` у `cwd` — дзеркалить дефолт JS-джерела один-в-один.
pub async fn run_test_file(test_abs_path: &Path, cwd: &Path) -> TestRunResult {
    let args = vec![
        "vitest".to_string(),
        "run".to_string(),
        "--reporter=verbose".to_string(),
        test_abs_path.to_string_lossy().into_owned(),
    ];
    run_command_with_timeout(
        DEFAULT_TEST_RUNNER_PROGRAM,
        &args,
        cwd,
        DEFAULT_TEST_RUN_TIMEOUT,
    )
    .await
}

/// [`TestRunner`], що делегує в [`run_test_file`] — дефолт для
/// [`find_broken_sibling_tests`], коли споживач не інʼєктував власний.
#[must_use]
pub fn default_test_runner() -> TestRunner {
    Arc::new(|test_path, cwd| Box::pin(async move { run_test_file(&test_path, &cwd).await }))
}

/// Test-gate над файлами, зміненими спробою (уже відфільтрованими викликачем
/// до target-set — ця функція сама фільтрації не робить, див.
/// [`find_broken_sibling_tests_in_target`] для готової композиції): перший
/// сестринський тест, що впав, зупиняє пошук — цього достатньо, щоб
/// відхилити clean-вердикт рунга. `runner: None` — використовується
/// [`default_test_runner`].
#[must_use = "провал сестринського тесту має ветувати рунг, ігнорувати результат не можна"]
pub async fn find_broken_sibling_tests(
    files: &[PathBuf],
    cwd: &Path,
    runner: Option<TestRunner>,
) -> Option<BrokenSiblingTest> {
    let runner = runner.unwrap_or_else(default_test_runner);
    for file in files {
        for test_file in find_sibling_test_files(file) {
            let TestRunResult { passed, output } =
                runner(test_file.clone(), cwd.to_path_buf()).await;
            if !passed {
                return Some(BrokenSiblingTest {
                    file: file.clone(),
                    test_file,
                    output,
                });
            }
        }
    }
    None
}

/// Готова композиція test-gate з відсіюванням target-set (дзеркалить
/// `detectBrokenTest` у `run-fix.mjs`, мінус JS-специфічна телеметрія
/// `writeTrace` — не наша турбота в цьому крейті). Скоуп — лише наявні
/// файли ВСЕРЕДИНІ `target_files` порушення, реально змінені спробою
/// (`modified_existing`); файли поза target-set гейт не застосовує взагалі
/// (fail-open — повертає `None` без виклику раннера).
///
/// Перевикористовує [`super::collateral::resolve_target_set`] і
/// `realpath_best_effort`, щоб обидва рубежі (`collateral` і `test_gate`)
/// нормалізували шляхи однаково — розбіжна symlink-нормалізація дала б
/// хибні вердикти саме на межі target-set.
#[must_use = "провал сестринського тесту має ветувати рунг, ігнорувати результат не можна"]
pub async fn find_broken_sibling_tests_in_target(
    modified_existing: &[PathBuf],
    target_files: &[PathBuf],
    cwd: &Path,
    runner: Option<TestRunner>,
) -> Option<BrokenSiblingTest> {
    let targets = super::collateral::resolve_target_set(target_files, cwd);
    let modified_in_target: Vec<PathBuf> = modified_existing
        .iter()
        .map(|p| super::collateral::realpath_best_effort(p))
        .filter(|abs| targets.contains(abs))
        .collect();
    if modified_in_target.is_empty() {
        return None;
    }
    find_broken_sibling_tests(&modified_in_target, cwd, runner).await
}

/// Композиція з канонічною перевіркою для замикання `FixDeps::verify` на
/// боці споживача: `canonical` — уже обчислений [`VerifyReport`] канонічного
/// детектора (повторний прогін правила). Test-gate запускається лише коли
/// `canonical` зелений і не інфра-помилка (даремно ганяти тести на
/// приреченому рунгу); якщо test-gate знайшов провал — повертає червоний
/// `VerifyReport` з описом провалу, інакше — початковий `canonical` без змін.
#[must_use]
pub async fn compose_verify_report(
    canonical: VerifyReport,
    modified_existing: &[PathBuf],
    target_files: &[PathBuf],
    cwd: &Path,
    runner: Option<TestRunner>,
) -> VerifyReport {
    if !canonical.ok || canonical.infra_error {
        return canonical;
    }
    match find_broken_sibling_tests_in_target(modified_existing, target_files, cwd, runner).await {
        None => canonical,
        Some(broken) => VerifyReport {
            ok: false,
            output: format!(
                "test-gate: сестринський тест {} для файлу {} червоний.\n{}",
                broken.test_file.display(),
                broken.file.display(),
                broken.output
            ),
            infra_error: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn stub_runner(passed: bool, output: &str) -> TestRunner {
        let output = output.to_string();
        Arc::new(move |_test_path, _cwd| {
            let result = TestRunResult {
                passed,
                output: output.clone(),
            };
            Box::pin(async move { result })
        })
    }

    /// Раннер-лічильник викликів — для перевірки, що fail-open/short-circuit
    /// гілки НЕ спричиняють жодного виклику раннера.
    fn counting_runner(passed: bool) -> (TestRunner, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_clone = Arc::clone(&calls);
        let runner: TestRunner = Arc::new(move |_test_path, _cwd| {
            calls_clone.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                TestRunResult {
                    passed,
                    output: String::new(),
                }
            })
        });
        (runner, calls)
    }

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("створити директорію фікстури");
        }
        fs::write(path, "").expect("записати файл фікстури");
    }

    // --- find_sibling_test_files ------------------------------------------

    #[test]
    fn finds_sibling_test_for_each_source_suffix() {
        let tmp = tempfile::tempdir().expect("tempdir");
        for src_ext in SOURCE_SUFFIXES {
            let stem = format!("mod{}", src_ext.replace('.', "_"));
            let source = tmp.path().join(format!("{stem}{src_ext}"));
            let test_file = tmp.path().join("tests").join(format!("{stem}.test.mjs"));
            touch(&test_file);

            let found = find_sibling_test_files(&source);

            assert_eq!(found, vec![test_file]);
        }
    }

    #[test]
    fn unsupported_source_extension_returns_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source = tmp.path().join("main.rs");
        touch(&tmp.path().join("tests").join("main.test.mjs"));

        assert!(find_sibling_test_files(&source).is_empty());
    }

    #[test]
    fn missing_sibling_test_returns_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source = tmp.path().join("lonely.mjs");

        assert!(find_sibling_test_files(&source).is_empty());
    }

    #[test]
    fn multiple_test_suffix_matches_all_returned() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source = tmp.path().join("dual.mjs");
        let mjs_test = tmp.path().join("tests").join("dual.test.mjs");
        let ts_test = tmp.path().join("tests").join("dual.test.ts");
        touch(&mjs_test);
        touch(&ts_test);

        let found = find_sibling_test_files(&source);

        assert_eq!(found, vec![mjs_test, ts_test]);
    }

    // --- find_broken_sibling_tests ------------------------------------------

    #[tokio::test]
    async fn passing_sibling_test_is_skipped() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source = tmp.path().join("ok.mjs");
        touch(&tmp.path().join("tests").join("ok.test.mjs"));

        let result =
            find_broken_sibling_tests(&[source], tmp.path(), Some(stub_runner(true, ""))).await;

        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn failing_sibling_test_is_reported() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source = tmp.path().join("broken.mjs");
        let test_file = tmp.path().join("tests").join("broken.test.mjs");
        touch(&test_file);

        let result = find_broken_sibling_tests(
            std::slice::from_ref(&source),
            tmp.path(),
            Some(stub_runner(false, "AssertionError: боже")),
        )
        .await;

        assert_eq!(
            result,
            Some(BrokenSiblingTest {
                file: source,
                test_file,
                output: "AssertionError: боже".to_string()
            })
        );
    }

    #[tokio::test]
    async fn no_sibling_test_fails_open_without_calling_runner() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source = tmp.path().join("untested.mjs");
        let (runner, calls) = counting_runner(false);

        let result = find_broken_sibling_tests(&[source], tmp.path(), Some(runner)).await;

        assert_eq!(result, None);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn first_failure_short_circuits_remaining_files() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let file_a = tmp.path().join("a.mjs");
        let file_b = tmp.path().join("b.mjs");
        touch(&tmp.path().join("tests").join("a.test.mjs"));
        touch(&tmp.path().join("tests").join("b.test.mjs"));
        let (runner, calls) = counting_runner(false);

        let result = find_broken_sibling_tests(&[file_a, file_b], tmp.path(), Some(runner)).await;

        assert!(result.is_some());
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "перший провал має зупинити пошук — b.mjs не мав перевірятись"
        );
    }

    // --- find_broken_sibling_tests_in_target --------------------------------

    #[tokio::test]
    async fn file_outside_target_set_is_not_gated() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let canonical_root = fs::canonicalize(tmp.path()).expect("canonicalize tmpdir");
        let outside = canonical_root.join("outside.mjs");
        touch(&canonical_root.join("tests").join("outside.test.mjs"));
        let (runner, calls) = counting_runner(false);

        let result = find_broken_sibling_tests_in_target(
            &[outside],
            &[PathBuf::from("target.mjs")],
            tmp.path(),
            Some(runner),
        )
        .await;

        assert_eq!(result, None, "файл поза target-set гейт не застосовує");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn file_inside_target_set_is_gated() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let canonical_root = fs::canonicalize(tmp.path()).expect("canonicalize tmpdir");
        let target = canonical_root.join("target.mjs");
        let test_file = canonical_root.join("tests").join("target.test.mjs");
        touch(&test_file);

        let result = find_broken_sibling_tests_in_target(
            std::slice::from_ref(&target),
            &[PathBuf::from("target.mjs")],
            tmp.path(),
            Some(stub_runner(false, "червоно")),
        )
        .await;

        assert_eq!(
            result,
            Some(BrokenSiblingTest {
                file: target,
                test_file,
                output: "червоно".to_string()
            })
        );
    }

    // --- run_command_with_timeout (реальний спавн — ізольований шар) -------

    #[tokio::test]
    async fn spawn_error_on_missing_binary_fails_open() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let result = run_command_with_timeout(
            "n-rules-cli-that-does-not-exist",
            &[],
            tmp.path(),
            Duration::from_secs(5),
        )
        .await;

        assert_eq!(
            result,
            TestRunResult {
                passed: true,
                output: String::new()
            }
        );
    }

    #[tokio::test]
    async fn timeout_fails_open() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let result = run_command_with_timeout(
            "sleep",
            &["5".to_string()],
            tmp.path(),
            Duration::from_millis(50),
        )
        .await;

        assert_eq!(
            result,
            TestRunResult {
                passed: true,
                output: String::new()
            },
            "таймаут — інфраструктурна невдача, не сигнал про код: fail-open, як і в JS-джерелі"
        );
    }

    #[tokio::test]
    async fn exit_status_maps_to_passed() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let ok = run_command_with_timeout("true", &[], tmp.path(), Duration::from_secs(5)).await;
        let bad = run_command_with_timeout("false", &[], tmp.path(), Duration::from_secs(5)).await;

        assert!(ok.passed);
        assert!(!bad.passed);
    }

    // --- compose_verify_report ------------------------------------------

    fn red_report(output: &str) -> VerifyReport {
        VerifyReport {
            ok: false,
            output: output.to_string(),
            infra_error: false,
        }
    }

    fn green_report() -> VerifyReport {
        VerifyReport {
            ok: true,
            output: String::new(),
            infra_error: false,
        }
    }

    #[tokio::test]
    async fn red_canonical_short_circuits_before_test_gate() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (runner, calls) = counting_runner(false);
        let canonical = red_report("правило й далі порушено");

        let result =
            compose_verify_report(canonical.clone(), &[], &[], tmp.path(), Some(runner)).await;

        assert_eq!(result.output, canonical.output);
        assert!(!result.ok);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "test-gate не має ганяти тести на приреченому rung-у"
        );
    }

    #[tokio::test]
    async fn infra_error_canonical_short_circuits_before_test_gate() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (runner, calls) = counting_runner(false);
        let canonical = VerifyReport {
            ok: false,
            output: "детектор недоступний".to_string(),
            infra_error: true,
        };

        let result = compose_verify_report(canonical, &[], &[], tmp.path(), Some(runner)).await;

        assert!(result.infra_error);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn green_canonical_but_broken_test_turns_report_red() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let canonical_root = fs::canonicalize(tmp.path()).expect("canonicalize tmpdir");
        let target = canonical_root.join("target.mjs");
        touch(&canonical_root.join("tests").join("target.test.mjs"));

        let result = compose_verify_report(
            green_report(),
            &[target],
            &[PathBuf::from("target.mjs")],
            tmp.path(),
            Some(stub_runner(false, "TypeError")),
        )
        .await;

        assert!(!result.ok);
        assert!(!result.infra_error);
        assert!(result.output.contains("test-gate"));
        assert!(result.output.contains("TypeError"));
    }

    #[tokio::test]
    async fn green_canonical_and_passing_tests_stay_green() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let canonical_root = fs::canonicalize(tmp.path()).expect("canonicalize tmpdir");
        let target = canonical_root.join("target.mjs");
        touch(&canonical_root.join("tests").join("target.test.mjs"));

        let result = compose_verify_report(
            green_report(),
            &[target],
            &[PathBuf::from("target.mjs")],
            tmp.path(),
            Some(stub_runner(true, "")),
        )
        .await;

        assert!(result.ok);
    }
}
