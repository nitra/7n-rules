//! `lint_progress` — точний порт обчислювального ядра
//! `npm/scripts/lib/lint-surface/progress.mjs` (клас A, крок 4 плану
//! `docs/plans/2026-08-31-full-rust-migration-plan.md`, §2.141 реєстру,
//! портовано разом із [`crate` … `lint-lock`] через
//! [`render_progress_line`] — міжпроцесний контракт: черга `lint --full`
//! (`crates/rules-cli/src/lint_full_lock.rs`) читає чужий `progress.json` і
//! малює його ЦИМ САМИМ форматером).
//!
//! # Що НЕ портовано і чому
//!
//! Візуальний TTY-бар (`cli-progress` `MultiBar`, `createProgressReporter`
//! у JS) — presentation-шар над терміналом, живий лише всередині JS
//! fix-конвеєра (`run-fix.mjs`/`run-detectors.mjs`), якого цей крок не
//! чіпає (native `lint`-шлях — `--no-fix`, detect-only, без TTY-бара
//! навіть у JS: `lint_cmd.rs` документує це як свідому розбіжність).
//! Портовано рівно обчислювальне ядро, спільне для ОБОХ споживачів
//! формату — рядок-рендерер і чиста семантика лічильників
//! «found не бреше вниз» ([`ProgressCounters`]) — те, що дійсно є
//! міжпроцесним контрактом і піддається byte-порівнянню з JS-тестами
//! (`progress.test.mjs`).

use std::collections::BTreeMap;

/// Ширина смуги бара в символах — порт `BAR_WIDTH` (`progress.mjs:19`).
const BAR_WIDTH: usize = 20;

/// Деталізація поточного concern-а (наприклад, granular Kubescape-прогрес
/// усередині одного файлу) — порт inline-типу `detail` (`progress.mjs:25`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProgressDetail {
    pub label: String,
    pub done: u64,
    pub total: u64,
    pub current: String,
}

/// Знімок прогресу — вхід [`render_progress_line`], той самий набір полів,
/// що `snap` у JS (`progress.mjs:25`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProgressSnapshot {
    pub done: u64,
    pub total: u64,
    pub found: u64,
    pub fixed: u64,
    pub current: String,
    /// `unitLabel` — типово `"концернів"` (`renderProgressLine`, JS
    /// `??`-дефолт).
    #[serde(rename = "unitLabel", default = "default_unit_label")]
    pub unit_label: String,
    /// `withFixed` — типово `true` (JS `?? true`).
    #[serde(rename = "withFixed", default = "default_with_fixed")]
    pub with_fixed: bool,
    pub detail: Option<ProgressDetail>,
}

fn default_unit_label() -> String {
    "концернів".to_string()
}

fn default_with_fixed() -> bool {
    true
}

