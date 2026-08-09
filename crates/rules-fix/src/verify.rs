//! `FixDeps::verify` для одного attempt-у: канонічний повторний прогін
//! `run_concern` + test-gate (`compose_verify_report`) — крок 4 задачі.
//!
//! Порядок і fail-open семантику бере готовими `llm_lib::fix::test_gate`
//! (доккомент `test_gate.rs`): цей модуль лише постачає йому «канонічний»
//! бік (`VerifyReport` реального детектора), самої логіки composed-вердикту
//! тут немає.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use llm_lib::fix::test_gate::compose_verify_report;
use llm_lib::fix::{BoxFuture, VerifyReport};
use rules_core::concerns::run_concern;

/// Тип [`FixDeps::verify`](llm_lib::fix::FixDeps::verify) — `llm-lib` не
/// експортує для нього окремий псевдонім (лише поле структури), тож
/// повторюємо форму тут один раз, а не в кожній сигнатурі.
pub type VerifyFn = Arc<dyn Fn() -> BoxFuture<'static, VerifyReport> + Send + Sync>;

/// Один канонічний прогін детектора → [`VerifyReport`]. Помилка детектора
/// (не «порушення лишилось», а сам виклик не зміг завершитись) мапиться в
/// `infra_error: true` — verify-петля attempt-у (`runner::VerifyBudget`) не
/// палить бюджет на інфраструктурний збій самої перевірки, лише на реальне
/// «і далі порушено» (доккомент `runner.rs`).
fn canonical_report(key: &str, cwd: &Path, files: Option<&[String]>) -> VerifyReport {
    match run_concern(key, cwd, files) {
        Ok(violations) if violations.is_empty() => VerifyReport {
            ok: true,
            output: String::new(),
            infra_error: false,
        },
        Ok(violations) => VerifyReport {
            ok: false,
            output: violations
                .iter()
                .map(|v| v.message.clone())
                .collect::<Vec<_>>()
                .join("\n"),
            infra_error: false,
        },
        Err(error) => VerifyReport {
            ok: false,
            output: error.to_string(),
            infra_error: true,
        },
    }
}

/// Складає [`VerifyFn`] з двох частин: канонічний повторний прогін
/// `run_concern` І test-gate (`compose_verify_report`) — точний порядок
/// (test-gate лише на зеленому і не-інфра канонічному вердикті) з
/// `test_gate.rs`.
///
/// `target_files` подається в test-gate і як межа (`target_files`), і як
/// «файли, що торкнулись» (`modified_existing`) — **відоме спрощення**
/// (звіт задачі): цей крейт не має доступу до внутрішнього `WriteGuard`
/// одного `run_attempt` (він не виставляє хук назовні, доккомент
/// `crate::attempt`), тож не може знати, які САМЕ файли торкнулись ЦІЄЇ
/// конкретної спроби на момент виклику `verify`. Використання повного
/// `target_files` як надмножини безпечне: `compose_verify_report` сам
/// звужує перетин із `target_files`, тож наслідок — «прогнати сестринські
/// тести всіх цільових файлів» замість точного «лише вже торкнутих»
/// (зайва вартість тестових прогонів, не хибний вердикт — fail-open на
/// відсутній сестринський тест лишається тим самим).
#[must_use]
pub fn build_verify_fn(
    key: String,
    cwd: PathBuf,
    files: Option<Vec<String>>,
    target_files: Vec<PathBuf>,
) -> VerifyFn {
    Arc::new(move || {
        let key = key.clone();
        let cwd = cwd.clone();
        let files = files.clone();
        let target_files = target_files.clone();
        Box::pin(async move {
            let canonical = canonical_report(&key, &cwd, files.as_deref());
            compose_verify_report(canonical, &target_files, &target_files, &cwd, None).await
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_report_is_green_when_no_violation() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let report = canonical_report("text/forbidden-prettier", tmp.path(), None);
        assert!(report.ok);
        assert!(!report.infra_error);
    }

    #[test]
    fn canonical_report_is_red_with_message_when_violation_present() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join(".prettierrc"), "{}").expect("написати .prettierrc");

        let report = canonical_report("text/forbidden-prettier", tmp.path(), None);

        assert!(!report.ok);
        assert!(!report.infra_error);
        assert!(report.output.contains(".prettierrc"));
    }

    #[test]
    fn canonical_report_marks_unknown_key_as_infra_error() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let report = canonical_report("nope/nope", tmp.path(), None);
        assert!(!report.ok);
        assert!(report.infra_error);
    }

    #[tokio::test]
    async fn build_verify_fn_reflects_canonical_state() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join(".prettierrc"), "{}").expect("написати .prettierrc");

        let verify = build_verify_fn(
            "text/forbidden-prettier".to_string(),
            tmp.path().to_path_buf(),
            None,
            vec![PathBuf::from(".prettierrc")],
        );
        let red = verify().await;
        assert!(!red.ok);

        std::fs::remove_file(tmp.path().join(".prettierrc")).expect("прибрати .prettierrc");
        let green = verify().await;
        assert!(green.ok);
    }
}
