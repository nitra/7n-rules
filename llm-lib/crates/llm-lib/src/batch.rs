//! Тип 2b (OpenAI-сумісний API, batch) — [`dispatch`] обирає між клієнтською
//! емуляцією (v1, рішення Р спеки `2026-07-23-llm-cascade-single-source-spec.md`:
//! чанкований конкурентний прогін через [`crate::local_cloud`], Тип 2a) і
//! справжнім `/v1/batches` litellm batch-adapter-а ([`crate::remote_batch`],
//! спека `2026-07-27-batch-local-avg-real-batches.md`) — той самий контракт
//! `submit → progress → results` для обох, викликач (napi-міст) не відрізняє
//! бекенд. omlx (без реального Batch API) завжди йде емуляцією.
//!
//! **Помилка одного item чи одного чанка не валить увесь batch** — вона
//! потрапляє у відповідний [`BatchResult::outcome`], решта items
//! обробляються далі (узагальнення емпіричного ліміту, який `mlmail`
//! вивів вручну: деградація понад ~35 items, зависання на 80).

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::local_cloud::LocalCloud;
use crate::remote_batch::{self, RemoteBatchConfig};
use crate::tiers::parse_model_spec;
use crate::LlmError;

/// Ліміти чанка/конкурентності. Дефолти — стартові з рішення Р спеки (чанк
/// ≤35), уточнені бенч-калібруванням на omlx (див.
/// `docs/specs/2026-07-24-batch-emulation-bench.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchConfig {
    /// Скільки items обробляється в одному чанку (progress звітується
    /// по завершенню кожного item, а не лише по чанку).
    pub chunk_size: usize,
    /// Скільки items одного чанка виконуються паралельно.
    pub concurrency: usize,
}

impl Default for BatchConfig {
    /// `chunk_size: 35` (старт зі спеки, рішення Р), `concurrency: 2`
    /// (помірна — бенч на omlx: `scheduler.max_concurrent_requests: 1` у
    /// типовому локальному конфізі робить вищу конкурентність марною
    /// клієнтською чергою, не пришвидшенням).
    fn default() -> Self {
        Self {
            chunk_size: 35,
            concurrency: 2,
        }
    }
}

/// Один запит у batch — той самий `custom_id`-контракт, що й OpenAI Batch
/// API (v2 буде говорити тим самим полем), щоб емуляція v1 і справжній
/// сервер v2 ділили один виклик-сайт.
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

