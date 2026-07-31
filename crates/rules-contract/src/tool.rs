//! `ToolOutput`/`LogLevel` — DTO host-функцій `run-tool`/`log` (plugin →
//! host, WIT `wit/world.wit`). Host-mediated spawn (рішення Д спеки): плагін
//! сам нічого не спавнить — лише запитує виконання задекларованого в
//! `Manifest::tools` tool-у, хост забезпечує наявність, виконує і повертає
//! вивід через цей DTO.

use serde::{Deserialize, Serialize};

/// Рівень логування `log` host-функції — точний відповідник WIT
/// `enum log-level`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Результат `run-tool` — точний відповідник WIT `record tool-output`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    /// Код завершення процесу; `None`, якщо процес не стартував (WIT
    /// `option<s32>`).
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_level_serializes_lowercase() {
        assert_eq!(serde_json::to_value(LogLevel::Warn).unwrap(), "warn");
    }

    #[test]
    fn tool_output_missing_status_round_trips_as_none() {
        let out = ToolOutput {
            status: None,
            stdout: String::new(),
            stderr: "не знайдено".to_string(),
        };
        let json = serde_json::to_value(&out).unwrap();
        let back: ToolOutput = serde_json::from_value(json).unwrap();
        assert!(back.status.is_none());
        assert_eq!(back.stderr, "не знайдено");
    }
}
