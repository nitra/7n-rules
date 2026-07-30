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
    ClientCapabilities, ContentBlock, ContentChunk, InitializeRequest, McpServer,
    NewSessionRequest, PermissionOption, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionConfigId, SessionUpdate,
    SetSessionConfigOptionRequest, StopReason,
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
    /// Case-insensitive fragments команд, які one-shot не має дозволяти.
    /// Перевіряються у title та raw input tool call до auto-approve.
    pub deny_command_fragments: Vec<String>,
    /// Опційний post-`session/new`-крок (рішення З.1).
    pub post_session_config: Option<PostSessionConfig>,
}

/// Чи tool-call містить заборонений command fragment.
pub(crate) fn denies_tool_call(
    tool_call: &agent_client_protocol::schema::v1::ToolCallUpdate,
    deny_command_fragments: &[String],
) -> bool {
    if deny_command_fragments.is_empty() {
        return false;
    }
    let title = tool_call
        .fields
        .title
        .as_deref()
        .unwrap_or_default()
        .to_lowercase();
    let raw_input = tool_call
        .fields
        .raw_input
        .as_ref()
        .map_or_else(String::new, |value| value.to_string().to_lowercase());
    deny_command_fragments.iter().any(|fragment| {
        let fragment = fragment.trim().to_lowercase();
        !fragment.is_empty() && (title.contains(&fragment) || raw_input.contains(&fragment))
    })
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

/// Ручка живої сесії — `prompt`/`cancel`/`shutdown`. Клонування дешеве
/// (`mpsc::UnboundedSender` + `AbortHandle` всередині); фонова задача сесії
/// завершується graceful-шляхом, коли останній клон дропається, — або
/// негайно через [`SessionHandle::shutdown`].
#[derive(Clone, Debug)]
pub struct SessionHandle {
    commands: mpsc::UnboundedSender<SessionCommand>,
    abort: tokio::task::AbortHandle,
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

    /// Гарантований teardown сесії незалежно від поведінки агента: абортить
    /// фонову задачу, що володіє ACP-з'єднанням, — падіння її future дропає
    /// transport, а `ChildGuard` крейта вбиває дочірній процес агента.
    /// Graceful-шлях (drop останнього клона ручки → вихід командного циклу)
    /// покладається на те, що агент закриє stdio, — Codex ACP після
    /// термінального ходу цього не робить, тож one-shot та інші споживачі
    /// викликають `shutdown` явно після кінця ходу/помилки. Ідемпотентний;
    /// після нього канал подій [`create_session`] закривається, дочитавши
    /// буферизовані події.
    pub fn shutdown(&self) {
        self.abort.abort();
    }
}

/// Спільний send-слот для handshake-результату ([`create_session`]) — під
/// `Mutex`, бо на нього претендують дві незалежні сторони гонки
/// `connect_with` (`future::select` фонової transport-задачі й нашого
/// `connect_with`-замикання, `agent-client-protocol`'s `jsonrpc.rs`): само
/// замикання (звичайний шлях) і зовнішній fallback одразу після `.await`
/// (шлях "фонова transport-задача перемогла гонку й закрила з'єднання
/// раніше, ніж замикання встигло щось надіслати").
type ReadySlot = std::sync::Arc<std::sync::Mutex<Option<oneshot::Sender<Result<(), String>>>>>;

/// Надсилає `outcome` рівно один раз — хто перший забере слот `Some`, той і
/// шле; повторний виклик (з іншої сторони гонки) — тихий no-op. Панікує лише
/// при отруєній `Mutex` (інша сторона впала з паніки під локом), що для
/// цього короткого некритичного розділу вважається неможливим на практиці.
fn send_ready_once(ready_tx: &ReadySlot, outcome: Result<(), String>) {
    if let Some(tx) = ready_tx
        .lock()
        .expect("ready-слот не має бути отруєним")
        .take()
    {
        let _ = tx.send(outcome);
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
    let deny_command_fragments = options.deny_command_fragments;
    let client_capabilities = options.client_capabilities;
    let mcp_servers = options.mcp_servers;
    let post_session_config = options.post_session_config;

    let (command_tx, mut command_rx) = mpsc::unbounded_channel::<SessionCommand>();
    let (event_tx, event_rx) = mpsc::unbounded_channel::<SessionEvent>();
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();

    // `ready_tx` треба ділити між `connect_with`-замиканням (внутрішнє
    // "ready"-замикання, нижче) і кодом одразу після `.await` (зовнішній
    // "fallback"-відправник): `Builder::connect_with` внутрішньо ганяє
    // `future::select(background, foreground)` між фоновою transport-
    // задачею й нашим замиканням — коли дочірній процес вмирає ще до
    // handshake (напр. `cursor-agent` без `agent login`), фонова задача
    // часто перемагає гонку й формує `crate::Error` з реальним stderr
    // ("Process exited with …: Authentication required…", ACP-крейт це
    // вже робить сам), а НАШЕ замикання просто дропається недопрацьованим
    // — тож `ready_tx.take()`/`send` усередині замикання (нижче) ніколи не
    // виконуються, і без зовнішнього fallback-відправника викликач бачив
    // би лише загадкове "до підтвердження handshake" замість справжньої
    // причини. `Arc<Mutex<Option<..>>>` (а не бере `Option` в замикання)
    // саме тому, що обом сторонам гонки потрібен доступ до того самого
    // send-слоту: хто перший дійде — той і шле.
    let ready_tx = std::sync::Arc::new(std::sync::Mutex::new(Some(ready_tx)));
    let ready_tx_fallback = std::sync::Arc::clone(&ready_tx);

    let permission_event_tx = event_tx.clone();
    let session_task = tokio::spawn(async move {
        // Усередині замикання `ready_tx` бере той самий спільний слот:
        // кожен ранній вихід (`?` на init/session-new/config-кроці) сам
        // шле `Err` перед поверненням, успішний шлях шле `Ok(())` перед
        // входом у командний цикл — так само, як і раніше. Різниця лише в
        // тому, що тепер це не єдиний відправник: якщо замикання так і не
        // встигло виконатись (гонка вище), зовнішній fallback після
        // `.await` (нижче) бере той самий слот і шле `result` сам.
        let ready_tx = ready_tx;

        let result = Client
            .builder()
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _cx| match permission_mode
                {
                    PermissionMode::AutoApprove => {
                        let outcome =
                            if denies_tool_call(&request.tool_call, &deny_command_fragments) {
                                RequestPermissionOutcome::Cancelled
                            } else {
                                match transport::pick_auto_permission_option(&request.options) {
                                    Some(option_id) => RequestPermissionOutcome::Selected(
                                        SelectedPermissionOutcome::new(option_id),
                                    ),
                                    None => RequestPermissionOutcome::Cancelled,
                                }
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
                    send_ready_once(&ready_tx, Err(e.to_string()));
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
                        send_ready_once(&ready_tx, Err(e.to_string()));
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
                        send_ready_once(&ready_tx, Err(e.to_string()));
                        return Err(e);
                    }
                }

                let session_id = session.session_id().clone();
                let mut startup_noise = unsolicited_startup_text(session.meta().as_ref());
                send_ready_once(&ready_tx, Ok(()));

                while let Some(command) = command_rx.recv().await {
                    match command {
                        SessionCommand::Prompt { text, reply } => {
                            let outcome = run_prompt_turn(
                                &mut session,
                                idle_timeout,
                                text,
                                &event_tx,
                                &mut startup_noise,
                            )
                            .await;
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

        if let Err(err) = &result {
            transport::log_line(format!(
                "acp: фонова задача сесії завершилась помилкою: {err}"
            ));
        }

        // Fallback-відправник: якщо гонка в `connect_with` (`future::select`
        // фонової transport-задачі й нашого замикання, `jsonrpc.rs`) дозволила
        // фоновій задачі завершитись раніше, ніж замикання встигло дійти до
        // власного `send_ready_once` (ранній `?` на init/session-new/config-
        // кроці або навіть успішний шлях), слот усе ще `Some` — беремо його тут
        // і шлемо РЕАЛЬНИЙ `result` (не вигаданий fallback-текст). Якщо
        // замикання вже забрало слот (звичайний випадок, без гонки), тут
        // нічого не відбувається — `send_ready_once` — no-op на порожньому
        // слоті.
        match result {
            Ok(()) => send_ready_once(&ready_tx_fallback, Ok(())),
            Err(e) => send_ready_once(&ready_tx_fallback, Err(e.to_string())),
        }
    });

    match ready_rx.await {
        Ok(Ok(())) => Ok((
            SessionHandle {
                commands: command_tx,
                abort: session_task.abort_handle(),
            },
            event_rx,
        )),
        Ok(Err(message)) => Err(LlmError::Provider(message)),
        Err(_) => Err(LlmError::Provider(
            "acp: неочікуваний внутрішній стан — фонова задача сесії зникла, не надіславши \
             жодного результату (ні через власне замикання, ні через fallback після \
             connect_with)"
                .to_string(),
        )),
    }
}

/// Один prompt-хід: надсилає `text`, пересилає кожен `SessionUpdate` у
/// канал подій через [`transport::drive_turn`] (idle-timeout + progress-
/// логування, та сама операційна броня, що й у [`super::one_shot_acp`]),
/// повертає фінальний `StopReason`. `startup_noise` — задекларований агентом
/// startup-текст ([`unsolicited_startup_text`]); ідентичний йому чанк не
/// потрапляє в канал подій ([`is_startup_noise`]).
async fn run_prompt_turn<S>(
    session: &mut S,
    idle_timeout: std::time::Duration,
    text: String,
    event_tx: &mpsc::UnboundedSender<SessionEvent>,
    startup_noise: &mut Option<String>,
) -> Result<StopReason, LlmError>
where
    S: AcpSessionUpdates + SendsPrompt,
{
    session
        .send_prompt(text)
        .map_err(|e| LlmError::Provider(e.to_string()))?;

    transport::drive_turn(session, idle_timeout, |update| {
        if is_startup_noise(startup_noise, update) {
            return;
        }
        let _ = event_tx.send(SessionEvent::Update(Box::new(update.clone())));
    })
    .await
    .map_err(|e| LlmError::Provider(e.to_string()))
}

/// Startup-текст, який агент задекларував у `_meta` відповіді `session/new`
/// (нині лише pi: `pi-acp` кладе банер версії + update-нотіс у
/// `_meta.piAcp.startupInfo` **і** дублює той самий текст першим
/// `agent_message_chunk` нової сесії — задумано під Zed, який рендерить його
/// окремим привітанням). Для headless/чат-споживачів крейта це шум, що
/// приклеюється до першої відповіді, тож задекларований текст фільтрується
/// з потоку подій точним збігом — без евристик і незалежно від
/// per-машинних настройок pi (`quietStartup`).
fn unsolicited_startup_text(
    meta: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<String> {
    let text = meta?.get("piAcp")?.get("startupInfo")?.as_str()?;
    (!text.is_empty()).then(|| text.to_string())
}

/// `true`, якщо `update` — той самий startup-чанк, що його агент задекларував
/// у `_meta` ([`unsolicited_startup_text`]): текстовий `AgentMessageChunk`,
/// ідентичний очікуваному. Спрацьовує щонайбільше раз — після збігу
/// `startup_noise` скидається, і подальші (навіть ідентичні) чанки проходять
/// як звичайний контент.
fn is_startup_noise(startup_noise: &mut Option<String>, update: &SessionUpdate) -> bool {
    let Some(expected) = startup_noise.as_deref() else {
        return false;
    };
    let SessionUpdate::AgentMessageChunk(ContentChunk {
        content: ContentBlock::Text(text),
        ..
    }) = update
    else {
        return false;
    };
    if text.text != expected {
        return false;
    }
    *startup_noise = None;
    true
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
                transport::log_line(format!(
                    "acp: auto-approve не зміг відповісти на дозвіл: {err}"
                ));
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

    /// Пише виконуваний shell-скрипт, що імітує неавторизований
    /// `cursor-agent`: одразу друкує `stderr_message` у stderr і виходить з
    /// ненульовим кодом, ще до того, як сказати бодай слово ACP JSON-RPC на
    /// stdout. Це відтворює точно ту саму "дитина вмирає до handshake"-форму,
    /// що й `cursor-agent` без `agent login` — і саме вона запускає гонку в
    /// `connect_with` (`agent-client-protocol`'s `jsonrpc.rs`,
    /// `future::select(background, foreground)`), де фонова transport-задача
    /// може завершитись раніше нашого `connect_with`-замикання.
    fn write_stderr_then_exit_script(stderr_message: &str) -> std::path::PathBuf {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("час не мав би йти назад від епохи")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "llm-lib-acp-session-test-auth-fail-{}-{unique}.sh",
            std::process::id()
        ));
        let script = format!("#!/bin/sh\necho '{stderr_message}' >&2\nexit 1\n");

        let mut file = std::fs::File::create(&path).expect("не вдалось створити тестовий скрипт");
        file.write_all(script.as_bytes())
            .expect("не вдалось записати тестовий скрипт");
        drop(file);

        let mut perms = std::fs::metadata(&path)
            .expect("не вдалось прочитати метадані скрипта")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).expect("не вдалось виставити +x на скрипт");

        path
    }

    /// Регресія на гонку `connect_with` (діагноз, з якого зроблено фікс
    /// `send_ready_once`/[`ReadySlot`]): коли дочірній процес вмирає до
    /// ACP-handshake з повідомленням у stderr (точнісінько як
    /// неавторизований `cursor-agent`), `create_session` має повернути
    /// `Err`, ЧИЄ повідомлення містить РЕАЛЬНИЙ stderr-текст — а не
    /// загальний fallback "…до підтвердження handshake", яким раніше
    /// маскувалась справжня причина щоразу, коли фонова transport-задача
    /// перемагала гонку з нашим `connect_with`-замиканням.
    #[tokio::test]
    async fn create_session_of_auth_failing_child_surfaces_real_stderr_not_generic_fallback() {
        let stderr_message = "Authentication required. Please run 'agent login' first, then call authenticate() with methodId 'cursor_login'.";
        let script_path = write_stderr_then_exit_script(stderr_message);

        let spec = AcpAgent::from_args([script_path.to_str().unwrap()])
            .expect("шлях до тестового скрипта має бути валідною AcpAgent-спекою");

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            create_session(spec, &std::env::temp_dir(), SessionOptions::default()),
        )
        .await;

        let _ = std::fs::remove_file(&script_path);

        let outcome =
            result.expect("процес, що одразу падає, не мав зависнути довше 5с очікування");
        let Err(err) = outcome else {
            panic!(
                "неавторизований дочірній процес мав провалити create_session, а не повернути Ok"
            );
        };

        let message = err.to_string();
        assert!(
            message.contains("Authentication required"),
            "повідомлення має нести реальний stderr, отримали: {message}"
        );
        assert!(
            message.contains("agent login") && message.contains("cursor_login"),
            "повідомлення має нести реальний stderr, отримали: {message}"
        );
        assert!(
            !message.contains("до підтвердження handshake"),
            "не має маскуватись загальним fallback, отримали: {message}"
        );
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
                &mut None,
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
        assert!(options.deny_command_fragments.is_empty());
    }

    #[test]
    fn command_deny_policy_matches_title_and_raw_input_case_insensitively() {
        use agent_client_protocol::schema::v1::{ToolCallUpdate, ToolCallUpdateFields};

        let title = ToolCallUpdate::new(
            "title",
            ToolCallUpdateFields::new().title("BUN RUN TEST".to_string()),
        );
        let raw_input = ToolCallUpdate::new(
            "raw",
            ToolCallUpdateFields::new()
                .raw_input(serde_json::json!({ "command": "npx @7n/rules lint" })),
        );
        let unrelated = ToolCallUpdate::new(
            "other",
            ToolCallUpdateFields::new().title("vitest run tests/router.test.mjs".to_string()),
        );
        let denied = vec!["bun run test".to_string(), "npx @7n/rules lint".to_string()];

        assert!(denies_tool_call(&title, &denied));
        assert!(denies_tool_call(&raw_input, &denied));
        assert!(!denies_tool_call(&unrelated, &denied));
    }

    #[test]
    fn post_session_config_carries_config_id_and_value() {
        let config = PostSessionConfig::new("model", "openai-codex/gpt-5.6-terra");
        assert_eq!(config.config_id, "model");
        assert_eq!(config.value, "openai-codex/gpt-5.6-terra");
    }

    fn text_chunk(text: &str) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
            agent_client_protocol::schema::v1::TextContent::new(text),
        )))
    }

    /// Той самий шлях, що й `session/new` від `pi-acp`: startup-текст лежить
    /// у `_meta.piAcp.startupInfo`.
    #[test]
    fn unsolicited_startup_text_reads_pi_acp_meta() {
        let meta = serde_json::json!({ "piAcp": { "startupInfo": "pi v0.80.10\n---" } });
        let meta = meta.as_object().cloned();
        assert_eq!(
            unsolicited_startup_text(meta.as_ref()),
            Some("pi v0.80.10\n---".to_string())
        );

        assert_eq!(unsolicited_startup_text(None), None);
        let empty = serde_json::json!({ "piAcp": { "startupInfo": "" } });
        assert_eq!(unsolicited_startup_text(empty.as_object()), None);
        let other = serde_json::json!({ "somethingElse": true });
        assert_eq!(unsolicited_startup_text(other.as_object()), None);
    }

    /// Фільтр гасить рівно один ідентичний чанк: інший текст проходить,
    /// а повторний ідентичний після збігу — теж (це вже легітимний контент).
    #[test]
    fn is_startup_noise_drops_exactly_one_matching_chunk() {
        let mut noise = Some("pi v0.80.10".to_string());

        assert!(!is_startup_noise(&mut noise, &text_chunk("відповідь")));
        assert!(noise.is_some(), "чанк без збігу не скидає фільтр");

        assert!(is_startup_noise(&mut noise, &text_chunk("pi v0.80.10")));
        assert!(noise.is_none(), "після збігу фільтр вимикається");

        assert!(
            !is_startup_noise(&mut noise, &text_chunk("pi v0.80.10")),
            "повторний ідентичний текст — легітимний контент"
        );
        assert!(!is_startup_noise(&mut None, &text_chunk("будь-що")));
    }
}
