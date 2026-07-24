//! napi-біндінги до `llm-lib` для `@7n/llm-lib`.
//!
//! Тонкий шар: конвертація типів JS ⇄ Rust і мапінг помилок у `napi::Error`.
//! Уся ACP/tiers/local_cloud-логіка живе в `llm-lib` — жодного
//! повторного JSON-RPC чи каскадного коду тут. JS-обгортка —
//! `llm-lib/lib/acp.mjs` + `llm-lib/lib/local-cloud.mjs` +
//! `llm-lib/lib/model-tiers.mjs` (задача T5: остання делегує сюди
//! `resolveModel`, більше не тримає власного каскаду).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use llm_lib::acp::AcpAgentKind;
use llm_lib::local_cloud::LocalProvider;
use llm_lib::{LlmError, LocalCloud, Tier};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

fn to_napi_err(e: LlmError) -> Error {
    Error::from_reason(e.to_string())
}

fn parse_agent_kind(s: &str) -> Result<AcpAgentKind> {
    match s {
        "cursor" => Ok(AcpAgentKind::Cursor),
        "codex" => Ok(AcpAgentKind::Codex),
        "pi" => Ok(AcpAgentKind::Pi),
        other => Err(Error::from_reason(format!(
            "невідомий ACP-агент {other:?}: очікується \"cursor\"/\"codex\"/\"pi\""
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

/// Один виклик через ACP-агента з особистою підпискою (`cursor`/`codex`/`pi`).
/// `cwd` — робочий каталог проєкту-викликача (не process cwd). `tier` —
/// опційний абстрактний тир (`min`/`avg`/`max`, задача T5, рішення И): якщо
/// заданий, Rust сам резолвить tier→env/args/post-session-config з пресету
/// агента ([`llm_lib::acp::one_shot_acp_with_tier`]) — жодного JS-хелпера
/// "пресет→env" не потрібно. Без тиру — стара поведінка (модель = персональний
/// конфіг CLI на машині).
#[napi]
pub async fn one_shot_acp(
    kind: String,
    prompt: String,
    cwd: String,
    tier: Option<String>,
) -> Result<String> {
    let agent = parse_agent_kind(&kind)?;
    let cwd = PathBuf::from(cwd);
    match tier {
        Some(t) => {
            let tier = parse_tier(&t)?;
            llm_lib::acp::one_shot_acp_with_tier(agent, tier, &prompt, &cwd)
                .await
                .map_err(to_napi_err)
        }
        None => llm_lib::acp::one_shot_acp(agent, &prompt, &cwd)
            .await
            .map_err(to_napi_err),
    }
}

/// Пресети ACP-агентів (задача T5, рішення Б): для кожного `kind`-у —
/// `command`/`label`, для кожного тиру — `label`/`env`/`args`/`postSessionConfig`
/// (серіалізований [`llm_lib::acp::TierPreset`]). Джерело — виключно Rust-пресети
/// `llm_lib::acp::presets`, жодного окремого JS-data-пакета (рішення Б).
#[napi]
pub fn get_acp_presets() -> serde_json::Value {
    let mut kinds = serde_json::Map::new();
    for (name, kind) in [
        ("cursor", AcpAgentKind::Cursor),
        ("codex", AcpAgentKind::Codex),
        ("pi", AcpAgentKind::Pi),
    ] {
        let mut tiers = serde_json::Map::new();
        for (tier_name, tier) in [("min", Tier::Min), ("avg", Tier::Avg), ("max", Tier::Max)] {
            let preset = kind.tier_preset(tier);
            let post_session_config = preset.post_session_config.map(|config| {
                serde_json::json!({
                    "configId": config.config_id,
                    "value": config.value,
                })
            });
            tiers.insert(
                tier_name.to_string(),
                serde_json::json!({
                    "label": preset.label,
                    "env": preset.env,
                    "args": preset.extra_args,
                    "postSessionConfig": post_session_config,
                }),
            );
        }
        kinds.insert(
            name.to_string(),
            serde_json::json!({
                "command": kind.command(),
                "label": kind.label(),
                "tiers": tiers,
            }),
        );
    }
    serde_json::Value::Object(kinds)
}

/// Каскадне розв'язання абстрактного тиру (`min`/`avg`/`max`) у
/// `"provider/model-id"` за `N_LOCAL_*`/`N_CLOUD_*` env — чиста функція,
/// без мережевого виклику. Єдине джерело правди для `resolveModel` з
/// `llm-lib/lib/model-tiers.mjs` (задача T5, рішення Е).
#[napi]
pub fn resolve_model(tier: String) -> Result<Option<String>> {
    Ok(llm_lib::resolve_model(parse_tier(&tier)?))
}

/// Опції [`one_shot_local_cloud`]: конфіг локальних провайдерів (`omlx` тощо)
/// і опційна system-репліка. Обидва опційні — без локальних провайдерів
/// `modelSpecOrTier`, що резолвиться в них, просто провалиться помилкою
/// "невідомий провайдер" глибше в `llm_lib::local_cloud`.
#[napi(object)]
#[derive(Default)]
pub struct OneShotLocalCloudOptions {
    /// JSON-мапа `{ "<provider>": { "baseUrl": "...", "apiKey": "..." | null } }`.
    pub local_providers: Option<serde_json::Value>,
    /// System-репліка чату.
    pub system: Option<String>,
}

/// Один chat-виклик Типу 2a (OpenAI-сумісний API, sync) для Node.
/// `model_spec_or_tier` — або явний `"provider/model-id"`, або абстрактний
/// тир (`min`/`avg`/`max`), що резолвиться через [`llm_lib::resolve_model`]
/// (та сама функція, що й [`resolve_model`] napi-експорт вище) — задача T5.
#[napi]
pub async fn one_shot_local_cloud(
    model_spec_or_tier: String,
    prompt: String,
    options: Option<OneShotLocalCloudOptions>,
) -> Result<String> {
    let options = options.unwrap_or_default();
    let providers: HashMap<String, LocalProvider> = match options.local_providers {
        Some(v) => serde_json::from_value(v)
            .map_err(|e| Error::from_reason(format!("невалідний localProviders: {e}")))?,
        None => HashMap::new(),
    };
    let cascade = LocalCloud::new(providers);
    let system = options.system.as_deref();

    let result = match model_spec_or_tier.as_str() {
        "min" => cascade.one_shot(Tier::Min, system, &prompt).await,
        "avg" => cascade.one_shot(Tier::Avg, system, &prompt).await,
        "max" => cascade.one_shot(Tier::Max, system, &prompt).await,
        spec => cascade.one_shot_with_spec(spec, system, &prompt).await,
    };
    result.map_err(to_napi_err)
}

/// Один item вхідного batch-у (Тип 2b, задача T6): дзеркалить
/// [`llm_lib::batch::BatchItem`] у JS-обʼєкт.
#[napi(object)]
pub struct BatchItemInput {
    /// Ідентифікатор, яким викликач звʼязує запит із результатом.
    pub custom_id: String,
    /// User-репліка чату.
    pub prompt: String,
    /// Опційна system-репліка item-у (якщо не задано — береться
    /// `options.system`, той самий дефолт, що й [`one_shot_local_cloud`]).
    pub system: Option<String>,
}

/// Ліміти чанка/конкурентності для [`submit_batch`]. Незадане поле —
/// дефолт [`llm_lib::batch::BatchConfig::default`] (чанк 35, конкурентність 2,
/// рішення Р, бенч-калібрування — `docs/specs/2026-07-24-batch-emulation-bench.md`).
#[napi(object)]
#[derive(Default)]
pub struct BatchConfigInput {
    /// Скільки items обробляється в одному чанку.
    pub chunk_size: Option<u32>,
    /// Скільки items одного чанка виконуються паралельно.
    pub concurrency: Option<u32>,
}

/// Результат одного item batch-у: рівно одне з `ok`/`error` заповнене —
/// дзеркалить [`llm_lib::batch::BatchResult::outcome`] без `Result`-типу,
/// якого немає в JS.
#[napi(object)]
pub struct BatchResultOutput {
    /// Той самий `custom_id`, що й у вхідному [`BatchItemInput`].
    pub custom_id: String,
    /// Текст відповіді — заповнене на успіху.
    pub ok: Option<String>,
    /// Повідомлення про помилку саме цього item — заповнене на невдачі.
    pub error: Option<String>,
}

/// Емуляція Типу 2b (batch, рішення Р спеки, задача T6): чанкований
/// конкурентний прогін `items` через [`llm_lib::LocalCloud`] (той самий
/// `model_spec_or_tier`/`options`-контракт, що й [`one_shot_local_cloud`]),
/// під інтерфейсом `submit → progress → results`. Помилка одного item чи
/// одного чанка не валить весь batch — потрапляє в `error`-поле саме
/// цього [`BatchResultOutput`].
///
/// `on_progress` — опційний JS-колбек `(completed, total) => void`,
/// викликається napi `ThreadsafeFunction`-ом (рішення для T6: прогрес не
/// акумулюється в Rust і не блокує event loop Node — кожне завершення
/// item-у публікується окремим non-blocking викликом у JS-потік).
#[napi]
pub async fn submit_batch(
    model_spec_or_tier: String,
    items: Vec<BatchItemInput>,
    options: Option<OneShotLocalCloudOptions>,
    config: Option<BatchConfigInput>,
    on_progress: Option<Arc<ThreadsafeFunction<(u32, u32), ()>>>,
) -> Result<Vec<BatchResultOutput>> {
    let options = options.unwrap_or_default();
    let providers: HashMap<String, LocalProvider> = match options.local_providers {
        Some(v) => serde_json::from_value(v)
            .map_err(|e| Error::from_reason(format!("невалідний localProviders: {e}")))?,
        None => HashMap::new(),
    };
    let cascade = Arc::new(LocalCloud::new(providers));
    let global_system = options.system;
    let model_spec_or_tier = Arc::new(model_spec_or_tier);

    let batch_items: Vec<llm_lib::batch::BatchItem> = items
        .into_iter()
        .map(|item| llm_lib::batch::BatchItem {
            custom_id: item.custom_id,
            prompt: item.prompt,
            system: item.system,
        })
        .collect();

    let mut batch_config = llm_lib::batch::BatchConfig::default();
    if let Some(cfg) = config {
        if let Some(chunk_size) = cfg.chunk_size {
            batch_config.chunk_size = chunk_size as usize;
        }
        if let Some(concurrency) = cfg.concurrency {
            batch_config.concurrency = concurrency as usize;
        }
    }

    let executor = {
        let cascade = Arc::clone(&cascade);
        let model_spec_or_tier = Arc::clone(&model_spec_or_tier);
        move |item: llm_lib::batch::BatchItem| {
            let cascade = Arc::clone(&cascade);
            let model_spec_or_tier = Arc::clone(&model_spec_or_tier);
            let system = item.system.clone().or_else(|| global_system.clone());
            async move {
                let system = system.as_deref();
                match model_spec_or_tier.as_str() {
                    "min" => cascade.one_shot(Tier::Min, system, &item.prompt).await,
                    "avg" => cascade.one_shot(Tier::Avg, system, &item.prompt).await,
                    "max" => cascade.one_shot(Tier::Max, system, &item.prompt).await,
                    spec => cascade.one_shot_with_spec(spec, system, &item.prompt).await,
                }
            }
        }
    };

    let on_progress_fn = move |progress: llm_lib::batch::BatchProgress| {
        if let Some(tsfn) = &on_progress {
            tsfn.call(
                Ok((progress.completed as u32, progress.total as u32)),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    };

    let results =
        llm_lib::batch::submit(batch_items, &batch_config, executor, on_progress_fn).await;

    Ok(results
        .into_iter()
        .map(|result| match result.outcome {
            Ok(text) => BatchResultOutput {
                custom_id: result.custom_id,
                ok: Some(text),
                error: None,
            },
            Err(message) => BatchResultOutput {
                custom_id: result.custom_id,
                ok: None,
                error: Some(message),
            },
        })
        .collect())
}
