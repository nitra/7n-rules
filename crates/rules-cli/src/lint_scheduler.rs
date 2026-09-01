//! Bounded two-lane concurrent scheduler — точний порт `runPlanConcurrently`
//! (`npm/scripts/lib/lint-surface/scheduler.mjs`, ADR 260716-1354), крок 4
//! плану `docs/plans/2026-08-31-full-rust-migration-plan.md` (клас A,
//! §2.141 реєстру).
//!
//! Активний лише коли `concurrency > 1` (JS: `run-detectors.mjs`); за
//! замовчуванням (`concurrency == 1`) `detectAll` лишається на повністю
//! послідовному шляху. Два лейни за `is_serial(item)`: **serial lane** —
//! власний sequential runner (items ніколи не перекриваються самі з
//! собою); **parallel lane** — bounded pool до `concurrency` слотів. Обидва
//! лейни виконуються КОНКУРЕНТНО один з одним (окремі OS-потоки замість
//! JS-івської «структурної конкурентності» одного event loop — доккомент
//! `scheduler.mjs:6-13` сам називає її ілюзорною для serial-лейну; тут
//! потоки реальні).
//!
//! Перший виняток від `run_item` зупиняє нові старти в обох лейнах,
//! [`AbortSignal::is_aborted`] сигналізує вже запущеним items, і функція
//! чекає завершення всіх уже стартованих items (кожен виклик сам ловить
//! власну помилку — жоден не панікує назовні) перед поверненням.
//!
//! # Що НЕ портовано і чому
//!
//! Живого Rust-споживача немає цим кроком: `lint_cmd.rs`'s native-шлях
//! завжди послідовний (`N_RULES_LINT_CONCURRENCY>1` — свідома розбіжність,
//! задокументована там-таки), той самий gap, що [`crate::lint_full_lock`]
//! (доккомент модуля).

#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

/// Сигнал скасування, який бачать уже запущені items — еквівалент
/// `AbortController.signal` (`scheduler.mjs:44`).
pub struct AbortSignal {
    aborted: AtomicBool,
}

impl AbortSignal {
    pub fn is_aborted(&self) -> bool {
        self.aborted.load(Ordering::SeqCst)
    }

    fn abort(&self) {
        self.aborted.store(true, Ordering::SeqCst);
    }
}

/// Помилка одного item-а — розрізняє «скасовано через чужу infra-помилку»
/// (`error.name === 'AbortError'`) від «сама infra-помилка».
pub enum RunItemError {
    /// Item сам кинув `AbortError` ПІСЛЯ того, як інший item зупинив
    /// прогін — очікуване скасування.
    Aborted,
    /// Будь-яка інша помилка — перша така зупиняє плановий прогін.
    Other(String),
}

/// Результат одного item-а, що реально стартував — точний порт
/// `PlanItemOutcome` (`scheduler.mjs:21-29`).
pub struct PlanItemOutcome<R> {
    pub index: usize,
    pub result: Option<R>,
    pub error: Option<String>,
    pub aborted: bool,
}

/// Результат усього прогону — точний порт повернення `runPlanConcurrently`.
pub struct RunPlanResult<R> {
    pub results: Vec<PlanItemOutcome<R>>,
    pub infra_error: Option<String>,
}

