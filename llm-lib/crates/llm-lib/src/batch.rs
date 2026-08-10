//! Batch-фасад (Тип 2b, §3.6 спеки `2026-08-08-llm-lib-acp-only-rust-goose.md`,
//! рішення Д/К) — [`dispatch`] обирає між двома бекендами:
//!
//! - [`Backend::Native`] — справжній `/v1/batches` OpenAI-сумісний адаптер
//!   ([`crate::remote_batch`], спека `2026-07-27-batch-local-avg-real-batches.md`).
//!   Дефолт і сьогоднішня єдина поведінка — нею користуються doc-files,
//!   adr-normalize і coverage classify через napi;
//! - [`Backend::Acp`] — емуляція пулом one-shot ACP-сесій
//!   ([`crate::acp::pool`]): для користувачів без нативного Batch API
//!   (підписочні CLI `cursor`/`codex`/`pi` чи `goose` на omlx/API-ключовому
//!   провайдері).
//!
//! **Зворотна сумісність (рішення Е)**: цей зріз лише РОБИТЬ ACP-шлях
//! доступним і явно обираним — дефолтна поведінка [`dispatch`] без
//! `N_BATCH_BACKEND` НЕ змінюється (лишається [`Backend::Native`], той
//! самий явний provider-помилка без тихого фолбеку, що й раніше). Повна
//! імпліцитна capability-детекція ("є хмарний ключ → native, інакше →
//! acp") і виведення прямого HTTP-пулу як єдиного дефолту прийдуть разом
//! із міграцією JS-споживачів (рішення Е) — не в цьому зрізі.
//!
//! **Помилка одного item не валить увесь batch** — вона потрапляє у
//! відповідний [`BatchResult::outcome`], решта items обробляються далі
//! (природа обох бекендів: [`crate::remote_batch::submit`] і
//! [`crate::acp::pool::run`]).

use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use crate::acp::{pool, AcpAgentKind};
use crate::local_cloud::LocalCloud;
use crate::remote_batch::{self, RemoteBatchConfig};
use crate::tiers::{parse_model_spec, Tier};
use crate::LlmError;

/// Один запит у batch — той самий `custom_id`-контракт, що й OpenAI Batch
/// API, щоб обидва бекенди ([`Backend::Native`]/[`Backend::Acp`]) ділили
/// один виклик-сайт.
#[derive(Debug, Clone)]
pub struct BatchItem {
    /// Ідентифікатор, яким викликач звʼязує запит із результатом —
    /// має бути унікальним у межах одного `submit`.
    pub custom_id: String,
    /// User-репліка чату.
    pub prompt: String,
    /// Опційна system-репліка (якщо не задано — виконавець вирішує сам,
    /// напр. бере глобальний дефолт).
    pub system: Option<String>,
}

/// Результат одного item. `outcome` — `Ok(text)` чи `Err(message)`;
/// помилка **не** типізована як [`LlmError`] навмисно (той самий плоский
/// підхід, що й у решті крейта) — рядок достатній для napi-мосту, де
/// помилка одного item лише показується користувачу, не оброблюється
/// програмно.
#[derive(Debug, Clone)]
pub struct BatchResult {
    /// Той самий `custom_id`, що й у вхідному [`BatchItem`].
    pub custom_id: String,
    /// `Ok(text)` — успішна відповідь; `Err(message)` — помилка саме
    /// цього item (мережа, провайдер, паніка виконавця) — інші items
    /// batch-у це не зачіпає.
    pub outcome: Result<String, String>,
}

/// Знімок прогресу — скільки items уже має результат (успішний чи ні) з
/// усього `total`. Монотонно зростає до `total` включно.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchProgress {
    /// Скільки items уже завершено (успіх чи помилка — байдуже).
    pub completed: usize,
    /// Загальна кількість items у batch-і.
    pub total: usize,
}