impl ProgressSnapshot {
    /// Конструктор із дефолтами `unitLabel`/`withFixed`, щоб виклики не
    /// повторювали ці два поля на кожному місці — прямий еквівалент JS
    /// `??`-дефолтів усередині `renderProgressLine`.
    pub fn new(done: u64, total: u64, found: u64, fixed: u64, current: impl Into<String>) -> Self {
        Self {
            done,
            total,
            found,
            fixed,
            current: current.into(),
            unit_label: default_unit_label(),
            with_fixed: true,
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: ProgressDetail) -> Self {
        self.detail = Some(detail);
        self
    }
}

/// Рендерить один рядок прогресу — точний порт `renderProgressLine`
/// (`progress.mjs:28-38`). Формат — міжпроцесний контракт: цей самий
/// рядок читає та малює черга `lint --full` для ЧУЖОГО прогону
/// (`lint_full_lock::render_wait_line`).
pub fn render_progress_line(snap: &ProgressSnapshot) -> String {
    let progress = if snap.total > 0 {
        (snap.done as f64 / snap.total as f64).min(1.0)
    } else {
        0.0
    };
    let filled = (progress * BAR_WIDTH as f64).round() as usize;
    let filled = filled.min(BAR_WIDTH);
    let bar: String = "█".repeat(filled) + &"░".repeat(BAR_WIDTH - filled);
    let ticker = if snap.with_fixed {
        format!(" · знайдено {} · виправлено {}", snap.found, snap.fixed)
    } else {
        String::new()
    };
    let sub = match &snap.detail {
        Some(d) => format!(" · {} {}/{} · {}", d.label, d.done, d.total, d.current),
        None => String::new(),
    };
    format!(
        "[{bar}] {}/{} {}{ticker} · {}{sub}",
        snap.done, snap.total, snap.unit_label, snap.current
    )
}

/// Пер-ключ стан лічильників — порт `stateFor`-запису (`progress.mjs:104-111`).
#[derive(Debug, Default, Clone, Copy)]
struct KeyState {
    found: u64,
    remaining: u64,
}

/// Чиста семантика лічильників `found`/`fixed` (spec 2026-07-03):
/// «found не бреше вниз» — точний порт стану, який у JS тримає
/// `createProgressReporter` (`counters`-Map, `stateFor`, `tally`,
/// `detectSnapshot`, `concernDone`, `summary`), БЕЗ TTY-бара і `log`
/// (див. доккомент модуля).
#[derive(Debug, Default)]
pub struct ProgressCounters {
    counters: BTreeMap<String, KeyState>,
    done: u64,
    total: u64,
}

impl ProgressCounters {
    pub fn new(total: u64) -> Self {
        Self { counters: BTreeMap::new(), done: 0, total }
    }

    fn state_for(&mut self, key: &str) -> &mut KeyState {
        self.counters.entry(key.to_string()).or_default()
    }

    /// Знімок detect/re-detect — точний порт `detectSnapshot`
    /// (`progress.mjs:171-179`): `found` росте, коли re-detect показав
    /// більше, ніж (remaining + вже зафіксовані виправлення) —
    /// маскування/standalone-T0 НЕ ховається зменшенням лічильника.
    pub fn detect_snapshot(&mut self, key: &str, count: u64) {
        let s = self.state_for(key);
        let fixed_prev = s.found.saturating_sub(s.remaining);
        s.found = s.found.max(count + fixed_prev);
        s.remaining = count;
    }

    /// Одиницю оброблено — точний порт `concernDone` (без TTY-виводу):
    /// `done` +1, ключ матеріалізується навіть без жодного `detectSnapshot`
    /// (порожній концерн), щоб [`Self::summary`] лишався повним.
    pub fn concern_done(&mut self, key: &str) {
        self.done += 1;
        self.state_for(key);
    }

    /// Агрегує тикер по всіх ключах — точний порт `tally`
    /// (`progress.mjs:117-125`).
    fn tally(&self) -> (u64, u64) {
        let mut found = 0;
        let mut fixed = 0;
        for s in self.counters.values() {
            found += s.found;
            fixed += s.found.saturating_sub(s.remaining);
        }
        (found, fixed)
    }

