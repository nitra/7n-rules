//! Адаптивний пул одночасних one-shot ACP-сесій — двигун batch-емуляції
//! (§3.6, рішення И спеки `docs/specs/2026-08-08-llm-lib-acp-only-rust-goose.md`):
//! коли в користувача немає нативного OpenAI-сумісного Batch API
//! ([`crate::remote_batch`]), batch-фасад емулює його пулом паралельних
//! one-shot ACP-викликів (`cursor`/`codex`/`pi`, чи майбутній `goose`-kind)
//! до вже залогіненого підпискою CLI-агента.
//!
//! # Адаптивна конкурентність (рішення И)
//!
//! Пул стартує з малої конкурентності ([`PoolConfig::start_concurrency`],
//! типово `1`) і піднімає рівень на `+1` після кожних
//! [`PoolConfig::ramp_up_after_successes`] поспіль успішних завершень **на
//! поточному рівні**, аж до [`PoolConfig::max_concurrency`] (верхній кеп —
//! страховка per-kind до першого backoff-сигналу: підписочні CLI мають
//! ставити нижче значення, ніж локальні/goose-моделі — сам пул жодного
//! kind-у не знає, кеп підбирає викликач). Помилка, класифікована як
//! rate-limit ([`PoolConfig::is_rate_limited`] — дефолтна евристика шукає
//! `429`/`rate limit`/`quota` в тексті [`LlmError::Provider`], бо
//! ACP-протокол — stdio JSON-RPC, не HTTP, і структурованого коду помилки
//! не несе), знижує рівень на `1` (не нижче `1`) і скидає лічильник
//! послідовних успіхів. Опційно ([`PoolConfig::latency_degradation_factor`])
//! пул також **заморожує** ramp-up (не підвищує рівень, але явно й не
//! знижує — те робить лише rate-limit-сигнал), якщо латентність завершення
//! перевищує базову (перший успіх на поточному рівні) у вказану кількість
//! разів.
//!
//! # Порядок і часткові невдачі
//!
//! [`run`] повертає `Vec<Result<String, LlmError>>` **рівно в порядку
//! вхідних `items`**, незалежно від порядку фактичного завершення — кожен
//! результат кладеться за позиційним індексом, не за порядком completion
//! (чинний контракт batch-шляху, на який покладаються споживачі —
//! `crate::batch`/`batch.mjs`). Помилка одного item (після вичерпання
//! ретраїв) не зупиняє решту — той самий принцип, що й у виведеному
//! `crate::batch::submit` (задача T6).
//!
//! # Жодного вбудованого нескінченного retry
//!
//! [`PoolConfig::max_retries_per_item`] — явний і скінченний ліміт (дефолт
//! `1`, тобто одна повторна спроба); після вичерпання — `Err` для цього
//! item, решта batch-у триває (фейл-фаст філософія крейта, докшапка
//! `crate::lib`).
//!
//! # Ін'єкція виконавця (тестовність без спавну агента)
//!
//! [`run`] бере `runner: impl Fn(String) -> Fut` — продакшн підключає
//! реальний ACP-виклик тонкою обгорткою [`acp_runner`] (над
//! [`crate::acp::one_shot_acp_with_tier`]), юніт-тести підставляють фейкову
//! async-функцію без мережі й без спавну процесів.

use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinSet;
use tokio::time::Instant;

use super::AcpAgentKind;
use crate::tiers::Tier;
use crate::LlmError;

/// Тип стертого (boxed) `Future`, який повертає ін'єктований раннер —
/// потрібен лише для [`acp_runner`] (продакшн-обгортки), сам [`run`]
/// лишається дженериком і жодного бокса не вимагає від фейкових раннерів
/// у тестах.
type BoxedRunFuture = Pin<Box<dyn Future<Output = Result<String, LlmError>> + Send>>;

