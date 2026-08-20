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

pub mod cascade;
pub mod madr;
pub mod pipeline;
pub mod retrieval;

use std::sync::Arc;

use cascade::{SubmitBatchFn, WaveItem, WaveResult};
use llm_lib::attempt::BoxFuture;
use llm_lib::batch::{dispatch, BatchItem};
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
#[must_use]
pub fn native_submit_batch() -> SubmitBatchFn {
    Arc::new(|model: String, items: Vec<WaveItem>| {
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
            let results = dispatch(
                &cascade,
                &model,
                batch_items,
                &RemoteBatchConfig::default(),
                None,
                None,
                EgressPolicy::AllowCloud,
                |_progress| {},
                CALLER,
            )
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
