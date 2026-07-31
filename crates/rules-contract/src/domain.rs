//! `DomainError` + мінімальні домени поза lint (`ecosystem-outdated`,
//! `docgen-render`) — рішення К спеки: один world з усіма інтерфейсами,
//! непідтримані домени повертають `DomainError::NotSupported` (хост знає з
//! `Manifest::domains` і за штатної роботи такий export не викликає — це
//! захисна заглушка, не основний шлях).
//!
//! # `result<T, E>` замість generic `domain-result<T>`
//!
//! Ескіз WIT у спеці (§3.2) записує сигнатури як `-> domain-result<list<...>>`
//! — ілюстративна, не буквально WIT-парситься форма: WIT **не підтримує**
//! generic-параметри для власних `record`/`variant`-типів (лише вбудовані
//! `list<T>`/`option<T>`/`result<T,E>` — generic на рівні мови). Тому в
//! `wit/world.wit` кожна домен-функція повертає вбудований `result<T,
//! domain-error>` — той самий набір станів (успіх / не підтримується /
//! помилка виконання), без потреби у власному generic-типі.

use serde::{Deserialize, Serialize};

/// Помилка домен-функції — точний відповідник WIT `variant domain-error`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum DomainError {
    /// Домен не задекларований у `Manifest::domains` — захисна заглушка.
    NotSupported,
    /// Помилка виконання; вкладене поле — людиночитне повідомлення.
    Failed { message: String },
}

/// Запит ecosystem-outdated домену (провайдер поза lint, рішення К) —
/// мінімальна форма-заглушка: вміст lock/manifest-файлу екосистеми, хост
/// уже прочитав.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemRequest {
    pub ecosystem: String,
    pub manifest_path: String,
    pub manifest_content: String,
}

/// Одна застаріла залежність (мінімальна форма-заглушка) — точний
/// відповідник WIT `record outdated-dep`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutdatedDep {
    pub name: String,
    pub current: String,
    pub latest: String,
    pub breaking: bool,
}

/// Запит docgen-render домену (провайдер поза lint, рішення К) —
/// мінімальна форма-заглушка: джерело + його CRC (звірка застарілості
/// доки, конвенція `n-doc-files`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocgenRequest {
    pub source_path: String,
    pub source_content: String,
    pub source_crc: String,
}

/// Результат docgen-render (мінімальна форма-заглушка) — точний
/// відповідник WIT `record doc-output`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocOutput {
    pub content: String,
    pub content_crc: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_error_not_supported_serializes_with_type_tag() {
        let err = DomainError::NotSupported;
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["type"], "not-supported");
    }

    #[test]
    fn domain_error_failed_carries_message() {
        let err = DomainError::Failed {
            message: "не вдалось прочитати lock-файл".to_string(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["type"], "failed");
        assert_eq!(json["message"], "не вдалось прочитати lock-файл");
    }
}