/// Конфіг адаптивного пулу (рішення И спеки, §3.6).
#[derive(Clone)]
pub struct PoolConfig {
    /// Стартова конкурентність `K` — рішення И рекомендує `1..=2`.
    pub start_concurrency: usize,
    /// Верхній кеп конкурентності — страховка до першого backoff-сигналу.
    /// Per-kind: підписочні CLI (`cursor`/`codex`/`pi`) — нижче значення,
    /// локальні/`goose`-моделі — вище; сам пул kind-у не знає, значення
    /// підбирає викликач (batch-фасад).
    pub max_concurrency: usize,
    /// Скільки поспіль успіхів **на поточному рівні** потрібно для
    /// ramp-up `+1`.
    pub ramp_up_after_successes: usize,
    /// Скільки додаткових спроб (крім першої) дозволено на один item —
    /// `0` = без ретраїв узагалі. Явний і скінченний ліміт (жодного
    /// вбудованого нескінченного retry).
    pub max_retries_per_item: usize,
    /// Пауза перед повторною спробою item-у — той самий фіксований backoff
    /// і для rate-limit, і для звичайної помилки (складнішу
    /// per-error-class політику ретраїв додає викликач через власний
    /// `runner`, пул навмисно простий).
    pub retry_backoff: Duration,
    /// Латентність вважається деградацією, якщо перевищує базову (перше
    /// успішне завершення на поточному рівні) у стільки разів — тоді
    /// ramp-up на цьому рівні заморожується (лічильник послідовних успіхів
    /// не зростає; рівень явно НЕ знижується — те робить лише
    /// rate-limit-сигнал). `None` — вимкнено (лише помилки керують рівнем).
    pub latency_degradation_factor: Option<f64>,
    /// Класифікатор "ця помилка — rate-limit/тимчасова відмова" (тригер
    /// backoff). Дефолт — [`default_is_rate_limited`]. Injectable для
    /// тестів і для точнішої класифікації конкретного kind-а/провайдера.
    pub is_rate_limited: Arc<dyn Fn(&LlmError) -> bool + Send + Sync>,
    /// Опційний колбек про зміну поточного рівня конкурентності (ramp-up
    /// `+1` чи backoff `-1`) — лише спостережність (метрики, тести); пул
    /// не залежить від нього для власної коректності.
    pub on_level_change: Option<Arc<dyn Fn(usize) + Send + Sync>>,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            start_concurrency: 1,
            max_concurrency: 4,
            ramp_up_after_successes: 3,
            max_retries_per_item: 1,
            retry_backoff: Duration::from_millis(500),
            latency_degradation_factor: None,
            is_rate_limited: Arc::new(default_is_rate_limited),
            on_level_change: None,
        }
    }
}

impl std::fmt::Debug for PoolConfig {
    /// Ручний `Debug` — `Arc<dyn Fn>`-поля не мають `Debug`, тож
    /// пропускаємо їх і позначаємо struct неповним.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PoolConfig")
            .field("start_concurrency", &self.start_concurrency)
            .field("max_concurrency", &self.max_concurrency)
            .field("ramp_up_after_successes", &self.ramp_up_after_successes)
            .field("max_retries_per_item", &self.max_retries_per_item)
            .field("retry_backoff", &self.retry_backoff)
            .field(
                "latency_degradation_factor",
                &self.latency_degradation_factor,
            )
            .finish_non_exhaustive()
    }
}

