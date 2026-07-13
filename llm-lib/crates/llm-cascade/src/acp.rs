//! ACP-бекенди (Agent Client Protocol, Zed) — доступ до потужних моделей
//! через **особисту підписку**, не API-ключ: спавнимо вже залогінений
//! локально агентський CLI (`agent login` / `codex login` виконано заздалегідь
//! власником) і говоримо з ним по stdio/JSON-RPC.
//!
//! Крейт **не** виставляє жодних API-ключів для цього шляху — якщо CLI не
//! залогінений підпискою, спроба просто провалиться, і викликач сам вирішує,
//! чи падати далі на [`crate::local_cloud`] (той самий fail-fast принцип, що
//! й у решті крейта — жодного вбудованого retry).

use std::str::FromStr;

use agent_client_protocol::Client;
use agent_client_protocol_tokio::AcpAgent;

use crate::CascadeError;

/// Ціль ACP-підключення. Список відкритий — нові агенти додаються нових
/// варіантом і `spec()`, протокол той самий для всіх.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AcpAgentKind {
    /// Cursor CLI, нативний ACP-режим (`agent acp`) — жодного стороннього моста.
    Cursor,
    /// OpenAI Codex через офіційний міст `@agentclientprotocol/codex-acp`
    /// (наступник задеприкейченого `@zed-industries/codex-acp`).
    Codex,
}

impl AcpAgentKind {
    /// Команда спавну для цього агента.
    fn command(self) -> &'static str {
        match self {
            AcpAgentKind::Cursor => "agent acp",
            AcpAgentKind::Codex => "npx -y @agentclientprotocol/codex-acp@latest",
        }
    }

    fn spec(self) -> Result<AcpAgent, CascadeError> {
        AcpAgent::from_str(self.command()).map_err(|e| CascadeError::Provider(e.to_string()))
    }
}

/// Один виклик через ACP: спавнить агента, відкриває сесію в поточній
/// директорії, надсилає `prompt`, читає повний текст відповіді до кінця ходу.
///
/// # Errors
/// [`CascadeError::Provider`] — агент не встановлений, не залогінений
/// підпискою, чи процес завершився з помилкою.
pub async fn one_shot_acp(agent: AcpAgentKind, prompt: &str) -> Result<String, CascadeError> {
    prompt_agent(agent.spec()?, prompt).await
}

/// Спільна реалізація для [`one_shot_acp`] і `#[cfg(test)]`-перевірки
/// fail-fast поведінки на спавні (приймає `AcpAgent` напряму, а не
/// [`AcpAgentKind`] — щоб тест міг підставити свідомо неіснуючу команду).
async fn prompt_agent(spec: AcpAgent, prompt: &str) -> Result<String, CascadeError> {
    let prompt = prompt.to_string();

    Client
        .connect_with(spec, async move |cx| {
            cx.build_session_cwd()?
                .block_task()
                .run_until(async move |mut session| {
                    session.send_prompt(prompt)?;
                    session.read_to_string().await
                })
                .await
        })
        .await
        .map_err(|e| CascadeError::Provider(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_targets_official_bridges_not_deprecated_ones() {
        assert_eq!(AcpAgentKind::Cursor.command(), "agent acp");
        assert!(AcpAgentKind::Codex
            .command()
            .contains("@agentclientprotocol/codex-acp"));
        assert!(!AcpAgentKind::Codex
            .command()
            .contains("@zed-industries/codex-acp"));
    }

    #[test]
    fn spec_parses_into_a_valid_stdio_agent() {
        assert!(AcpAgentKind::Cursor.spec().is_ok());
        assert!(AcpAgentKind::Codex.spec().is_ok());
    }

    /// Обкатка fail-fast поведінки: неіснуючий бінарник — драбина (Cursor →
    /// Codex → local → cloud, див. README) покладається на те, що недоступний
    /// агент провалюється швидко з `Err`, а не висить назавжди чи панікує.
    #[tokio::test]
    async fn spawn_of_missing_binary_fails_fast_not_hangs() {
        let bad_spec = AcpAgent::from_str("nonexistent-acp-binary-xyz-test").unwrap();

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            prompt_agent(bad_spec, "привіт"),
        )
        .await;

        let outcome = result.expect("spawn неіснуючого бінарника не мав зависнути довше 5с");
        assert!(
            outcome.is_err(),
            "неіснуючий бінарник має провалитись, а не повернути Ok"
        );
    }
}
