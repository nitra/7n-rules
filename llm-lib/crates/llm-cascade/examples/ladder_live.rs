//! Жива обкатка композитної драбини з README: Cursor → Codex → local →
//! cloud, кожна ланка — реальний виклик, не мок. Друкує, яка саме ланка
//! відповіла. Запуск: `cargo run --example ladder_live`

use std::collections::HashMap;
use std::env;
use std::future::Future;
use std::time::Instant;

use llm_cascade::acp::{one_shot_acp, AcpAgentKind};
use llm_cascade::local_cloud::LocalProvider;
use llm_cascade::{CascadeError, LocalCloud, Tier};

#[tokio::main]
async fn main() {
    let prompt = "Скажи рівно одне слово: працює";
    let start = Instant::now();
    let cwd = env::current_dir().expect("cwd");

    let mut local_providers = HashMap::new();
    local_providers.insert(
        "omlx".to_string(),
        LocalProvider {
            base_url: "http://127.0.0.1:8000/v1/".to_string(),
            api_key: env::var("OMLX_API_KEY").ok(),
        },
    );
    let local_cloud = LocalCloud::new(local_providers);

    if let Some(text) = try_rung(
        "acp:cursor",
        one_shot_acp(AcpAgentKind::Cursor, prompt, &cwd),
    )
    .await
    {
        return report(start, "acp:cursor", &text);
    }
    if let Some(text) = try_rung("acp:codex", one_shot_acp(AcpAgentKind::Codex, prompt, &cwd)).await
    {
        return report(start, "acp:codex", &text);
    }
    if let Some(text) = try_rung(
        "local (Tier::Min)",
        local_cloud.one_shot(Tier::Min, None, prompt),
    )
    .await
    {
        return report(start, "local (Tier::Min)", &text);
    }
    match local_cloud.one_shot(Tier::Max, None, prompt).await {
        Ok(text) => report(start, "cloud (Tier::Max)", &text),
        Err(e) => {
            eprintln!("⏭️  cloud (Tier::Max) провалився: {e}");
            eprintln!("❌ вся драбина провалилась");
            std::process::exit(1);
        }
    }
}

/// Чекає рунг, друкує причину провалу в stderr, повертає `Some(text)` при успіху.
async fn try_rung(
    name: &str,
    fut: impl Future<Output = Result<String, CascadeError>>,
) -> Option<String> {
    match fut.await {
        Ok(text) => Some(text),
        Err(e) => {
            eprintln!("⏭️  {name} провалився: {e}");
            None
        }
    }
}

fn report(start: Instant, rung: &str, text: &str) {
    println!("✅ рунг: {rung} ({:?})\nвідповідь: {text}", start.elapsed());
}
