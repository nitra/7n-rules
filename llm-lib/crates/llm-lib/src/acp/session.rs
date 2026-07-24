//! Публічний session-API крейта (задача T2, рішення В/В.1): довгоживуча
//! ACP-сесія з відкритим потоком подій, зовнішнім permission-responder-ом і
//! `cancel` — те, що сьогодні вміє лише `tauri-plugin-agent`
//! (`tauri-plugin-agent/src/acp/mod.rs`), тут без жодної Tauri-залежності
//! (`AppHandle`/`Emitter`/`State` — Tauri-emit лишається адаптеру-плагіну,
//! T9). [`super::one_shot_acp`] лишається окремим тонким фасадом (один
//! prompt + auto-approve + акумуляція тексту) над тим самим
//! [`super::transport`]-шаром, поведінка якого не змінюється.
//!
//! Архітектура — session builder ([`SessionOptions`]) → `create_session`
//! спавнить фонову `tokio`-задачу, яка володіє ACP-з'єднанням (з'єднання
//! живе рівно стільки, скільки триває `connect_with`-future — той самий
//! патерн, що й у плагіні) і крутить mpsc-цикл команд (`prompt`/`cancel`);
//! `create_session` не повертається, доки `initialize` → `session/new` →
//! опційний `session/set_config_option` не завершаться (handshake-ready-
//! синхронізація, як `acp_spawn_agent` у плагіні) — інакше перший
//! [`SessionHandle::prompt`] або спливе незрозумілою помилкою "канал
//! закритий", або зафіксує гонку з handshake.
//!
//! Permission-семантики (рішення Л) — два режими одного механізму:
//! [`PermissionMode::External`] пересилає кожен `session/request_permission`
//! як [`SessionEvent::PermissionRequest`] у той самий канал подій, і
//! викликач відповідає сам ([`PermissionRequestEvent::respond`]/
//! [`PermissionRequestEvent::cancel`]); [`PermissionMode::AutoApprove`] —
//! готова стратегія **поверх того самого каналу**: [`drive_auto_approve`]
//! читає ті самі `PermissionRequest`-події і одразу відповідає
//! [`transport::pick_auto_permission_option`], без окремого протокольного
//! шляху.

use std::collections::HashMap;
use std::path::Path;

use agent_client_protocol::schema::v1::{
    ClientCapabilities, InitializeRequest, McpServer, NewSessionRequest, PermissionOption,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionConfigId, SessionUpdate, SetSessionConfigOptionRequest,
    StopReason,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Client, Responder};
use tokio::sync::{mpsc, oneshot};

use crate::LlmError;

use super::transport::{self, AcpSessionUpdates};

/// Опційний post-`session/new`-крок конфігурації (рішення З.1, потрібен
/// Pi-тіру): один `session/set_config_option` **між** `session/new` і
/// першим `session/prompt` — не env/args на спавні, як у Cursor/Codex.
/// `configId: "model"`, `value: "provider/modelId"` (напр.
/// `"openai-codex/gpt-5.6-terra"`) — точні значення несе тір-пресет (T3),
/// цей тип лише виконує вже готову пару.
#[derive(Debug, Clone)]
pub struct PostSessionConfig {
    /// `configId` протокольного виклику (Pi: `"model"`).
    pub config_id: String,
    /// `value` протокольного виклику (Pi: `"provider/modelId"`).
    pub value: String,
}

impl PostSessionConfig {
    /// Пара `configId`/`value` для `session/set_config_option`.
    #[must_use]
    pub fn new(config_id: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            config_id: config_id.into(),
            value: value.into(),
        }
    }
}

/// Хто відповідає на `session/request_permission` (рішення Л — два режими
/// одного механізму, не два дизайни).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PermissionMode {
    /// Кожен запит пересилається як [`SessionEvent::PermissionRequest`] у
    /// канал подій; викликач відповідає сам.
    External,
    /// Full-trust one-shot-стратегія (`transport::pick_auto_permission_option`)
    /// поверх того самого зовнішнього каналу — див. [`drive_auto_approve`].
    #[default]
    AutoApprove,
}

