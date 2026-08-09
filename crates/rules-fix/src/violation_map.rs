//! Мапінг доменів: `rules_core::diagnostics::Violation` (детектор lint-у) ⇄
//! `llm_lib::fix::pipeline::Violation` (вхід петлі `fix`), і те саме для
//! `Fixability` (`rules_core::concern_meta::Fixability` →
//! `llm_lib::fix::pipeline::Fixability`). Обидва боки описують те саме
//! поняття різними DTO — цей модуль єдине місце перекладу, щоб решта крейта
//! (`detect`/`verify`/`attempt`) не дублювала правила конверсії.

use std::path::PathBuf;

use llm_lib::fix::pipeline::{Fixability as PipelineFixability, Violation as PipelineViolation};
use rules_core::concern_meta::Fixability as ConcernFixability;
use rules_core::diagnostics::Violation as CoreViolation;

/// Перекладає одне порушення `rules-core` у форму, яку читає петля `fix`.
///
/// Функція навмисно завжди повертає значення (не `Result`/`Option`): відсутній `file`
/// чи відсутній/нечисловий `data["line"]` — не помилка мапінгу.
/// - Відсутній `file` → порожній `PathBuf` (`llm_lib::fix::pipeline::Violation::file`
///   не є `Option`, на відміну від `line`); порожній шлях ніколи не збігається
///   з жодним реальним файлом у `check_collateral` (`pipeline.rs`), тож
///   порушення просто не бере участі в hunk-вікні, а не ламає мапінг.
///   Це реальний випадок, не крайовий: доккомент модуля `diagnostics.rs`
///   прямо каже, що native-концерни РЕГУЛЯРНО не встановлюють `file` —
///   шлях уже вшитий у текст `message`.
/// - Відсутній чи нечисловий `data["line"]` → `None`: вікно hunk-veto для
///   цього порушення просто не застосовується (`check_collateral`
///   фільтрує такі записи через `filter_map(|v| v.line)`).
#[must_use]
pub fn to_pipeline_violation(violation: &CoreViolation) -> PipelineViolation {
    let file = violation
        .file
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_default();
    let line = violation
        .data
        .as_ref()
        .and_then(|data| data.get("line"))
        .and_then(serde_json::Value::as_u64)
        .and_then(|n| usize::try_from(n).ok());
    PipelineViolation {
        file,
        line,
        message: violation.message.clone(),
    }
}

/// Перекладає маршрутизацію fix-руху concern-а (`ConcernMeta::fixability`) у
/// грубішу двійкову ознаку, яку читає петля `fix`
/// (`PipelineConfig::fixability`): `Config` і `Structural` обидва означають
/// «людське рішення, драбина моделей тут марна» — `pipeline::Fixability` їх
/// далі не розрізняє (лише `Code` рухає concern у драбину).
#[must_use]
pub fn to_pipeline_fixability(fixability: ConcernFixability) -> PipelineFixability {
    match fixability {
        ConcernFixability::Code => PipelineFixability::Code,
        ConcernFixability::Config | ConcernFixability::Structural => {
            PipelineFixability::ConfigOrStructural
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rules_core::diagnostics::Severity;

    fn violation(file: Option<&str>, data: Option<serde_json::Value>) -> CoreViolation {
        CoreViolation {
            reason: "r".to_string(),
            message: "m".to_string(),
            file: file.map(str::to_string),
            severity: Severity::Error,
            data,
        }
    }

    #[test]
    fn maps_file_and_line_when_both_present() {
        let mapped = to_pipeline_violation(&violation(
            Some("a/b.mjs"),
            Some(serde_json::json!({ "line": 42 })),
        ));
        assert_eq!(mapped.file, PathBuf::from("a/b.mjs"));
        assert_eq!(mapped.line, Some(42));
        assert_eq!(mapped.message, "m");
    }

    #[test]
    fn missing_file_maps_to_empty_path_not_an_error() {
        let mapped =
            to_pipeline_violation(&violation(None, Some(serde_json::json!({ "line": 1 }))));
        assert_eq!(mapped.file, PathBuf::new());
        assert_eq!(mapped.line, Some(1));
    }

    #[test]
    fn missing_data_maps_line_to_none() {
        let mapped = to_pipeline_violation(&violation(Some("a.mjs"), None));
        assert_eq!(mapped.line, None);
    }

    #[test]
    fn data_without_line_key_maps_line_to_none() {
        let mapped = to_pipeline_violation(&violation(
            Some("a.mjs"),
            Some(serde_json::json!({ "kind": "x" })),
        ));
        assert_eq!(mapped.line, None);
    }

    #[test]
    fn non_numeric_line_maps_to_none() {
        let mapped = to_pipeline_violation(&violation(
            Some("a.mjs"),
            Some(serde_json::json!({ "line": "не число" })),
        ));
        assert_eq!(mapped.line, None);
    }

    #[test]
    fn code_fixability_maps_to_code() {
        assert_eq!(
            to_pipeline_fixability(ConcernFixability::Code),
            PipelineFixability::Code
        );
    }

    #[test]
    fn config_and_structural_both_map_to_config_or_structural() {
        assert_eq!(
            to_pipeline_fixability(ConcernFixability::Config),
            PipelineFixability::ConfigOrStructural
        );
        assert_eq!(
            to_pipeline_fixability(ConcernFixability::Structural),
            PipelineFixability::ConfigOrStructural
        );
    }
}
