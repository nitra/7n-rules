//! Спільний спавн/init/session-шар для всіх ACP-фасадів крейта.
//!
//! Портовано зі скелету `tauri-plugin-agent/src/acp/mod.rs`
//! (`build_acp_args`, handshake `initialize` → `session/new`), але без
//! Tauri-специфіки (`AppHandle`/`Emitter`/`State`) і з обов'язковою
//! операційною бронею cascade, якої плагін не мав: semantic idle-timeout,
//! `summarize_update`/`N_LLM_ACP_VERBOSE` progress-логування,
//! типізований [`LlmError`] замість `String`.
//!
//! Обидва фасади крейта йдуть через нього: [`super::session::create_session`]
//! напряму (публічний session-API: create/prompt/update-стрім/зовнішній
//! permission-responder/cancel), а [`super::one_shot_acp`] — уже поверх
//! `session`, як тонкий фасад (один prompt + auto-approve + акумуляція
//! тексту, задача T2). Спільний [`drive_turn`] дає обом idle-timeout-
//! читання й progress-логування одного prompt-ходу.

use std::collections::HashMap;
use std::env;
use std::sync::mpsc as std_mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, PermissionOption, PermissionOptionId, PermissionOptionKind,
    SessionNotification, SessionUpdate, StopReason,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{AcpAgent, Error as AcpError, SessionMessage};

use crate::LlmError;

/// `npm exec --package=...` експортує цю службову змінну в дочірні процеси.
/// Якщо ACP-команда сама запускається через `npx`, успадковане значення
/// підміняє її package selector: замість `@agentclientprotocol/*-acp`
/// вкладений `npx` намагається виконати package зовнішнього `npm exec`.
const NPM_CONFIG_PACKAGE: &str = "npm_config_package";

/// Один і той самий ACP update не є новим прогресом. Ліміт зупиняє
/// багатоядерний busy-loop, якщо bridge після завершення ходу нескінченно
/// відтворює останній text/tool event замість `StopReason`.
const MAX_DUPLICATE_ACTIVITY_EVENTS: usize = 64;

/// Абсолютна межа одного ACP ходу. Progress-події не можуть її подовжити,
/// тому bridge не здатен утримувати resolver живим нескінченним flood-ом.
const DEFAULT_TURN_TIMEOUT_MS: u64 = 300_000;

