//! Бенч-калібрування дефолтів [`llm_lib::batch`] (задача T6) на локальному
//! omlx: прожене N коротких промптів через [`llm_lib::batch::submit`] для
//! декількох комбінацій `chunk_size`/`concurrency`, друкує час/успішність.
//!
//! Запуск: `N_LOCAL_MIN_MODEL=omlx/<model-id> cargo run --release --example batch_bench`
//! (модель береться з `N_LOCAL_MIN_MODEL`, як і в `local_live.rs`; ендпоінт —
//! `http://127.0.0.1:8000/v1/` з `OMLX_API_KEY`, той самий контракт, що й
//! `LocalCloud::new` очікує від `~/.omlx/settings.json`-налаштованого сервера).

use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use std::time::Instant;

use llm_lib::batch::{submit, BatchConfig, BatchItem};
use llm_lib::local_cloud::LocalProvider;
use llm_lib::LocalCloud;

const ITEM_COUNT: usize = 48;

#[tokio::main]
async fn main() {
    let model = env::var("N_LOCAL_MIN_MODEL").unwrap_or_else(|_| {
        eprintln!(
            "N_LOCAL_MIN_MODEL не задано — приклад: N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit"
        );
        std::process::exit(1);
    });

    let mut local_providers = HashMap::new();
    local_providers.insert(
        "omlx".to_string(),
        LocalProvider {
            base_url: "http://127.0.0.1:8000/v1/".to_string(),
            api_key: env::var("OMLX_API_KEY").ok(),
        },
    );
    let cascade = Arc::new(LocalCloud::new(local_providers));

    let items: Vec<BatchItem> = (0..ITEM_COUNT)
        .map(|i| BatchItem {
            custom_id: format!("item-{i}"),
            prompt: format!(
                "Скажи рівно одне слово українською, що римується з номером {i}: просто слово, без пояснень."
            ),
            system: None,
        })
        .collect();

    println!("модель: {model}, items: {ITEM_COUNT}");
    println!(
        "{:>10} {:>12} {:>10} {:>10} {:>10}",
        "chunk_size", "concurrency", "час(с)", "ok", "err"
    );

    for chunk_size in [5usize, 15, 35] {
        for concurrency in [1usize, 2, 4] {
            let config = BatchConfig {
                chunk_size,
                concurrency,
            };
            let executor = {
                let cascade = Arc::clone(&cascade);
                let model = model.clone();
                move |item: BatchItem| {
                    let cascade = Arc::clone(&cascade);
                    let model = model.clone();
                    async move {
                        cascade
                            .one_shot_with_spec(&model, item.system.as_deref(), &item.prompt)
                            .await
                    }
                }
            };

            let start = Instant::now();
            let results = submit(items.clone(), &config, executor, |_p| {}).await;
            let elapsed = start.elapsed();

            let ok = results.iter().filter(|r| r.outcome.is_ok()).count();
            let err = results.len() - ok;
            println!(
                "{chunk_size:>10} {concurrency:>12} {:>10.2} {ok:>10} {err:>10}",
                elapsed.as_secs_f64()
            );
        }
    }
}
