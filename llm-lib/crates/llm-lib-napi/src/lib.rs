//! napi-біндінги до `llm-lib` для `@7n/llm-lib`.
//!
//! Тонкий шар: конвертація типів JS ⇄ Rust і мапінг помилок у `napi::Error`.
//! Уся ACP/tiers/local_cloud-логіка живе в `llm-lib` — жодного
//! повторного JSON-RPC чи каскадного коду тут. JS-обгортка — плановано
//! `llm-lib/lib/acp.mjs` + `llm-lib/lib/internal/native.mjs`.

use std::collections::HashMap;
use std::path::PathBuf;

use llm_lib::acp::AcpAgentKind;
use llm_lib::local_cloud::LocalProvider;
use llm_lib::{LlmError, LocalCloud, Tier};
use napi::bindgen_prelude::*;
use napi_derive::napi;

fn to_napi_err(e: LlmError) -> Error {
    Error::from_reason(e.to_string())
}

fn parse_agent_kind(s: &str) -> Result<AcpAgentKind> {
    match s {
        "cursor" => Ok(AcpAgentKind::Cursor),
        "codex" => Ok(AcpAgentKind::Codex),
        other => Err(Error::from_reason(format!(
            "невідомий ACP-агент {other:?}: очікується \"cursor\" чи \"codex\""
        ))),
    }
}

fn parse_tier(s: &str) -> Result<Tier> {
    match s {
        "min" => Ok(Tier::Min),
        "avg" => Ok(Tier::Avg),
        "max" => Ok(Tier::Max),
        other => Err(Error::from_reason(format!(
            "невідомий тир {other:?}: очікується \"min\"/\"avg\"/\"max\""
        ))),
    }
}

/// Один виклик через ACP-агента з особистою підпискою (`cursor`/`codex`).
/// `cwd` — робочий каталог проєкту-викликача (не process cwd).
#[napi]
pub async fn one_shot_acp(kind: String, prompt: String, cwd: String) -> Result<String> {
    let agent = parse_agent_kind(&kind)?;
    llm_lib::acp::one_shot_acp(agent, &prompt, &PathBuf::from(cwd))
        .await
        .map_err(to_napi_err)
}

/// Каскадне розв'язання абстрактного тиру (`min`/`avg`/`max`) у
/// `"provider/model-id"` за `N_LOCAL_*`/`N_CLOUD_*` env — чиста функція,
/// без мережевого виклику.
#[napi]
pub fn resolve_model(tier: String) -> Result<Option<String>> {
    Ok(llm_lib::resolve_model(parse_tier(&tier)?))
}

/// Один chat-виклик local/cloud тиру. `local_providers` — JSON-мапа
/// `{ "<provider>": { "baseUrl": "...", "apiKey": "..." | null } }`.
#[napi]
pub async fn one_shot_local_cloud(
    local_providers: serde_json::Value,
    tier: String,
    system: Option<String>,
    user: String,
) -> Result<String> {
    let providers: HashMap<String, LocalProvider> = serde_json::from_value(local_providers)
        .map_err(|e| Error::from_reason(format!("невалідний local_providers: {e}")))?;
    let cascade = LocalCloud::new(providers);
    cascade
        .one_shot(parse_tier(&tier)?, system.as_deref(), &user)
        .await
        .map_err(to_napi_err)
}
