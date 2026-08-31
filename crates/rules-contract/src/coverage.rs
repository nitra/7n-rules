//! DTO слотового світу `n-rules:surfaces/coverage-provider@1.0.0`
//! (`crates/rules-contract/wit/deps/surfaces/coverage-provider.wit`) — крок
//! 6 спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12, «перша
//! слотова поверхня». Форма — дослівний переніс WIT-record-ів
//! (`coverage-counts`, `mutation-counts`, `coverage-area`,
//! `coverage-report`, `coverage-request`), доккомент того файлу пояснює,
//! чому дослівно, а не вигадано: звірено проти реального
//! `plugins/lang-rust/coverage-provider/provider.mjs` (і трьох сусідів)
//! ДО написання WIT.
//!
//! Помилка домен-функції — [`crate::domain::DomainError`], НЕ окремий тип:
//! `coverage-request`-world оголошує ВЛАСНИЙ локальний WIT `variant
//! domain-error` (доккомент `coverage-provider.wit`: «форма ідентична
//! `world.wit::domain-error`»), але СТРУКТУРНО він `not-supported`/
//! `failed(string)` — той самий набір станів, що вже несе
//! [`crate::domain::DomainError`] для `ecosystem-outdated`/`docgen-render`.
//! Другий Rust-тип з тими самими двома варіантами додав би дублікат без
//! жодної нової семантики — конверсія host-боку (`rules-plugin-host::convert`)
//! мапить WIT-локальний `coverage-domain-error` СЮДИ, а не в новий enum.

use serde::{Deserialize, Serialize};

/// Пара covered/total — точний відповідник WIT `record coverage-counts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverageCounts {
    pub covered: u32,
    pub total: u32,
}

/// Мутаційний рахунок — точний відповідник WIT `record mutation-counts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationCounts {
    pub caught: u32,
    pub total: u32,
}

/// Один вимір результату `collect-coverage` — точний відповідник WIT
/// `record coverage-area`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverageArea {
    pub area: String,
    pub lines: CoverageCounts,
    pub functions: CoverageCounts,
    pub mutation: MutationCounts,
    pub survived_files: Vec<String>,
}

/// Повний результат `collect-coverage` — точний відповідник WIT `record
/// coverage-report`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverageReport {
    pub areas: Vec<CoverageArea>,
}

/// Запит `collect-coverage` — точний відповідник WIT `record
/// coverage-request`, дослівні параметри `provider.collect(cwd, {
/// mutationRefreshFiles })` (`npm/rules/test/coverage/main.mjs:119`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverageRequest {
    pub cwd: String,
    pub mutation_refresh_files: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coverage_report_round_trips_through_json() {
        let report = CoverageReport {
            areas: vec![CoverageArea {
                area: "Rust".to_string(),
                lines: CoverageCounts {
                    covered: 10,
                    total: 20,
                },
                functions: CoverageCounts {
                    covered: 3,
                    total: 4,
                },
                mutation: MutationCounts {
                    caught: 5,
                    total: 8,
                },
                survived_files: vec!["src/lib.rs".to_string()],
            }],
        };
        let json = serde_json::to_value(&report).unwrap();
        let back: CoverageReport = serde_json::from_value(json).unwrap();
        assert_eq!(back, report);
    }

    #[test]
    fn coverage_request_defaults_are_empty() {
        let request = CoverageRequest::default();
        assert_eq!(request.cwd, "");
        assert!(request.mutation_refresh_files.is_empty());
    }
}
