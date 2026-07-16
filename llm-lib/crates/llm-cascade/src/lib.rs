//! Каскадний доступ до LLM — Rust-аналог env-контракту `@7n/llm-lib`
//! (model-tiers.mjs), розширений ACP-бекендами особистих підписок (Codex,
//! Cursor CLI) поряд із local/cloud тирами через [`genai`].
//!
//! # Філософія (успадкована з `@7n/llm-lib`)
//!
//! **Жодного вбудованого retry.** Кожен `one_shot_*` — рівно один виклик;
//! невдача повертається як [`CascadeError`], а драбину ескалації (як
//! `local-min → cloud-min → cloud-avg` у JS-шарі) будує викликач, компонуючи
//! примітиви крейта. Приклад драбини з ACP-підпискою попереду метрованого
//! ключа:
//!
//! ```no_run
//! use llm_cascade::{acp::{AcpAgentKind, one_shot_acp}, local_cloud::LocalCloud, tiers::Tier};
//!
//! # async fn ladder(local_cloud: &LocalCloud, prompt: &str, cwd: &std::path::Path) -> Result<String, llm_cascade::CascadeError> {
//! if let Ok(text) = one_shot_acp(AcpAgentKind::Cursor, prompt, cwd).await {
//!     return Ok(text);
//! }
//! if let Ok(text) = one_shot_acp(AcpAgentKind::Codex, prompt, cwd).await {
//!     return Ok(text);
//! }
//! local_cloud.one_shot(Tier::Max, None, prompt).await
//! # }
//! ```

pub mod acp;
pub mod local_cloud;
pub mod tiers;

pub use acp::{one_shot_acp, AcpAgentKind};
pub use local_cloud::LocalCloud;
pub use tiers::{resolve_model, Tier};

/// Помилка каскаду. Навмисно плоска — деталі провайдера/ACP-агента вже
/// в тексті, без вкладеної типізації для кожного backend-у.
#[derive(Debug, thiserror::Error)]
pub enum CascadeError {
    /// Для тиру не задано жодної відповідної env-змінної.
    #[error("для тиру {0:?} не задано жодної N_LOCAL_*/N_CLOUD_* моделі")]
    NoModelConfigured(Tier),

    /// `"provider/model-id"` не пройшов парсинг.
    #[error("невалідний model spec: {0}")]
    InvalidModelSpec(String),

    /// Помилка самого виклику (HTTP, ACP-хендшейк, процес).
    #[error("{0}")]
    Provider(String),
}