/// Опції створення сесії ([`create_session`]).
#[derive(Debug, Clone, Default)]
pub struct SessionOptions {
    /// Extra env для спавну (той самий контракт, що й `build_acp_args` —
    /// тір-пресети T3 підуть саме сюди).
    pub extra_env: HashMap<String, String>,
    /// Extra args для спавну (напр. `--model <id>` для Cursor).
    pub extra_args: Vec<String>,
    /// Клієнтські ACP-capabilities (`fs`/`terminal`) — типово порожні
    /// (жодних дозволів агенту без явної згоди викликача).
    pub client_capabilities: ClientCapabilities,
    /// MCP-сервери, які приєднати до сесії (домен-каталог тощо).
    pub mcp_servers: Vec<McpServer>,
    /// Хто відповідає на дозволи.
    pub permission_mode: PermissionMode,
    /// Опційний post-`session/new`-крок (рішення З.1).
    pub post_session_config: Option<PostSessionConfig>,
}

/// Подія, яку [`create_session`] публікує в канал подій.
#[derive(Debug)]
pub enum SessionEvent {
    /// `session/update`-нотифікація від агента (текст, tool-call, plan, …).
    /// `Box` — `ToolCall`/`ToolCallUpdate` несуть великий `raw_input`/
    /// `raw_output`, і clippy справедливо не хоче роздувати весь `SessionEvent`
    /// під найбільший варіант.
    Update(Box<SessionUpdate>),
    /// `session/request_permission` — лише в [`PermissionMode::External`]
    /// ([`PermissionMode::AutoApprove`] відповідає сама, до появи в каналі
    /// назовні не доходить). Відповісти: [`PermissionRequestEvent::respond`]/
    /// [`PermissionRequestEvent::cancel`]. `Box` — щоб рідкісний великий
    /// варіант (несе `Responder`) не роздував увесь `SessionEvent` для
    /// частого `Update`.
    PermissionRequest(Box<PermissionRequestEvent>),
}

/// Запит дозволу, що чекає на відповідь ззовні ([`PermissionMode::External`]).
#[derive(Debug)]
pub struct PermissionRequestEvent {
    /// Деталі tool-call-а, на який агент просить дозвіл (`title`,
    /// `tool_call_id`, …) — потрібні зовнішньому responder-у, щоб показати
    /// людині, *що саме* просить дозволу (permission-UI плагіна, T9), а не
    /// лише перелік варіантів відповіді.
    pub tool_call: agent_client_protocol::schema::v1::ToolCallUpdate,
    /// Варіанти дозволу, з яких викликач обирає один
    /// ([`PermissionRequestEvent::respond`]) — той самий `PermissionOption`,
    /// що йде в протокольний запит (id/name/kind).
    pub options: Vec<PermissionOption>,
    responder: Responder<RequestPermissionResponse>,
}

impl PermissionRequestEvent {
    /// Відповідає обраним варіантом (`option.option_id` з [`Self::options`]).
    ///
    /// # Errors
    /// [`LlmError::Provider`] — з'єднання з агентом уже закрите.
    pub fn respond(
        self,
        option_id: agent_client_protocol::schema::v1::PermissionOptionId,
    ) -> Result<(), LlmError> {
        self.responder
            .respond(RequestPermissionResponse::new(
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id)),
            ))
            .map_err(|e| LlmError::Provider(e.to_string()))
    }

    /// Відхиляє запит (агент отримує `RequestPermissionOutcome::Cancelled`).
    ///
    /// # Errors
    /// [`LlmError::Provider`] — з'єднання з агентом уже закрите.
    pub fn cancel(self) -> Result<(), LlmError> {
        self.responder
            .respond(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ))
            .map_err(|e| LlmError::Provider(e.to_string()))
    }
}

/// Команди, які приймає фонова задача сесії.
enum SessionCommand {
    Prompt {
        text: String,
        reply: oneshot::Sender<Result<StopReason, LlmError>>,
    },
    Cancel,
}

/// Ручка живої сесії — `prompt`/`cancel`. Клонування дешеве
/// (`mpsc::UnboundedSender` всередині); фонова задача сесії завершується,
/// коли останній клон дропається.
#[derive(Clone, Debug)]
pub struct SessionHandle {
    commands: mpsc::UnboundedSender<SessionCommand>,
}