/// Емуляція batch (рішення Р, задача T6): розбиває `items` на чанки за
/// `config.chunk_size`, у межах чанка виконує до `config.concurrency`
/// `executor`-викликів одночасно, чанки — послідовно один за одним.
/// `on_progress` викликається після кожного завершеного item (успіх чи
/// помилка).
///
/// `executor` — ін'єкція виконавця одного item (у продакшн-коді —
/// `LocalCloud::one_shot_with_spec`/`one_shot`, у юніт-тестах — фейкова
/// async-функція без мережі; той самий підхід ін'єкції, що й
/// `AcpSessionUpdates` у `acp::transport`). Паніка `executor`-а всередині
/// задачі не валить `submit` — item, чия задача запанікувала, теж
/// отримує `Err`-результат (за `custom_id`, зібраним до спавну задачі).
///
/// Порядок [`BatchResult`] у поверненому `Vec` збігається з порядком
/// вхідних `items` — попри конкурентне виконання всередині чанка.
pub async fn submit<Exec, Fut, Progress>(
    items: Vec<BatchItem>,
    config: &BatchConfig,
    executor: Exec,
    on_progress: Progress,
) -> Vec<BatchResult>
where
    Exec: Fn(BatchItem) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<String, LlmError>> + Send + 'static,
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    let total = items.len();
    let executor = Arc::new(executor);
    let on_progress = Arc::new(on_progress);
    // 0 має сенс лише як "усе в один чанк"/"без обмеження конкурентності" —
    // не як "нічого не робити", тому підлога 1.
    let chunk_size = config.chunk_size.max(1);
    let concurrency = config.concurrency.max(1);
    let completed = Arc::new(AtomicUsize::new(0));

    let mut results = Vec::with_capacity(total);
    for chunk in items.chunks(chunk_size) {
        let chunk_ids: Vec<String> = chunk.iter().map(|item| item.custom_id.clone()).collect();
        let semaphore = Arc::new(Semaphore::new(concurrency));
        let mut set = JoinSet::new();

        for item in chunk.iter().cloned() {
            let sem = Arc::clone(&semaphore);
            let exec = Arc::clone(&executor);
            let progress = Arc::clone(&on_progress);
            let completed = Arc::clone(&completed);
            set.spawn(async move {
                let _permit = sem
                    .acquire_owned()
                    .await
                    .expect("семафор чанку закривається лише разом із задачею");
                let custom_id = item.custom_id.clone();
                let outcome = exec(item).await.map_err(|e| e.to_string());
                let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                progress(BatchProgress {
                    completed: done,
                    total,
                });
                BatchResult { custom_id, outcome }
            });
        }

        let mut chunk_results: Vec<BatchResult> = Vec::with_capacity(chunk.len());
        while let Some(joined) = set.join_next().await {
            if let Ok(result) = joined {
                chunk_results.push(result);
            }
            // `Err` тут — паніка задачі-виконавця (не помилка Result
            // самого виклику), а не мережева/провайдерна помилка. Такий
            // item лишається непокритим і добирається нижче за
            // `custom_id`, щоб не втратити ні порядок, ні повноту.
        }
        for id in &chunk_ids {
            if !chunk_results.iter().any(|r| &r.custom_id == id) {
                let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                on_progress(BatchProgress {
                    completed: done,
                    total,
                });
                chunk_results.push(BatchResult {
                    custom_id: id.clone(),
                    outcome: Err("виконання item перервалось (паніка виконавця)".to_string()),
                });
            }
        }
        // Конкурентне виконання завершує items не в порядку `chunk_ids` —
        // відновлюємо вихідний порядок перед тим, як додати в загальний
        // результат.
        chunk_results.sort_by_key(|r| chunk_ids.iter().position(|id| id == &r.custom_id));
        results.extend(chunk_results);
    }
    results
}

/// Провайдер, для якого сьогодні розгорнутий справжній `/v1/batches`
/// litellm-adapter (спека `2026-07-27-batch-local-avg-real-batches.md`,
/// рішення Б: тир-правило «litellm-провайдер ⇒ справжній batch»). Єдине
/// місце цього рядка — розширення на інший провайдер зі своїм Batch API
/// міняє лише цю константу, не виклик-сайти.
const REMOTE_BATCH_PROVIDER: &str = "litellm";

/// Вибір бекенда для [`dispatch`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// Клієнтська емуляція (Тип 2a, чанкований прогін) — без мережевої capability-проби.
    Emulated,
    /// Справжній `/v1/batches` — без capability-проби (явний вибір
    /// викликача, помилка мережі повертається як є), для БУДЬ-ЯКОГО
    /// провайдера, зареєстрованого в `local_providers` (не лише
    /// [`REMOTE_BATCH_PROVIDER`] — той обмежує тільки `Auto`). Провайдер, не
    /// зареєстрований узагалі (немає `base_url`/`api_key`), гейтується так
    /// само, як і `Auto` без проби — падає на емуляцію, а не хибу: явний
    /// вибір бекенда описує лише, ЯКИЙ backend бажаний, не гарантує його
    /// застосовність без потрібного конфігу.
    OpenAiBatches,
    /// Дефолт: емуляція для будь-якого провайдера, крім
    /// [`REMOTE_BATCH_PROVIDER`]; для нього — кешована capability-проба
    /// ([`crate::remote_batch::probe_cached`]), і лише за позитивного
    /// результату — справжній Batch API.
    Auto,
}

