//! ACP-бекенди (Agent Client Protocol, Zed) — доступ до потужних моделей
//! через **особисту підписку**, не API-ключ: спавнимо вже залогінений
//! локально агентський CLI (`agent login` / `codex login` виконано заздалегідь
//! власником) і говоримо з ним по stdio/JSON-RPC.
//!
//! Крейт **не** виставляє жодних API-ключів для цього шляху — якщо CLI не
//! залогінений підпискою, спроба просто провалиться, і викликач сам вирішує,
//! чи падати далі на [`crate::local_cloud`] (той самий fail-fast принцип, що
//! й у решті крейта — жодного вбудованого retry).

use std::path::Path;

use agent_client_protocol::AcpAgent;

use crate::CascadeError;

pub(crate) mod transport;

use transport::spec_for;

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
    /// Команда спавну для цього агента (базовий argv, без env/extra-args
    /// префіксів — ті додає [`transport::build_acp_args`]).
    fn command(self) -> &'static str {
        match self {
            AcpAgentKind::Cursor => "agent acp",
            AcpAgentKind::Codex => "npx -y @agentclientprotocol/codex-acp@latest",
        }
    }

    /// `AcpAgent`-спека без додаткових env/args — поведінка `one_shot_acp`
    /// сьогодні. Тір-пресети (T3) підключать `spec_with` з непорожніми
    /// env/args для того самого `command()`.
    fn spec(self) -> Result<AcpAgent, CascadeError> {
        spec_for(self.command(), &[], &std::collections::HashMap::new())
    }
}

/// Один виклик через ACP: спавнить агента, відкриває сесію в `cwd`, надсилає
/// `prompt`, читає повний текст відповіді до кінця ходу.
///
/// `cwd` — явний, а не [`std::env::current_dir`]: викликач (напр. napi-міст
/// в один процес із Node) має свій власний робочий каталог проєкту, який
/// не обов'язково збігається з cwd самого хост-процесу.
///
/// Тонкий фасад над [`transport`]: спавн/init/session — спільний шар, який
/// буде перевикористаний публічним session-API (наступна задача) поверх
/// того самого транспорту.
///
/// # Errors
/// [`CascadeError::Provider`] — агент не встановлений, не залогінений
/// підпискою, чи процес завершився з помилкою.
pub async fn one_shot_acp(
    agent: AcpAgentKind,
    prompt: &str,
    cwd: &Path,
) -> Result<String, CascadeError> {
    transport::prompt_agent(agent.spec()?, prompt, cwd).await
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
}
