//! Каскадний доступ до LLM — Rust-аналог env-контракту `@7n/llm-lib`
//! (model-tiers.mjs), розширений ACP-бекендами особистих підписок (Codex,
//! Cursor CLI) поряд із local/cloud тирами через [`genai`].
//!
//! # Feature-split (Р9 спеки rules-v2, фаза 5 фінал)
//!
//! `tiers` (env-каскад вибору моделі, `parse_model_spec`, `is_local_model`) —
//! **завжди** доступний, лише serde/thiserror-клас залежностей. Решта
//! (`acp`/`local_cloud`/`batch`/`remote_batch`) — за фічею `agents`
//! (у `default`), бо тягнуть `genai`/`tokio`/`reqwest`/`agent-client-protocol`.
//! Мотивація: `rules-core` (native lint-адон) бере лише `tiers` через
//! `llm-lib = { path = "...", default-features = false }` — без важкого
//! async/HTTP-стеку в бінарнику, який просто читає env-змінні для
//! `adr/hooks`-конкорна. `llm-lib-napi` не чіпає `default-features`, тож
//! `agents` лишається увімкненою — той самий бінарник, що й до split-у.
//!
//! # Філософія (успадкована з `@7n/llm-lib`)
//!
//! **Жодного вбудованого retry.** Кожен `one_shot_*` — рівно один виклик;
//! невдача повертається як [`LlmError`], а драбину ескалації (як
//! `local-min → cloud-min → cloud-avg` у JS-шарі) будує викликач, компонуючи
//! примітиви крейта. Приклад драбини з ACP-підпискою попереду метрованого
//! ключа (потребує фічі `agents`, увімкненої за замовчуванням):
//!
//! ```no_run
//! # #[cfg(feature = "agents")]
//! # {
//! use llm_lib::{acp::{AcpAgentKind, one_shot_acp}, local_cloud::LocalCloud, tiers::Tier};
//!
//! # async fn ladder(local_cloud: &LocalCloud, prompt: &str, cwd: &std::path::Path) -> Result<String, llm_lib::LlmError> {
//! if let Ok(text) = one_shot_acp(AcpAgentKind::Cursor, prompt, cwd).await {
//!     return Ok(text);
//! }
//! if let Ok(text) = one_shot_acp(AcpAgentKind::Codex, prompt, cwd).await {
//!     return Ok(text);
//! }
//! local_cloud.one_shot(Tier::Max, None, prompt).await
//! # }
//! # }
//! ```

/// Агенти (потребує фічі `agents`).
#[cfg(feature = "agents")]
pub mod acp;
/// Тип 2b (batch) — [`batch::dispatch`] завжди йде через справжній
/// `/v1/batches` OpenAI-сумісний адаптер ([`remote_batch`]) резолвленого
/// провайдера. Потребує фічі `agents`.
#[cfg(feature = "agents")]
pub mod batch;
/// Локальні та хмарні агенти (Local/Cloud). Потребує фічі `agents`.
#[cfg(feature = "agents")]
pub mod local_cloud;
/// Тип 2b, справжній бекенд: `/v1/batches` litellm batch-adapter поверх
/// upload/poll/output-протоколу OpenAI Batch API. Потребує фічі `agents`.
#[cfg(feature = "agents")]
pub mod remote_batch;
/// Моделі та рівні (Tiers) для вибору LLM — завжди доступний (без `agents`).
pub mod tiers;

#[cfg(feature = "agents")]
pub use acp::{one_shot_acp, one_shot_acp_with_tier, AcpAgentKind};
#[cfg(feature = "agents")]
pub use batch::{dispatch as dispatch_batch, BatchItem, BatchProgress, BatchResult};
#[cfg(feature = "agents")]
pub use local_cloud::LocalCloud;
pub use tiers::{resolve_model, resolve_model_from, ModelEnv, Tier};

/// Помилка каскаду. Навмисно плоска — деталі провайдера/ACP-агента вже
/// в тексті, без вкладеної типізації для кожного backend-у.
#[derive(Debug, thiserror::Error)]
pub enum LlmError {
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
