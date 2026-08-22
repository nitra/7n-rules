//! Локальний ADR-нормалізатор — Rust-порт конвеєра
//! `npm/scripts/lib/adr/normalize-pipeline.mjs` (клас 1 спеки
//! `2026-08-08-llm-lib-acp-only-rust-goose.md`, рядок `adr-normalize-local`).
//!
//! Інверсія керування збережена дослівно: оркеструє код, LLM відповідає лише
//! на вузькі verifiable-питання (бінарний edge-judge, standalone/trivial,
//! JSON-зміст секцій, merge-проза) — глобальний стан (кластери, слаги,
//! MADR-каркас, дати) детермінований. LLM-стадії йдуть batch-хвилями через
//! `llm_lib::batch::dispatch` (native OpenAI-batch чи ACP-емуляція — фасад
//! вирішує сам), із каскадом двох тирів tier1 → tier2 → conservative fallback.
//!
//! Вихідний контракт — той самий `{"operations": [...]}`-JSON, що його
//! застосовує bash (`normalize-decisions.sh`); формат операцій дзеркальний
//! до JS-версії поле в поле.

/// Спільний 2-хвильовий batch-каскад стадій (tier1 → tier2) і типи хвилі.
pub mod cascade;
/// Каркас MADR-документа: секції, frontmatter, детерміновані слаги й дати.
pub mod madr;
/// Головний конвеєр нормалізації: стадії, рішення по драфтах, операції.
pub mod pipeline;
/// Stage 0 — детермінований відбір кандидатів на порівняння (ребра).
pub mod retrieval;

use std::sync::Arc;

use cascade::{ChainRef, SubmitBatchFn, WaveItem, WaveResult};
use llm_lib::attempt::BoxFuture;
use llm_lib::batch::{dispatch, BatchItem, DispatchConfig};
use llm_lib::budget::EgressPolicy;
use llm_lib::local_cloud::{default_local_openai_provider, LocalCloud};
use llm_lib::remote_batch::RemoteBatchConfig;
use llm_lib::tiers::{parse_model_spec, resolve_model, Tier};

/// Ідентифікатор застосунку для trace-рядків batch-фасаду.
const CALLER: &str = "rules-adr";

/// Бойовий виконавець хвилі — обгортка над [`llm_lib::batch::dispatch`].
///
/// `LocalCloud` будується з universal-слотом локального провайдера за
/// ПРЕФІКСОМ моделі хвилі (той самий контракт, що `defaultLocalProviders()`
/// у JS і воркер cspell у `rules-fix`): будь-який OpenAI-сумісний сервер,
/// хоч би як користувач його назвав. Egress тут завжди `AllowCloud` —
/// приватність вирішується вище (`allow_cloud` каскаду просто не подає
/// tier2-хвилю), а не забороною на рівні транспорту.
///
/// # Ланцюжок
///
/// Handle прогону передається в `dispatch` як `Some(&mut …)`, тож per-item
/// рядки trace усіх хвиль лягають під один `chainId` із наскрізним
/// `chainStep`. Guard тримається на весь виклик хвилі — саме тому
/// [`ChainRef`] на `tokio::sync::Mutex` (див. його доккоментар). `end()`
/// звідси НЕ викликається: підсумковий рядок закриває власник ланцюжка
/// ([`pipeline::normalize_pipeline`]) — лише він знає, що хвиля була
/// остання.
#[must_use]
pub fn native_submit_batch() -> SubmitBatchFn {
    Arc::new(|model: String, items: Vec<WaveItem>, chain: ChainRef| {
        let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            let mut providers = std::collections::HashMap::new();
            if let Ok((prefix, _)) = parse_model_spec(&model) {
                providers.insert(prefix.to_string(), default_local_openai_provider());
            }
            let cascade = LocalCloud::new(providers);
            let batch_items: Vec<BatchItem> = items
                .into_iter()
                .map(|i| BatchItem {
                    custom_id: i.custom_id,
                    prompt: i.prompt,
                    system: Some(i.system),
                })
                .collect();
            let remote_config = RemoteBatchConfig::default();
            let config = DispatchConfig {
                cascade: &cascade,
                model_spec_or_tier: &model,
                remote_config: &remote_config,
                global_system: None,
                acp_config: None,
                egress: EgressPolicy::AllowCloud,
                caller: CALLER,
            };
            let mut chain = chain.lock().await;
            let results = dispatch(&config, batch_items, |_progress| {}, Some(&mut chain))
                .await
                .map_err(|e| e.to_string())?;
            Ok(results
                .into_iter()
                .map(|r| WaveResult {
                    custom_id: r.custom_id,
                    outcome: r.outcome,
                })
                .collect())
        });
        fut
    })
}

/// Резолв моделей тирів для CLI-шару: tier1 — локальна (`N_LOCAL_MODEL`),
/// tier2 — хмарна `N_CLOUD_MIN_MODEL`. Порожній рядок = тир недоступний
/// (каскад пропустить хвилю) — та сама семантика, що в JS.
#[must_use]
pub fn resolve_tiers() -> (String, String) {
    (
        resolve_model(Tier::Local).unwrap_or_default(),
        resolve_model(Tier::CloudMin).unwrap_or_default(),
    )
}
