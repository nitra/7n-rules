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
    /// префіксів — ті додає [`transport::build_acp_args`]). Публічна — потрібна
    /// napi-мосту (`getAcpPresets`, задача T5) для експорту спавн-команд у JS
    /// без повторного хардкоду.
    #[must_use]
    pub fn command(self) -> &'static str {
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

    /// `AcpAgent`-спека з уже застосованим тір-пресетом (env для Codex,
    /// extra-args для Cursor) — публічний будівельний блок для session-споживачів
    /// (`tauri-plugin-agent`, T9/T10), яким [`one_shot_acp_with_tier`] не
    /// підходить, але які так само не мають дублювати розбір
    /// [`Self::command`] і зливання пресету. Post-session-крок (Pi) сюди не
    /// входить — його викликач бере з [`Self::tier_preset`] і кладе в
    /// [`session::SessionOptions::post_session_config`].
    ///
    /// # Errors
    /// [`LlmError::Provider`] — команда/args не зібрались у валідну спеку.
    pub fn tier_spec(self, tier: Tier) -> Result<AcpAgent, LlmError> {
        let preset = self.tier_preset(tier);
        spec_for(self.command(), &preset.extra_args, &preset.env)
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
    one_shot_acp_with_tier_guarded(agent, tier, prompt, cwd, Vec::new()).await
}

/// Tiered one-shot ACP-виклик із denylist команд у permission boundary.
/// Заборонена команда отримує ACP `Cancelled`, тому агент не може обійти
/// JS-owned full gates лише ігноруванням промпта.
pub async fn one_shot_acp_with_tier_guarded(
    agent: AcpAgentKind,
    tier: Tier,
    prompt: &str,
    cwd: &Path,
    deny_command_fragments: Vec<String>,
) -> Result<String, LlmError> {
    let spec = agent.tier_spec(tier)?;
    let options = SessionOptions {
        post_session_config: agent.tier_preset(tier).post_session_config,
        deny_command_fragments,
        ..SessionOptions::default()
    };
    run_one_shot(spec, cwd, options, prompt).await
}

/// Спільне тіло [`one_shot_acp`]/[`one_shot_acp_with_tier`]: створює сесію
/// з готового `spec`/`options`, надсилає один `prompt`, акумулює текстові
/// `AgentMessageChunk`-події з потоку подій до кінця ходу. Той самий
/// idle-timeout, auto-approve дозволів і progress-логування, що й раніше
/// (спільна операційна броня [`transport`], розділена з session-режимом).
///
/// Термінальний сигнал ходу — відповідь `session/prompt` (`StopReason` з
/// [`session::SessionHandle::prompt`]) або її провал (ACP-помилка/
/// idle-timeout), **не** закриття каналу подій: Codex ACP після
/// термінального ходу лишає stdio й сесію відкритими, тож очікування
/// закриття каналу висіло б вічно (живий hang `git-reconcile`×Codex).
/// Після термінального сигналу — гарантований
/// [`session::SessionHandle::shutdown`]-teardown дочірнього процесу агента
/// (для success, timeout і помилки однаково) і дочитування вже
/// буферизованих подій.
async fn run_one_shot(
    spec: AcpAgent,
    cwd: &Path,
    options: SessionOptions,
    prompt: &str,
) -> Result<String, LlmError> {
    let (handle, mut events) = session::create_session(spec, cwd, options).await?;

    let mut output = String::new();
    let turn = handle.prompt(prompt);
    tokio::pin!(turn);
    let turn_result = loop {
        tokio::select! {
            outcome = &mut turn => break outcome,
            event = events.recv() => match event {
                Some(event) => accumulate_agent_text(&mut output, &event),
                // Канал подій закрився до кінця ходу — фонова задача сесії
                // померла; сам `turn` ось-ось поверне реальну причину
                // (reply-канал обірваний тією самою задачею).
                None => break turn.await,
            },
        }
    };

    handle.shutdown();
    while let Some(event) = events.recv().await {
        accumulate_agent_text(&mut output, &event);
    }

    turn_result?;
    Ok(output)
}