/// Планує `items` у два лейни (`is_serial`) і виконує `run_item` для
/// кожного — точний порт `runPlanConcurrently` (`scheduler.mjs:43-96`).
/// `results` — лише items, що реально стартували, у порядку ЗАВЕРШЕННЯ
/// (не вхідному); `infra_error` — перша не-abort помилка, або `None`.
pub fn run_plan_concurrently<T, R>(
    items: &[T],
    concurrency: usize,
    is_serial: impl Fn(&T) -> bool,
    run_item: impl Fn(&T, &AbortSignal) -> Result<R, RunItemError> + Sync,
) -> RunPlanResult<R>
where
    T: Sync,
    R: Send,
{
    let signal = AbortSignal { aborted: AtomicBool::new(false) };
    let stopped = AtomicBool::new(false);
    let infra_error: Mutex<Option<String>> = Mutex::new(None);
    let results: Mutex<Vec<PlanItemOutcome<R>>> = Mutex::new(Vec::new());
    let next = AtomicUsize::new(0);

    let mut serial_idx = Vec::new();
    let mut parallel_idx = Vec::new();
    for (i, item) in items.iter().enumerate() {
        if is_serial(item) {
            serial_idx.push(i);
        } else {
            parallel_idx.push(i);
        }
    }

    let run_one = |idx: usize| {
        if stopped.load(Ordering::SeqCst) {
            return;
        }
        match run_item(&items[idx], &signal) {
            Ok(result) => {
                results.lock().unwrap().push(PlanItemOutcome { index: idx, result: Some(result), error: None, aborted: false });
            }
            Err(RunItemError::Aborted) if stopped.load(Ordering::SeqCst) => {
                results.lock().unwrap().push(PlanItemOutcome { index: idx, result: None, error: None, aborted: true });
            }
            Err(err) => {
                let message = match err {
                    RunItemError::Aborted => "aborted".to_string(),
                    RunItemError::Other(message) => message,
                };
                results.lock().unwrap().push(PlanItemOutcome {
                    index: idx,
                    result: None,
                    error: Some(message.clone()),
                    aborted: false,
                });
                if stopped.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                    *infra_error.lock().unwrap() = Some(message);
                    signal.abort();
                }
            }
        }
    };

    std::thread::scope(|scope| {
        scope.spawn(|| {
            for &idx in &serial_idx {
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                run_one(idx);
            }
        });

        let worker_count = concurrency.min(parallel_idx.len());
        for _ in 0..worker_count {
            scope.spawn(|| loop {
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= parallel_idx.len() {
                    break;
                }
                run_one(parallel_idx[i]);
            });
        }
    });

    RunPlanResult { results: results.into_inner().unwrap(), infra_error: infra_error.into_inner().unwrap() }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicI64, AtomicUsize as StdAtomicUsize};
    use std::thread;
    use std::time::Duration;

    use super::*;

    fn tick(ms: u64) {
        thread::sleep(Duration::from_millis(ms));
    }

    /// parallel lane не перевищує concurrency одночасних workers.
    #[test]
    fn parallel_lane_respects_concurrency_bound() {
        let items: Vec<i64> = (0..8).collect();
        let active = AtomicI64::new(0);
        let max_active = AtomicI64::new(0);

        let out = run_plan_concurrently(&items, 3, |_| false, |item, _signal| {
            let cur = active.fetch_add(1, Ordering::SeqCst) + 1;
            max_active.fetch_max(cur, Ordering::SeqCst);
            tick(5);
            active.fetch_sub(1, Ordering::SeqCst);
            Ok::<i64, RunItemError>(item * 10)
        });

        assert!(out.infra_error.is_none());
        assert!(max_active.load(Ordering::SeqCst) <= 3);
        assert_eq!(out.results.len(), 8);
        let mut values: Vec<i64> = out.results.iter().filter_map(|r| r.result).collect();
        values.sort();
        assert_eq!(values, vec![0, 10, 20, 30, 40, 50, 60, 70]);
    }

    /// serial lane items ніколи не перекриваються самі з собою.
    #[test]
    fn serial_lane_never_overlaps() {
        let items: Vec<i64> = (0..5).collect();
        let active_serial = StdAtomicUsize::new(0);
        let overlapped = AtomicBool::new(false);

        let out = run_plan_concurrently(&items, 4, |_| true, |item, _signal| {
            let cur = active_serial.fetch_add(1, Ordering::SeqCst) + 1;
            if cur > 1 {
                overlapped.store(true, Ordering::SeqCst);
            }
            tick(5);
            active_serial.fetch_sub(1, Ordering::SeqCst);
            Ok::<i64, RunItemError>(*item)
        });

        assert!(out.infra_error.is_none());
        assert!(!overlapped.load(Ordering::SeqCst));
        assert_eq!(out.results.len(), 5);
    }

    /// serial і parallel лейни виконуються конкурентно один з одним:
    /// коротший parallel item стартує одночасно з довшим serial item і
    /// завершується РАНІШЕ.
    #[test]
    fn serial_and_parallel_lanes_run_concurrently() {
        let items = vec!["s1", "p1"];
        let order: Mutex<Vec<String>> = Mutex::new(Vec::new());

        let out = run_plan_concurrently(&items, 2, |item| *item == "s1", |item, _signal| {
            order.lock().unwrap().push(format!("{item}-start"));
            tick(if *item == "s1" { 40 } else { 5 });
            order.lock().unwrap().push(format!("{item}-end"));
            Ok::<(), RunItemError>(())
        });

        assert!(out.infra_error.is_none());
        let order = order.into_inner().unwrap();
        let p1_start = order.iter().position(|s| s == "p1-start").unwrap();
        let s1_end = order.iter().position(|s| s == "s1-end").unwrap();
        assert!(p1_start < s1_end, "{order:?}");
    }

    /// Перша помилка зупиняє нові старти в обох лейнах і чекає вже стартовані.
    #[test]
    fn first_error_stops_new_starts_and_awaits_started() {
        let items = vec!["ok-1", "boom", "ok-2", "ok-3", "ok-4"];
        let started: Mutex<Vec<&str>> = Mutex::new(Vec::new());
        let finished: Mutex<Vec<&str>> = Mutex::new(Vec::new());

        let out = run_plan_concurrently(&items, 2, |_| false, |item, _signal| {
            started.lock().unwrap().push(item);
            if *item == "boom" {
                tick(1);
                return Err(RunItemError::Other("infra crash".to_string()));
            }
            tick(30);
            finished.lock().unwrap().push(item);
            Ok::<&str, RunItemError>(item)
        });

        assert_eq!(out.infra_error.as_deref(), Some("infra crash"));
        let started_count = started.into_inner().unwrap().len();
        assert!(started_count < items.len());
        assert_eq!(out.results.len(), started_count);
        assert!(finished.into_inner().unwrap().contains(&"ok-1"));
    }

    /// `AbortSignal` доходить до вже запущеного item і позначається як
    /// очікуване скасування.
    #[test]
    fn abort_signal_reaches_running_item() {
        let items = vec!["slow", "boom"];
        let received_aborted = Mutex::new(false);

        let out = run_plan_concurrently(&items, 2, |_| false, |item, signal| -> Result<&str, RunItemError> {
            if *item == "boom" {
                tick(1);
                return Err(RunItemError::Other("infra crash".to_string()));
            }
            while !signal.is_aborted() {
                tick(1);
            }
            *received_aborted.lock().unwrap() = true;
            Err(RunItemError::Aborted)
        });

        assert_eq!(out.infra_error.as_deref(), Some("infra crash"));
        assert!(*received_aborted.lock().unwrap());
        let slow_outcome = out.results.iter().find(|r| items[r.index] == "slow").unwrap();
        assert!(slow_outcome.aborted);
        assert!(slow_outcome.error.is_none());
    }
}
