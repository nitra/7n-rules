//! `Diagnostic`/`Severity` — WIT-дзеркало diagnostics DTO `rules-core`
//! (`rules_core::diagnostics::Violation`/`Severity`,
//! `crates/rules-core/src/diagnostics.rs`, `CONTRACT_VERSION = 2`).
//!
//! Точний структурний дублікат, не реекспорт — план злиття задокументовано
//! в `crate`-doc-коментарі кореневого `lib.rs`. Serde-форма звірена з тим
//! самим джерелом правди, що й `rules_core::diagnostics::Violation`
//! (`npm/scripts/lib/lint-surface/detect.mjs:40-75`), тому unit-тести тут —
//! дзеркала тестів `rules-core::diagnostics::tests`.
//!
//! # `data` — JSON-рядок, не структурний тип
//!
//! У WIT (`wit/world.wit`, `record diagnostic`) поле `data` типізоване як
//! `option<string>` — WIT не має довільного (self-describing) JSON-типу.
//! Тут, на Rust-боці, [`Diagnostic::data`] лишається `Option<serde_json::Value>`
//! (як і в `rules-core`) — конвертація в/із WIT-рядкового представлення
//! (серіалізація `serde_json::to_string`/парсинг `serde_json::from_str`)
//! належить `rules-plugin-host` (I2, ABI-межа), не цьому DTO-шару.

use serde::{Deserialize, Serialize};

/// Рівень серйозності діагностики. serde lowercase (`"error"`/`"warn"`) —
/// точне дзеркало `Severity` `rules-core` і `'error'|'warn'` у JS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Діагностика блокує (дефолт).
    #[default]
    Error,
    /// Попередження — не блокує.
    Warn,
}

/// Одна діагностика lint-домену — структурний дублікат
/// `rules_core::diagnostics::Violation` (план злиття — `lib.rs`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    /// Стабільний machine code (`crc-mismatch`, `zk-logback-root-level`, ...).
    pub reason: String,
    /// Людиночитний опис — єдине джерело для runner-render.
    pub message: String,
    /// Posix-relative шлях від cwd (без `..`), якщо плагін його знає.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Рівень серйозності, дефолт [`Severity::Error`].
    #[serde(default)]
    pub severity: Severity,
    /// Concern-specific payload (напр. `{"line": 42}`) — лише `object`.
    /// На WIT-боці — JSON-рядок (`option<string>`), тут — розпарсене
    /// значення (конвертацію робить `rules-plugin-host`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Порожні опційні поля — відсутні ключі, не `null` (дзеркало
    /// `rules_core::diagnostics::tests::minimal_violation_omits_absent_optional_fields`).
    #[test]
    fn minimal_diagnostic_omits_absent_optional_fields() {
        let d = Diagnostic {
            reason: "forbidden-prettier".to_string(),
            message: ".prettierrc заборонено".to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        };
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "reason": "forbidden-prettier",
                "message": ".prettierrc заборонено",
                "severity": "error"
            })
        );
    }

    /// Severity серіалізується lowercase, заповнені `file`/`data` —
    /// звичайні поля (дзеркало
    /// `rules_core::diagnostics::tests::full_violation_serializes_all_fields_lowercase_severity`).
    #[test]
    fn full_diagnostic_serializes_all_fields_lowercase_severity() {
        let d = Diagnostic {
            reason: "zk-logback-root-level".to_string(),
            message: "zookeeper.yaml: ...".to_string(),
            file: Some("dev/dremio_v2/templates/zookeeper.yaml".to_string()),
            severity: Severity::Warn,
            data: Some(serde_json::json!({ "line": 12 })),
        };
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "reason": "zk-logback-root-level",
                "message": "zookeeper.yaml: ...",
                "file": "dev/dremio_v2/templates/zookeeper.yaml",
                "severity": "warn",
                "data": { "line": 12 }
            })
        );
    }

    /// `severity` відсутній у вхідному JSON → дефолт `Error` (дзеркало
    /// `rules_core::diagnostics::tests::missing_severity_deserializes_to_error_default`).
    #[test]
    fn missing_severity_deserializes_to_error_default() {
        let raw = serde_json::json!({ "reason": "r", "message": "m" });
        let d: Diagnostic = serde_json::from_value(raw).unwrap();
        assert_eq!(d.severity, Severity::Error);
        assert!(d.file.is_none());
        assert!(d.data.is_none());
    }
}
