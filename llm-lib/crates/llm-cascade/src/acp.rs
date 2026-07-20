//! ACP-бекенди (Agent Client Protocol, Zed) — доступ до потужних моделей
//! через **особисту підписку**, не API-ключ: спавнимо вже залогінений
//! локально агентський CLI (`agent login` / `codex login` виконано заздалегідь
//! власником) і говоримо з ним по stdio/JSON-RPC.
//!
//! Крейт **не** виставляє жодних API-ключів для цього шляху — якщо CLI не
//! залогінений підпискою, спроба просто провалиться, і викликач сам вирішує,
//! чи падати далі на [`crate::local_cloud`] (той самий fail-fast принцип, що
//! й у решті крейта — жодного вбудованого retry).

use std::env;
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, InitializeRequest, PermissionOption, PermissionOptionId,
    PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification, SessionUpdate,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{AcpAgent, Client, Error as AcpError, SessionMessage};

use crate::CascadeError;

/// Idle-timeout — без жодної `session/update`-події від агента, не загальна
/// тривалість ходу (реальний хід законно триває довго, поки регулярно щось
/// відбувається). Захист від протокольного/агентського зависання: без нього
/// відсутність відповіді на `session/request_permission` чи будь-яка інша
/// тиша висить назавжди (саме так провалився живий прогін `skill codex taze`
/// до фіксу дозволів — 57+ хвилин без жодного виводу). Override:
/// `N_LLM_ACP_IDLE_TIMEOUT_MS`.
fn idle_timeout() -> Duration {
    Duration::from_millis(
        env::var("N_LLM_ACP_IDLE_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(180_000),
    )
}

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

/// Обирає варіант дозволу без участі людини: `AllowAlways` > `AllowOnce` > перший
/// зі списку. Без цього хендлера `session/request_permission` лишається без
/// відповіді — агент, дійшовши до першого tool-call (bash/edit), зависає
/// назавжди в очікуванні (протокольний deadlock, не мережева/spawn-помилка).
/// Full-trust one-shot виклик — дозволи не питаються інтерактивно (паритет із
/// колишнім `pickAutoPermissionOptionId` у JS-шимі й офіційним
/// `yolo_one_shot_client`-прикладом крейта).
fn pick_auto_permission_option(options: &[PermissionOption]) -> Option<PermissionOptionId> {
    options
        .iter()
        .find(|o| o.kind == PermissionOptionKind::AllowAlways)
        .or_else(|| {
            options
                .iter()
                .find(|o| o.kind == PermissionOptionKind::AllowOnce)
        })
        .or_else(|| options.first())
        .map(|o| o.option_id.clone())
}

/// Один виклик через ACP: спавнить агента, відкриває сесію в `cwd`, надсилає
/// `prompt`, читає повний текст відповіді до кінця ходу.
///
/// `cwd` — явний, а не [`std::env::current_dir`]: викликач (напр. napi-міст
/// в один процес із Node) має свій власний робочий каталог проєкту, який
/// не обов'язково збігається з cwd самого хост-процесу.
///
/// # Errors
/// [`CascadeError::Provider`] — агент не встановлений, не залогінений
/// підпискою, чи процес завершився з помилкою.
pub async fn one_shot_acp(
    agent: AcpAgentKind,
    prompt: &str,
    cwd: &Path,
) -> Result<String, CascadeError> {
    prompt_agent(agent.spec()?, prompt, cwd).await
}

/// Спільна реалізація для [`one_shot_acp`] і `#[cfg(test)]`-перевірки
/// fail-fast поведінки на спавні (приймає `AcpAgent` напряму, а не
/// [`AcpAgentKind`] — щоб тест міг підставити свідомо неіснуючу команду).
async fn prompt_agent(spec: AcpAgent, prompt: &str, cwd: &Path) -> Result<String, CascadeError> {
    let prompt = prompt.to_string();
    let cwd = cwd.to_path_buf();
    let idle_timeout = idle_timeout();

    Client
        .builder()
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                let outcome = match pick_auto_permission_option(&request.options) {
                    Some(option_id) => RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(option_id),
                    ),
                    None => RequestPermissionOutcome::Cancelled,
                };
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(spec, async move |cx| {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            cx.build_session(cwd)
                .block_task()
                .run_until(async move |mut session| {
                    session.send_prompt(prompt)?;
                    read_to_string_with_idle_timeout(&mut session, idle_timeout).await
                })
                .await
        })
        .await
        .map_err(|e| CascadeError::Provider(e.to_string()))
}

