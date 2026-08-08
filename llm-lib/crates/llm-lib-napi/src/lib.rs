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
        "goose" => Ok(AcpAgentKind::Goose),
        other => Err(Error::from_reason(format!(
            "невідомий ACP-агент {other:?}: очікується \"cursor\"/\"codex\"/\"pi\"/\"goose\""
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

/// Tiered ACP-виклик із denylist terminal-command fragments. Заборонена
/// команда відхиляється на ACP permission boundary до її виконання.
#[napi]
pub async fn one_shot_acp_guarded(
    kind: String,
    prompt: String,
    cwd: String,
    tier: String,
    deny_command_fragments: Vec<String>,
) -> Result<String> {
    let agent = parse_agent_kind(&kind)?;
    let tier = parse_tier(&tier)?;
    llm_lib::acp::one_shot_acp_with_tier_guarded(
        agent,
        tier,
        &prompt,
        &PathBuf::from(cwd),
        deny_command_fragments,
    )
    .await
    .map_err(to_napi_err)
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
        ("goose", AcpAgentKind::Goose),
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

/// Ліміти опитування справжнього Batch API для [`submit_batch`]. Незадане
/// поле — дефолт [`llm_lib::remote_batch::RemoteBatchConfig::default`]
/// (опитування кожні 2с, ліміт 20хв — спека
/// `2026-07-27-batch-local-avg-real-batches.md`).
#[napi(object)]
#[derive(Default)]
pub struct BatchConfigInput {
    /// Пауза між `GET /v1/batches/{id}` у мілісекундах.
    pub poll_interval_ms: Option<u32>,
    /// М'який ліміт часу очікування завершення batch-у в мілісекундах —
    /// по вичерпанню шле best-effort cancel.
    pub poll_timeout_ms: Option<u32>,
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

/// Тип `on_progress`-колбека [`submit_batch`] — `FnArgs<(u32, u32)>`, не
/// голий tuple: голий tuple конвертується через бланкетний
/// `impl<T: ToNapiValue> JsValuesTupleIntoVec for T` (уся пара — ОДИН
/// JS-аргумент, масив `[completed, total]`), тоді як `JsValuesTupleIntoVec`
/// для `FnArgs<(A, B)>` розгортає tuple у ДВА окремих JS-аргументи — саме
/// так, як задокументована сигнатура `(completed, total) => void` і очікує
/// (баг був знайдений через live-тест проти реального OpenAI-сумісного
/// сервера: колбек отримував `(null, [completed, total])` замість
/// `(completed, total)`). `CalleeHandled = false` (5-й параметр) — прогрес
/// ніколи не є `Result`-помилкою (завжди `Ok`-виклик), тож без цього JS
/// отримував би ще й зайвий провідний `err`-аргумент (`null`) перед
/// `completed`/`total`, порушуючи задокументовану сигнатуру без err.
type BatchProgressCallback =
    Arc<ThreadsafeFunction<FnArgs<(u32, u32)>, (), FnArgs<(u32, u32)>, Status, false>>;

/// Тип 2b (batch, спека `2026-07-27-batch-local-avg-real-batches.md`):
/// [`llm_lib::dispatch_batch`] завжди йде через справжній `/v1/batches`
/// OpenAI-сумісний batch-adapter резолвленого провайдера (клієнтську
/// емуляцію вилучено — провайдер без зареєстрованого `base_url`/`api_key`
/// повертає явну помилку). Помилка одного item чи усього batch-у, що впав
/// до старту item-ів, не валить виклик — потрапляє в `error`-поле
/// відповідного [`BatchResultOutput`].
///
/// `on_progress` — опційний JS-колбек `(completed, total) => void`
/// ([`BatchProgressCallback`]), викликається napi `ThreadsafeFunction`-ом
/// (рішення для T6: прогрес не акумулюється в Rust і не блокує event loop
/// Node — кожне завершення item-у чи кожен poll публікується окремим
/// non-blocking викликом у JS-потік).
#[napi]
pub async fn submit_batch(
    model_spec_or_tier: String,
    items: Vec<BatchItemInput>,
    options: Option<OneShotLocalCloudOptions>,
    config: Option<BatchConfigInput>,
    on_progress: Option<BatchProgressCallback>,
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

    let mut remote_config = llm_lib::remote_batch::RemoteBatchConfig::default();
    if let Some(cfg) = &config {
        if let Some(ms) = cfg.poll_interval_ms {
            remote_config.poll_interval = std::time::Duration::from_millis(u64::from(ms));
        }
        if let Some(ms) = cfg.poll_timeout_ms {
            remote_config.poll_timeout = std::time::Duration::from_millis(u64::from(ms));
        }
    }

    let on_progress_fn = move |progress: llm_lib::batch::BatchProgress| {
        if let Some(tsfn) = &on_progress {
            tsfn.call(
                FnArgs::from((progress.completed as u32, progress.total as u32)),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    };

    // ACP-емуляція (`N_BATCH_BACKEND=acp`, спека
    // `2026-08-08-llm-lib-acp-only-rust-goose.md` §3.6) сюди ще не
    // проведена — napi-міст лишається на нативному `/v1/batches`-шляху
    // (рішення Е: JS-споживачі мігрують разом зі своїм контуром, не
    // раніше). `acp_config: None` — той самий дефолт [`Backend::Native`],
    // що й до цього зрізу.
    let results = llm_lib::dispatch_batch(
        &cascade,
        &model_spec_or_tier,
        batch_items,
        &remote_config,
        global_system,
        None,
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
