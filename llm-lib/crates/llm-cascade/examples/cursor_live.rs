//! Живий смок-тест ACP-бекенда проти вже залогіненого Cursor CLI (`agent acp`).
//! Не автотест — реальний виклик підписки, коштує квоти. Запуск:
//! `cargo run --example cursor_live`

use llm_cascade::acp::{one_shot_acp, AcpAgentKind};

#[tokio::main]
async fn main() {
    let cwd = std::env::current_dir().expect("cwd");
    match one_shot_acp(AcpAgentKind::Cursor, "Скажи рівно одне слово: працює", &cwd).await
    {
        Ok(text) => println!("OK: {text}"),
        Err(e) => {
            eprintln!("FAILED: {e}");
            std::process::exit(1);
        }
    }
}
