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
    /// Код завершення процесу (WIT `option<s32>`); `None` — тул не
    /// задекларований/не резолвлений `ToolResolver`-ом (спавн навіть не
    /// почався, `crates/rules-plugin-host/src/tool_resolver.rs`), процес не
    /// вдалось запустити, він перевищив таймаут (примусово вбитий) чи
    /// `wait()` провалився з ОС-помилкою — усі ці випадки не мають
    /// реального exit-коду, тож розрізняються лише текстом `stderr`.
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Один файл scratch-обміну `exec-tool` — точний відповідник WIT
/// `record scratch-file`.
///
/// `path` — ВІДНОСНИЙ до scratch-каталогу виклику (слот `scratch-dir@1`
/// `host-context`), НЕ до кореня репо: на відміну від
/// [`crate::detect::SourceFile`], чий `path` posix-relative від cwd. Форму
/// перевіряє [`crate::validators::tool::validate_tool_request`] — абсолютні
/// шляхи й `..`-сегменти хост відхиляє (scratch-каталог не має ставати
/// каналом запису в довільне місце ФС).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScratchFile {
    pub path: String,
    pub content: String,
}

/// Запит `exec-tool` — точний відповідник WIT `record tool-request`
/// (зріз 5 контракту v3.1, рішення А спеки
/// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`): надмножина
/// параметрів `run-tool` плюс виконавчий контекст.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolRequest {
    /// Ім'я тула ДОСЛІВНО як у `Manifest::tools` — зі схемою резолву
    /// (`path:bun`) чи без неї (дефолт `pinned:`, рішення В спеки).
    pub tool: String,
    pub args: Vec<String>,
    pub stdin: Option<String>,
    /// Робочий каталог процесу, posix-relative від кореня репо; `None` —
    /// сам корінь.
    pub cwd: Option<String>,
    /// Змінні середовища ПОВЕРХ успадкованого env хоста (не заміщують його
    /// цілком).
    pub env: Vec<(String, String)>,
    /// Файли, які хост матеріалізує у scratch-каталозі ПЕРЕД спавном.
    pub scratch_in: Vec<ScratchFile>,
    /// Glob-и файлів, які хост зчитує зі scratch-каталогу ПІСЛЯ виходу
    /// процесу.
    pub scratch_out: Vec<String>,
}

/// Результат `exec-tool` — точний відповідник WIT `record tool-result`:
/// [`ToolOutput`] плюс зібрані за `scratch_out`-глобами файли.
///
/// `status: None` означає рівно те саме, що й у [`ToolOutput`] (доккомент
/// поля там) — включно з «тул не задекларований/не резолвлений», що для
/// `exec-tool` після винесення провізіонінгу в `tools ensure` є ЄДИНОЮ
/// реакцією на промах резолву: ні мережі, ні авто-встановлення в
/// lint-рантаймі.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolResult {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// Порожньо, якщо тул нічого не створив — гість трактує це як «звіту
    /// немає», не як помилку.
    pub scratch_out: Vec<ScratchFile>,
}

impl ToolResult {
    /// Типізована помилка `exec-tool` без спавна (`status: None`, порожній
    /// вивід, людиночитний `stderr`) — та сама форма, що дає `run-tool` на
    /// незадекларований тул.
    pub fn failed(stderr: impl Into<String>) -> Self {
        Self {
            status: None,
            stdout: String::new(),
            stderr: stderr.into(),
            scratch_out: Vec::new(),
        }
    }
}

impl From<ToolOutput> for ToolResult {
    /// `run-tool` ≡ `exec-tool` без контексту (доккомент WIT біля
    /// `import exec-tool`) — конверсія добудовує лише порожній
    /// `scratch_out`.
    fn from(output: ToolOutput) -> Self {
        Self {
            status: output.status,
            stdout: output.stdout,
            stderr: output.stderr,
            scratch_out: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_output_converts_to_tool_result_with_empty_scratch() {
        let result = ToolResult::from(ToolOutput {
            status: Some(0),
            stdout: "ok".to_string(),
            stderr: String::new(),
        });
        assert_eq!(result.status, Some(0));
        assert_eq!(result.stdout, "ok");
        assert!(result.scratch_out.is_empty());
    }

    #[test]
    fn failed_result_has_no_status_and_no_output() {
        let result = ToolResult::failed("тул не задекларовано");
        assert!(result.status.is_none());
        assert!(result.stdout.is_empty());
        assert!(result.scratch_out.is_empty());
        assert!(result.stderr.contains("не задекларовано"));
    }

    #[test]
    fn tool_request_round_trips_through_json() {
        let request = ToolRequest {
            tool: "path:bun".to_string(),
            args: vec!["x".to_string(), "licensee".to_string()],
            stdin: None,
            cwd: Some("npm".to_string()),
            env: vec![("NO_COLOR".to_string(), "1".to_string())],
            scratch_in: vec![ScratchFile {
                path: "policy.rego".to_string(),
                content: "package p\n".to_string(),
            }],
            scratch_out: vec!["*.json".to_string()],
        };
        let back: ToolRequest =
            serde_json::from_value(serde_json::to_value(&request).unwrap()).unwrap();
        assert_eq!(back, request);
    }

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
