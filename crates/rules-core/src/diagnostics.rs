//! Diagnostics DTO — versioned JSON-межа `rules-core` ⇄ `rules-napi` для
//! detector-результатів (Р10 спеки `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`,
//! фаза 5 задача E1).
//!
//! [`Violation`] — точне дзеркало форми, яку `normalizeViolation`
//! (`npm/scripts/lib/lint-surface/detect.mjs:40-75`) очікує від сирого
//! результату detector-а (`LintViolation` без `ruleId`/`concernId` —
//! `npm/scripts/lib/lint-surface/types.mjs:31-43`).
//!
//! # Чому без `ruleId`/`concernId`
//!
//! JS-runner домішує `ruleId`/`concernId` з `LintContext` при нормалізації
//! (`detect.mjs:64-65`) — вони не властивість самого violation, а координати
//! виклику. Native-концерни (`crate::concerns`) не знають своїх
//! `ruleId`/`concernId` (лише `NATIVE_CONCERNS`-ключ формату
//! `ruleId/concernId` у registry), тож DTO їх не містить — той самий поділ
//! відповідальності, що й у JS.
//!
//! # Чому без top-level `line`
//!
//! `LintViolation` у JS **не має** окремого поля `line` — номер рядка (коли
//! detector його знає) конвенційно кладеться у `data.line`
//! (`Record<string, unknown>`, concern-specific payload). Це не забаганка:
//! два незалежні споживачі читають саме `violation.data.line`, не
//! top-level поле —
//!   - `npm/scripts/lib/lint-surface/run-detectors.mjs:623` (`fix-eslint`
//!     shape) читає `v.data.line` для сортування/групування T0-патернів;
//!   - `npm/scripts/lib/lint-surface/collateral-veto.mjs:24,80,114` звіряє
//!     вікно навколо кожної `violation.data.line` з діапазонами diff-змін,
//!     щоб відсіяти колатеральні правки поза власне порушенням.
//!
//! Додавання окремого top-level `line` зламало б обидва контракти (вони
//! читають саме вкладене поле) — тому [`Violation::data`] лишається єдиним
//! носієм для `line`, а не окрема структурна властивість.

use serde::{Deserialize, Serialize};

/// Рівень серйозності порушення. serde lowercase (`"error"`/`"warn"`) —
/// точне дзеркало `'error'|'warn'` у JS (`types.mjs:40`,
/// `detect.mjs:61` — `v.severity === 'warn' ? 'warn' : 'error'`, дефолт
/// `error` при будь-якому іншому значенні чи відсутності поля).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Порушення блокує (дефолт).
    #[default]
    Error,
    /// Попередження — не блокує.
    Warn,
}

/// Одне порушення detector-а — точний семантичний port `LintViolation` без
/// `ruleId`/`concernId` (секції у doc-коменті модуля вище).
///
/// Serde-форма звірена з `normalizeViolation`
/// (`npm/scripts/lib/lint-surface/detect.mjs:40-75`):
///   - `reason`/`message` — обов'язкові непорожні рядки;
///   - `file` — опційний, posix-relative (без ведучого `/` і без `..`
///     сегментів; native-концерни цього фази не встановлюють `file` взагалі,
///     бо жоден із трьох пілотів на нього не покладається — шлях уже
///     вшитий у `message`, за зразком оригінального `main.mjs`);
///   - `data` — опційний, лише `object` (тут: `serde_json::Value::Object`);
///     JS-нормалізатор відкидає `data`, якщо це не `object`
///     (`detect.mjs:71`) — той самий контракт тут через `Option`, не
///     довільний `Value`.
///
/// Відсутні опційні поля (`file`, `data`) серіалізуються як відсутні ключі
/// (`skip_serializing_if`), не як `null` — так JSON-форма буквально збігається
/// з тим, що видає JS-детектор (`fail()` без `file`/`data` не кладе ці ключі
/// у violation-об'єкт узагалі, `violation-reporter.mjs:37-40`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Violation {
    /// Стабільний machine code (`crc-mismatch`, `zk-logback-root-level`, ...).
    pub reason: String,
    /// Людиночитний опис — єдине джерело для runner-render.
    pub message: String,
    /// Posix-relative шлях від cwd (без `..`), якщо detector його знає.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Рівень серйозності, дефолт [`Severity::Error`].
    #[serde(default)]
    pub severity: Severity,
    /// Concern-specific payload (напр. `{"line": 42}`) — лише `object`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Порожні опційні поля мають бути відсутніми ключами, а не `null` —
    /// звірка з JS-формою `violation-reporter.mjs:37-40`.
    #[test]
    fn minimal_violation_omits_absent_optional_fields() {
        let v = Violation {
            reason: "forbidden-prettier".to_string(),
            message: ".prettierrc заборонено".to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        };
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "reason": "forbidden-prettier",
                "message": ".prettierrc заборонено",
                "severity": "error"
            })
        );
    }

    /// Severity серіалізується lowercase, і при заповнених file/data вони
    /// зʼявляються як звичайні поля (`file` — string, `data` — object).
    #[test]
    fn full_violation_serializes_all_fields_lowercase_severity() {
        let v = Violation {
            reason: "zk-logback-root-level".to_string(),
            message: "zookeeper.yaml: ...".to_string(),
            file: Some("dev/dremio_v2/templates/zookeeper.yaml".to_string()),
            severity: Severity::Warn,
            data: Some(serde_json::json!({ "line": 12 })),
        };
        let json = serde_json::to_value(&v).unwrap();
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
    /// `detect.mjs:61`: будь-яке не-`'warn'` значення, включно з відсутністю
    /// поля, нормалізується в `'error'`).
    #[test]
    fn missing_severity_deserializes_to_error_default() {
        let raw = serde_json::json!({ "reason": "r", "message": "m" });
        let v: Violation = serde_json::from_value(raw).unwrap();
        assert_eq!(v.severity, Severity::Error);
        assert!(v.file.is_none());
        assert!(v.data.is_none());
    }
}