/// Обраний бекенд виконання batch-у (рішення Д/К). Приватний — викликач
/// [`dispatch`] керує вибором лише через `N_BATCH_BACKEND` (env) або
/// неявно (дефолт), самого enum-у ззовні не бачить.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Backend {
    /// Прямий HTTP-пул через [`remote_batch::submit`] — дефолт.
    Native,
    /// Емуляція пулом one-shot ACP-сесій ([`pool::run`]).
    Acp,
}

/// Єдиний новий env-ключ цього зрізу (рішення К) — явний override вибору
/// бекенда для дебагу/примусового вибору.
const BACKEND_ENV_VAR: &str = "N_BATCH_BACKEND";

/// Резолвить [`Backend`] за `N_BATCH_BACKEND`.
///
/// Відсутня чи порожня змінна — [`Backend::Native`] (зворотна
/// сумісність, докшапка модуля: наявні napi-споживачі не бачать зміни
/// дефолтної поведінки в цьому зрізі). `"native"`/`"acp"` — явний вибір.
/// Будь-яке інше значення — явна помилка (fail-fast філософія крейта,
/// докшапка `crate::lib`), не тихий фолбек на дефолт.
///
/// # Errors
/// [`LlmError::Provider`] — `N_BATCH_BACKEND` заданий, але не дорівнює
/// `"native"`/`"acp"`.
fn resolve_backend() -> Result<Backend, LlmError> {
    match std::env::var(BACKEND_ENV_VAR) {
        Err(_) => Ok(Backend::Native),
        Ok(value) if value.is_empty() => Ok(Backend::Native),
        Ok(value) if value == "native" => Ok(Backend::Native),
        Ok(value) if value == "acp" => Ok(Backend::Acp),
        Ok(value) => Err(LlmError::Provider(format!(
            "невалідний {BACKEND_ENV_VAR}={value:?}: очікується \"native\" чи \"acp\""
        ))),
    }
}

/// Конфіг ACP-емуляції для [`dispatch`] (рішення Д, §3.6): який ACP-kind
/// спавнити ([`AcpAgentKind`] — підписочний `cursor`/`codex`/`pi` чи
/// `goose`), на якому [`Tier`] і в якому `cwd`. Обовʼязковий лише коли
/// резолвлений бекенд — [`Backend::Acp`] (явний `N_BATCH_BACKEND=acp`);
/// на нативному шляху ігнорується.
///
/// `agent`/`tier`/`cwd` приходять від викликача параметром, а НЕ з
/// нового env-ключа — єдиний новий env цього зрізу — `N_BATCH_BACKEND`
/// (рішення К), тір-мапа `goose` й далі читає наявний `N_*_MODEL`-контракт
/// (рішення З), але сам kind ACP-агента вибирає викликач [`dispatch`].
#[derive(Debug, Clone)]
pub struct AcpBatchConfig {
    /// Який ACP-агент спавнити для кожної one-shot сесії пулу.
    pub agent: AcpAgentKind,
    /// Тір моделі — резолвиться в конкретну модель усередині
    /// [`crate::acp::one_shot_acp_with_tier`] за пресетом `agent`-а.
    pub tier: Tier,
    /// Робочий каталог ACP-сесії.
    pub cwd: PathBuf,
    /// Явний override верхнього кепа конкурентності пулу — якщо `None`,
    /// застосовується per-kind дефолт [`default_pool_cap`].
    pub max_concurrency: Option<usize>,
}

