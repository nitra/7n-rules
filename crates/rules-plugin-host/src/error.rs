//! Типізовані помилки `rules-plugin-host` (рішення М спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.6):
//! вузький публічний trait — жодна wasmtime-специфічна помилка не перетинає
//! межу крейта, усе загорнуто тут у людиночитні варіанти.

use std::path::PathBuf;

/// Помилка `rules-plugin-host` — публічний тип, єдиний спосіб дізнатись про
/// збій завантаження/виконання плагіна поза цим крейтом.
#[derive(Debug, thiserror::Error)]
pub enum PluginHostError {
    /// Не вдалось прочитати/скомпілювати `.wasm` (I/O або wasm-валідація
    /// Component Model).
    #[error("не вдалось завантажити wasm-компонент {path}: {source}")]
    Load {
        path: PathBuf,
        #[source]
        source: anyhow::Error,
    },

    /// WASI preopen для одного з `capabilities.fs_read`-шляхів маніфеста не
    /// вдався (шлях відсутній чи недоступний на хості).
    #[error("preopen fs-read шляху `{path}` не вдався: {source}")]
    Preopen {
        path: PathBuf,
        #[source]
        source: anyhow::Error,
    },

    /// Плагін заявляє world-версію, несумісну (за major-компонентою) з
    /// очікуваною — skip-not-crash семантика (рішення З спеки): оркестрація
    /// ловить цей варіант і пропускає плагін, не валить прогін.
    #[error(
        "плагін заявляє world-версію `{found}` — несумісна за major з очікуваною `{expected}` (skip-not-crash)"
    )]
    IncompatibleVersion { found: String, expected: String },

    /// Інстанціація компонента (лінкінг, WASI-хук, host-функції) не
    /// вдалась.
    #[error("інстанціація wasm-компонента не вдалась: {0}")]
    Instantiate(#[source] anyhow::Error),

    /// Виконання guest-функції завершилось помилкою (trap чи інша
    /// wasmtime-помилка виклику).
    #[error("виконання guest-функції `{function}` завершилось помилкою: {source}")]
    Execution {
        function: &'static str,
        #[source]
        source: anyhow::Error,
    },

    /// Guest повернув дані, які не конвертуються в DTO контракту (напр.
    /// невалідний JSON у `diagnostic.data`).
    #[error("плагін повернув дані, несумісні з контрактом: {0}")]
    InvalidContractData(String),
}