/// Дефолтна евристика "це rate-limit/тимчасова відмова": ACP-протокол
/// (stdio JSON-RPC) не несе структурованого коду помилки, тож дивимось на
/// типові текстові маркери в [`LlmError::Provider`] — той самий плоский
/// підхід, що й решта помилок крейта.
#[must_use]
pub fn default_is_rate_limited(err: &LlmError) -> bool {
    let LlmError::Provider(message) = err else {
        return false;
    };
    let lower = message.to_lowercase();
    [
        "429",
        "rate limit",
        "rate-limit",
        "too many requests",
        "quota",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

/// Один запланований item у внутрішній черзі пулу (позиційний `index` —
/// саме він, не порядок completion, визначає місце результату у
/// поверненому `Vec`).
struct QueueItem {
    index: usize,
    prompt: String,
    attempt: usize,
}

/// Подія з внутрішнього [`JoinSet`]: або завершена робоча спроба, або
/// "прокинувся" відкладений ретрай, готовий повернутись у чергу спавну.
enum Event {
    Completed {
        index: usize,
        prompt: String,
        attempt: usize,
        elapsed: Duration,
        outcome: Result<String, LlmError>,
    },
    RetryReady(QueueItem),
}

/// Оновлює/звіряє базову латентність поточного рівня; повертає `true`,
/// якщо `elapsed` перевищує базову у [`PoolConfig::latency_degradation_factor`]
/// разів. Перше успішне завершення на щойно встановленому рівні саме
/// встановлює базову лінію (і не вважається деградацією).
fn is_latency_degraded(
    config: &PoolConfig,
    baseline: &mut Option<Duration>,
    elapsed: Duration,
) -> bool {
    let Some(factor) = config.latency_degradation_factor else {
        return false;
    };
    match *baseline {
        None => {
            *baseline = Some(elapsed);
            false
        }
        Some(base) => elapsed.as_secs_f64() > base.as_secs_f64() * factor,
    }
}

/// Викликає [`PoolConfig::on_level_change`], якщо він заданий.
fn notify_level(config: &PoolConfig, level: usize) {
    if let Some(callback) = &config.on_level_change {
        callback(level);
    }
}

/// Ганяє `items` через адаптивний пул one-shot ACP-викликів.
///
/// `runner` — ін'єкція виконавця одного item-у (продакшн: [`acp_runner`]
/// над [`crate::acp::one_shot_acp_with_tier`]; тести: фейкова
/// async-функція без мережі й без спавну процесів). Паніка `runner`-а
/// всередині задачі не валить увесь `run` — item отримує явний `Err`,
/// решта батчу продовжується.
///
/// Порожній `items` повертає порожній `Vec` без жодного виклику `runner`.
pub async fn run<Runner, Fut>(
    items: Vec<String>,
    config: PoolConfig,
    runner: Runner,
) -> Vec<Result<String, LlmError>>
where
    Runner: Fn(String) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<String, LlmError>> + Send + 'static,
{
    let total = items.len();
    if total == 0 {
        return Vec::new();
    }

    let runner = Arc::new(runner);
    let mut results: Vec<Option<Result<String, LlmError>>> = (0..total).map(|_| None).collect();
    let mut queue: VecDeque<QueueItem> = items
        .into_iter()
        .enumerate()
        .map(|(index, prompt)| QueueItem {
            index,
            prompt,
            attempt: 0,
        })
        .collect();

    let max_level = config.max_concurrency.max(1);
    let mut level = config.start_concurrency.max(1).min(max_level);
    let mut consecutive_successes = 0usize;
    let mut level_baseline: Option<Duration> = None;
    let mut in_flight = 0usize;
    let mut pending_retries = 0usize;
    let mut tasks: JoinSet<Event> = JoinSet::new();

    notify_level(&config, level);

    loop {
        while in_flight < level {
            let Some(QueueItem {
                index,
                prompt,
                attempt,
            }) = queue.pop_front()
            else {
                break;
            };
            in_flight += 1;
            let runner = Arc::clone(&runner);
            tasks.spawn(async move {
                let started = Instant::now();
                let outcome = runner(prompt.clone()).await;
                Event::Completed {
                    index,
                    prompt,
                    attempt,
                    elapsed: started.elapsed(),
                    outcome,
                }
            });
        }

        if in_flight == 0 && pending_retries == 0 && queue.is_empty() {
            break;
        }

        let Some(joined) = tasks.join_next().await else {
            // JoinSet порожній, але наші лічильники кажуть, що щось ще в
            // роботі — розсинхрон неможливий за побудовою циклу, але
            // безпечніше завершити, ніж крутитись вічно.
            break;
        };

        match joined {
            Ok(Event::Completed {
                index,
                prompt,
                attempt,
                elapsed,
                outcome,
            }) => {
                in_flight -= 1;
                match outcome {
                    Ok(text) => {
                        results[index] = Some(Ok(text));
                        let degraded = is_latency_degraded(&config, &mut level_baseline, elapsed);
                        if !degraded {
                            consecutive_successes += 1;
                            if consecutive_successes >= config.ramp_up_after_successes.max(1)
                                && level < max_level
                            {
                                level += 1;
                                consecutive_successes = 0;
                                level_baseline = None;
                                notify_level(&config, level);
                            }
                        }
                    }
                    Err(err) => {
                        if (config.is_rate_limited)(&err) {
                            consecutive_successes = 0;
                            let lowered = level.saturating_sub(1).max(1);
                            if lowered != level {
                                level = lowered;
                                level_baseline = None;
                                notify_level(&config, level);
                            }
                        }
                        if attempt < config.max_retries_per_item {
                            pending_retries += 1;
                            let delay = config.retry_backoff;
                            tasks.spawn(async move {
                                tokio::time::sleep(delay).await;
                                Event::RetryReady(QueueItem {
                                    index,
                                    prompt,
                                    attempt: attempt + 1,
                                })
                            });
                        } else {
                            results[index] = Some(Err(err));
                        }
                    }
                }
            }
            Ok(Event::RetryReady(item)) => {
                pending_retries -= 1;
                queue.push_back(item);
            }
            Err(_join_err) => {
                // Паніка задачі-виконавця (delay-задача ретраю — лише
                // `tokio::time::sleep`, практично не панікує) — не валимо
                // весь пул. Лічильник in_flight звільняємо
                // best-effort; item без результату отримає явний `Err`
                // наприкінці (нижче, за залишковим `None`).
                in_flight = in_flight.saturating_sub(1);
            }
        }
    }

    results
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.unwrap_or_else(|| {
                Err(LlmError::Provider(format!(
                    "pool: item {index} не отримав результату (паніка виконавця)"
                )))
            })
        })
        .collect()
}