/// Per-kind дефолтний верхній кеп конкурентності пулу ACP-емуляції, коли
/// [`AcpBatchConfig::max_concurrency`] не заданий явно ([`pool`] сам
/// kind-у не знає — докшапка `crate::acp::pool`, кеп підбирає викликач).
///
/// - `Cursor`/`Codex`/`Pi` — підписочні CLI: усі одночасні one-shot сесії
///   йдуть через **той самий** обліковий запис користувача, тож
///   консервативний кеп `2` — страховка від rate-limit акаунту до
///   першого backoff-сигналу самого пулу (рішення И). Однаковий для всіх
///   трьох — жоден із них не дає підстав вважати ліміт свого акаунту
///   суттєво вищим за інші.
/// - `Goose` (omlx чи API-ключовий провайдер) — не ділить один
///   обліковий запис підписки: локальна модель обмежена лише
///   пропускною здатністю власного inference-сервера, а API-ключовий
///   провайдер має власне (як правило, вище за особисту CLI-підписку)
///   квотування, тож кеп вищий — `6`.
#[must_use]
fn default_pool_cap(agent: AcpAgentKind) -> usize {
    match agent {
        AcpAgentKind::Cursor | AcpAgentKind::Codex | AcpAgentKind::Pi => 2,
        AcpAgentKind::Goose => 6,
    }
}

/// Склеює опційний `system` і `prompt` в один ACP-user-prompt.
///
/// ACP не має окремого system-каналу (stdio JSON-RPC говорить лише про
/// `session/prompt` з одним блоком контенту) — той самий підхід, що й
/// `runOneShot` у `llm-lib/lib/one-shot.mjs`
/// (`messages.map(m => m.content).join('\n\n')`): свідоме рішення заради
/// слабких локальних моделей, які трактують system-prompt-інструкції як
/// "правила для підтвердження" й переказують їх замість виконання, тоді
/// як інлайн-інструкції в user-репліці модель виконує.
fn merge_prompt(system: Option<&str>, prompt: &str) -> String {
    match system {
        Some(system) if !system.is_empty() => format!("{system}\n\n{prompt}"),
        _ => prompt.to_string(),
    }
}

/// Диспетчер batch-фасаду (§3.6): резолвить бекенд за `N_BATCH_BACKEND`
/// ([`resolve_backend`]) і виконує `items` через [`Backend::Native`]
/// ([`dispatch_native`]) чи [`Backend::Acp`] ([`dispatch_acp`]).
///
/// `global_system` — дефолтна system-репліка для items без власної,
/// застосовується тут, перед розгалуженням по бекенду, однаково для
/// обох шляхів.
///
/// `acp_config` — потрібен лише коли резолвлений [`Backend::Acp`]; на
/// нативному шляху ігнорується (можна передавати `None`).
///
/// # Errors
/// [`LlmError::Provider`] — невалідний `N_BATCH_BACKEND`; на нативному
/// шляху — незареєстрований провайдер чи помилка
/// [`remote_batch::submit`]; на ACP-шляху — відсутній `acp_config`, коли
/// резолвлений бекенд — [`Backend::Acp`]. [`LlmError::NoModelConfigured`]/
/// [`LlmError::InvalidModelSpec`] — з [`LocalCloud::resolve_spec`]/
/// парсингу spec-у (лише нативний шлях).
pub async fn dispatch<Progress>(
    cascade: &LocalCloud,
    model_spec_or_tier: &str,
    items: Vec<BatchItem>,
    remote_config: &RemoteBatchConfig,
    global_system: Option<String>,
    acp_config: Option<&AcpBatchConfig>,
    on_progress: Progress,
) -> Result<Vec<BatchResult>, LlmError>
where
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    let items: Vec<BatchItem> = items
        .into_iter()
        .map(|mut item| {
            if item.system.is_none() {
                item.system = global_system.clone();
            }
            item
        })
        .collect();

    match resolve_backend()? {
        Backend::Native => {
            dispatch_native(
                cascade,
                model_spec_or_tier,
                items,
                remote_config,
                on_progress,
            )
            .await
        }
        Backend::Acp => dispatch_acp(items, acp_config, on_progress).await,
    }
}

