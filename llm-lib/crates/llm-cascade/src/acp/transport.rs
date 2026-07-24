//! Спільний спавн/init/session-шар для всіх ACP-фасадів крейта.
//!
//! Портовано зі скелету `tauri-plugin-agent/src/acp/mod.rs`
//! (`build_acp_args`, handshake `initialize` → `session/new`), але без
//! Tauri-специфіки (`AppHandle`/`Emitter`/`State`) і з обов'язковою
//! операційною бронею cascade, якої плагін не мав: idle-timeout на кожен
//! update-read, `summarize_update`/`N_LLM_ACP_VERBOSE` progress-логування,
//! типізований [`CascadeError`] замість `String`.
//!
//! Сьогодні єдиний споживач — [`super::one_shot_acp`] (one-shot: один
//! prompt, auto-approve дозволів, акумуляція тексту до `StopReason`).
//! Публічний session-API (create/prompt/update-стрім/зовнішній
//! permission-responder/cancel) — наступна задача поверх цього самого шару.

use std::collections::HashMap;
use std::env;
use std::path::Path;
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
pub(crate) fn idle_timeout() -> Duration {
    Duration::from_millis(
        env::var("N_LLM_ACP_IDLE_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(180_000),
    )
}

/// Компонує argv, який очікує `AcpAgent::from_args`: спершу `NAME=value`
/// env-префікси, тоді слова базової команди, тоді extra-args. Той самий
/// контракт, що й `build_acp_args` у `tauri-plugin-agent` (env-first, бо
/// `AcpAgent::from_args` трактує будь-які провідні `NAME=value`-елементи як
/// env, зупиняючись на першому, що ним не є).
pub(crate) fn build_acp_args(
    command: &str,
    extra_args: &[String],
    extra_env: &HashMap<String, String>,
) -> Vec<String> {
    let mut argv: Vec<String> = extra_env.iter().map(|(k, v)| format!("{k}={v}")).collect();
    argv.extend(command.split_whitespace().map(str::to_string));
    argv.extend(extra_args.iter().cloned());
    argv
}

/// `AcpAgent`-спека для базової команди `command` з опційними тір-`env`/
/// extra-`args` (тір-пресети, T3). Порожні `extra_args`/`extra_env` дають
/// точно ту саму спеку, що й колишній `AcpAgent::from_str(command)`.
pub(crate) fn spec_for(
    command: &str,
    extra_args: &[String],
    extra_env: &HashMap<String, String>,
) -> Result<AcpAgent, CascadeError> {
    AcpAgent::from_args(build_acp_args(command, extra_args, extra_env))
        .map_err(|e| CascadeError::Provider(e.to_string()))
}

/// Обирає варіант дозволу без участі людини: `AllowAlways` > `AllowOnce` > перший
/// зі списку. Без цього хендлера `session/request_permission` лишається без
/// відповіді — агент, дійшовши до першого tool-call (bash/edit), зависає
/// назавжди в очікуванні (протокольний deadlock, не мережева/spawn-помилка).
/// Full-trust one-shot виклик — дозволи не питаються інтерактивно (паритет із
/// колишнім `pickAutoPermissionOptionId` у JS-шимі й офіційним
/// `yolo_one_shot_client`-прикладом крейта).
pub(crate) fn pick_auto_permission_option(
    options: &[PermissionOption],
) -> Option<PermissionOptionId> {
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

/// Спавнить агента, робить `initialize` → `session/new` → `session/prompt`
/// одним ходом і читає повний текст відповіді до кінця ходу. Спільна
/// реалізація для [`super::one_shot_acp`] і `#[cfg(test)]`-перевірки
/// fail-fast поведінки на спавні (приймає `AcpAgent` напряму, а не
/// [`super::AcpAgentKind`] — щоб тест міг підставити свідомо неіснуючу
/// команду).
pub(crate) async fn prompt_agent(
    spec: AcpAgent,
    prompt: &str,
    cwd: &Path,
) -> Result<String, CascadeError> {
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
                    // ШОВ для post-session-creation конфігурації (T2/T3):
                    // `session` тут — вже після успішного `session/new`, до
                    // першого `session/prompt`. Саме сюди ляже опційний
                    // `session/set_config_option` для тіру Pi (рішення З.1,
                    // R1: `configId: "model"`, `value: "provider/modelId"`
                    // — протокольний виклик МІЖ `session/new` і
                    // `session/prompt`, не env/args на спавні, як у
                    // Cursor/Codex). Не реалізовується в T1.
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
    use std::str::FromStr;

    #[test]
    fn build_acp_args_puts_env_before_command_before_extra_args() {
        let mut env = HashMap::new();
        env.insert("CODEX_CONFIG".to_string(), "model=\"sol\"".to_string());
        let args = build_acp_args(
            "npx -y @agentclientprotocol/codex-acp@latest",
            &["--verbose".to_string()],
            &env,
        );
        assert_eq!(
            args,
            vec![
                "CODEX_CONFIG=model=\"sol\"",
                "npx",
                "-y",
                "@agentclientprotocol/codex-acp@latest",
                "--verbose",
            ]
        );
    }

    #[test]
    fn build_acp_args_with_no_env_or_extra_args_splits_only_the_command() {
        let args = build_acp_args("agent acp", &[], &HashMap::new());
        assert_eq!(args, vec!["agent", "acp"]);
    }

    #[test]
    fn build_acp_args_with_multiple_env_pairs_all_land_before_the_command() {
        let mut env = HashMap::new();
        env.insert("A".to_string(), "1".to_string());
        env.insert("B".to_string(), "2".to_string());
        let args = build_acp_args("cmd", &[], &env);

        let command_idx = args.iter().position(|a| a == "cmd").unwrap();
        assert_eq!(command_idx, 2, "обидві env-пари мають йти перед командою");
        assert!(args[..command_idx].contains(&"A=1".to_string()));
        assert!(args[..command_idx].contains(&"B=2".to_string()));
    }

    #[test]
    fn spec_for_with_no_extras_matches_plain_from_str() {
        assert!(spec_for("agent acp", &[], &HashMap::new()).is_ok());
    }

    #[test]
    fn spec_for_with_tier_env_and_args_still_parses() {
        let mut env = HashMap::new();
        env.insert("CODEX_CONFIG".to_string(), "model=\"sol\"".to_string());
        let spec = spec_for(
            "npx -y @agentclientprotocol/codex-acp@latest",
            &["--model".to_string(), "sol".to_string()],
            &env,
        );
        assert!(spec.is_ok());
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