/// Диспетчер Типу 2b: резолвить `model_spec_or_tier` через
/// [`LocalCloud::resolve_spec`], визначає провайдер і — за `backend` —
/// виконує batch або через [`submit`] (емуляція, executor —
/// [`LocalCloud::one_shot_with_spec`] на резолвлений spec), або через
/// [`crate::remote_batch::submit`] (справжній `/v1/batches`, лише bare
/// model-id без provider-префікса — той самий, що адаптер очікує в тілі
/// `chat/completions`).
///
/// # Errors
/// [`LlmError::NoModelConfigured`]/[`LlmError::InvalidModelSpec`] з
/// [`LocalCloud::resolve_spec`]/парсингу spec-у; [`LlmError::Provider`] з
/// обраного бекенда (мережа, невалідна відповідь адаптера).
#[allow(clippy::too_many_arguments)]
pub async fn dispatch<Progress>(
    cascade: &LocalCloud,
    model_spec_or_tier: &str,
    items: Vec<BatchItem>,
    backend: Backend,
    emulated_config: &BatchConfig,
    remote_config: &RemoteBatchConfig,
    global_system: Option<String>,
    on_progress: Progress,
) -> Result<Vec<BatchResult>, LlmError>
where
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    let spec = cascade.resolve_spec(model_spec_or_tier)?;
    let (provider, _) = parse_model_spec(&spec).map_err(LlmError::InvalidModelSpec)?;

    let remote_provider_config = cascade.provider_config(provider).filter(|_| {
        matches!(backend, Backend::OpenAiBatches)
            || (backend == Backend::Auto && provider == REMOTE_BATCH_PROVIDER)
    });

    let use_remote = match (backend, remote_provider_config) {
        (Backend::Emulated, _) => false,
        (_, None) => false,
        (Backend::OpenAiBatches, Some(_)) => true,
        (Backend::Auto, Some(config)) => {
            remote_batch::probe_cached(&config.base_url, config.api_key.as_deref()).await
        }
    };

    if use_remote {
        let config = remote_provider_config.expect("перевірено вище (use_remote=true)");
        let (_, model_name) = parse_model_spec(&spec).map_err(LlmError::InvalidModelSpec)?;
        return remote_batch::submit(
            &config.base_url,
            config.api_key.as_deref(),
            model_name,
            items,
            remote_config,
            on_progress,
        )
        .await;
    }

    let cascade = cascade.clone();
    let spec = Arc::new(spec);
    let executor = move |item: BatchItem| {
        let cascade = cascade.clone();
        let spec = Arc::clone(&spec);
        let system = item.system.clone().or_else(|| global_system.clone());
        async move {
            cascade
                .one_shot_with_spec(&spec, system.as_deref(), &item.prompt)
                .await
        }
    };
    Ok(submit(items, emulated_config, executor, on_progress).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::time::Duration;

    fn item(id: &str) -> BatchItem {
        BatchItem {
            custom_id: id.to_string(),
            prompt: format!("prompt-{id}"),
            system: None,
        }
    }

    /// Фейковий виконавець без мережі — echo `custom_id` (доводить, що
    /// `submit` дійшов до саме цього item, а не якогось іншого).
    async fn echo_executor(item: BatchItem) -> Result<String, LlmError> {
        Ok(item.custom_id)
    }

    fn no_progress(_: BatchProgress) {}

    #[tokio::test]
    async fn chunking_splits_items_and_preserves_order_and_completeness() {
        let items: Vec<BatchItem> = (0..37).map(|i| item(&format!("id-{i}"))).collect();
        let config = BatchConfig {
            chunk_size: 5,
            concurrency: 3,
        };

        let results = submit(items.clone(), &config, echo_executor, no_progress).await;

        assert_eq!(results.len(), items.len());
        let expected_ids: Vec<&str> = items.iter().map(|i| i.custom_id.as_str()).collect();
        let actual_ids: Vec<&str> = results.iter().map(|r| r.custom_id.as_str()).collect();
        assert_eq!(
            actual_ids, expected_ids,
            "порядок результатів має збігатися з порядком items"
        );
        for result in &results {
            assert_eq!(result.outcome.as_deref(), Ok(result.custom_id.as_str()));
        }
    }

    #[tokio::test]
    async fn single_chunk_when_chunk_size_covers_all_items() {
        let items: Vec<BatchItem> = (0..10).map(|i| item(&format!("id-{i}"))).collect();
        let config = BatchConfig {
            chunk_size: 100,
            concurrency: 4,
        };
        let results = submit(items, &config, echo_executor, no_progress).await;
        assert_eq!(results.len(), 10);
    }

    #[tokio::test]
    async fn empty_batch_returns_empty_results() {
        let results = submit(
            Vec::new(),
            &BatchConfig::default(),
            echo_executor,
            no_progress,
        )
        .await;
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn concurrency_is_bounded_within_a_chunk() {
        let items: Vec<BatchItem> = (0..12).map(|i| item(&format!("id-{i}"))).collect();
        let config = BatchConfig {
            chunk_size: 12,
            concurrency: 3,
        };

        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));

        let in_flight_for_exec = Arc::clone(&in_flight);
        let max_for_exec = Arc::clone(&max_in_flight);
        let executor = move |item: BatchItem| {
            let in_flight = Arc::clone(&in_flight_for_exec);
            let max_in_flight = Arc::clone(&max_for_exec);
            async move {
                let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                max_in_flight.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                in_flight.fetch_sub(1, Ordering::SeqCst);
                Ok(item.custom_id)
            }
        };

        let results = submit(items, &config, executor, no_progress).await;
        assert_eq!(results.len(), 12);
        assert!(
            max_in_flight.load(Ordering::SeqCst) <= 3,
            "конкурентність мала бути обмежена concurrency=3, отримано {}",
            max_in_flight.load(Ordering::SeqCst)
        );
        assert!(
            max_in_flight.load(Ordering::SeqCst) >= 2,
            "занадто послідовно як на concurrency=3 — тест не перевіряє паралелізм"
        );
    }

    #[tokio::test]
    async fn one_failing_item_does_not_fail_the_rest_of_the_batch() {
        let items: Vec<BatchItem> = (0..6).map(|i| item(&format!("id-{i}"))).collect();
        let config = BatchConfig {
            chunk_size: 6,
            concurrency: 2,
        };
        let executor = |item: BatchItem| async move {
            if item.custom_id == "id-3" {
                Err(LlmError::Provider("штучна помилка item-3".to_string()))
            } else {
                Ok(item.custom_id)
            }
        };

        let results = submit(items, &config, executor, no_progress).await;
        assert_eq!(results.len(), 6);
        for result in &results {
            if result.custom_id == "id-3" {
                assert!(
                    result.outcome.is_err(),
                    "id-3 має бути помічений як помилковий"
                );
                assert!(result
                    .outcome
                    .as_ref()
                    .unwrap_err()
                    .contains("штучна помилка item-3"));
            } else {
                assert_eq!(result.outcome.as_deref(), Ok(result.custom_id.as_str()));
            }
        }
    }

    #[tokio::test]
    async fn one_failing_chunk_does_not_prevent_other_chunks_from_running() {
        // Чанк 0 (items 0..5): усі падають. Чанк 1 (items 5..10): усі ок.
        let items: Vec<BatchItem> = (0..10).map(|i| item(&format!("id-{i}"))).collect();
        let config = BatchConfig {
            chunk_size: 5,
            concurrency: 5,
        };
        let executor = |item: BatchItem| async move {
            let idx: usize = item.custom_id.strip_prefix("id-").unwrap().parse().unwrap();
            if idx < 5 {
                Err(LlmError::Provider(format!(
                    "чанк 0 падає: {}",
                    item.custom_id
                )))
            } else {
                Ok(item.custom_id)
            }
        };

        let results = submit(items, &config, executor, no_progress).await;
        assert_eq!(results.len(), 10);
        let (failed, ok): (Vec<_>, Vec<_>) = results.iter().partition(|r| r.outcome.is_err());
        assert_eq!(failed.len(), 5, "перший чанк мав дати 5 помилок");
        assert_eq!(
            ok.len(),
            5,
            "другий чанк мав пройти успішно попри падіння першого"
        );
    }

    #[tokio::test]
    async fn progress_reports_monotonically_up_to_total() {
        let items: Vec<BatchItem> = (0..9).map(|i| item(&format!("id-{i}"))).collect();
        let config = BatchConfig {
            chunk_size: 4,
            concurrency: 2,
        };
        let seen: Arc<Mutex<Vec<BatchProgress>>> = Arc::new(Mutex::new(Vec::new()));
        let seen_for_cb = Arc::clone(&seen);
        let on_progress = move |p: BatchProgress| {
            seen_for_cb.lock().unwrap().push(p);
        };

        let results = submit(items, &config, echo_executor, on_progress).await;
        assert_eq!(results.len(), 9);

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 9, "по одному progress-виклику на кожен item");
        for p in seen.iter() {
            assert_eq!(p.total, 9);
        }
        let completions: Vec<usize> = seen.iter().map(|p| p.completed).collect();
        let mut sorted = completions.clone();
        sorted.sort_unstable();
        assert_eq!(
            sorted,
            (1..=9).collect::<Vec<_>>(),
            "completed має покрити 1..=total без пропусків/дублів"
        );
    }

    #[tokio::test]
    async fn zero_chunk_size_and_concurrency_are_clamped_to_one() {
        let items: Vec<BatchItem> = (0..3).map(|i| item(&format!("id-{i}"))).collect();
        let config = BatchConfig {
            chunk_size: 0,
            concurrency: 0,
        };
        let results = submit(items, &config, echo_executor, no_progress).await;
        assert_eq!(results.len(), 3);
    }

    fn provider(base_url: &str) -> crate::local_cloud::LocalProvider {
        crate::local_cloud::LocalProvider {
            base_url: base_url.to_string(),
            api_key: None,
        }
    }

    /// Порожній набір items не спричиняє жодного мережевого виклику в жодному
    /// шляху ([`submit`] і [`crate::remote_batch::submit`] обидва
    /// short-circuit-ять на `is_empty`) — безпечно перевіряти сам вибір
    /// бекенда без піднімання мок-сервера.
    #[tokio::test]
    async fn dispatch_never_probes_for_non_remote_provider() {
        let mut providers = std::collections::HashMap::new();
        // Порт 1 — привілейований, гарантовано нічого не слухає; якби Auto
        // помилково пробував "omlx" (не REMOTE_BATCH_PROVIDER), проба
        // зависла б чи провалилась замість тихого short-circuit на 0 items.
        providers.insert("omlx".to_string(), provider("http://127.0.0.1:1/v1/"));
        let cascade = LocalCloud::new(providers);

        let results = dispatch(
            &cascade,
            "omlx/some-model",
            Vec::new(),
            Backend::Auto,
            &BatchConfig::default(),
            &RemoteBatchConfig::default(),
            None,
            no_progress,
        )
        .await
        .expect("порожній batch не має провалюватись");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn dispatch_auto_falls_back_to_emulation_when_litellm_probe_fails() {
        let mut providers = std::collections::HashMap::new();
        // Порт узятий і відразу звільнений — жоден слухач не піднятий, тож
        // capability-проба гарантовано провалюється (адаптер "недоступний").
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);
        providers.insert(
            "litellm".to_string(),
            provider(&format!("http://{addr}/v1/")),
        );
        let cascade = LocalCloud::new(providers);

        let results = dispatch(
            &cascade,
            "litellm/gemma-4-26b-awq",
            Vec::new(),
            Backend::Auto,
            &BatchConfig::default(),
            &RemoteBatchConfig::default(),
            None,
            no_progress,
        )
        .await
        .expect("недоступний адаптер має тихо впасти на емуляцію, не на помилку");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn dispatch_emulated_ignores_litellm_provider() {
        let mut providers = std::collections::HashMap::new();
        providers.insert("litellm".to_string(), provider("http://127.0.0.1:1/v1/"));
        let cascade = LocalCloud::new(providers);

        // Backend::Emulated форсує емуляцію навіть для litellm — з 0 items
        // це доводиться відсутністю HTTP-виклику (інакше проба чи HTTP до
        // непіднятого порту 1 провалили б виклик мережевою помилкою).
        let results = dispatch(
            &cascade,
            "litellm/gemma-4-26b-awq",
            Vec::new(),
            Backend::Emulated,
            &BatchConfig::default(),
            &RemoteBatchConfig::default(),
            None,
            no_progress,
        )
        .await
        .expect("Backend::Emulated з 0 items не має бити в мережу");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn dispatch_unregistered_provider_falls_back_to_emulation_even_for_explicit_backend() {
        let cascade = LocalCloud::new(std::collections::HashMap::new());

        let results = dispatch(
            &cascade,
            "litellm/gemma-4-26b-awq",
            Vec::new(),
            Backend::OpenAiBatches,
            &BatchConfig::default(),
            &RemoteBatchConfig::default(),
            None,
            no_progress,
        )
        .await
        .expect("незареєстрований провайдер не має падати навіть за явного backend");
        assert!(results.is_empty());
    }
}
