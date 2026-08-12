//! Складання агента циклу `fix` на `rig-agent` (спека
//! `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7 клас 3, §3.8 — спайк
//! підтвердив кодом усі шість вимог класу).
//!
//! Один публічний вхід — [`run_attempt`]: виконує рівно один attempt циклу
//! (один рунг зовнішньої драбини) і повертає [`super::FixOutcome`]. Toolset
//! складає [`super::tools::build_toolset`] — цей модуль його НЕ знає, лише
//! приймає готовий [`ToolServerHandle`] (типове підключення в один рядок:
//! `let handle = ToolServer::new().run(); handle.append_toolset(
//! tools::build_toolset(cwd, &deps, anchored_edits)).await;`, див. тести нижче).
//!
//! # Складові
//!
//! - **Провайдер** — [`resolve_provider_target`]: `crate::tiers::resolve_model`
//!   резолвить `"provider/model-id"` для тіру; локальні моделі йдуть на
//!   `crate::local_cloud::default_local_openai_provider()` (та сама генерик
//!   `local-openai`-точка, що й у `acp::presets`), хмарні — наразі лише
//!   реальний OpenAI-провайдер через `OPENAI_API_KEY` з env (rig's
//!   `openai`-клієнт говорить рівно одним wire-протоколом; довільний
//!   мапінг чужого хмарного provider-префікса на власний
//!   base_url/автентифікацію — майбутнє розширення, не цей зріз).
//! - **Write-guard veto** — [`FixHook::on_tool_call`]: для `edit`/`write`/
//!   `edit_anchored` викликає [`WriteGuard::check_write`] ПЕРЕД тілом tool-а;
//!   `Decision::Block` → `ToolCallAction::skip(reason)` — тіло tool-а не
//!   виконується. [`FixHook::on_tool_result`] записує editLog (повний
//!   old→new, не лічильник) лише для застосованих (не vetoed) записів.
//! - **Verify-петля** — [`FixHook::on_model_turn_finished`] на tool-вільному
//!   ході прогонить `FixDeps::verify`; облік бюджету — чиста функція
//!   [`VerifyBudget::record`] (юніт-тестована окремо від rig, без мережі):
//!   `infra_error` НЕ палить `verify_max` (rig усе одно списує хід із
//!   `turn_ceiling`, §3.8), а до дедлайну attempt-у менше ~5с — чесна
//!   зупинка замість ще однієї приреченої ітерації.
//! - **Chain-заголовки + per-turn maxTokens** — [`ChainHeaderClient`]
//!   (власний `HttpClientExt`, штампує `x-fix-chain-id`/`x-fix-step` на
//!   кожному запиті, патерн `proof2.rs` спайку) і
//!   [`FixHook::on_completion_call`] → `RequestPatch::max_tokens`.
//! - **Бюджети/`StopReason`** — `PromptRequest::max_turns(turn_ceiling)` як
//!   backstop проти зациклення; зовнішній `tokio::time::timeout(req.timeout,
//!   …)` — жорсткий abort (rig сам не повідомляє причину скасованого
//!   future, §3.8 — тому `StopReason::Timeout` тут синтезує ЦЕЙ код, не
//!   rig). `StopReason::VerifyExhausted`/`Timeout`-через-дедлайн із хука
//!   передаються назовні через `stop_signal` (без текстового парсингу
//!   `PromptError`-тексту).
//! - **`empty_completion`** — хід без жодного tool-виклику і без editLog-
//!   записів наприкінці attempt-у (не всі провайдери віддають usage).

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use rig_agent::agent::hook::{
    self, AgentHook, CompletionCallAction, HookContext, ModelTurnAction, ModelTurnFinished,
    ObservationAction, RequestPatch, ToolCall as ToolCallEvent, ToolCallAction, ToolResultAction,
    ToolResultEvent,
};
use rig_agent::agent::AgentBuilder;
use rig_agent::completion::{Prompt, PromptError};
use rig_agent::tool::server::ToolServerHandle;
use rig_core::client::completion::CompletionClient;
use rig_core::http_client::{self, HttpClientExt, LazyBody, MultipartForm};
use rig_core::message::AssistantContent;
use rig_core::providers::openai;
use rig_core::wasm_compat::{WasmCompatSend, WasmCompatSendStream};

use crate::tiers::{is_local_model, parse_model_spec, resolve_model, Tier};
use crate::write_guard::{Decision, WriteGuard};
use crate::LlmError;

use super::{EditMode, FixDeps, FixOutcome, FixRequest, StopReason};

/// Назви write-інтент tool-ів (§3.7): рівно ці три перехоплює write-guard
/// veto ПЕРЕД виконанням тіла. Решта набору ([`super::tools::build_toolset`])
/// — read-only або advisory, guard їх не чіпає.
const WRITE_TOOLS: &[&str] = &["edit", "write", "edit_anchored"];

/// Скільки часу лишити «про запас» перед дедлайном attempt-у: якщо до
/// дедлайну лишилось менше — verify-петля чесно зупиняється замість ще
/// однієї ітерації, що заздалегідь приречена (§3.7).
const NEAR_DEADLINE: Duration = Duration::from_secs(5);

/// Скільки викликів інструментів поспіль дозволено БЕЗ жодного запису,
/// перш ніж визнати спробу безрезультатною.
///
/// Живий прогін показав, навіщо це: concern, чиє порушення усувається
/// ВИДАЛЕННЯМ файлу, наш набір інструментів закрити не може взагалі (delete
/// у ньому немає — свідомо). Модель на такій задачі зробила 120 викликів
/// інструментів і жодної правки, вигорівши всю стелю ходів. Поріг зупиняє
/// саме цей клас: не «модель думає повільно», а «прогресу немає в принципі».
const NO_PROGRESS_TOOL_CALLS: usize = 25;

/// Дефолтний cap на output-токени одного ходу моделі (per-turn `max_tokens`
/// через [`FixHook::on_completion_call`]) — консервативне значення проти
/// розгону слабких локальних моделей у надто довгу відповідь. Перекривається
/// через [`FixRequest::max_tokens`], коли модель рунга витримує більше.
const DEFAULT_MAX_TOKENS: u64 = 4096;