/// Semantic idle-timeout — без нового tool-call або agent output, не загальна
/// тривалість ходу. Usage/thought/config/tool-update шум не подовжує deadline,
/// тому завислий агент не може жити вічно лише завдяки progress events.
/// Захист також зупиняє повну протокольну тишу. Override:
/// `N_LLM_ACP_IDLE_TIMEOUT_MS`.
pub(crate) fn idle_timeout() -> Duration {
    Duration::from_millis(
        env::var("N_LLM_ACP_IDLE_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(180_000),
    )
}

/// Повертає абсолютний timeout одного ACP ходу. Override:
/// `N_LLM_ACP_TURN_TIMEOUT_MS`.
pub(crate) fn turn_timeout() -> Duration {
    Duration::from_millis(
        env::var("N_LLM_ACP_TURN_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_TURN_TIMEOUT_MS),
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
    let nested_npx = command.split_whitespace().next() == Some("npx");
    let mut argv = Vec::new();
    if nested_npx && !extra_env.contains_key(NPM_CONFIG_PACKAGE) {
        argv.push(format!("{NPM_CONFIG_PACKAGE}="));
    }
    argv.extend(extra_env.iter().map(|(k, v)| format!("{k}={v}")));
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
) -> Result<AcpAgent, LlmError> {
    AcpAgent::from_args(build_acp_args(command, extra_args, extra_env))
        .map_err(|e| LlmError::Provider(e.to_string()))
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

/// Виділений потік для stderr-виводу ACP-діагностики (progress/помилки
/// фонової задачі/auto-approve) — розв'язує tokio-задачу сесії від
/// блокуючого `write()` на stdio. `eprintln!` синхронно бере
/// процес-глобальний lock `Stderr` на час системного виклику: якщо той
/// заблокується (переповнений pipe/tty без активного читача — типовий
/// випадок під конкурентними сесіями, що вдвічі й більше збільшують обсяг
/// progress-логів), tokio-воркер зависає всередині `write`, а з ним і
/// будь-який інший потік процесу, що теж чекає той самий lock (напр.
/// незалежний heartbeat-принт викликача). [`log_line`] лишає сам
/// блокуючий `eprintln!` тільки на цьому одному потоці; `send` у канал
/// ніколи не блокує (unbounded — обсяг обмежений реальними подіями ходу,
/// не довільним потоком байтів), тож ACP-задачі самі ніколи не чекають
/// на stdio.
fn log_sender() -> &'static std_mpsc::Sender<String> {
    static SENDER: OnceLock<std_mpsc::Sender<String>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let (tx, rx) = std_mpsc::channel::<String>();
        std::thread::Builder::new()
            .name("acp-log".to_string())
            .spawn(move || {
                while let Ok(line) = rx.recv() {
                    eprintln!("{line}");
                }
            })
            .expect("не вдалось запустити потік acp-log");
        tx
    })
}

/// Неблокуюче логування ACP-шляху — заміна прямого `eprintln!` у
/// tokio-задачах сесії (див. [`log_sender`]).
pub(crate) fn log_line(line: impl Into<String>) {
    let _ = log_sender().send(line.into());
}

/// Чи друкувати короткі non-text ACP progress events. Оркестратори з власним
/// progress UI можуть вимкнути дубльований stderr через
/// `N_LLM_ACP_PROGRESS=0`; verbose завжди має пріоритет.
pub(crate) fn acp_progress_enabled() -> bool {
    acp_verbose()
        || !env::var("N_LLM_ACP_PROGRESS")
            .is_ok_and(|v| v == "0" || v.eq_ignore_ascii_case("false"))
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

/// Помилка semantic idle-timeout ходу — спільна для явної перевірки
/// вичерпаного deadline і для `tokio::time::timeout` у [`drive_turn`].
fn idle_timeout_error(idle_timeout: Duration) -> AcpError {
    AcpError::internal_error().data(Some(serde_json::json!(format!(
        "acp: немає змістовного agent/tool прогресу {idle_timeout:?} — ймовірно завис"
    ))))
}

/// Помилка абсолютного timeout незалежно від будь-яких ACP progress events.
fn turn_timeout_error(turn_timeout: Duration) -> AcpError {
    AcpError::internal_error().data(Some(serde_json::json!(format!(
        "acp: хід перевищив абсолютний timeout {turn_timeout:?} — сесію зупинено"
    ))))
}

/// Чи є update змістовним прогресом, який подовжує semantic idle deadline.
/// Usage/thought/config/tool-update шум навмисно не скидає watchdog: ACP
/// агенти можуть нескінченно надсилати такі events уже після filesystem edits.
fn activity_key(update: &SessionUpdate) -> Option<String> {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => Some(format!("agent:{chunk:?}")),
        SessionUpdate::ToolCall(tool_call) => Some(format!("tool:{}", tool_call.tool_call_id.0)),
        _ => None,
    }
}

/// Читає events одного prompt-ходу до `StopReason`, з semantic
/// `idle_timeout`: deadline скидають лише новий tool-call або текст/контент
/// відповіді агента. Usage/thought/config/tool-update events логуються за
/// чинною progress-політикою, але не можуть тримати завислий хід живим.
///
/// `on_update` отримує кожен `SessionUpdate` (текстові шматки включно) —
/// викликач вирішує, що з ним робити: акумулювати текст
/// ([`super::one_shot_acp`]) чи передати подію зовнішньому каналу
/// ([`super::session`]). Повертає фінальний `StopReason` ходу.
pub(crate) async fn drive_turn<S>(
    session: &mut S,
    idle_timeout: Duration,
    turn_timeout: Duration,
    mut on_update: impl FnMut(&SessionUpdate),
) -> Result<StopReason, AcpError>
where
    S: AcpSessionUpdates,
{
    let mut idle_deadline = Instant::now() + idle_timeout;
    let turn_deadline = Instant::now() + turn_timeout;
    let mut last_activity = None;
    let mut duplicate_activity_events = 0;
    loop {
        let now = Instant::now();
        if now >= turn_deadline {
            return Err(turn_timeout_error(turn_timeout));
        }
        let remaining = idle_deadline
            .saturating_duration_since(now)
            .min(turn_deadline.saturating_duration_since(now));
        // Вичерпаний deadline перевіряється явно ДО читання:
        // `tokio::time::timeout` завжди спершу полить внутрішній future, тож
        // на агенті, що флудить не-змістовними подіями (кожен `read_update`
        // миттєво ready), сам по собі timeout не спрацював би ніколи — хід
        // жив би вічно busy-loop-ом (живий симптом Codex ACP після terminal
        // event без відповіді на `session/prompt`).
        if remaining.is_zero() {
            return Err(idle_timeout_error(idle_timeout));
        }
        let update = tokio::time::timeout(remaining, session.read_update())
            .await
            .map_err(|_| idle_timeout_error(idle_timeout))??;

        match update {
            SessionMessage::SessionMessage(dispatch) => {
                let on_update = &mut on_update;
                let mut meaningful_activity = false;
                let activity_seen = &mut meaningful_activity;
                let last_activity = &mut last_activity;
                let duplicate_events = &mut duplicate_activity_events;
                MatchDispatch::new(dispatch)
                    .if_notification(async move |notification: SessionNotification| {
                        let update = &notification.update;
                        if let Some(key) = activity_key(update) {
                            if last_activity.as_ref() != Some(&key) {
                                *last_activity = Some(key);
                                *activity_seen = true;
                                *duplicate_events = 0;
                            } else {
                                *duplicate_events += 1;
                                if *duplicate_events > MAX_DUPLICATE_ACTIVITY_EVENTS {
                                    return Err(AcpError::internal_error().data(Some(
                                        serde_json::json!(
                                            "acp: bridge повторює той самий agent/tool event без StopReason"
                                        ),
                                    )));
                                }
                            }
                        }
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
                        if acp_progress_enabled() && !quiet_text_chunk && !is_agent_text_chunk {
                            log_line(format!("acp progress: {}", summarize_update(update)));
                        }
                        on_update(update);
                        Ok(())
                    })
                    .await
                    .otherwise_ignore()?;
                if meaningful_activity {
                    idle_deadline = Instant::now() + idle_timeout;
                }
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

/// Фейкова сесія, яка безкінечно шле Plan-шум без agent output/tool-call.
#[cfg(test)]
struct NoisySession;

#[cfg(test)]
impl AcpSessionUpdates for NoisySession {
    async fn read_update(&mut self) -> Result<SessionMessage, AcpError> {
        use agent_client_protocol::schema::v1::Plan;
        use agent_client_protocol::{Dispatch, UntypedMessage};

        tokio::time::sleep(Duration::from_millis(5)).await;
        let notification = SessionNotification::new("test", SessionUpdate::Plan(Plan::new(vec![])));
        let message = UntypedMessage::new("session/update", notification)?;
        Ok(SessionMessage::SessionMessage(Dispatch::Notification(
            message,
        )))
    }
}

/// Фейкова сесія-«флуд»: не-змістовний шум готовий **миттєво** на кожен
/// `read_update`, без жодного await-yield — так виглядає буферизований потік
/// подій від агента, що після terminal event продовжує слати телеметрію,
/// не відповідаючи на `session/prompt` (живий симптом `codex-acp` у
/// `git-reconcile`).
#[cfg(test)]
struct FloodingSession;

#[cfg(test)]
impl AcpSessionUpdates for FloodingSession {
    async fn read_update(&mut self) -> Result<SessionMessage, AcpError> {
        use agent_client_protocol::schema::v1::Plan;
        use agent_client_protocol::{Dispatch, UntypedMessage};

        let notification = SessionNotification::new("test", SessionUpdate::Plan(Plan::new(vec![])));
        let message = UntypedMessage::new("session/update", notification)?;
        Ok(SessionMessage::SessionMessage(Dispatch::Notification(
            message,
        )))
    }
}

/// Фейкова сесія, яка нескінченно повторює той самий agent text event. Це
/// окремий клас flood: до захисту кожен повтор скидав semantic idle deadline.
#[cfg(test)]
struct RepeatingActivitySession;

#[cfg(test)]
impl AcpSessionUpdates for RepeatingActivitySession {
    async fn read_update(&mut self) -> Result<SessionMessage, AcpError> {
        use agent_client_protocol::schema::v1::TextContent;
        use agent_client_protocol::{Dispatch, UntypedMessage};

        let update = SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
            TextContent::new("same agent output"),
        )));
        let notification = SessionNotification::new("test", update);
        let message = UntypedMessage::new("session/update", notification)?;
        Ok(SessionMessage::SessionMessage(Dispatch::Notification(
            message,
        )))
    }
}

/// Фейкова сесія, яка чергує різні agent chunks. Вони скидають idle timeout,
/// тому лише абсолютна межа здатна завершити такий flood.
#[cfg(test)]
struct AlternatingActivitySession {
    next: bool,
}

#[cfg(test)]
impl AcpSessionUpdates for AlternatingActivitySession {
    async fn read_update(&mut self) -> Result<SessionMessage, AcpError> {
        use agent_client_protocol::schema::v1::TextContent;
        use agent_client_protocol::{Dispatch, UntypedMessage};

        self.next = !self.next;
        let text = if self.next {
            "first output"
        } else {
            "second output"
        };
        let update = SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
            TextContent::new(text),
        )));
        let notification = SessionNotification::new("test", update);
        let message = UntypedMessage::new("session/update", notification)?;
        Ok(SessionMessage::SessionMessage(Dispatch::Notification(
            message,
        )))
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
                "npm_config_package=",
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
    fn build_acp_args_sanitizes_parent_package_for_nested_npx() {
        let args = build_acp_args(
            "npx -y @agentclientprotocol/codex-acp@latest",
            &[],
            &HashMap::new(),
        );
        assert_eq!(
            args,
            vec![
                "npm_config_package=",
                "npx",
                "-y",
                "@agentclientprotocol/codex-acp@latest",
            ]
        );
    }

    #[test]
    fn build_acp_args_preserves_explicit_nested_npx_package_override() {
        let mut env = HashMap::new();
        env.insert(
            NPM_CONFIG_PACKAGE.to_string(),
            "@agentclientprotocol/custom-acp".to_string(),
        );
        let args = build_acp_args("npx custom-acp", &[], &env);
        assert_eq!(
            args,
            vec![
                "npm_config_package=@agentclientprotocol/custom-acp",
                "npx",
                "custom-acp",
            ]
        );
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
                Duration::from_secs(5),
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

    /// Регресія на живий hang `git-reconcile`×Codex (~320% CPU busy-loop):
    /// коли агент після terminal event флудить не-змістовними подіями і не
    /// відповідає на `session/prompt`, кожен `read_update` миттєво ready — і
    /// `tokio::time::timeout` (який завжди спершу полить внутрішній future)
    /// ніколи не спрацьовує, навіть із вичерпаним deadline. [`drive_turn`]
    /// має сам перевіряти вичерпання deadline і провалюватись за idle-timeout,
    /// а не жити вічно на flood-і. До фіксу цей тест зависав намертво (loop
    /// без жодного yield), а не просто провалювався.
    #[tokio::test]
    async fn idle_timeout_fires_even_when_flooded_with_instantly_ready_noise() {
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            drive_turn(
                &mut FloodingSession,
                Duration::from_millis(50),
                Duration::from_secs(5),
                |_update| {},
            ),
        )
        .await;

        let outcome = result.expect("flood не-змістовних подій не має тримати drive_turn вічно");
        assert!(
            outcome.is_err(),
            "вичерпаний semantic idle deadline має провалити хід і під flood-ом"
        );
    }

    #[tokio::test]
    async fn duplicate_agent_activity_flood_fails_without_spinning_until_idle_timeout() {
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            drive_turn(
                &mut RepeatingActivitySession,
                Duration::from_secs(30),
                Duration::from_secs(5),
                |_update| {},
            ),
        )
        .await;

        let outcome = result.expect("повторюваний agent event має бути зупинений bounded-захистом");
        assert!(
            outcome.is_err(),
            "однаковий agent event не має нескінченно подовжувати хід"
        );
    }

    #[tokio::test]
    async fn absolute_turn_timeout_stops_alternating_activity_flood() {
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            drive_turn(
                &mut AlternatingActivitySession { next: false },
                Duration::from_secs(30),
                Duration::from_millis(50),
                |_update| {},
            ),
        )
        .await;

        let outcome = result.expect("абсолютний timeout має завершити alternating flood");
        assert!(
            outcome.is_err(),
            "progress events не мають нескінченно подовжувати ACP хід"
        );
    }

    #[tokio::test]
    async fn progress_noise_does_not_reset_semantic_idle_timeout() {
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            drive_turn(
                &mut NoisySession,
                Duration::from_millis(40),
                Duration::from_secs(5),
                |_update| {},
            ),
        )
        .await;

        let outcome = result.expect("semantic idle-timeout має спрацювати попри Plan events");
        assert!(outcome.is_err(), "progress noise не має тримати хід живим");
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

    #[test]
    fn only_new_agent_output_or_tool_call_is_activity() {
        use agent_client_protocol::schema::v1::{Plan, ToolCall};

        let plan = SessionUpdate::Plan(Plan::new(vec![]));
        let tool_call = SessionUpdate::ToolCall(ToolCall::new("id-1", "Edit foo.rs"));

        assert!(activity_key(&plan).is_none());
        assert_eq!(activity_key(&tool_call), Some("tool:id-1".to_string()));
    }
}