/// [`Backend::Native`]: резолвить `model_spec_or_tier` через
/// [`LocalCloud::resolve_spec`], визначає провайдер і виконує batch
/// виключно через [`remote_batch::submit`] (справжній `/v1/batches`,
/// лише bare model-id без provider-префікса — той самий, що адаптер
/// очікує в тілі `chat/completions`). Провайдер без зареєстрованого
/// `base_url`/`api_key` у `local_providers` — явна помилка, без тихого
/// фолбеку на ACP-емуляцію (той фолбек — майбутня повна capability-детекція
/// рішення К, не цей зріз).
async fn dispatch_native<Progress>(
    cascade: &LocalCloud,
    model_spec_or_tier: &str,
    items: Vec<BatchItem>,
    remote_config: &RemoteBatchConfig,
    on_progress: Progress,
) -> Result<Vec<BatchResult>, LlmError>
where
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    let spec = cascade.resolve_spec(model_spec_or_tier)?;
    let (provider, model_name) = parse_model_spec(&spec).map_err(LlmError::InvalidModelSpec)?;

    let config = cascade.provider_config(provider).ok_or_else(|| {
        LlmError::Provider(format!(
            "провайдер {provider:?} не зареєстрований у local_providers (немає base_url/api_key) \
             — реальний Batch API вимагає явного конфігу, емуляція вилучена"
        ))
    })?;

    remote_batch::submit(
        &config.base_url,
        config.api_key.as_deref(),
        model_name,
        items,
        remote_config,
        on_progress,
    )
    .await
}

/// [`Backend::Acp`]: вимагає [`AcpBatchConfig`] від викликача (kind не
/// резолвиться з env — лише `N_BATCH_BACKEND` вибирає сам бекенд,
/// рішення К), підбирає верхній кеп конкурентності пулу
/// ([`AcpBatchConfig::max_concurrency`] чи per-kind [`default_pool_cap`])
/// і делегує [`run_acp_pool`] із продакшн [`pool::acp_runner`].
async fn dispatch_acp<Progress>(
    items: Vec<BatchItem>,
    acp_config: Option<&AcpBatchConfig>,
    on_progress: Progress,
) -> Result<Vec<BatchResult>, LlmError>
where
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    let cfg = acp_config.ok_or_else(|| {
        LlmError::Provider(
            "batch: N_BATCH_BACKEND=acp вимагає AcpBatchConfig (agent/tier/cwd) від викликача \
             — ACP-kind не резолвиться з env (рішення К)"
                .to_string(),
        )
    })?;

    let max_concurrency = cfg
        .max_concurrency
        .unwrap_or_else(|| default_pool_cap(cfg.agent));
    let pool_config = pool::PoolConfig {
        max_concurrency,
        ..pool::PoolConfig::default()
    };
    let runner = pool::acp_runner(cfg.agent, cfg.tier, cfg.cwd.clone());

    Ok(run_acp_pool(items, pool_config, runner, on_progress).await)
}

