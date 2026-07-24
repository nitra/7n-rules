//! Тип 2b (OpenAI-сумісний API, batch) — **лише емуляція** у v1 (рішення Р
//! спеки `2026-07-23-llm-cascade-single-source-spec.md`): чанкований
//! конкурентний прогін через [`crate::local_cloud`] (Тип 2a) під тим самим
//! інтерфейсом `submit → progress → results`, яким користувалися б і зі
//! справжнім OpenAI Batch API (`/v1/batches`, v2) — перший споживач (локальний
//! omlx) його не має. Той самий інтерфейс незалежно від того, хто батчить:
//! сервер (v2) чи клієнт (v1, тут).
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
}