// ---------------------------------------------------------------------------
// Verify-петля: чиста логіка обліку бюджету, незалежна від rig — юніт-
// тестована окремо (без мережі, без агента).
// ---------------------------------------------------------------------------

/// Один крок рішення verify-петлі — результат [`VerifyBudget::record`].
/// `StopReason` не є `Copy` (fix.rs, спільний контракт), тож і цей тип — лише `Clone`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum VerifyStep {
    /// Перевірка зелена — приймаємо хід, цикл завершується успіхом.
    Accept,
    /// Перевірка червона (або інфра-помилка), час і бюджет ще є — фідбек
    /// назад у ту саму сесію.
    Retry,
    /// Час чи бюджет вичерпано — зупиняємось із конкретною причиною.
    Stop(StopReason),
}

/// Облік НЕ-інфра спроб verify-петлі проти `verify_max`. rig списує хід із
/// `turn_ceiling` за кожен ретрай незалежно від причини (§3.8) — тому
/// backstop проти нескінченних інфра-ретраїв лишається на `turn_ceiling`,
/// а не тут: цей лічильник свідомо НЕ росте на `infra_error`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct VerifyBudget {
    verify_max: usize,
    consumed: usize,
}

impl VerifyBudget {
    pub(crate) fn new(verify_max: usize) -> Self {
        Self {
            verify_max,
            consumed: 0,
        }
    }

    /// Скільки НЕ-інфра спроб вже спожито — видиме лише тестам.
    #[cfg(test)]
    pub(crate) fn consumed(&self) -> usize {
        self.consumed
    }

    /// Один крок: `remaining` — час до дедлайну attempt-у станом на момент
    /// рішення (рахувати після `verify`-виклику, не до нього — точніша
    /// оцінка бюджету на ЩЕ ОДНУ ітерацію).
    pub(crate) fn record(
        &mut self,
        ok: bool,
        infra_error: bool,
        remaining: Duration,
    ) -> VerifyStep {
        if ok {
            return VerifyStep::Accept;
        }
        if remaining < NEAR_DEADLINE {
            return VerifyStep::Stop(StopReason::Timeout);
        }
        if infra_error {
            // Інфра-помилка САМОЇ перевірки — не палить verify_max (§3.7).
            return VerifyStep::Retry;
        }
        self.consumed += 1;
        if self.consumed > self.verify_max {
            return VerifyStep::Stop(StopReason::VerifyExhausted);
        }
        VerifyStep::Retry
    }
}

#[cfg(test)]
mod verify_budget_tests {
    use super::*;

    const PLENTY: Duration = Duration::from_secs(60);

    #[test]
    fn accepts_immediately_on_ok() {
        let mut budget = VerifyBudget::new(3);
        assert_eq!(budget.record(true, false, PLENTY), VerifyStep::Accept);
        assert_eq!(budget.consumed(), 0);
    }

    #[test]
    fn infra_error_retries_without_consuming_budget() {
        let mut budget = VerifyBudget::new(1);
        for _ in 0..5 {
            assert_eq!(budget.record(false, true, PLENTY), VerifyStep::Retry);
        }
        assert_eq!(
            budget.consumed(),
            0,
            "інфра-помилка не має палити verify_max ітерацію"
        );
    }

    #[test]
    fn exhausts_after_verify_max_non_infra_retries() {
        let mut budget = VerifyBudget::new(2);
        assert_eq!(budget.record(false, false, PLENTY), VerifyStep::Retry);
        assert_eq!(budget.record(false, false, PLENTY), VerifyStep::Retry);
        assert_eq!(
            budget.record(false, false, PLENTY),
            VerifyStep::Stop(StopReason::VerifyExhausted)
        );
        assert_eq!(budget.consumed(), 3);
    }

    #[test]
    fn zero_verify_max_exhausts_on_first_real_failure() {
        let mut budget = VerifyBudget::new(0);
        assert_eq!(
            budget.record(false, false, PLENTY),
            VerifyStep::Stop(StopReason::VerifyExhausted)
        );
    }

    #[test]
    fn near_deadline_stops_honestly_instead_of_burning_iteration() {
        let mut budget = VerifyBudget::new(10);
        let almost_out = Duration::from_secs(1);
        assert_eq!(
            budget.record(false, false, almost_out),
            VerifyStep::Stop(StopReason::Timeout)
        );
        assert_eq!(
            budget.consumed(),
            0,
            "чесна зупинка не має рахуватись як спожита verify-ітерація"
        );
    }

    #[test]
    fn near_deadline_check_wins_even_over_infra_error() {
        let mut budget = VerifyBudget::new(10);
        assert_eq!(
            budget.record(false, true, Duration::from_millis(100)),
            VerifyStep::Stop(StopReason::Timeout),
            "бюджет часу — тверда межа незалежно від причини червоного вердикту"
        );
    }
}

// ---------------------------------------------------------------------------
// Провайдер: OpenAI-сумісний клієнт із резолвінгу тіру.
// ---------------------------------------------------------------------------

/// Резолвлений endpoint для побудови rig-клієнта одного attempt-у.
struct ProviderTarget {
    base_url: String,
    api_key: String,
    model: String,
}

