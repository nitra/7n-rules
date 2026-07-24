//! Живий смок-тест local-бекенда через genai проти omlx. Запуск:
//! `N_LOCAL_MIN_MODEL=omlx/<model> cargo run --example local_live`

use std::collections::HashMap;
use std::env;

use llm_lib::local_cloud::LocalProvider;
use llm_lib::{LocalCloud, Tier};

#[tokio::main]
async fn main() {
    let mut local_providers = HashMap::new();
    local_providers.insert(
        "omlx".to_string(),
        LocalProvider {
            base_url: "http://127.0.0.1:8000/v1/".to_string(),
            api_key: env::var("OMLX_API_KEY").ok(),
        },
    );
    let client = LocalCloud::new(local_providers);

    match client
        .one_shot(Tier::Min, None, "Скажи рівно одне слово: працює")
        .await
    {
        Ok(text) => println!("OK: {text}"),
        Err(e) => {
            eprintln!("FAILED: {e}");
            std::process::exit(1);
        }
    }
}