/// Чи друкувати повний `{:?}`-дамп кожної non-text ACP-події замість
/// одного короткого рядка. За замовчуванням (як `lint` без `--verbose`) —
/// тихо: `ToolCall`/`ToolCallUpdate` несуть `raw_input`/`raw_output` (повний
/// JSON параметрів/результату інструменту), і на прогоні `taze` з багатьма
/// пакетами це затоплювало stderr. Override: `N_LLM_ACP_VERBOSE=1`.
fn acp_verbose() -> bool {
    env::var("N_LLM_ACP_VERBOSE").is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

/// Один короткий рядок для non-text ACP-події — без `raw_input`/`raw_output`
/// інструментів і без тексту чанків `AgentThoughtChunk`/`UserMessageChunk` (стрім по токенах).
/// `N_LLM_ACP_VERBOSE=1` (`acp_verbose()`) повертає повний `{:?}` замість
/// цього — для діагностики зависань/протокольних аномалій.
fn summarize_update(update: &SessionUpdate) -> String {
    if acp_verbose() {
        return format!("{update:?}");
    }
    match update {
        SessionUpdate::UserMessageChunk(_) => "user_message_chunk".to_string(),
        SessionUpdate::AgentThoughtChunk(_) => "agent_thought_chunk".to_string(),
        SessionUpdate::AgentMessageChunk(_) => "agent_message_chunk (non-text)".to_string(),
        SessionUpdate::ToolCall(tc) => format!("tool_call: {} [{:?}]", tc.title, tc.status),
        SessionUpdate::ToolCallUpdate(u) => match &u.fields.status {
            Some(status) => format!("tool_call_update: {status:?}"),
            None => "tool_call_update".to_string(),
        },
        SessionUpdate::Plan(p) => format!("plan: {} entries", p.entries.len()),
        SessionUpdate::AvailableCommandsUpdate(_) => "available_commands_update".to_string(),
        SessionUpdate::CurrentModeUpdate(_) => "current_mode_update".to_string(),
        SessionUpdate::ConfigOptionUpdate(_) => "config_option_update".to_string(),
        SessionUpdate::SessionInfoUpdate(_) => "session_info_update".to_string(),
        SessionUpdate::UsageUpdate(_) => "usage_update".to_string(),
        _ => "other".to_string(),
    }
}

/// Як `Session::read_to_string()` (акумулює текстові `agent_message_chunk`,
/// зупиняється на `StopReason`), але кожне окреме читання events обгорнуте в
/// `idle_timeout` — а не весь хід разом. Це і є "видимість": не-текстові
/// події (`tool_call`/`plan`/…) логуються в stderr замість мовчазного
/// відкидання (за замовчуванням — одним коротким рядком, `N_LLM_ACP_VERBOSE=1`
/// — повним `{:?}`), і саме кожна така подія скидає таймер — реальний прогрес
/// не зупиняє годинник, зупиняє лише справжня тиша. Текстові
/// `AgentThoughtChunk`/`UserMessageChunk` тиша не логуються зовсім (лише
/// скидають таймер) — потокенний стрім думок агента інакше затоплював stderr.
async fn read_to_string_with_idle_timeout<S>(
    session: &mut S,
    idle_timeout: Duration,
) -> Result<String, AcpError>
where
    S: AcpSessionUpdates,
{
    let mut output = String::new();
    loop {
        let update = tokio::time::timeout(idle_timeout, session.read_update())
            .await
            .map_err(|_| {
                AcpError::internal_error().data(Some(serde_json::json!(format!(
                    "acp: немає жодної session/update-події {idle_timeout:?} — ймовірно завис"
                ))))
            })??;

        match update {
            SessionMessage::SessionMessage(dispatch) => MatchDispatch::new(dispatch)
                .if_notification(async |notification: SessionNotification| {
                    match &notification.update {
                        SessionUpdate::AgentMessageChunk(ContentChunk {
                            content: ContentBlock::Text(text),
                            ..
                        }) => output.push_str(&text.text),
                        SessionUpdate::AgentThoughtChunk(ContentChunk {
                            content: ContentBlock::Text(_),
                            ..
                        })
                        | SessionUpdate::UserMessageChunk(ContentChunk {
                            content: ContentBlock::Text(_),
                            ..
                        }) if !acp_verbose() => {}
                        other => eprintln!("acp progress: {}", summarize_update(other)),
                    }
                    Ok(())
                })
                .await
                .otherwise_ignore()?,
            SessionMessage::StopReason(_) => break,
            _ => {}
        }
    }
    Ok(output)
}

/// Мінімальний зріз `ActiveSession`, потрібний для idle-timeout-читання —
/// узагальнено, щоб уникнути повного generic-підпису `ActiveSession<'_, Link>`
/// у сигнатурі [`read_to_string_with_idle_timeout`].
trait AcpSessionUpdates {
    /// Читає наступну подію (текст, tool-call, StopReason, …).
    async fn read_update(&mut self) -> Result<SessionMessage, AcpError>;
}

impl<Link> AcpSessionUpdates for agent_client_protocol::ActiveSession<'_, Link>
where
    Link: agent_client_protocol::role::HasPeer<agent_client_protocol::Agent>,
{
    async fn read_update(&mut self) -> Result<SessionMessage, AcpError> {
        agent_client_protocol::ActiveSession::read_update(self).await
    }
}

/// Фейкова сесія без жодної події — для тесту idle-timeout без реального ACP-агента.
#[cfg(test)]
struct NeverUpdatingSession;

#[cfg(test)]
impl AcpSessionUpdates for NeverUpdatingSession {
    async fn read_update(&mut self) -> Result<SessionMessage, AcpError> {
        std::future::pending().await
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
    }

    #[test]
    fn spec_parses_into_a_valid_stdio_agent() {
        assert!(AcpAgentKind::Cursor.spec().is_ok());
        assert!(AcpAgentKind::Codex.spec().is_ok());
    }

    fn permission_option(id: &'static str, kind: PermissionOptionKind) -> PermissionOption {
        PermissionOption::new(id, id, kind)
    }

    #[test]
    fn permission_picker_prefers_allow_always() {
        let options = vec![
            permission_option("once", PermissionOptionKind::AllowOnce),
            permission_option("always", PermissionOptionKind::AllowAlways),
        ];
        assert_eq!(
            pick_auto_permission_option(&options),
            Some(PermissionOptionId::new("always"))
        );
    }

    #[test]
    fn permission_picker_falls_back_to_allow_once() {
        let options = vec![
            permission_option("reject", PermissionOptionKind::RejectOnce),
            permission_option("once", PermissionOptionKind::AllowOnce),
        ];
        assert_eq!(
            pick_auto_permission_option(&options),
            Some(PermissionOptionId::new("once"))
        );
    }

    #[test]
    fn permission_picker_falls_back_to_first_option_without_allow_kinds() {
        let options = vec![permission_option(
            "reject",
            PermissionOptionKind::RejectOnce,
        )];
        assert_eq!(
            pick_auto_permission_option(&options),
            Some(PermissionOptionId::new("reject"))
        );
    }

    #[test]
    fn permission_picker_none_for_empty_options() {
        assert_eq!(pick_auto_permission_option(&[]), None);
    }

    /// Захист від зависання без сигналу: якщо сесія взагалі не шле подій
    /// (той самий симптом, що й живий прогін `skill codex taze` до фіксу
    /// дозволів — 57+ хвилин тиші), читання провалюється за idle-timeout,
    /// а не висить назавжди.
    #[tokio::test]
    async fn idle_timeout_fails_fast_when_no_updates_ever_arrive() {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            read_to_string_with_idle_timeout(
                &mut NeverUpdatingSession,
                std::time::Duration::from_millis(50),
            ),
        )
        .await;

        let outcome =
            result.expect("idle-timeout сам мав спрацювати задовго до зовнішнього 5с-ліміту");
        assert!(
            outcome.is_err(),
            "без подій читання має провалитись, а не повернути Ok"
        );
    }

    /// Обкатка fail-fast поведінки: неіснуючий бінарник — драбина (Cursor →
    /// Codex → local → cloud, див. README) покладається на те, що недоступний
    /// агент провалюється швидко з `Err`, а не висить назавжди чи панікує.
    #[tokio::test]
    async fn spawn_of_missing_binary_fails_fast_not_hangs() {
        let bad_spec = AcpAgent::from_str("nonexistent-acp-binary-xyz-test").unwrap();

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            prompt_agent(bad_spec, "привіт", &std::env::temp_dir()),
        )
        .await;

        let outcome = result.expect("spawn неіснуючого бінарника не мав зависнути довше 5с");
        assert!(
            outcome.is_err(),
            "неіснуючий бінарник має провалитись, а не повернути Ok"
        );
    }

    /// `ToolCall`/`ToolCallUpdate` за замовчуванням (без `N_LLM_ACP_VERBOSE`)
    /// дають короткий рядок без `raw_input`/`raw_output` — саме вони роздували
    /// stderr на `taze` (jest issue: повний Debug тягнув увесь JSON тулза).
    #[test]
    fn summarize_update_tool_call_is_short_without_raw_payload() {
        let mut tool_call = agent_client_protocol::schema::v1::ToolCall::new("id-1", "Edit foo.rs");
        tool_call.raw_input = Some(serde_json::json!({ "content": "x".repeat(10_000) }));
        let summary = summarize_update(&SessionUpdate::ToolCall(tool_call));

        assert_eq!(summary, "tool_call: Edit foo.rs [Pending]");
        assert!(
            summary.len() < 200,
            "рядок має лишатись коротким: {}",
            summary.len()
        );
    }

    /// `Plan` — лише кількість пунктів, не повний перелік `PlanEntry`.
    #[test]
    fn summarize_update_plan_counts_entries() {
        use agent_client_protocol::schema::v1::{PlanEntry, PlanEntryPriority, PlanEntryStatus};

        let plan = agent_client_protocol::schema::v1::Plan::new(vec![
            PlanEntry::new("крок 1", PlanEntryPriority::High, PlanEntryStatus::Pending),
            PlanEntry::new("крок 2", PlanEntryPriority::Low, PlanEntryStatus::Pending),
        ]);
        assert_eq!(
            summarize_update(&SessionUpdate::Plan(plan)),
            "plan: 2 entries"
        );
    }
}