/// Доклеює текстовий `AgentMessageChunk` з події сесії до акумульованої
/// відповіді one-shot-ходу; інші події ігнорує.
fn accumulate_agent_text(output: &mut String, event: &SessionEvent) {
    if let SessionEvent::Update(update) = event {
        if let SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) = update.as_ref()
        {
            output.push_str(&text.text);
        }
    }
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

    /// Публічний [`AcpAgentKind::tier_spec`] (споживач — session-адаптери,
    /// T9/T10) дає валідну спеку для кожної пари kind×tier.
    #[test]
    fn tier_spec_is_valid_for_every_kind_and_tier() {
        for kind in [AcpAgentKind::Cursor, AcpAgentKind::Codex, AcpAgentKind::Pi] {
            for tier in [Tier::Min, Tier::Avg, Tier::Max] {
                assert!(
                    kind.tier_spec(tier).is_ok(),
                    "{kind:?}×{tier:?}: tier_spec має давати валідну spec"
                );
            }
        }
    }

    /// Пише виконуваний sh-скрипт фейкового ACP-агента, що відтворює живий
    /// симптом `codex-acp` у `git-reconcile`: чесний handshake
    /// (`initialize` → `session/new`), на `session/prompt` — один текстовий
    /// чанк і термінальний `stopReason: end_turn`, після чого процес
    /// **не** закриває stdio і не завершується сам (`sleep`). Свій PID агент
    /// пише у `pid_path` — тест по ньому перевіряє гарантований teardown.
    fn write_terminal_turn_without_close_agent(
        pid_path: &Path,
        script_path: &Path,
    ) -> std::path::PathBuf {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let script = r#"#!/bin/sh
echo $$ > '__PID_PATH__'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  case "$line" in
    *'"initialize"'*) printf '{"jsonrpc":"2.0","id":"%s","result":{"protocolVersion":1}}\n' "$id" ;;
    *'"session/new"'*) printf '{"jsonrpc":"2.0","id":"%s","result":{"sessionId":"sess-1"}}\n' "$id" ;;
    *'"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"PONG"}}}}\n'
      printf '{"jsonrpc":"2.0","id":"%s","result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
sleep 600
"#
        .replace("__PID_PATH__", &pid_path.display().to_string());

        let mut file =
            std::fs::File::create(script_path).expect("не вдалось створити тестовий скрипт");
        file.write_all(script.as_bytes())
            .expect("не вдалось записати тестовий скрипт");
        drop(file);

        let mut perms = std::fs::metadata(script_path)
            .expect("не вдалось прочитати метадані скрипта")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(script_path, perms).expect("не вдалось виставити +x на скрипт");
        script_path.to_path_buf()
    }

    /// `true` — процес `pid` зник протягом `limit` (SIGKILL від teardown
    /// не миттєвий, тому опитуємо `kill -0`).
    fn process_exits_within(pid: &str, limit: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + limit;
        while std::time::Instant::now() < deadline {
            let alive = std::process::Command::new("kill")
                .args(["-0", pid])
                .status()
                .is_ok_and(|status| status.success());
            if !alive {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        false
    }

    /// Регресія на живий hang `git-reconcile`×Codex: агент повідомив
    /// термінальний хід (`stopReason: end_turn`), але не закрив stdio і не
    /// завершився. One-shot має повернути накопичений текст за bounded time
    /// (термінальний сигнал — відповідь `session/prompt`, а не закриття
    /// event-каналу) і гарантовано прибрати дочірній процес агента.
    #[tokio::test]
    async fn one_shot_returns_and_kills_agent_that_never_closes_after_terminal_turn() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("час не мав би йти назад від епохи")
            .as_nanos();
        let dir = std::env::temp_dir();
        let pid_path = dir.join(format!(
            "llm-lib-acp-oneshot-terminal-pid-{}-{unique}",
            std::process::id()
        ));
        let script_path = dir.join(format!(
            "llm-lib-acp-oneshot-terminal-agent-{}-{unique}.sh",
            std::process::id()
        ));
        write_terminal_turn_without_close_agent(&pid_path, &script_path);

        let spec = AcpAgent::from_args([script_path.to_str().unwrap()])
            .expect("шлях до тестового скрипта має бути валідною AcpAgent-спекою");
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            run_one_shot(spec, &dir, SessionOptions::default(), "ping"),
        )
        .await;

        let outcome = result.expect("terminal turn без закриття stdio не має підвішувати one-shot");
        let pid = std::fs::read_to_string(&pid_path)
            .expect("агент мав записати свій PID до handshake")
            .trim()
            .to_string();
        let agent_dead = process_exits_within(&pid, std::time::Duration::from_secs(5));

        let _ = std::fs::remove_file(&script_path);
        let _ = std::fs::remove_file(&pid_path);

        let output = outcome.expect("хід з термінальним stopReason має повернути Ok");
        assert_eq!(output, "PONG");
        assert!(
            agent_dead,
            "дочірній процес агента (pid {pid}) має бути прибраний після terminal turn"
        );
    }
}