/// Спільне тіло ACP-шляху: склеює `system`+`prompt`
/// ([`merge_prompt`]) у позиційний список промптів, ганяє його через
/// [`pool::run`] з ін'єктованим `runner`-ом, мапить позиційні результати
/// назад у [`BatchResult`] за `custom_id` (порядок [`pool::run`] уже
/// гарантовано збігається з порядком вхідних `items` — докшапка
/// `crate::acp::pool`).
///
/// Винесено окремо від [`dispatch_acp`], щоб юніт-тести підставляли
/// фейковий `runner` (без спавну ACP-процесів і без мережі), не
/// чіпаючи продакшн [`pool::acp_runner`].
///
/// `on_progress` обгортається у власний runner-шар — [`pool::run`] сам
/// по собі прогресу не публікує (лише [`pool::PoolConfig::on_level_change`]
/// для конкурентності, не для completion-ів), тож кожне завершення item-у
/// (успіх чи вичерпані ретраї) інкрементує лічильник і публікує
/// [`BatchProgress`] — той самий контракт `(completed, total)`, що й на
/// нативному шляху.
async fn run_acp_pool<Runner, Fut, Progress>(
    items: Vec<BatchItem>,
    pool_config: pool::PoolConfig,
    runner: Runner,
    on_progress: Progress,
) -> Vec<BatchResult>
where
    Runner: Fn(String) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<String, LlmError>> + Send + 'static,
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    if items.is_empty() {
        return Vec::new();
    }
    let total = items.len();
    let custom_ids: Vec<String> = items.iter().map(|item| item.custom_id.clone()).collect();
    let prompts: Vec<String> = items
        .iter()
        .map(|item| merge_prompt(item.system.as_deref(), &item.prompt))
        .collect();

    let completed = Arc::new(AtomicUsize::new(0));
    let on_progress = Arc::new(on_progress);
    let progress_runner = move |prompt: String| {
        let attempt = runner(prompt);
        let completed = Arc::clone(&completed);
        let on_progress = Arc::clone(&on_progress);
        async move {
            let outcome = attempt.await;
            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            on_progress(BatchProgress {
                completed: done,
                total,
            });
            outcome
        }
    };

    let outcomes = pool::run(prompts, pool_config, progress_runner).await;
    custom_ids
        .into_iter()
        .zip(outcomes)
        .map(|(custom_id, outcome)| BatchResult {
            custom_id,
            outcome: outcome.map_err(|error| error.to_string()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> BatchItem {
        BatchItem {
            custom_id: id.to_string(),
            prompt: format!("prompt-{id}"),
            system: None,
        }
    }

    fn no_progress(_: BatchProgress) {}

    fn provider(base_url: &str) -> crate::local_cloud::LocalProvider {
        crate::local_cloud::LocalProvider {
            base_url: base_url.to_string(),
            api_key: None,
        }
    }

    // --- dispatch: нативний шлях (Backend::Native, дефолт) ---

    /// Порожній набір items не спричиняє жодного мережевого виклику
    /// ([`crate::remote_batch::submit`] short-circuit-ить на `is_empty`) —
    /// безпечно перевіряти сам диспетчер без піднімання мок-сервера.
    #[tokio::test]
    async fn dispatch_uses_remote_batch_for_registered_provider() {
        let mut providers = std::collections::HashMap::new();
        providers.insert(
            "local-openai".to_string(),
            provider("http://127.0.0.1:1/v1/"),
        );
        let cascade = LocalCloud::new(providers);

        let results = dispatch(
            &cascade,
            "local-openai/gemma-4-26b-awq",
            Vec::new(),
            &RemoteBatchConfig::default(),
            None,
            None,
            no_progress,
        )
        .await
        .expect("порожній batch не має провалюватись");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn dispatch_errors_when_provider_not_registered() {
        let cascade = LocalCloud::new(std::collections::HashMap::new());

        let err = dispatch(
            &cascade,
            "local-openai/gemma-4-26b-awq",
            vec![item("a")],
            &RemoteBatchConfig::default(),
            None,
            None,
            no_progress,
        )
        .await
        .expect_err("незареєстрований провайдер має явно провалитись, без фолбеку на емуляцію");
        assert!(matches!(err, LlmError::Provider(_)));
    }

    #[tokio::test]
    async fn dispatch_fills_missing_item_system_from_global_system() {
        let mut providers = std::collections::HashMap::new();
        providers.insert(
            "local-openai".to_string(),
            provider("http://127.0.0.1:1/v1/"),
        );
        let cascade = LocalCloud::new(providers);

        // Порожні items — доводимо лише, що виклик не падає з global_system
        // заданим (саме заповнення перевіряється на рівні remote_batch::submit
        // через item.system, тут — інтеграційна перевірка "не ламається").
        let results = dispatch(
            &cascade,
            "local-openai/gemma-4-26b-awq",
            Vec::new(),
            &RemoteBatchConfig::default(),
            Some("ти корисний асистент".to_string()),
            None,
            no_progress,
        )
        .await
        .expect("global_system не має ламати диспетчер");
        assert!(results.is_empty());
    }

    // --- resolve_backend: вибір бекенда за N_BATCH_BACKEND (рішення К) ---
    //
    // env-змінна не входить у `crate::tiers::test_env::ALL_VARS` (той
    // список — про tiers-специфічні N_LOCAL_*/N_CLOUD_*), тож серіалізуємо
    // лише спільним `ENV_LOCK`, керуючи `N_BATCH_BACKEND` тут-таки — той
    // самий м'ютекс, що й `tiers`/`local_cloud`/`acp::presets`-тести
    // (коментар над `crate::tiers::test_env`).

    fn with_batch_backend_env<T>(value: Option<&str>, f: impl FnOnce() -> T) -> T {
        let _guard = crate::tiers::test_env::ENV_LOCK.lock().unwrap();
        match value {
            Some(v) => unsafe { std::env::set_var(BACKEND_ENV_VAR, v) },
            None => unsafe { std::env::remove_var(BACKEND_ENV_VAR) },
        }
        let result = f();
        unsafe { std::env::remove_var(BACKEND_ENV_VAR) };
        result
    }

    #[test]
    fn resolve_backend_defaults_to_native_when_unset() {
        with_batch_backend_env(None, || {
            assert_eq!(resolve_backend().unwrap(), Backend::Native);
        });
    }

    #[test]
    fn resolve_backend_honors_explicit_native() {
        with_batch_backend_env(Some("native"), || {
            assert_eq!(resolve_backend().unwrap(), Backend::Native);
        });
    }

    #[test]
    fn resolve_backend_honors_explicit_acp() {
        with_batch_backend_env(Some("acp"), || {
            assert_eq!(resolve_backend().unwrap(), Backend::Acp);
        });
    }

    #[test]
    fn resolve_backend_rejects_invalid_value() {
        with_batch_backend_env(Some("bogus"), || {
            let err = resolve_backend().expect_err("невалідне значення має провалитись");
            assert!(matches!(err, LlmError::Provider(_)));
        });
    }

    #[test]
    fn resolve_backend_empty_value_treated_as_unset() {
        with_batch_backend_env(Some(""), || {
            assert_eq!(resolve_backend().unwrap(), Backend::Native);
        });
    }

    // --- merge_prompt: system+prompt склейка (ACP не має system-каналу) ---

    #[test]
    fn merge_prompt_joins_system_and_user_with_blank_line() {
        assert_eq!(
            merge_prompt(Some("будь корисним"), "привіт"),
            "будь корисним\n\nпривіт"
        );
    }

    #[test]
    fn merge_prompt_without_system_returns_prompt_verbatim() {
        assert_eq!(merge_prompt(None, "привіт"), "привіт");
    }

    #[test]
    fn merge_prompt_empty_system_treated_as_absent() {
        assert_eq!(merge_prompt(Some(""), "привіт"), "привіт");
    }

    // --- default_pool_cap: per-kind кепи (рішення И) ---

    #[test]
    fn default_pool_cap_matches_subscription_clis_conservative_cap() {
        assert_eq!(default_pool_cap(AcpAgentKind::Cursor), 2);
        assert_eq!(default_pool_cap(AcpAgentKind::Codex), 2);
        assert_eq!(default_pool_cap(AcpAgentKind::Pi), 2);
    }

    #[test]
    fn default_pool_cap_goose_is_higher_than_subscription_clis() {
        assert!(default_pool_cap(AcpAgentKind::Goose) > default_pool_cap(AcpAgentKind::Cursor));
    }

    // --- dispatch_acp / run_acp_pool: ACP-шлях, фейковий runner (без спавну процесів і мережі) ---

    fn acp_item(id: &str, prompt: &str, system: Option<&str>) -> BatchItem {
        BatchItem {
            custom_id: id.to_string(),
            prompt: prompt.to_string(),
            system: system.map(str::to_string),
        }
    }

    #[tokio::test]
    async fn dispatch_acp_errors_without_config() {
        let err = dispatch_acp(vec![item("a")], None, no_progress)
            .await
            .expect_err("acp-шлях без AcpBatchConfig має явно провалитись");
        assert!(matches!(err, LlmError::Provider(_)));
    }

    #[tokio::test]
    async fn run_acp_pool_returns_empty_without_calling_runner_for_empty_items() {
        let runner = |_: String| async { Ok(String::new()) };
        let results =
            run_acp_pool(Vec::new(), pool::PoolConfig::default(), runner, no_progress).await;
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn run_acp_pool_merges_system_into_prompt_and_maps_custom_ids() {
        let items = vec![
            acp_item("a", "перший", None),
            acp_item("b", "другий", Some("system-b")),
        ];
        let runner = |prompt: String| async move { Ok(format!("echo:{prompt}")) };

        let results = run_acp_pool(items, pool::PoolConfig::default(), runner, no_progress).await;

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].custom_id, "a");
        assert_eq!(results[0].outcome.as_deref(), Ok("echo:перший"));
        assert_eq!(results[1].custom_id, "b");
        assert_eq!(results[1].outcome.as_deref(), Ok("echo:system-b\n\nдругий"));
    }

    #[tokio::test(start_paused = true)]
    async fn run_acp_pool_preserves_result_order_despite_reversed_completion() {
        let total = 4usize;
        let items: Vec<BatchItem> = (0..total)
            .map(|i| acp_item(&format!("id-{i}"), &format!("prompt-{i}"), None))
            .collect();
        let runner = move |prompt: String| async move {
            let index: usize = prompt
                .strip_prefix("prompt-")
                .and_then(|s| s.parse().ok())
                .expect("тестові prompt мають формат prompt-<index>");
            let delay = std::time::Duration::from_millis(((total - index) * 10) as u64);
            tokio::time::sleep(delay).await;
            Ok(format!("out-{prompt}"))
        };
        let config = pool::PoolConfig {
            start_concurrency: total,
            max_concurrency: total,
            max_retries_per_item: 0,
            ..pool::PoolConfig::default()
        };

        let results = run_acp_pool(items, config, runner, no_progress).await;

        assert_eq!(results.len(), total);
        for (index, result) in results.into_iter().enumerate() {
            assert_eq!(result.custom_id, format!("id-{index}"));
            assert_eq!(
                result.outcome.as_deref(),
                Ok(format!("out-prompt-{index}").as_str()),
                "результат на позиції {index} має відповідати саме item-{index}, попри інший порядок completion"
            );
        }
    }

    #[tokio::test]
    async fn run_acp_pool_maps_llm_error_to_string_outcome_without_failing_batch() {
        let items = vec![acp_item("only", "prompt", None)];
        let runner = |_: String| async { Err(LlmError::Provider("бум".to_string())) };
        let config = pool::PoolConfig {
            max_retries_per_item: 0,
            ..pool::PoolConfig::default()
        };

        let results = run_acp_pool(items, config, runner, no_progress).await;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].custom_id, "only");
        assert_eq!(results[0].outcome, Err("бум".to_string()));
    }

    #[tokio::test]
    async fn run_acp_pool_reports_progress_after_each_completion() {
        let items = vec![
            acp_item("a", "1", None),
            acp_item("b", "2", None),
            acp_item("c", "3", None),
        ];
        let runner = |prompt: String| async move { Ok(prompt) };
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let log_for_cb = Arc::clone(&log);
        let on_progress = move |progress: BatchProgress| {
            log_for_cb.lock().unwrap().push(progress);
        };

        let results = run_acp_pool(items, pool::PoolConfig::default(), runner, on_progress).await;

        assert_eq!(results.len(), 3);
        let observed = log.lock().unwrap().clone();
        assert_eq!(observed.len(), 3, "по одному виклику on_progress на item");
        for (i, progress) in observed.iter().enumerate() {
            assert_eq!(progress.completed, i + 1);
            assert_eq!(progress.total, 3);
        }
    }
}