/// `crate::tiers::resolve_model(tier)` + `crate::local_cloud::default_local_openai_provider()`
/// для локального endpoint-а — той самий каскад, що й `acp::presets::goose_env`
/// (рішення З специфікації), лише транспорт інший (прямий rig `openai`-клієнт
/// замість env для зовнішнього ACP-процесу).
///
/// # Errors
/// [`LlmError::NoModelConfigured`] — жодної `N_*_MODEL`-сходинки для тіру;
/// [`LlmError::InvalidModelSpec`] — резолвлений spec не парситься;
/// [`LlmError::Provider`] — хмарний тір без `OPENAI_API_KEY` в env.
fn resolve_provider_target(tier: Tier, model: Option<&str>) -> Result<ProviderTarget, LlmError> {
    // Явна модель рунга виграє в каскаду: драбина вже вирішила, ЯКА модель
    // належить цій сходинці, а `resolve_model` завжди починає з local і для
    // хмарного рунга дав би не ту модель.
    let spec = match model {
        Some(explicit) => explicit.to_string(),
        None => resolve_model(tier).ok_or(LlmError::NoModelConfigured(tier))?,
    };
    let (_provider, model) = parse_model_spec(&spec).map_err(LlmError::InvalidModelSpec)?;

    if is_local_model(&spec) {
        let local = crate::local_cloud::default_local_openai_provider();
        Ok(ProviderTarget {
            base_url: local.base_url,
            api_key: local.api_key.unwrap_or_else(|| "local".to_string()),
            model: model.to_string(),
        })
    } else {
        // Хмарний шлях наразі підтримує лише реальний OpenAI-провайдер —
        // rig's `openai`-клієнт говорить рівно одним wire-протоколом;
        // мапінг довільного provider-префікса (anthropic, litellm тощо) на
        // власний base_url/автентифікацію лишається майбутнім розширенням
        // (див. звіт задачі, не покрито цим зрізом).
        let api_key = std::env::var("OPENAI_API_KEY").map_err(|_| {
            LlmError::Provider("OPENAI_API_KEY не задано для хмарного тіру".to_string())
        })?;
        Ok(ProviderTarget {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key,
            model: model.to_string(),
        })
    }
}

// ---------------------------------------------------------------------------
// Chain-заголовки: власний HttpClientExt, штампує x-fix-chain-id/x-fix-step
// на кожному запиті до моделі (патерн `proof2.rs`, §3.8).
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct ChainHeaderClient {
    inner: reqwest::Client,
    chain_id: String,
    step: Arc<AtomicU64>,
}

impl std::fmt::Debug for ChainHeaderClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChainHeaderClient")
            .field("chain_id", &self.chain_id)
            .finish()
    }
}

impl ChainHeaderClient {
    fn new(chain_id: impl Into<String>) -> Self {
        Self {
            inner: reqwest::Client::default(),
            chain_id: chain_id.into(),
            step: Arc::new(AtomicU64::new(0)),
        }
    }

    fn stamped_headers(&self, mut headers: http::HeaderMap) -> http::HeaderMap {
        let step = self.step.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(value) = http::HeaderValue::from_str(&self.chain_id) {
            headers.insert(http::HeaderName::from_static("x-fix-chain-id"), value);
        }
        headers.insert(
            http::HeaderName::from_static("x-fix-step"),
            http::HeaderValue::from(step),
        );
        headers
    }
}

async fn into_lazy_response<U>(
    response: reqwest::Response,
) -> http_client::Result<http_client::Response<LazyBody<U>>>
where
    U: From<Bytes> + WasmCompatSend + 'static,
{
    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|e| format!("не вдалося прочитати тіло помилки: {e}"));
        return Err(http_client::Error::InvalidStatusCodeWithMessage(
            status, body,
        ));
    }
    let mut builder = http_client::Response::builder().status(response.status());
    if let Some(headers) = builder.headers_mut() {
        *headers = response.headers().clone();
    }
    let body: LazyBody<U> = Box::pin(async move {
        let bytes = response
            .bytes()
            .await
            .map_err(|e| http_client::Error::Instance(Box::new(e)))?;
        Ok(U::from(bytes))
    });
    builder.body(body).map_err(http_client::Error::Protocol)
}

impl HttpClientExt for ChainHeaderClient {
    fn send<T, U>(
        &self,
        req: http_client::Request<T>,
    ) -> impl std::future::Future<Output = http_client::Result<http_client::Response<LazyBody<U>>>>
           + WasmCompatSend
           + 'static
    where
        T: Into<Bytes>,
        T: WasmCompatSend,
        U: From<Bytes>,
        U: WasmCompatSend + 'static,
    {
        let (mut parts, body) = req.into_parts();
        parts.headers = self.stamped_headers(parts.headers);
        let client = self.inner.clone();
        let built = client
            .request(parts.method, parts.uri.to_string())
            .headers(parts.headers)
            .body(body.into());
        async move {
            let response = built
                .send()
                .await
                .map_err(|e| http_client::Error::Instance(Box::new(e)))?;
            into_lazy_response(response).await
        }
    }

    /// Не підтримується навмисно: fix-цикл використовує лише
    /// `chat/completions` (JSON) — multipart (аудіо/зображення upload) сюди
    /// ніколи не приходить. `rig_core::http_client::MultipartForm` конвертує
    /// в `reqwest::multipart::Form` лише ЧЕРЕЗ reqwest-версію самого
    /// `rig-core` (0.13.x) — інша мажорна лінія, ніж прямий `reqwest`-
    /// dependency цього крейта (0.12.x, потрібен для `remote_batch.rs`), тож
    /// два різні типи `reqwest::multipart::Form` не конвертуються один в
    /// одного напряму. Дублювати другу мажорну лінію `reqwest` заради шляху,
    /// яким цей клієнт ніколи не піде, — не виправдано.
    // `async fn` тут не годиться: сигнатура трейта вимагає `+ 'static` для
    // повернутого `Future` (незалежного від часу життя `&self`), а `async
    // fn` розгортається у Future, позичений із `&self` — звідси
    // `#[allow(manual_async_fn)]`: тіло свідомо не `async fn`, а ручний
    // `impl Future`, хоч і тривіальний.
    #[allow(clippy::manual_async_fn)]
    fn send_multipart<U>(
        &self,
        _req: http_client::Request<MultipartForm>,
    ) -> impl std::future::Future<Output = http_client::Result<http_client::Response<LazyBody<U>>>>
           + WasmCompatSend
           + 'static
    where
        U: From<Bytes>,
        U: WasmCompatSend + 'static,
    {
        async {
            Err(http_client::Error::Instance(Box::new(std::io::Error::other(
                "ChainHeaderClient: multipart-запити не підтримуються — fix-цикл ходить лише в chat/completions",
            ))))
        }
    }

