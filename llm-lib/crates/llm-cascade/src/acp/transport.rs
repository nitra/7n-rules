//! Спільний спавн/init/session-шар для всіх ACP-фасадів крейта.
//!
//! Портовано зі скелету `tauri-plugin-agent/src/acp/mod.rs`
//! (`build_acp_args`, handshake `initialize` → `session/new`), але без
//! Tauri-специфіки (`AppHandle`/`Emitter`/`State`) і з обов'язковою
//! операційною бронею cascade, якої плагін не мав: idle-timeout на кожен
//! update-read, `summarize_update`/`N_LLM_ACP_VERBOSE` progress-логування,
//! типізований [`CascadeError`] замість `String`.
//!
//! Обидва фасади крейта йдуть через нього: [`super::session::create_session`]
//! напряму (публічний session-API: create/prompt/update-стрім/зовнішній
//! permission-responder/cancel), а [`super::one_shot_acp`] — уже поверх
//! `session`, як тонкий фасад (один prompt + auto-approve + акумуляція
//! тексту, задача T2). Спільний [`drive_turn`] дає обом idle-timeout-
//! читання й progress-логування одного prompt-ходу.

use std::collections::HashMap;
use std::env;
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, PermissionOption, PermissionOptionId, PermissionOptionKind,
    SessionNotification, SessionUpdate, StopReason,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{AcpAgent, Error as AcpError, SessionMessage};

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

/// Чи друкувати повний `{:?}`-дамп кожної non-text ACP-події замість
/// одного короткого рядка. За замовчуванням (як `lint` без `--verbose`) —
/// тихо: `ToolCall`/`ToolCallUpdate` несуть `raw_input`/`raw_output` (повний
/// JSON параметрів/результату інструменту), і на прогоні `taze` з багатьма
/// пакетами це затоплювало stderr. Override: `N_LLM_ACP_VERBOSE=1`.
pub(crate) fn acp_verbose() -> bool {
    env::var("N_LLM_ACP_VERBOSE").is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

/// Один короткий рядок для non-text ACP-події — без `raw_input`/`raw_output`
/// інструментів і без тексту чанків `AgentThoughtChunk`/`UserMessageChunk` (стрім по токенах).
/// `N_LLM_ACP_VERBOSE=1` (`acp_verbose()`) повертає повний `{:?}` замість
/// цього — для діагностики зависань/протокольних аномалій.
pub(crate) fn summarize_update(update: &SessionUpdate) -> String {
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

/// Читає events одного prompt-ходу до `StopReason`, з `idle_timeout` на
/// кожне окреме читання (а не на весь хід разом — це і є "видимість": не-
/// текстові події (`tool_call`/`plan`/…) логуються в stderr замість
/// мовчазного відкидання (за замовчуванням — одним коротким рядком,
/// `N_LLM_ACP_VERBOSE=1` — повним `{:?}`), і саме кожна така подія скидає
/// таймер — реальний прогрес не зупиняє годинник, зупиняє лише справжня
/// тиша). Текстові `AgentThoughtChunk`/`UserMessageChunk` не логуються
/// зовсім (лише скидають таймер) — потокенний стрім думок агента інакше
/// затоплював stderr.
///
/// `on_update` отримує кожен `SessionUpdate` (текстові шматки включно) —
/// викликач вирішує, що з ним робити: акумулювати текст
/// ([`super::one_shot_acp`]) чи передати подію зовнішньому каналу
/// ([`super::session`]). Повертає фінальний `StopReason` ходу.
pub(crate) async fn drive_turn<S>(
    session: &mut S,
    idle_timeout: Duration,
    mut on_update: impl FnMut(&SessionUpdate),
) -> Result<StopReason, AcpError>
where
    S: AcpSessionUpdates,
{
    loop {
        let update = tokio::time::timeout(idle_timeout, session.read_update())
            .await
            .map_err(|_| {
                AcpError::internal_error().data(Some(serde_json::json!(format!(
                    "acp: немає жодної session/update-події {idle_timeout:?} — ймовірно завис"
                ))))
            })??;

        match update {
            SessionMessage::SessionMessage(dispatch) => {
                let on_update = &mut on_update;
                MatchDispatch::new(dispatch)
                    .if_notification(async move |notification: SessionNotification| {
                        let update = &notification.update;
                        let quiet_text_chunk = matches!(
                            update,
                            SessionUpdate::AgentThoughtChunk(ContentChunk {
                                content: ContentBlock::Text(_),
                                ..
                            }) | SessionUpdate::UserMessageChunk(ContentChunk {
                                content: ContentBlock::Text(_),
                                ..
                            })
                        ) && !acp_verbose();
                        let is_agent_text_chunk = matches!(
                            update,
                            SessionUpdate::AgentMessageChunk(ContentChunk {
                                content: ContentBlock::Text(_),
                                ..
                            })
                        );
                        if !quiet_text_chunk && !is_agent_text_chunk {
                            eprintln!("acp progress: {}", summarize_update(update));
                        }
                        on_update(update);
                        Ok(())
                    })
                    .await
                    .otherwise_ignore()?;
            }
            SessionMessage::StopReason(reason) => return Ok(reason),
            _ => {}
        }
    }
}

/// Мінімальний зріз `ActiveSession`, потрібний для idle-timeout-читання —
/// узагальнено, щоб уникнути повного generic-підпису `ActiveSession<'_, Link>`
/// у сигнатурі [`drive_turn`]. `pub(crate)` — і [`super::session`], і
/// `#[cfg(test)]`-фейки реалізують/використовують цю абстракцію.
pub(crate) trait AcpSessionUpdates {
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
    /// дозволів — 57+ хвилин тиші), [`drive_turn`] провалюється за
    /// idle-timeout, а не висить назавжди. Fail-fast на реальному спавні
    /// неіснуючого бінарника — тест `create_session_of_missing_binary_fails_fast_not_hangs`
    /// у `super::super::session` (той самий `drive_turn`, повний шлях
    /// `create_session`).
    #[tokio::test]
    async fn idle_timeout_fails_fast_when_no_updates_ever_arrive() {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            drive_turn(
                &mut NeverUpdatingSession,
                std::time::Duration::from_millis(50),
                |_update| {},
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
