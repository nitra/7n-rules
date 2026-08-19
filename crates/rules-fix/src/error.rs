//! Помилка публічного входу [`crate::fix_concern`].

use thiserror::Error;

/// Категорії відмови, окремі від того, що вже несуть свої тексти
/// (`RulesError`/`FixReport`-помилка петлі) — навмисно плоский перелік, за
/// зразком `rules_core::RulesError`/`llm_lib::LlmError`.
#[derive(Debug, Error)]
pub enum FixConcernError {
    /// `key` не у форматі `ruleId/concernId`.
    #[error("невалідний ключ concern-а (очікується \"ruleId/concernId\"): {0}")]
    InvalidKey(String),
    /// Не вдалося резолвити корінь встановленого пакета `@7n/rules`
    /// (`rules_core::rules_package::rules_root`).
    #[error("{}", rules_core::rules_package::missing_package_root_hint())]
    MissingPackageRoot,
    /// `concern.json` відсутній, невалідний, або концерн без жодної
    /// поверхні (`rules_core::concern_meta::read_concern_meta`).
    #[error("не вдалося прочитати concern.json для {0}")]
    MissingConcernMeta(String),
    /// Помилка першого (розвідувального) прогону детектора — до нього, а не
    /// петлі `fix`, тому окремий варіант.
    #[error("детектор: {0}")]
    Detect(String),
    /// Помилка самої петлі `fix` (`harness::pipeline::run_fix`).
    #[error("петля fix: {0}")]
    Pipeline(String),
}