/// Тонка обгортка над [`crate::acp::one_shot_acp_with_tier`] — продакшн
/// runner для [`run`]: фіксує `agent`/`tier`/`cwd` на весь виклик пулу
/// (одна ACP-ціль на batch), приймає лише `prompt` (сигнатура, якої
/// очікує [`run`]).
///
/// ```no_run
/// # #[cfg(feature = "agents")]
/// # async fn example() {
/// use llm_lib::acp::{pool, AcpAgentKind};
/// use llm_lib::tiers::Tier;
///
/// let runner = pool::acp_runner(AcpAgentKind::Cursor, Tier::Min, "/tmp".into());
/// let _results = pool::run(vec!["привіт".to_string()], pool::PoolConfig::default(), runner).await;
/// # }
/// ```
pub fn acp_runner(
    agent: AcpAgentKind,
    tier: Tier,
    cwd: PathBuf,
) -> impl Fn(String) -> BoxedRunFuture + Send + Sync + 'static {
    move |prompt: String| {
        let cwd = cwd.clone();
        Box::pin(
            async move { crate::acp::one_shot_acp_with_tier(agent, tier, &prompt, &cwd).await },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    /// Фейковий раннер, injectable у [`run`] замість продакшн [`acp_runner`].
    type FakeRunner = Box<dyn Fn(String) -> BoxedRunFuture + Send + Sync>;
    /// Колбек [`PoolConfig::on_level_change`] — той самий тип, що й поле.
    type LevelCallback = Arc<dyn Fn(usize) + Send + Sync>;

    /// Фейковий раннер без мережі й без спавну процесів: рахує поточну й
    /// максимальну спостережену конкурентність, спить фіксовану
    /// (симульовану — під `start_paused`) тривалість, повертає `Ok` з
    /// ехо-текстом промпта.
    fn counting_ok_runner(delay: Duration) -> (FakeRunner, Arc<AtomicUsize>) {
        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));
        let max_for_return = Arc::clone(&max_in_flight);
        let runner = move |prompt: String| {
            let in_flight = Arc::clone(&in_flight);
            let max_in_flight = Arc::clone(&max_in_flight);
            let delay = delay;
            Box::pin(async move {
                let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                max_in_flight.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(delay).await;
                in_flight.fetch_sub(1, Ordering::SeqCst);
                Ok(prompt)
            }) as BoxedRunFuture
        };
        (Box::new(runner), max_for_return)
    }

    /// Колбек [`PoolConfig::on_level_change`], що логує кожен рівень у
    /// спільний `Vec` — дозволяє перевірити не лише кінцевий рівень, а й
    /// саму траєкторію ramp-up/backoff.
    fn level_log() -> (LevelCallback, Arc<Mutex<Vec<usize>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let log_for_cb = Arc::clone(&log);
        let callback: LevelCallback =
            Arc::new(move |level: usize| log_for_cb.lock().unwrap().push(level));
        (callback, log)
    }

    fn items(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("item-{i}")).collect()
    }

    #[tokio::test(start_paused = true)]
    async fn ramp_up_grows_concurrency_from_start_to_cap_without_errors() {
        let (runner, max_in_flight) = counting_ok_runner(Duration::from_millis(20));
        let (on_level_change, log) = level_log();
        let config = PoolConfig {
            start_concurrency: 1,
            max_concurrency: 6,
            ramp_up_after_successes: 1,
            max_retries_per_item: 0,
            on_level_change: Some(on_level_change),
            ..PoolConfig::default()
        };

        let results = run(items(40), config, runner).await;

        assert_eq!(results.len(), 40);
        assert!(
            results.iter().all(Result::is_ok),
            "без помилок усі item мають бути Ok"
        );
        assert_eq!(
            max_in_flight.load(Ordering::SeqCst),
            6,
            "за відсутності помилок пул мав дорости до кепа"
        );

        let observed_levels = log.lock().unwrap().clone();
        assert_eq!(
            observed_levels,
            vec![1, 2, 3, 4, 5, 6],
            "рівень має монотонно зростати від старту до кепа рівно по +1"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn cap_is_never_exceeded_even_with_fast_ramp_up() {
        let (runner, max_in_flight) = counting_ok_runner(Duration::from_millis(5));
        let config = PoolConfig {
            start_concurrency: 1,
            max_concurrency: 3,
            ramp_up_after_successes: 1,
            max_retries_per_item: 0,
            ..PoolConfig::default()
        };

        let results = run(items(60), config, runner).await;

        assert_eq!(results.len(), 60);
        assert!(results.iter().all(Result::is_ok));
        assert!(
            max_in_flight.load(Ordering::SeqCst) <= 3,
            "спостережена конкурентність {} перевищила кеп 3",
            max_in_flight.load(Ordering::SeqCst)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn rate_limit_errors_back_off_concurrency() {
        let rate_limited_range = 10..20usize;
        let rate_limited_range_for_runner = rate_limited_range.clone();
        let runner = move |prompt: String| {
            let rate_limited_range = rate_limited_range_for_runner.clone();
            Box::pin(async move {
                tokio::time::sleep(Duration::from_millis(10)).await;
                let index: usize = prompt
                    .strip_prefix("item-")
                    .and_then(|s| s.parse().ok())
                    .expect("тестові items мають формат item-<index>");
                if rate_limited_range.contains(&index) {
                    Err(LlmError::Provider(
                        "upstream: 429 too many requests".to_string(),
                    ))
                } else {
                    Ok(prompt)
                }
            }) as BoxedRunFuture
        };
        let (on_level_change, log) = level_log();
        let config = PoolConfig {
            start_concurrency: 1,
            max_concurrency: 8,
            ramp_up_after_successes: 1,
            max_retries_per_item: 0,
            on_level_change: Some(on_level_change),
            ..PoolConfig::default()
        };

        let results = run(items(40), config, runner).await;

        assert_eq!(results.len(), 40);
        for (index, result) in results.iter().enumerate() {
            if rate_limited_range.contains(&index) {
                assert!(result.is_err(), "item {index} мав бути rate-limited");
            } else {
                assert!(result.is_ok(), "item {index} мав пройти успішно");
            }
        }

        let observed_levels = log.lock().unwrap().clone();
        let peak = *observed_levels.iter().max().unwrap();
        assert!(
            peak > 1,
            "до rate-limit пул мав встигнути піднятись вище старту, лог: {observed_levels:?}"
        );
        let has_drop = observed_levels.windows(2).any(|w| w[1] < w[0]);
        assert!(
            has_drop,
            "rate-limit-помилки мали знизити рівень хоч раз, лог: {observed_levels:?}"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn result_order_matches_input_order_regardless_of_completion_order() {
        let total = 6usize;
        // Затримка обернено пропорційна індексу — item-0 завершується
        // останнім, item-(N-1) першим: completion-порядок навмисно
        // протилежний вхідному.
        let runner = move |prompt: String| {
            Box::pin(async move {
                let index: usize = prompt
                    .strip_prefix("item-")
                    .and_then(|s| s.parse().ok())
                    .expect("тестові items мають формат item-<index>");
                let delay = Duration::from_millis(((total - index) * 10) as u64);
                tokio::time::sleep(delay).await;
                Ok(format!("out-{prompt}"))
            }) as BoxedRunFuture
        };
        let config = PoolConfig {
            start_concurrency: total,
            max_concurrency: total,
            max_retries_per_item: 0,
            ..PoolConfig::default()
        };

        let results = run(items(total), config, runner).await;

        assert_eq!(results.len(), total);
        for (index, result) in results.into_iter().enumerate() {
            assert_eq!(
                result.expect("усі items у цьому тесті успішні"),
                format!("out-item-{index}"),
                "результат на позиції {index} має відповідати саме item-{index}, попри інший порядок completion"
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn one_failing_item_does_not_fail_the_rest_of_the_batch() {
        let runner = |prompt: String| {
            Box::pin(async move {
                if prompt == "item-3" {
                    Err(LlmError::Provider("штучна помилка item-3".to_string()))
                } else {
                    Ok(prompt)
                }
            }) as BoxedRunFuture
        };
        let config = PoolConfig {
            max_retries_per_item: 0,
            ..PoolConfig::default()
        };

        let results = run(items(6), config, runner).await;

        assert_eq!(results.len(), 6);
        for (index, result) in results.into_iter().enumerate() {
            if index == 3 {
                assert!(result.is_err(), "item-3 мав провалитись");
                assert_eq!(result.unwrap_err().to_string(), "штучна помилка item-3");
            } else {
                assert_eq!(
                    result.expect("решта items мають бути Ok"),
                    format!("item-{index}")
                );
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn exhausted_retries_yield_err_after_configured_attempts() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempts_for_runner = Arc::clone(&attempts);
        let runner = move |prompt: String| {
            let attempts = Arc::clone(&attempts_for_runner);
            Box::pin(async move {
                attempts.fetch_add(1, Ordering::SeqCst);
                Err(LlmError::Provider(format!("завжди падає: {prompt}")))
            }) as BoxedRunFuture
        };
        let config = PoolConfig {
            max_retries_per_item: 2,
            retry_backoff: Duration::from_millis(1),
            ..PoolConfig::default()
        };

        let results = run(items(1), config, runner).await;

        assert_eq!(results.len(), 1);
        assert!(results[0].is_err());
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            3,
            "1 початкова спроба + 2 ретраї = 3 виклики раннера"
        );
    }

    #[test]
    fn default_is_rate_limited_matches_common_markers_case_insensitively() {
        assert!(default_is_rate_limited(&LlmError::Provider(
            "HTTP 429: Too Many Requests".to_string()
        )));
        assert!(default_is_rate_limited(&LlmError::Provider(
            "Rate Limit exceeded, retry later".to_string()
        )));
        assert!(default_is_rate_limited(&LlmError::Provider(
            "monthly quota exceeded".to_string()
        )));
        assert!(!default_is_rate_limited(&LlmError::Provider(
            "connection refused".to_string()
        )));
        assert!(!default_is_rate_limited(&LlmError::InvalidModelSpec(
            "bogus".to_string()
        )));
    }
}