    fn send_streaming<T>(
        &self,
        req: http_client::Request<T>,
    ) -> impl std::future::Future<Output = http_client::Result<http_client::StreamingResponse>>
           + WasmCompatSend
    where
        T: Into<Bytes> + WasmCompatSend,
    {
        let (mut parts, body) = req.into_parts();
        parts.headers = self.stamped_headers(parts.headers);
        let client = self.inner.clone();
        async move {
            let built = client
                .request(parts.method, parts.uri.to_string())
                .headers(parts.headers)
                .body(body.into())
                .build()
                .map_err(|e| http_client::Error::Instance(Box::new(e)))?;
            let response = client
                .execute(built)
                .await
                .map_err(|e| http_client::Error::Instance(Box::new(e)))?;
            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return Err(http_client::Error::InvalidStatusCodeWithMessage(
                    status, text,
                ));
            }
            let mut builder = http_client::Response::builder()
                .status(response.status())
                .version(response.version());
            if let Some(headers) = builder.headers_mut() {
                *headers = response.headers().clone();
            }
            let mapped: std::pin::Pin<
                Box<dyn WasmCompatSendStream<InnerItem = http_client::Result<Bytes>>>,
            > = Box::pin(futures::StreamExt::map(response.bytes_stream(), |chunk| {
                chunk.map_err(|e| http_client::Error::Instance(Box::new(e)))
            }));
            builder.body(mapped).map_err(http_client::Error::Protocol)
        }
    }
}

// ---------------------------------------------------------------------------
// Хуки: write-guard veto + editLog, verify-петля, per-turn maxTokens, лічильники.
// ---------------------------------------------------------------------------

// `WriteGuard` потоково-безпечний за побудовою: його поля-замикання
// оголошені як `Box<dyn Fn(..) + Send + Sync>` / `Box<dyn FnMut(..) + Send +
// Sync>` (`write_guard.rs`), тож `Mutex<WriteGuard>` — `Sync`, і хуки rig
// (яким потрібні `WasmCompatSend + WasmCompatSync`) працюють без жодного
// `unsafe`. Раніше тут стояла обгортка з `unsafe impl Send/Sync`,
// обґрунтована тим, що цей runner не інжектує власних замикань — але це
// твердження про поточний код, а не про тип: інжекція не-`Send` замикання
// через `with_check_ignore` зробила б його хибним мовчки. Межі винесені в
// самі bounds — компілятор перевіряє їх замість коментаря.

/// Один хук на весь attempt — усі чотири концерни класу 3 (§3.7) розділені
/// по методах [`AgentHook`], але живуть в одній інстанції, бо всі
/// потребують той самий run-scoped стан (guard, бюджет, дедлайн, лічильники).
struct FixHook {
    guard: Arc<Mutex<WriteGuard>>,
    deps: FixDeps,
    verify_budget: Mutex<VerifyBudget>,
    deadline: Instant,
    max_tokens: u64,
    tool_call_count: Arc<AtomicUsize>,
    turn_count: Arc<AtomicUsize>,
    /// Скільки примусових перевірок поспіль повернули «червоно».
    red_probes: AtomicUsize,
    /// `Some(reason)` — ЦЕЙ хук ініціював `ModelTurnAction::stop(..)`; runner
    /// читає це замість парсингу тексту з `PromptError::PromptCancelled`.
    stop_signal: Arc<Mutex<Option<StopReason>>>,
}

fn lock_poisoned_safe<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl AgentHook for FixHook {
    async fn on_completion_call(
        &self,
        _ctx: &HookContext,
        _event: hook::CompletionCall<'_>,
    ) -> CompletionCallAction {
        CompletionCallAction::patch(RequestPatch::new().max_tokens(self.max_tokens))
    }

    async fn on_completion_response(
        &self,
        _ctx: &HookContext,
        _event: hook::CompletionResponse<'_>,
    ) -> ObservationAction {
        self.turn_count.fetch_add(1, Ordering::SeqCst);
        ObservationAction::continue_run()
    }

    async fn on_tool_call(&self, _ctx: &HookContext, event: ToolCallEvent<'_>) -> ToolCallAction {
        let calls = self.tool_call_count.fetch_add(1, Ordering::SeqCst) + 1;

        // Backstop «немає прогресу» — через КАНОНІЧНУ ПЕРЕВІРКУ, а не через
        // лічильник записів.
        //
        // Дві попередні версії (спершу «жодного запису взагалі», потім
        // «давно не було запису») живий прогін спростував: модель, яка не
        // може закрити порушення наявними інструментами, входить у цикл
        // перезапису й пише на КОЖНОМУ виклику — лічильники записів росли
        // щоразу, тож обидві умови не наставали ніколи.
        //
        // Причина глибша: `verify` прив'язаний до завершення ходу
        // ([`Self::on_model_turn_finished`]), а модель, що безперервно
        // викликає інструменти, хід не завершує — канонічна перевірка не
        // відпрацьовує жодного разу, і єдиним обмежувачем лишається стеля
        // ходів. Тому запускаємо перевірку примусово що `NO_PROGRESS_TOOL_CALLS`
        // викликів: два червоні поспіль означають, що робота йде, а
        // порушення не рухається.
        if calls.is_multiple_of(NO_PROGRESS_TOOL_CALLS) {
            let report = (self.deps.verify)().await;
            if report.ok {
                self.red_probes.store(0, Ordering::SeqCst);
            } else if !report.infra_error {
                let reds = self.red_probes.fetch_add(1, Ordering::SeqCst) + 1;
                if reds >= 2 {
                    *lock_poisoned_safe(&self.stop_signal) = Some(StopReason::NoProgress);
                    return ToolCallAction::stop(format!(
                        "перевірка червона після {calls} викликів інструментів — прогресу немає, зупиняємось"
                    ));
                }
            }
        }
        if !WRITE_TOOLS.contains(&event.tool_name) {
            return ToolCallAction::run();
        }
        let path = extract_str_field(event.args, "path");
        let decision = lock_poisoned_safe(&self.guard).check_write(&path);
        match decision {
            Decision::Allow => ToolCallAction::run(),
            Decision::Block { reason } => ToolCallAction::skip(reason),
        }
    }

    async fn on_tool_result(
        &self,
        _ctx: &HookContext,
        event: ToolResultEvent<'_>,
    ) -> ToolResultAction {
        if WRITE_TOOLS.contains(&event.tool_name) && event.raw_result.is_success() {
            let path = extract_str_field(event.args, "path");
            if !path.is_empty() {
                let (edits, content) = extract_edit_fields(event.args);
                lock_poisoned_safe(&self.guard).record_edit(
                    PathBuf::from(path),
                    event.tool_name,
                    edits,
                    content,
                );
            }
        }
        ToolResultAction::keep()
    }

    async fn on_model_turn_finished(
        &self,
        _ctx: &HookContext,
        event: ModelTurnFinished<'_>,
    ) -> ModelTurnAction {
        let has_tool_call = event
            .content
            .iter()
            .any(|c| matches!(c, AssistantContent::ToolCall(_)));
        if has_tool_call {
            // Verify-петля живе лише на tool-вільних (кандидат-фінальних)
            // ходах — rig і так відхиляє ретрай ходу з tool-викликом (§3.8).
            return ModelTurnAction::continue_run();
        }

        let report = (self.deps.verify)().await;
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        let step = lock_poisoned_safe(&self.verify_budget).record(
            report.ok,
            report.infra_error,
            remaining,
        );
        match step {
            VerifyStep::Accept => ModelTurnAction::continue_run(),
            VerifyStep::Retry => ModelTurnAction::retry_with_feedback(report.output),
            VerifyStep::Stop(reason) => {
                let text = match &reason {
                    StopReason::VerifyExhausted => {
                        "verify-петля вичерпана: перевірка й далі червона".to_string()
                    }
                    StopReason::Timeout => {
                        "до дедлайну attempt-у лишилось замало часу для ще однієї verify-ітерації"
                            .to_string()
                    }
                    _ => "verify-петля зупинена".to_string(),
                };
                *lock_poisoned_safe(&self.stop_signal) = Some(reason);
                ModelTurnAction::stop(text)
            }
        }
    }
}

