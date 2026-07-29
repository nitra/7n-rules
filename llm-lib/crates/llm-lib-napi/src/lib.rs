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
use llm_lib::{LlmError, LocalCloud, ModelEnv, Tier};
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

fn parse_model_env(s: &str) -> Result<ModelEnv> {
    match s {
        "N_LOCAL_MIN_MODEL" | "min" => Ok(ModelEnv::LocalMin),
        "N_LOCAL_AVG_MODEL" | "avg" => Ok(ModelEnv::LocalAvg),
        "N_LOCAL_MAX_MODEL" | "max" => Ok(ModelEnv::LocalMax),
        "N_CLOUD_MIN_MODEL" => Ok(ModelEnv::CloudMin),
        "N_CLOUD_AVG_MODEL" => Ok(ModelEnv::CloudAvg),
        "N_CLOUD_MAX_MODEL" => Ok(ModelEnv::CloudMax),
        other => Err(Error::from_reason(format!(
            "невідома model env-сходинка {other:?}: очікується N_LOCAL_*_MODEL або N_CLOUD_*_MODEL"
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

/// Каскадне розв'язання від явної `N_LOCAL_*_MODEL`/`N_CLOUD_*_MODEL`
/// сходинки у `"provider/model-id"` — чиста функція,
/// без мережевого виклику. Єдине джерело правди для `resolveModel` з
/// `llm-lib/lib/model-tiers.mjs` (задача T5, рішення Е).
#[napi]
pub fn resolve_model(start: String) -> Result<Option<String>> {
    Ok(llm_lib::resolve_model_from(parse_model_env(&start)?))
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
/// `model_spec_or_tier` — явний `"provider/model-id"`, абстрактний tier
/// (`min`/`avg`/`max`) або `N_LOCAL_*_MODEL`/`N_CLOUD_*_MODEL` selector.
/// Tier і selector резолвляться тією самою universal policy, що й
/// [`resolve_model`] napi-експорт вище.
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

    let result = match cascade.resolve_spec(&model_spec_or_tier) {
        Ok(spec) => cascade.one_shot_with_spec(&spec, system, &prompt).await,
        Err(error) => Err(error),
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

/// Ліміти чанка/конкурентності емуляції та опитування справжнього Batch API
/// для [`submit_batch`]. Незадане поле — дефолт
/// [`llm_lib::batch::BatchConfig::default`] (чанк 35, конкурентність 2,
/// рішення Р, бенч-калібрування — `docs/specs/2026-07-24-batch-emulation-bench.md`)
/// чи [`llm_lib::remote_batch::RemoteBatchConfig::default`] (опитування
/// кожні 2с, ліміт 20хв — спека `2026-07-27-batch-local-avg-real-batches.md`).
#[napi(object)]
#[derive(Default)]
pub struct BatchConfigInput {
    /// Скільки items обробляється в одному чанку (лише емуляція).
    pub chunk_size: Option<u32>,
    /// Скільки items одного чанка виконуються паралельно (лише емуляція).
    pub concurrency: Option<u32>,
    /// Вибір бекенда: `"emulated"` | `"openai-batches"` | `"auto"` (дефолт) —
    /// `"auto"` пробує справжній `/v1/batches` лише коли резолвлений
    /// провайдер `litellm` (кешована мережева проба на процес).
    pub backend: Option<String>,
    /// Пауза між `GET /v1/batches/{id}` у мілісекундах (лише справжній backend).
    pub poll_interval_ms: Option<u32>,
    /// М'який ліміт часу очікування завершення batch-у в мілісекундах
    /// (лише справжній backend) — по вичерпанню шле best-effort cancel.
    pub poll_timeout_ms: Option<u32>,
}

fn parse_backend(s: &str) -> Result<llm_lib::BatchBackend> {
    match s {
        "emulated" => Ok(llm_lib::BatchBackend::Emulated),
        "openai-batches" => Ok(llm_lib::BatchBackend::OpenAiBatches),
        "auto" => Ok(llm_lib::BatchBackend::Auto),
        other => Err(Error::from_reason(format!(
            "невідомий batch backend {other:?}: очікується \"emulated\"/\"openai-batches\"/\"auto\""
        ))),
    }
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

/// Тип 2b (batch, задача T6, спека `2026-07-27-batch-local-avg-real-batches.md`):
/// [`llm_lib::dispatch_batch`] обирає між клієнтською емуляцією (чанкований
/// конкурентний прогін через [`llm_lib::LocalCloud`], той самий
/// `model_spec_or_tier`/`options`-контракт, що й [`one_shot_local_cloud`]) і
/// справжнім `/v1/batches` litellm batch-adapter-а — під тим самим
/// інтерфейсом `submit → progress → results`. Помилка одного item чи
/// одного чанка/усього batch-у, що впав до старту item-ів, не валить виклик
/// — потрапляє в `error`-поле відповідного [`BatchResultOutput`].
///
/// `on_progress` — опційний JS-колбек `(completed, total) => void`,
/// викликається napi `ThreadsafeFunction`-ом (рішення для T6: прогрес не
/// акумулюється в Rust і не блокує event loop Node — кожне завершення
/// item-у чи кожен poll публікується окремим non-blocking викликом у
/// JS-потік).
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
    let cascade = LocalCloud::new(providers);
    let global_system = options.system;

    let batch_items: Vec<llm_lib::batch::BatchItem> = items
        .into_iter()
        .map(|item| llm_lib::batch::BatchItem {
            custom_id: item.custom_id,
            prompt: item.prompt,
            system: item.system,
        })
        .collect();

    let mut batch_config = llm_lib::batch::BatchConfig::default();
    let mut remote_config = llm_lib::remote_batch::RemoteBatchConfig::default();
    let mut backend = llm_lib::BatchBackend::Auto;
    if let Some(cfg) = &config {
        if let Some(chunk_size) = cfg.chunk_size {
            batch_config.chunk_size = chunk_size as usize;
        }
        if let Some(concurrency) = cfg.concurrency {
            batch_config.concurrency = concurrency as usize;
        }
        if let Some(ms) = cfg.poll_interval_ms {
            remote_config.poll_interval = std::time::Duration::from_millis(u64::from(ms));
        }
        if let Some(ms) = cfg.poll_timeout_ms {
            remote_config.poll_timeout = std::time::Duration::from_millis(u64::from(ms));
        }
        if let Some(b) = &cfg.backend {
            backend = parse_backend(b)?;
        }
    }

    let on_progress_fn = move |progress: llm_lib::batch::BatchProgress| {
        if let Some(tsfn) = &on_progress {
            tsfn.call(
                Ok((progress.completed as u32, progress.total as u32)),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    };

    let results = llm_lib::dispatch_batch(
        &cascade,
        &model_spec_or_tier,
        batch_items,
        backend,
        &batch_config,
        &remote_config,
        global_system,
        on_progress_fn,
    )
    .await
    .map_err(to_napi_err)?;

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
