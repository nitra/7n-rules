//! Канонічний детектор петлі `fix` — обгортка над `rules_core::concerns::run_concern`,
//! і межа редагування (`target_files`), яку рахуємо з його першого прогону.
//!
//! Крок 2 задачі (частина `detect`): на відміну від попередніх
//! інʼєкцій-заглушок, тут стоїть СПРАВЖНІЙ native-детектор `rules-core`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use harness::pipeline::{DetectFn, Violation as PipelineViolation};
use rules_core::concerns::run_concern;

use crate::violation_map::to_pipeline_violation;

/// Один синхронний прогін реального детектора для ключа `ruleId/concernId`,
/// перекладений у форму петлі `fix` ([`to_pipeline_violation`]).
///
/// # Errors
/// Текст помилки `rules_core::RulesError` (петля `fix` не розрізняє причин —
/// [`DetectFn`] бере лише `String`).
pub fn run_canonical(
    key: &str,
    cwd: &Path,
    files: Option<&[String]>,
) -> Result<Vec<PipelineViolation>, String> {
    run_concern(key, cwd, files)
        .map(|report| {
            report
                .violations
                .iter()
                .map(to_pipeline_violation)
                .collect()
        })
        .map_err(|error| error.to_string())
}

/// Обгортка [`run_canonical`] під тип [`DetectFn`] петлі `fix`. `run_concern`
/// — синхронна CPU/fs-bound функція (native-порти читають файли напряму,
/// без мережі й довгих зовнішніх процесів), тож просто загортаємо виклик у
/// `Box::pin(async move { ... })` — без переносу на окремий потік
/// (`spawn_blocking`), як і решта інʼєкцій цього крейта.
#[must_use]
pub fn build_detect_fn(key: String, cwd: PathBuf, files: Option<Vec<String>>) -> DetectFn {
    Arc::new(move || {
        let key = key.clone();
        let cwd = cwd.clone();
        let files = files.clone();
        Box::pin(async move { run_canonical(&key, &cwd, files.as_deref()) })
    })
}

/// Файли з перекладених порушень, у порядку першої появи, без дублікатів і без
/// порожнього шляху (детектори без file-атрибуції — доккомент
/// [`crate::violation_map::to_pipeline_violation`]) — межа редагування, яку
/// бачить драбина `fix` (`PipelineConfig::target_files`).
#[must_use]
pub fn target_files_from_violations(violations: &[PipelineViolation]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for violation in violations {
        if violation.file.as_os_str().is_empty() {
            continue;
        }
        if !out.contains(&violation.file) {
            out.push(violation.file.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_canonical_reports_real_violation_from_a_native_detector() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join(".prettierrc"), "{}").expect("написати .prettierrc");

        let violations =
            run_canonical("text/forbidden-prettier", tmp.path(), None).expect("run_concern ok");

        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains(".prettierrc"));
    }

    #[test]
    fn run_canonical_is_clean_when_no_violation_present() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let violations =
            run_canonical("text/forbidden-prettier", tmp.path(), None).expect("run_concern ok");

        assert!(violations.is_empty());
    }

    #[test]
    fn run_canonical_reports_error_for_unknown_key() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let error = run_canonical("nope/nope", tmp.path(), None).expect_err("невідомий ключ");

        assert!(error.contains("nope/nope"));
    }

    #[tokio::test]
    async fn build_detect_fn_bridges_into_the_pipeline_detect_type() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join(".prettierrc"), "{}").expect("написати .prettierrc");

        let detect = build_detect_fn(
            "text/forbidden-prettier".to_string(),
            tmp.path().to_path_buf(),
            None,
        );
        let violations = detect().await.expect("detect ok");

        assert_eq!(violations.len(), 1);
    }

    #[test]
    fn target_files_dedups_and_skips_empty_paths() {
        let violations = vec![
            PipelineViolation {
                file: PathBuf::from("a.mjs"),
                line: None,
                message: "1".to_string(),
            },
            PipelineViolation {
                file: PathBuf::new(),
                line: None,
                message: "без файлу".to_string(),
            },
            PipelineViolation {
                file: PathBuf::from("a.mjs"),
                line: Some(2),
                message: "2".to_string(),
            },
            PipelineViolation {
                file: PathBuf::from("b.mjs"),
                line: None,
                message: "3".to_string(),
            },
        ];

        let targets = target_files_from_violations(&violations);

        assert_eq!(
            targets,
            vec![PathBuf::from("a.mjs"), PathBuf::from("b.mjs")]
        );
    }
}