    /// Поточні лічильники — точний порт `summary`.
    pub fn summary(&self) -> (u64, u64, u64, u64) {
        let (found, fixed) = self.tally();
        (self.done, self.total, found, fixed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(done: u64, total: u64, found: u64, fixed: u64, current: &str) -> ProgressSnapshot {
        ProgressSnapshot::new(done, total, found, fixed, current)
    }

    /// Порожній бар при total=0 — `progress/BAR_WIDTH` не ділить на нуль.
    #[test]
    fn empty_bar_when_total_zero() {
        let line = render_progress_line(&snap(0, 0, 0, 0, "…"));
        assert!(line.starts_with("[░░░░░░░░░░░░░░░░░░░░] 0/0"));
    }

    /// Повний бар при done>=total.
    #[test]
    fn full_bar_when_done_equals_total() {
        let line = render_progress_line(&snap(5, 5, 1, 1, "js/eslint"));
        assert!(line.starts_with("[████████████████████] 5/5"));
    }

    /// Точний рядок з тикером — те саме, що очікує `renderWaitLine`-тест
    /// JS-сторони (`lint-lock.test.mjs`): `5/12 концернів · знайдено 47 ·
    /// виправлено 32 · js/eslint`.
    #[test]
    fn matches_js_fixture_line() {
        let line = render_progress_line(&snap(5, 12, 47, 32, "js/eslint"));
        assert!(line.contains("5/12 концернів · знайдено 47 · виправлено 32 · js/eslint"), "{line}");
    }

    /// `withFixed:false` ховає тикер — порт `withFixed:false` (doc-files/detect-only).
    #[test]
    fn hides_ticker_when_with_fixed_false() {
        let mut s = snap(1, 1, 0, 0, "f1");
        s.with_fixed = false;
        s.unit_label = "файлів".to_string();
        let line = render_progress_line(&s);
        assert!(line.contains("1/1 файлів"), "{line}");
        assert!(!line.contains("виправлено"), "{line}");
    }

    /// Деталізація (granular Kubescape-прогрес) додається як `sub`-хвіст.
    #[test]
    fn detail_appends_sub_line() {
        let s = snap(5, 12, 0, 0, "k8s/manifest").with_detail(ProgressDetail {
            label: "kubescape".into(),
            done: 47,
            total: 133,
            current: "jobs/foo/k8s/tr".into(),
        });
        let line = render_progress_line(&s);
        assert!(line.contains("kubescape 47/133"), "{line}");
        assert!(line.contains("jobs/foo/k8s/tr"), "{line}");
    }

    /// Простий шлях: знайшли 10, виправили всі — порт першого JS-тесту.
    #[test]
    fn simple_find_then_fix_all() {
        let mut c = ProgressCounters::new(1);
        c.detect_snapshot("a", 10);
        assert_eq!(c.summary(), (0, 1, 10, 0));
        c.detect_snapshot("a", 0);
        assert_eq!(c.summary(), (0, 1, 10, 10));
    }

    /// Часткове виправлення: fixed = found - remaining.
    #[test]
    fn partial_fix() {
        let mut c = ProgressCounters::new(1);
        c.detect_snapshot("a", 10);
        c.detect_snapshot("a", 4);
        assert_eq!(c.summary(), (0, 1, 10, 6));
    }

    /// Маскування: re-detect більший за очікуваний → found росте, fixed не падає.
    #[test]
    fn masking_grows_found_without_dropping_fixed() {
        let mut c = ProgressCounters::new(1);
        c.detect_snapshot("a", 10);
        c.detect_snapshot("a", 4);
        c.detect_snapshot("a", 7);
        assert_eq!(c.summary(), (0, 1, 13, 6));
        c.detect_snapshot("a", 0);
        assert_eq!(c.summary(), (0, 1, 13, 13));
    }

    /// standalone-концерн: перший знімок після apply — found росте з нуля.
    #[test]
    fn standalone_concern_starts_from_zero() {
        let mut c = ProgressCounters::new(1);
        c.detect_snapshot("s", 3);
        assert_eq!(c.summary(), (0, 1, 3, 0));
        c.detect_snapshot("s", 0);
        assert_eq!(c.summary(), (0, 1, 3, 3));
    }

    /// Агрегація по кількох концернах.
    #[test]
    fn aggregates_across_keys() {
        let mut c = ProgressCounters::new(3);
        c.detect_snapshot("a", 5);
        c.detect_snapshot("b", 2);
        c.detect_snapshot("a", 0);
        assert_eq!(c.summary(), (0, 3, 7, 5));
    }

    /// `concern_done` інкрементує `done`; порожній концерн без знімків не ламає тикер.
    #[test]
    fn concern_done_increments_done_and_tolerates_empty_concern() {
        let mut c = ProgressCounters::new(2);
        c.concern_done("clean");
        c.detect_snapshot("dirty", 1);
        c.detect_snapshot("dirty", 0);
        c.concern_done("dirty");
        assert_eq!(c.summary(), (2, 2, 1, 1));
    }
}