impl SessionHandle {
    /// Надсилає prompt і чекає на кінець ходу (`StopReason`). Контент самого
    /// ходу (текст/tool-calls/plan) приходить окремо через канал подій
    /// [`create_session`] — це повертає лише термінальний статус.
    ///
    /// # Errors
    /// [`LlmError::Provider`] — фонова задача сесії вже завершилась
    /// (з'єднання розірване) або хід провалився ACP-помилкою/idle-timeout.
    pub async fn prompt(&self, text: impl Into<String>) -> Result<StopReason, LlmError> {
        let (reply, reply_rx) = oneshot::channel();
        self.commands
            .send(SessionCommand::Prompt {
                text: text.into(),
                reply,
            })
            .map_err(|_| LlmError::Provider("acp: сесія вже завершена".to_string()))?;
        reply_rx.await.map_err(|_| {
            LlmError::Provider("acp: фонова задача сесії обірвала канал відповіді".to_string())
        })?
    }

    /// Просить агента скасувати поточний хід (`session/prompt` завершиться
    /// зі `StopReason::Cancelled`) — сама команда не блокує на підтвердженні.
    ///
    /// # Errors
    /// [`LlmError::Provider`] — фонова задача сесії вже завершена.
    pub fn cancel(&self) -> Result<(), LlmError> {
        self.commands
            .send(SessionCommand::Cancel)
            .map_err(|_| LlmError::Provider("acp: сесія вже завершена".to_string()))
    }
}

