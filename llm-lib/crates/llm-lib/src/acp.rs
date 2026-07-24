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

use agent_client_protocol::schema::v1::{ContentBlock, ContentChunk, SessionUpdate};
use agent_client_protocol::AcpAgent;

use crate::tiers::Tier;
use crate::LlmError;

/// Публічний session-API (задача T2): довгоживуча ACP-сесія з потоком
/// подій, зовнішнім permission-responder-ом і `cancel` — без tauri-залежностей.
pub mod session;
pub(crate) mod transport;

/// Тір-пресети агентів (задача T3, рішення Б/Ж/З/З.1/К): `AcpAgentKind ×
/// Tier` → [`presets::TierPreset`] + UI-лейбли.
pub mod presets;

pub use presets::TierPreset;
use session::{SessionEvent, SessionOptions};
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
    /// Pi через окремий npm-пакет `pi-acp` (рішення З.1, R1-підтверджено):
    /// сам `pi` ACP-режиму не має, лише власний `--mode rpc` — `pi-acp`
    /// спавнить його сам.
    Pi,
}

impl AcpAgentKind {
    /// Команда спавну для цього агента (базовий argv, без env/extra-args
    /// префіксів — ті додає [`transport::build_acp_args`]).
    pub(crate) fn command(self) -> &'static str {
        match self {
            AcpAgentKind::Cursor => "agent acp",
            AcpAgentKind::Codex => "npx -y @agentclientprotocol/codex-acp@latest",
            AcpAgentKind::Pi => "npx -y pi-acp",
        }
    }

    /// `AcpAgent`-спека без додаткових env/args — поведінка `one_shot_acp`
    /// сьогодні.
    fn spec(self) -> Result<AcpAgent, LlmError> {
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
/// Тонкий фасад над публічним [`session`]-API (задача T2): створює сесію з
/// дефолтних [`SessionOptions`] (`PermissionMode::AutoApprove`, без
/// post-session-config-кроку — той потрібен лише Pi-тіру, T3), надсилає
/// один `prompt`, акумулює текстові `AgentMessageChunk`-події з потоку
/// подій до кінця ходу. Поведінка не змінюється — той самий idle-timeout,
/// auto-approve дозволів і progress-логування, що й раніше (спільна
/// операційна броня [`transport`], тепер розділена з session-режимом).
///
/// # Errors
/// [`LlmError::Provider`] — агент не встановлений, не залогінений
/// підпискою, чи процес завершився з помилкою.
pub async fn one_shot_acp(
    agent: AcpAgentKind,
    prompt: &str,
    cwd: &Path,
) -> Result<String, LlmError> {
    run_one_shot(agent.spec()?, cwd, SessionOptions::default(), prompt).await
}

/// Той самий один виклик через ACP, що й [`one_shot_acp`], але з явним
/// [`Tier`] (задача T3, рішення К: тір, ніколи конкретна модель) —
/// резолвиться в [`presets::TierPreset`] цього `agent`-а і застосовується
/// одноманітно незалежно від того, чи kind бере тір через env на спавні
/// (Codex), extra-arg на спавні (Cursor) чи post-session протокольний
/// виклик (Pi, рішення З.1): `env`/`extra_args` пресету йдуть у той самий
/// [`transport::spec_for`], що й раніше, `post_session_config` — у
/// [`SessionOptions`] session-шару. Стара сигнатура [`one_shot_acp`] не
/// чіпається — цей фасад лише додає крок резолвінгу перед тим самим
/// `run_one_shot`.
///
/// # Errors
/// [`LlmError::Provider`] — агент не встановлений, не залогінений
/// підпискою, невалідний `configId`/`value` (Pi) чи процес завершився з
/// помилкою.
pub async fn one_shot_acp_with_tier(
    agent: AcpAgentKind,
    tier: Tier,
    prompt: &str,
    cwd: &Path,
) -> Result<String, LlmError> {
    let preset = agent.tier_preset(tier);
    let spec = spec_for(agent.command(), &preset.extra_args, &preset.env)?;
    let options = SessionOptions {
        post_session_config: preset.post_session_config,
        ..SessionOptions::default()
    };
    run_one_shot(spec, cwd, options, prompt).await
}

/// Спільне тіло [`one_shot_acp`]/[`one_shot_acp_with_tier`]: створює сесію
/// з готового `spec`/`options`, надсилає один `prompt`, акумулює текстові
/// `AgentMessageChunk`-події з потоку подій до кінця ходу. Той самий
/// idle-timeout, auto-approve дозволів і progress-логування, що й раніше
/// (спільна операційна броня [`transport`], розділена з session-режимом).
async fn run_one_shot(
    spec: AcpAgent,
    cwd: &Path,
    options: SessionOptions,
    prompt: &str,
) -> Result<String, LlmError> {
    let (handle, mut events) = session::create_session(spec, cwd, options).await?;

    handle.prompt(prompt).await?;
    drop(handle);

    let mut output = String::new();
    while let Some(event) = events.recv().await {
        if let SessionEvent::Update(update) = event {
            if let SessionUpdate::AgentMessageChunk(ContentChunk {
                content: ContentBlock::Text(text),
                ..
            }) = *update
            {
                output.push_str(&text.text);
            }
        }
    }
    Ok(output)
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
        assert_eq!(AcpAgentKind::Pi.command(), "npx -y pi-acp");
    }

    #[test]
    fn spec_parses_into_a_valid_stdio_agent() {
        assert!(AcpAgentKind::Cursor.spec().is_ok());
        assert!(AcpAgentKind::Codex.spec().is_ok());
        assert!(AcpAgentKind::Pi.spec().is_ok());
    }

    /// Резолвлений тір-пресет (env для Codex, extra-args для Cursor,
    /// post-session-config для Pi — тому спека без `extra_env`/`extra_args`
    /// теж має валідно парситись, окремо перевіряючи лише env/args-частину)
    /// не ламає `spec_for` для жодного kind-у.
    #[test]
    fn tier_preset_env_and_args_still_produce_a_valid_spec() {
        for kind in [AcpAgentKind::Cursor, AcpAgentKind::Codex, AcpAgentKind::Pi] {
            for tier in [Tier::Min, Tier::Avg, Tier::Max] {
                let preset = kind.tier_preset(tier);
                let spec = spec_for(kind.command(), &preset.extra_args, &preset.env);
                assert!(
                    spec.is_ok(),
                    "{kind:?}×{tier:?}: пресет має давати валідну spec"
                );
            }
        }
    }
}