/// Дістає рядкове поле `field` з JSON-аргументів tool-виклику (`event.args`).
/// Порожній рядок — і для невалідного JSON, і для відсутнього поля: guard
/// сам відповідає на порожній шлях `Decision::Allow` без перевірок (та сама
/// семантика, що й [`WriteGuard::check_write`] на порожній `raw_path`), а не
/// цей хелпер вирішує, що з ним робити.
fn extract_str_field(args: &str, field: &str) -> String {
    serde_json::from_str::<serde_json::Value>(args)
        .ok()
        .and_then(|value| {
            value
                .get(field)
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

/// Дістає `edits`/`content` з JSON-аргументів write-інтент tool-виклику для
/// editLog — контракт форм `edit`/`edit_anchored` (`edits: [...]`) і `write`
/// (`content: "..."`) фіксує [`super::tools`] (`EditArgs`/`WriteArgs`/
/// `EditAnchoredArgs`); тут — лише чесне зчитування, без переінтерпретації.
fn extract_edit_fields(args: &str) -> (Option<serde_json::Value>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(args) else {
        return (None, None);
    };
    let edits = value.get("edits").cloned();
    let content = value
        .get("content")
        .and_then(|c| c.as_str())
        .map(str::to_string);
    (edits, content)
}

// ---------------------------------------------------------------------------
// Промпт: preamble/prompt із FixRequest.
// ---------------------------------------------------------------------------

fn build_preamble(req: &FixRequest) -> String {
    let mode = match req.edit_mode {
        EditMode::Generic => "редагувати можна лише перелічені дозволені файли",
        EditMode::TestGeneration => {
            "джерельні файли read-only; редагувати можна лише *.test.* файли"
        }
    };
    let files: Vec<String> = req
        .target_files
        .iter()
        .map(|p| p.display().to_string())
        .collect();
    format!(
        "Ти — автоматичний фікс-агент правила `{rule}`. Робоча директорія: {cwd}. \
         {mode}. Дозволені файли: {files}. Використовуй лише надані інструменти — \
         жодного bash/shell-доступу немає.",
        rule = req.rule_id,
        cwd = req.cwd.display(),
        mode = mode,
        files = if files.is_empty() {
            "(усі під робочою директорією)".to_string()
        } else {
            files.join(", ")
        },
    )
}

// ---------------------------------------------------------------------------
// Публічний вхід.
// ---------------------------------------------------------------------------

fn provider_error_outcome(message: String) -> FixOutcome {
    FixOutcome {
        ok: false,
        touched_files: Vec::new(),
        edit_log: Vec::new(),
        turns: 0,
        tool_calls: 0,
        empty_completion: true,
        stop_reason: StopReason::ProviderError,
        error: Some(message),
    }
}

/// Виконує один attempt циклу `fix`. `tools` — вже зібраний і запущений
/// toolset (типове підключення в один рядок:
/// `let handle = ToolServer::new().run(); handle.append_toolset(
/// fix::tools::build_toolset(&req.cwd, &deps, req.anchored_edits)).await;`
/// — `deps` для toolset-у і для цього виклику
/// той самий `FixDeps::clone()`, бо `ast_facts`/`verify` tool-и і verify-
/// петля хука ділять одні й ті самі інʼєкції).
pub async fn run_attempt(req: &FixRequest, deps: FixDeps, tools: ToolServerHandle) -> FixOutcome {
    let target = match resolve_provider_target(req.tier, req.model.as_deref()) {
        Ok(target) => target,
        Err(err) => return provider_error_outcome(err.to_string()),
    };

    let client = openai::Client::builder()
        .api_key(target.api_key)
        .base_url(target.base_url)
        .http_client(ChainHeaderClient::new(req.rule_id.clone()))
        .build();
    let client = match client {
        Ok(client) => client,
        Err(err) => return provider_error_outcome(err.to_string()),
    };
    let model = client.completions_api().completion_model(target.model);

    // Хук першого дотику підключаємо ДО першого запису — саме він робить
    // ladder-рівневий snapshot видющим для файлів поза цільовим набором
    // (без нього cross-file collateral-veto сліпий).
    let mut write_guard = WriteGuard::new(req.cwd.clone());
    if let Some(on_capture) = deps.on_capture.clone() {
        write_guard = write_guard.with_on_capture(move |abs| on_capture(abs.to_path_buf()));
    }
    let guard = Arc::new(Mutex::new(write_guard));
    let deadline = Instant::now() + req.timeout;
    let stop_signal: Arc<Mutex<Option<StopReason>>> = Arc::new(Mutex::new(None));
    let tool_call_count = Arc::new(AtomicUsize::new(0));
    let turn_count = Arc::new(AtomicUsize::new(0));

    let hook = FixHook {
        guard: guard.clone(),
        deps,
        verify_budget: Mutex::new(VerifyBudget::new(req.verify_max)),
        deadline,
        max_tokens: req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        tool_call_count: tool_call_count.clone(),
        turn_count: turn_count.clone(),
        red_probes: AtomicUsize::new(0),
        stop_signal: stop_signal.clone(),
    };

    let preamble = build_preamble(req);
    let agent = AgentBuilder::new(model)
        .tool_server_handle(tools)
        .preamble(&preamble)
        .add_hook(hook)
        .build();

    let run = agent
        .prompt(req.violation_text.clone())
        .max_turns(req.turn_ceiling);

    let (stop_reason, error) = match tokio::time::timeout(req.timeout, run).await {
        // Зовнішній abort через drop future не повідомляє причини (§3.8) —
        // саме тому `StopReason::Timeout` тут синтезує ЦЕЙ код, не rig.
        Err(_elapsed) => (
            StopReason::Timeout,
            Some("вичерпано бюджет часу attempt-у".to_string()),
        ),
        Ok(Ok(_text)) => (StopReason::Completed, None),
        Ok(Err(err)) => {
            let mapped = match &err {
                PromptError::MaxTurnsError { .. } => StopReason::TurnCeiling,
                PromptError::PromptCancelled { .. } => lock_poisoned_safe(&stop_signal)
                    .take()
                    .unwrap_or(StopReason::ProviderError),
                _ => StopReason::ProviderError,
            };
            (mapped, Some(err.to_string()))
        }
    };

    let guard = lock_poisoned_safe(&guard);
    let edit_log = guard.edit_log().to_vec();
    let touched_files = guard.touched_files();
    drop(guard);

    let tool_calls = tool_call_count.load(Ordering::SeqCst);
    let turns = turn_count.load(Ordering::SeqCst);
    let empty_completion = tool_calls == 0 && edit_log.is_empty();

    FixOutcome {
        ok: stop_reason == StopReason::Completed,
        touched_files,
        edit_log,
        turns,
        tool_calls,
        empty_completion,
        stop_reason,
        error,
    }
}

// ---------------------------------------------------------------------------
// Інтеграційні smoke-тести проти mock OpenAI-сумісного сервера (localhost-
// лише, без справжньої мережі) — той самий mock-патерн, що й spike
// (`rig-spike/mock_server.mjs`), убудований рядком у бінарник тесту.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::tiers::test_env;
    use std::process::Stdio;
    use std::sync::atomic::AtomicU16;
    use std::time::Duration as StdDuration;

    const MOCK_SERVER_JS: &str = r#"
const port = Number(process.argv[2] || 8399);

function textMessage(text) {
  return { role: "assistant", content: text, tool_calls: [] };
}
function toolCallMessage(id, name, args) {
  return {
    role: "assistant",
    content: "",
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}
function chatCompletion(message, finishReason) {
  return {
    id: "resp-" + Math.random().toString(36).slice(2),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}
function toolMessages(messages) {
  return messages.filter((m) => m.role === "tool");
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method !== "POST" || !path.endsWith("/chat/completions")) {
      return new Response("not found: " + path, { status: 404 });
    }
    const body = await req.json();
    const messages = body.messages || [];
    const scenario = path.split("/")[1];

    switch (scenario) {
      case "veto": {
        if (toolMessages(messages).length > 0) {
          return Response.json(chatCompletion(textMessage("done"), "stop"));
        }
        return Response.json(
          chatCompletion(
            toolCallMessage("call_1", "write", { path: globalThis.__OUTSIDE_PATH__, content: "pwned" }),
            "tool_calls",
          ),
        );
      }
      case "always_tool": {
        return Response.json(
          chatCompletion(
            toolCallMessage("call_" + messages.length, "self_check", {}),
            "tool_calls",
          ),
        );
      }
      case "slow": {
        await new Promise((r) => setTimeout(r, 2000));
        return Response.json(
          chatCompletion(
            toolCallMessage("call_" + messages.length, "self_check", {}),
            "tool_calls",
          ),
        );
      }
      case "text_only": {
        return Response.json(chatCompletion(textMessage("attempted a fix"), "stop"));
      }
      default:
        return new Response("unknown scenario: " + scenario, { status: 404 });
    }
  },
});
console.log("[mock] listening on :" + port);
"#;

    fn unique_port() -> u16 {
        static COUNTER: AtomicU16 = AtomicU16::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let base = 19000u16.wrapping_add((std::process::id() as u16) % 5000);
        base.wrapping_add(n.wrapping_mul(7))
    }

    /// Піднімає mock-сервер (`bun`, скрипт із [`MOCK_SERVER_JS`]) на `port`,
    /// підставивши `outside_path` замість `globalThis.__OUTSIDE_PATH__`
    /// (для veto-сценарію — шлях поза git-root тестового репо). Команда сама
    /// завершується наприкінці тесту через `kill_on_drop`/явний `kill`.
    async fn spawn_mock(port: u16, outside_path: &str) -> tokio::process::Child {
        let script = format!(
            "globalThis.__OUTSIDE_PATH__ = {outside_path_json};\n{body}",
            outside_path_json = serde_json::Value::String(outside_path.to_string()),
            body = MOCK_SERVER_JS,
        );
        let script_path = std::env::temp_dir().join(format!(
            "llm-lib-fix-runner-mock-{}-{port}.mjs",
            std::process::id()
        ));
        std::fs::write(&script_path, &script).expect("записати mock-скрипт");

        let child = tokio::process::Command::new("bun")
            .arg(&script_path)
            .arg(port.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("запустити bun mock-сервер (потрібен bun у PATH)");

        wait_for_port(port, StdDuration::from_secs(5)).await;
        let _ = std::fs::remove_file(&script_path);
        child
    }

    async fn wait_for_port(port: u16, timeout: StdDuration) {
        let deadline = Instant::now() + timeout;
        loop {
            if tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_ok()
            {
                return;
            }
            if Instant::now() >= deadline {
                panic!("mock-сервер не піднявся на порту {port} за {timeout:?}");
            }
            tokio::time::sleep(StdDuration::from_millis(20)).await;
        }
    }

    fn init_git_repo(dir: &std::path::Path) {
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            std::process::Command::new("git")
                .args(&args)
                .current_dir(dir)
                .status()
                .expect("git має бути доступний у середовищі тестів");
        }
    }

    fn trivial_ok_deps() -> FixDeps {
        FixDeps {
            verify: Arc::new(|| {
                Box::pin(async {
                    super::super::VerifyReport {
                        ok: true,
                        output: String::new(),
                        infra_error: false,
                    }
                })
            }),
            ast_facts: None,
            on_capture: None,
        }
    }

    fn base_request(cwd: PathBuf, timeout: StdDuration, turn_ceiling: usize) -> FixRequest {
        FixRequest {
            rule_id: "test-rule".to_string(),
            violation_text: "виправ порушення".to_string(),
            target_files: Vec::new(),
            cwd,
            tier: Tier::Min,
            model: None,
            max_tokens: None,
            timeout,
            turn_ceiling,
            verify_max: 1,
            anchored_edits: false,
            edit_mode: EditMode::Generic,
        }
    }

    /// Env для локального тіру, наведеного на mock-сервер — той самий
    /// каскад, що й production-шлях [`resolve_provider_target`] (тест не
    /// обходить резолвінг, а йде крізь нього).
    fn mock_env(port: u16, scenario: &str) -> Vec<(&'static str, String)> {
        vec![
            ("N_LOCAL_MIN_MODEL", "local-openai/mock-model".to_string()),
            (
                "N_LOCAL_OPENAI_BASE_URL",
                format!("http://127.0.0.1:{port}/{scenario}/"),
            ),
            ("N_LOCAL_OPENAI_API_KEY", "mock-key".to_string()),
        ]
    }

    /// Серіалізує тест проти спільного `ENV_LOCK` (той самий м'ютекс, що й
    /// `tiers`/`local_cloud`/`acp::presets`-тести на ті самі `N_*_MODEL`/
    /// `N_LOCAL_OPENAI_*` env-змінні), виставляє `vars`, виконує `body` і
    /// прибирає їх незалежно від результату.
    ///
    /// `#[allow(clippy::await_holding_lock)]`: guard тримається через
    /// `.await` НАВМИСНО — увесь сенс блоку саме в тому, щоб жоден інший
    /// тест не міг перезаписати ті самі глобальні env-змінні, поки `body`
    /// ще їх читає (аж до завершення `run_attempt`). `#[tokio::test]` без
    /// `flavor = "multi_thread"` дає current-thread executor — усередині
    /// ОДНОГО виклику немає інших задач, що змагались би за цей м'ютекс на
    /// тому самому потоці; це тестовий хелпер, не production-код.
    #[allow(clippy::await_holding_lock)]
    async fn with_mock_env<Fut, T>(vars: &[(&'static str, String)], body: Fut) -> T
    where
        Fut: std::future::Future<Output = T>,
    {
        let _guard = test_env::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for name in test_env::ALL_VARS {
            unsafe { std::env::remove_var(name) };
        }
        for (name, value) in vars {
            unsafe { std::env::set_var(name, value) };
        }
        let result = body.await;
        for name in test_env::ALL_VARS {
            unsafe { std::env::remove_var(name) };
        }
        result
    }

    /// Veto: write-tool-виклик поза git-root блокується write-guard-ом ДО
    /// виконання тіла — жодного реального запису, `touched_files` порожній,
    /// attempt завершується `Completed` (verify тривіально зелений).
    #[tokio::test]
    async fn write_guard_veto_blocks_write_outside_root_and_run_completes() {
        let dir = tempfile::tempdir().expect("tempdir");
        init_git_repo(dir.path());
        let outside = std::env::temp_dir().join(format!(
            "llm-lib-fix-runner-veto-outside-{}.txt",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&outside);

        let port = unique_port();
        let mut mock = spawn_mock(port, outside.to_str().expect("utf8 шлях")).await;
        let vars = mock_env(port, "veto");

        let deps = trivial_ok_deps();
        let req = base_request(dir.path().to_path_buf(), StdDuration::from_secs(10), 6);
        let outcome = with_mock_env(&vars, async {
            let toolset = crate::fix::tools::build_toolset(&req.cwd, &deps, req.anchored_edits);
            let handle = rig_agent::tool::server::ToolServer::new().run();
            handle.append_toolset(toolset).await;
            run_attempt(&req, deps, handle).await
        })
        .await;

        let _ = mock.kill().await;

        assert_eq!(outcome.stop_reason, StopReason::Completed, "{outcome:?}");
        assert!(outcome.ok);
        assert!(
            outcome.touched_files.is_empty(),
            "vetoed запис не мав лишити pre-image/touched-слід: {outcome:?}"
        );
        assert!(
            !outside.exists(),
            "vetoed write НЕ мав торкнутись файлової системи"
        );
    }

    /// Turn-ceiling: модель ніколи не завершує хід (завжди tool-call) —
    /// `max_turns` мусить самостійно спинити біг замість вічного циклу.
    #[tokio::test]
    async fn turn_ceiling_stops_infinite_tool_loop() {
        let dir = tempfile::tempdir().expect("tempdir");
        init_git_repo(dir.path());

        let port = unique_port();
        let mut mock = spawn_mock(port, "/unused").await;
        let vars = mock_env(port, "always_tool");

        let deps = trivial_ok_deps();
        let req = base_request(dir.path().to_path_buf(), StdDuration::from_secs(10), 3);
        let outcome = with_mock_env(&vars, async {
            let toolset = crate::fix::tools::build_toolset(&req.cwd, &deps, req.anchored_edits);
            let handle = rig_agent::tool::server::ToolServer::new().run();
            handle.append_toolset(toolset).await;
            run_attempt(&req, deps, handle).await
        })
        .await;

        let _ = mock.kill().await;

        assert_eq!(outcome.stop_reason, StopReason::TurnCeiling, "{outcome:?}");
        assert!(!outcome.ok);
    }

    /// Timeout: зовнішній `tokio::time::timeout` абортує attempt, коли
    /// провайдер відповідає повільніше за бюджет часу — `StopReason::Timeout`
    /// синтезує ЦЕЙ код (rig не повідомляє причину скасованого future, §3.8).
    #[tokio::test]
    async fn external_timeout_aborts_slow_provider() {
        let dir = tempfile::tempdir().expect("tempdir");
        init_git_repo(dir.path());

        let port = unique_port();
        let mut mock = spawn_mock(port, "/unused").await;
        let vars = mock_env(port, "slow");

        let deps = trivial_ok_deps();
        let req = base_request(dir.path().to_path_buf(), StdDuration::from_millis(150), 50);
        let outcome = with_mock_env(&vars, async {
            let toolset = crate::fix::tools::build_toolset(&req.cwd, &deps, req.anchored_edits);
            let handle = rig_agent::tool::server::ToolServer::new().run();
            handle.append_toolset(toolset).await;
            run_attempt(&req, deps, handle).await
        })
        .await;

        let _ = mock.kill().await;

        assert_eq!(outcome.stop_reason, StopReason::Timeout, "{outcome:?}");
        assert!(!outcome.ok);
    }

    /// Verify-петля наскрізь через rig: перші дві перевірки — інфра-помилка
    /// (не палять `verify_max`), третя — реальний "червоний" вердикт (палить
    /// бюджет), четверта — зелена. `verify_max=2` вистачає лише тому, що
    /// інфра-ретраї не рахуються.
    #[tokio::test]
    async fn verify_loop_survives_infra_errors_then_succeeds_in_same_session() {
        let dir = tempfile::tempdir().expect("tempdir");
        init_git_repo(dir.path());

        let port = unique_port();
        let mut mock = spawn_mock(port, "/unused").await;
        let vars = mock_env(port, "text_only");

        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_verify = calls.clone();
        let deps = FixDeps {
            verify: Arc::new(move || {
                let calls = calls_for_verify.clone();
                Box::pin(async move {
                    let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
                    match n {
                        1 | 2 => super::super::VerifyReport {
                            ok: false,
                            output: "інфра-збій перевірки".to_string(),
                            infra_error: true,
                        },
                        3 => super::super::VerifyReport {
                            ok: false,
                            output: "усе ще червоно".to_string(),
                            infra_error: false,
                        },
                        _ => super::super::VerifyReport {
                            ok: true,
                            output: String::new(),
                            infra_error: false,
                        },
                    }
                })
            }),
            ast_facts: None,
            on_capture: None,
        };

        let mut req = base_request(dir.path().to_path_buf(), StdDuration::from_secs(10), 10);
        req.verify_max = 2;
        let outcome = with_mock_env(&vars, async {
            let toolset = crate::fix::tools::build_toolset(&req.cwd, &deps, req.anchored_edits);
            let handle = rig_agent::tool::server::ToolServer::new().run();
            handle.append_toolset(toolset).await;
            run_attempt(&req, deps, handle).await
        })
        .await;

        let _ = mock.kill().await;

        assert_eq!(outcome.stop_reason, StopReason::Completed, "{outcome:?}");
        assert!(outcome.ok);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            4,
            "усі чотири verify-виклики мають відбутись у ТІЙ САМІЙ сесії"
        );
        assert_eq!(outcome.turns, 4);
    }

    /// Verify-петля вичерпується: перевірка стабільно червона (не інфра),
    /// `verify_max=1` — після початкового ходу й одного ретраю бюджет
    /// вичерпано, attempt зупиняється `VerifyExhausted`.
    #[tokio::test]
    async fn verify_loop_exhausts_after_verify_max_stable_red() {
        let dir = tempfile::tempdir().expect("tempdir");
        init_git_repo(dir.path());

        let port = unique_port();
        let mut mock = spawn_mock(port, "/unused").await;
        let vars = mock_env(port, "text_only");

        let deps = FixDeps {
            verify: Arc::new(|| {
                Box::pin(async {
                    super::super::VerifyReport {
                        ok: false,
                        output: "стабільно червоно".to_string(),
                        infra_error: false,
                    }
                })
            }),
            ast_facts: None,
            on_capture: None,
        };

        let mut req = base_request(dir.path().to_path_buf(), StdDuration::from_secs(10), 10);
        req.verify_max = 1;
        let outcome = with_mock_env(&vars, async {
            let toolset = crate::fix::tools::build_toolset(&req.cwd, &deps, req.anchored_edits);
            let handle = rig_agent::tool::server::ToolServer::new().run();
            handle.append_toolset(toolset).await;
            run_attempt(&req, deps, handle).await
        })
        .await;

        let _ = mock.kill().await;

        assert_eq!(
            outcome.stop_reason,
            StopReason::VerifyExhausted,
            "{outcome:?}"
        );
        assert!(!outcome.ok);
    }
}