/// Спавнить агента (`spec`), відкриває сесію в `cwd` і тримає її живою у
/// фоновій `tokio`-задачі, доки живий хоч один [`SessionHandle`].
/// Повертається лише після успішного `initialize` → `session/new` →
/// опційного `session/set_config_option` — так само, як `acp_spawn_agent`
/// у плагіні чекає handshake, щоб перший `prompt` не гнався за гонкою і щоб
/// реальна причина відмови (агент не залогінений, невалідний `configId`
/// тощо) повернулась одразу, а не як загадкове "канал закритий" з першого
/// [`SessionHandle::prompt`].
///
/// # Errors
/// [`LlmError::Provider`] — спавн/handshake/config-крок провалились.
pub async fn create_session(
    spec: AcpAgent,
    cwd: &Path,
    options: SessionOptions,
) -> Result<(SessionHandle, mpsc::UnboundedReceiver<SessionEvent>), LlmError> {
    let cwd = cwd.to_path_buf();
    let idle_timeout = transport::idle_timeout();
    let permission_mode = options.permission_mode;
    let client_capabilities = options.client_capabilities;
    let mcp_servers = options.mcp_servers;
    let post_session_config = options.post_session_config;

    let (command_tx, mut command_rx) = mpsc::unbounded_channel::<SessionCommand>();
    let (event_tx, event_rx) = mpsc::unbounded_channel::<SessionEvent>();
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();

    let permission_event_tx = event_tx.clone();
    tokio::spawn(async move {
        // `ready_tx` — власність цього таска, повністю споживається
        // всередині `connect_with`-замикання: кожен ранній вихід (`?` на
        // init/session-new/config-кроці) сам шле `Err` перед поверненням,
        // успішний шлях шле `Ok(())` перед входом у командний цикл. Тому
        // зовнішнього "якщо `result` — `Err`" гілки після `.await` не
        // потрібно (і вона не скомпілювалась би — `ready_tx` уже
        // переміщено в замикання).
        let mut ready_tx = Some(ready_tx);

        let result = Client
            .builder()
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _cx| match permission_mode
                {
                    PermissionMode::AutoApprove => {
                        let outcome = match transport::pick_auto_permission_option(&request.options)
                        {
                            Some(option_id) => RequestPermissionOutcome::Selected(
                                SelectedPermissionOutcome::new(option_id),
                            ),
                            None => RequestPermissionOutcome::Cancelled,
                        };
                        responder.respond(RequestPermissionResponse::new(outcome))
                    }
                    PermissionMode::External => {
                        let _ = permission_event_tx.send(SessionEvent::PermissionRequest(
                            Box::new(PermissionRequestEvent {
                                tool_call: request.tool_call,
                                options: request.options,
                                responder,
                            }),
                        ));
                        Ok(())
                    }
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(spec, async move |cx| {
                if let Err(e) = cx
                    .send_request(
                        InitializeRequest::new(ProtocolVersion::V1)
                            .client_capabilities(client_capabilities),
                    )
                    .block_task()
                    .await
                {
                    if let Some(ready_tx) = ready_tx.take() {
                        let _ = ready_tx.send(Err(e.to_string()));
                    }
                    return Err(e);
                }

                let request = NewSessionRequest::new(cwd).mcp_servers(mcp_servers);
                let mut session = match cx
                    .build_session_from(request)
                    .block_task()
                    .start_session()
                    .await
                {
                    Ok(session) => session,
                    Err(e) => {
                        if let Some(ready_tx) = ready_tx.take() {
                            let _ = ready_tx.send(Err(e.to_string()));
                        }
                        return Err(e);
                    }
                };

                if let Some(config) = post_session_config {
                    if let Err(e) = session
                        .connection()
                        .send_request(SetSessionConfigOptionRequest::new(
                            session.session_id().clone(),
                            SessionConfigId::new(config.config_id),
                            config.value.as_str(),
                        ))
                        .block_task()
                        .await
                    {
                        if let Some(ready_tx) = ready_tx.take() {
                            let _ = ready_tx.send(Err(e.to_string()));
                        }
                        return Err(e);
                    }
                }

                let session_id = session.session_id().clone();
                if let Some(ready_tx) = ready_tx.take() {
                    let _ = ready_tx.send(Ok(()));
                }

                while let Some(command) = command_rx.recv().await {
                    match command {
                        SessionCommand::Prompt { text, reply } => {
                            let outcome =
                                run_prompt_turn(&mut session, idle_timeout, text, &event_tx).await;
                            let _ = reply.send(outcome);
                        }
                        SessionCommand::Cancel => {
                            let _ = session.connection().send_notification(
                                agent_client_protocol::schema::v1::CancelNotification::new(
                                    session_id.clone(),
                                ),
                            );
                        }
                    }
                }

                Ok(())
            })
            .await;

        if let Err(err) = result {
            eprintln!("acp: фонова задача сесії завершилась помилкою: {err}");
        }
    });

    match ready_rx.await {
        Ok(Ok(())) => Ok((
            SessionHandle {
                commands: command_tx,
            },
            event_rx,
        )),
        Ok(Err(message)) => Err(LlmError::Provider(message)),
        Err(_) => Err(LlmError::Provider(
            "acp: фонова задача сесії завершилась до підтвердження handshake".to_string(),
        )),
    }
}

/// Один prompt-хід: надсилає `text`, пересилає кожен `SessionUpdate` у
/// канал подій через [`transport::drive_turn`] (idle-timeout + progress-
/// логування, та сама операційна броня, що й у [`super::one_shot_acp`]),
/// повертає фінальний `StopReason`.
async fn run_prompt_turn<S>(
    session: &mut S,
    idle_timeout: std::time::Duration,
    text: String,
    event_tx: &mpsc::UnboundedSender<SessionEvent>,
) -> Result<StopReason, LlmError>
where
    S: AcpSessionUpdates + SendsPrompt,
{
    session
        .send_prompt(text)
        .map_err(|e| LlmError::Provider(e.to_string()))?;

    transport::drive_turn(session, idle_timeout, |update| {
        let _ = event_tx.send(SessionEvent::Update(Box::new(update.clone())));
    })
    .await
    .map_err(|e| LlmError::Provider(e.to_string()))
}

/// Мінімальний зріз `ActiveSession::send_prompt`, потрібний
/// [`run_prompt_turn`] — узагальнено разом з [`AcpSessionUpdates`], щоб
/// уникнути повного generic-підпису `ActiveSession<'_, Link>`.
trait SendsPrompt {
    fn send_prompt(&mut self, prompt: impl ToString) -> Result<(), agent_client_protocol::Error>;
}

impl<Link> SendsPrompt for agent_client_protocol::ActiveSession<'_, Link>
where
    Link: agent_client_protocol::role::HasPeer<agent_client_protocol::Agent>,
{
    fn send_prompt(&mut self, prompt: impl ToString) -> Result<(), agent_client_protocol::Error> {
        agent_client_protocol::ActiveSession::send_prompt(self, prompt)
    }
}

/// Готова [`PermissionMode::AutoApprove`]-стратегія, реалізована **поверх**
/// [`PermissionMode::External`]-каналу (рішення Л: не окремий протокольний
/// шлях, той самий механізм). Не потрібна тому викликачу, який створює сесію
/// вже з `PermissionMode::AutoApprove` (той шлях відповідає всередині
/// фонової задачі сесії, без проходу через канал подій) — придатна, якщо
/// зовнішній код хоче явно приймати рішення по кожному запиту, окрім
/// авто-approve, тобто для проміжних стратегій (напр. `AutoApprove` з
/// логуванням) поверх `External`-каналу.
///
/// Читає `rx`, доки він не закриється (сесія завершилась), ігноруючи
/// `SessionEvent::Update` — той хай читає власний код викликача з окремого
/// каналу чи `tee`.
pub async fn drive_auto_approve(mut rx: mpsc::UnboundedReceiver<SessionEvent>) {
    while let Some(event) = rx.recv().await {
        if let SessionEvent::PermissionRequest(request) = event {
            let option_id = transport::pick_auto_permission_option(&request.options);
            let result = match option_id {
                Some(option_id) => request.respond(option_id),
                None => request.cancel(),
            };
            if let Err(err) = result {
                eprintln!("acp: auto-approve не зміг відповісти на дозвіл: {err}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn missing_binary_spec() -> AcpAgent {
        AcpAgent::from_str("nonexistent-acp-binary-xyz-session-test").unwrap()
    }

    /// `create_session` не має зависати, якщо бінарник агента відсутній — та сама
    /// fail-fast гарантія, що й у `one_shot_acp`.
    #[tokio::test]
    async fn create_session_of_missing_binary_fails_fast_not_hangs() {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            create_session(
                missing_binary_spec(),
                &std::env::temp_dir(),
                SessionOptions::default(),
            ),
        )
        .await;

        let outcome = result.expect("spawn неіснуючого бінарника не мав зависнути довше 5с");
        assert!(
            outcome.is_err(),
            "неіснуючий бінарник має провалитись, а не повернути Ok"
        );
    }

    /// Фейкова сесія без жодної події — той самий idle-timeout-захист, що й
    /// `read_to_string_with_idle_timeout`, але через `run_prompt_turn`
    /// (стрім подій замість акумуляції тексту).
    struct NeverUpdatingSession;

    impl AcpSessionUpdates for NeverUpdatingSession {
        async fn read_update(
            &mut self,
        ) -> Result<agent_client_protocol::SessionMessage, agent_client_protocol::Error> {
            std::future::pending().await
        }
    }

    impl SendsPrompt for NeverUpdatingSession {
        fn send_prompt(
            &mut self,
            _prompt: impl ToString,
        ) -> Result<(), agent_client_protocol::Error> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn run_prompt_turn_fails_fast_on_idle_timeout() {
        let (event_tx, _event_rx) = mpsc::unbounded_channel();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            run_prompt_turn(
                &mut NeverUpdatingSession,
                std::time::Duration::from_millis(50),
                "привіт".to_string(),
                &event_tx,
            ),
        )
        .await;

        let outcome =
            result.expect("idle-timeout сам мав спрацювати задовго до зовнішнього 5с-ліміту");
        assert!(
            outcome.is_err(),
            "без подій хід має провалитись, а не повернути Ok"
        );
    }

    /// `SessionOptions::default()` — `PermissionMode::AutoApprove`, без
    /// caps/MCP/config-кроку — той самий baseline, що й `one_shot_acp`.
    #[test]
    fn session_options_default_is_auto_approve() {
        let options = SessionOptions::default();
        assert_eq!(options.permission_mode, PermissionMode::AutoApprove);
        assert!(options.post_session_config.is_none());
        assert!(options.mcp_servers.is_empty());
    }

    #[test]
    fn post_session_config_carries_config_id_and_value() {
        let config = PostSessionConfig::new("model", "openai-codex/gpt-5.6-terra");
        assert_eq!(config.config_id, "model");
        assert_eq!(config.value, "openai-codex/gpt-5.6-terra");
    }
}
