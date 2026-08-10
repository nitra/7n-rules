//! Драбина спроб (рунги) — послідовність тирів, таймаути, класифікація помилок, кеп avg.
//!
//! Частина детермінованого harness-а навколо циклу `fix` (спека
//! `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7 — оркестрація поза LLM).
//! Rust-порт `npm/scripts/lib/lint-surface/ladder.mjs` (разом з фрагментом
//! `resolveFixLadderModels` з `run-fix.mjs`, який тут і належить — резолв
//! моделей rung-ів невіддільний від їхньої побудови).
//!
//! Чиста логіка вибору й обліку: жодних мережевих викликів, жодного запуску
//! агента. Цей модуль лише віддає сходинки ladder-а (рунги) і рішення «що
//! робити після провалу», а виконує їх оркестратор (інший шар harness-а).

use std::env;

use crate::tiers::{is_local_model, resolve_model_from, ModelEnv};

// ── Per-tier дефолти таймаутів — ADR 260620-0556 (fail-fast escalation) ────────
//
// Локальний 4b-рунг об'єктивно не закінчить важкий промпт за хвилини (curl 28),
// хмарний SSE без таймауту здатен висіти годинами на ESTABLISHED TCP — драбина
// має рухатись далі.
//
// Override без зміни коду — env `N_LOCAL_FIX_TIMEOUT_MS` / `N_CLOUD_FIX_TIMEOUT_MS`
// / `N_CLOUD_AVG_FIX_TIMEOUT_MS`: мілісекунди на ОДИН рунг відповідного класу
// (local-min/local-min-retry, cloud-min, cloud-avg). Невалідне значення
// (не число/від'ємне/0/порожньо) → дефолт.
//
// cloud-avg має ОКРЕМИЙ (більший за cloud-min) дефолт: реальний прогін
// (2026-07-18, /ai run/yoga2, chainId 6f6b4fdca71aa0c5) показав, що cloud-avg
// регулярно доводить concern до 1 залишкового порушення в межах спільного з
// cloud-min бюджету, але verify (canonical re-detect) не встигає підтвердитись —
// і весь прогрес відкочується, бо після cloud-avg немає наступної сходинки для
// повторної спроби. cloud-avg — останній шанс ladder-а (і під DEFAULT_MAX_AVG-кепом),
// тож дорожчий за нього бюджет виправдано менш економний, ніж cloud-min.
const LOCAL_TIMEOUT_MS_DEFAULT: u64 = 45_000;
const CLOUD_TIMEOUT_MS_DEFAULT: u64 = 120_000;
const CLOUD_AVG_TIMEOUT_MS_DEFAULT: u64 = 180_000;

/// Дефолтний кеп на виклики cloud-avg за прогін (щоб ladder на N concern-ів не спалив avg).
pub const DEFAULT_MAX_AVG: u32 = 3;

/// Читає таймаут рунга з env: валідне додатне ціле в мс, інакше `default_ms`.
/// Живий (per-call) read, без module-level кешування — той самий підхід, що й
/// решта `tiers.rs` (env-змінна в межах процесу практично не змінюється в
/// production, а в тестах live-read навіть точніший за кеш).
///
/// Дрібне зумисне спрощення проти JS (`Number(env.X) || default`, де falsy —
/// лише NaN/0/''): тут будь-яке не-додатне чи нечислове значення (зокрема
/// від'ємне, яке JS формально прийняв би) теж падає на дефолт — таймаут у мс
/// апріорі не буває від'ємним.
fn env_timeout_ms(name: &str, default_ms: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&ms| ms > 0)
        .unwrap_or(default_ms)
}

/// Назва сходинки ladder-а — фіксований порядок ескалації.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RungTier {
    /// Перша спроба слабкою локальною моделлю — фідбек відсутній.
    LocalMin,
    /// Друга спроба ТІЄЮ Ж локальною моделлю, вже з фідбеком попереднього провалу.
    LocalMinRetry,
    /// Мінімальна хмарна модель.
    CloudMin,
    /// Середня хмарна модель — останній шанс ladder-а (під `DEFAULT_MAX_AVG`-кепом).
    CloudAvg,
}

impl RungTier {
    /// Рядкова назва тиру — та сама, що `Rung.tier` у JS (`'local-min'` тощо),
    /// для телеметрії/логів harness-а.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            RungTier::LocalMin => "local-min",
            RungTier::LocalMinRetry => "local-min-retry",
            RungTier::CloudMin => "cloud-min",
            RungTier::CloudAvg => "cloud-avg",
        }
    }
}

impl std::fmt::Display for RungTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Дискретний рівень міркування моделі для рунга — Rust-порт
/// `thinkingLevelForTier` (`model-tiers.mjs`), звужений до чотирьох тирів
/// production ladder-а (`cloud-max` — experiment-only тир, поза ladder-ом,
/// тож тут не представлений).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThinkingLevel {
    /// local-min, local-min-retry — слабка локальна модель.
    Low,
    /// cloud-min.
    Medium,
    /// cloud-avg.
    High,
}

/// Мапить тир рунга на рівень міркування: local → low, cloud-min → medium,
/// cloud-avg → high.
#[must_use]
pub fn thinking_level_for_tier(tier: RungTier) -> ThinkingLevel {
    match tier {
        RungTier::LocalMin | RungTier::LocalMinRetry => ThinkingLevel::Low,
        RungTier::CloudMin => ThinkingLevel::Medium,
        RungTier::CloudAvg => ThinkingLevel::High,
    }
}

/// Одна сходинка ladder-а: тир, модель, чи передавати фідбек попереднього
/// провалу, чи локальна, чи під avg-кепом, і персональний таймаут виклику.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rung {
    /// Назва тиру сходинки.
    pub tier: RungTier,
    /// Ідентифікатор моделі (`"provider/model-id"`) для цього рунга.
    pub model: String,
    /// Використати фідбек попереднього рунга.
    pub feedback: bool,
    /// Чи це локальний (не cloud) рунг.
    pub local: bool,
    /// Чи списує цей рунг avg-бюджет.
    pub is_avg: bool,
    /// Таймаут виклику рунга в мілісекундах.
    pub timeout_ms: u64,
}

impl Rung {
    /// Рівень міркування цього рунга ({@link thinking_level_for_tier}).
    #[must_use]
    pub fn thinking_level(&self) -> ThinkingLevel {
        thinking_level_for_tier(self.tier)
    }
}

/// Резолвлені моделі під три сходинки ladder-а (порожній рядок = модель не
/// резолвилась — відповідний рунг/рунги відсіються у {@link build_ladder}).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LadderModels {
    /// Модель для `local-min`/`local-min-retry`.
    pub local_min: String,
    /// Модель для `cloud-min`.
    pub cloud_min: String,
    /// Модель для `cloud-avg`.
    pub cloud_avg: String,
}

/// Резолвить моделі центральної fix-ladder через policy-каскад
/// `tiers::resolve_model_from` — Rust-порт `resolveFixLadderModels`
/// (`run-fix.mjs`). Належить цьому модулю: резолв моделей ladder-а невіддільний
/// від побудови самого ladder-а.
///
/// Локальна сходинка існує лише коли старт від `ModelEnv::LocalMin` справді
/// дав локальну модель: cloud fallback (коли жодна локальна не задана і
/// каскад доїхав до хмарної) не повинен маркуватися як local і обходити
/// звуження `skip_local_tier` у {@link crate::fix::run_fix} (оркестратор).
/// Хмарні сходинки стартують зі своїх меж policy ladder-а.
///
/// `cloud_avg`, що резолвився в ту саму модель, що й `cloud_min`, вважається
/// відсутнім: той самий cloud-виклик не повторюємо на наступній сходинці;
/// local-retry лишається в {@link build_ladder}, де він має окрему семантику
/// (той самий model, але з фідбеком).
#[must_use]
pub fn resolve_ladder_models() -> LadderModels {
    let preferred = resolve_model_from(ModelEnv::LocalMin).unwrap_or_default();
    let local_min = if is_local_model(&preferred) {
        preferred
    } else {
        String::new()
    };
    let cloud_min = resolve_model_from(ModelEnv::CloudMin).unwrap_or_default();
    let cloud_avg_raw = resolve_model_from(ModelEnv::CloudAvg).unwrap_or_default();
    let cloud_avg = if cloud_avg_raw == cloud_min {
        String::new()
    } else {
        cloud_avg_raw
    };
    LadderModels {
        local_min,
        cloud_min,
        cloud_avg,
    }
}

/// Будує ladder за наявними моделями; рунги з порожнім `model` відсіюються
/// (порожня модель = рунга немає) — Rust-порт `buildLadder` (`ladder.mjs`).
#[must_use]
pub fn build_ladder(models: &LadderModels) -> Vec<Rung> {
    let local_timeout_ms = env_timeout_ms("N_LOCAL_FIX_TIMEOUT_MS", LOCAL_TIMEOUT_MS_DEFAULT);
    let cloud_timeout_ms = env_timeout_ms("N_CLOUD_FIX_TIMEOUT_MS", CLOUD_TIMEOUT_MS_DEFAULT);
    let cloud_avg_timeout_ms =
        env_timeout_ms("N_CLOUD_AVG_FIX_TIMEOUT_MS", CLOUD_AVG_TIMEOUT_MS_DEFAULT);

    [
        Rung {
            tier: RungTier::LocalMin,
            model: models.local_min.clone(),
            feedback: false,
            local: true,
            is_avg: false,
            timeout_ms: local_timeout_ms,
        },
        Rung {
            tier: RungTier::LocalMinRetry,
            model: models.local_min.clone(),
            feedback: true,
            local: true,
            is_avg: false,
            timeout_ms: local_timeout_ms,
        },
        Rung {
            tier: RungTier::CloudMin,
            model: models.cloud_min.clone(),
            feedback: true,
            local: false,
            is_avg: false,
            timeout_ms: cloud_timeout_ms,
        },
        Rung {
            tier: RungTier::CloudAvg,
            model: models.cloud_avg.clone(),
            feedback: true,
            local: false,
            is_avg: true,
            timeout_ms: cloud_avg_timeout_ms,
        },
    ]
    .into_iter()
    .filter(|rung| !rung.model.is_empty())
    .collect()
}

/// Звужує ladder під конкретний concern — Rust-порт `selectLadder` (`run-fix.mjs`):
/// `skip_local_tier` викидає обидва локальні рунги (`local-min`,
/// `local-min-retry`), `cloud_timeout_ms` перевизначає бюджет лише для
/// хмарної частини (локальні рунги лишаються з власним таймаутом). Concern-и, де local-min/
/// local-min-retry емпірично не встигають дати результат у межах свого
/// бюджету, застосовують `skip_local_tier`; concern-и з важчим цільовим кодом
/// — `cloud_timeout_ms`.
#[must_use]
pub fn select_ladder(
    ladder: &[Rung],
    skip_local_tier: bool,
    cloud_timeout_ms: Option<u64>,
) -> Vec<Rung> {
    let narrowed: Vec<Rung> = if skip_local_tier {
        ladder.iter().filter(|rung| !rung.local).cloned().collect()
    } else {
        ladder.to_vec()
    };
    match cloud_timeout_ms {
        Some(timeout_ms) => narrowed
            .into_iter()
            .map(|rung| {
                if rung.local {
                    rung
                } else {
                    Rung { timeout_ms, ..rung }
                }
            })
            .collect(),
        None => narrowed,
    }
}

// ── Класифікація помилок ────────────────────────────────────────────────────

/// Категорія помилки worker-а рунга.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixErrorClass {
    /// Повтор тієї ж моделі марний (нема git, fail-closed guard, відсутня
    /// модель, auth) — дія: обрив ladder-а (cloud) / пропуск моделі (local).
    Systemic,
    /// Реальний транспортний збій провайдера (мережа/сокет) — дія: обрив
    /// ladder-а на хмарному рунгу, продовження на локальному.
    Transport,
    /// Усе інше (зокрема агентний backstop-timeout) — дія: рух далі по ladder-у.
    Quality,
}

/// Патерни systemic-помилок (substring, порівняння в нижньому регістрі) —
/// точний список фраз з `SYSTEMIC_RE` (`ladder.mjs`). Порівнюємо
/// substring-ами замість regex-крейта: цей крейт (`llm-lib`) не має `regex`
/// серед залежностей (`Cargo.toml`), а самі патерни — прості фразові
/// альтернативи без спецсимволів, тож substring-match — точний еквівалент.
const SYSTEMIC_PATTERNS: &[&str] = &[
    "не git-репо",
    "fail-closed",
    "write-guard",
    "модель не знайдена",
    "registry:",
    "session:",
    "немає ключа",
    "api key",
];

/// Патерни реального транспортного збою (не агентний backstop-timeout) —
/// точний список фраз з `TRANSPORT_RE` (`ladder.mjs`).
// cspell:ignore econnrefused
const TRANSPORT_PATTERNS: &[&str] = &[
    "etimedout",
    "timed out",
    "econnrefused",
    "connection refused",
];

/// Префікс агентного backstop-timeout worker-а (`FIX_TIMEOUT_RE` — `/^fix timeout /i`
/// у джерелі). Перевіряється ПЕРШИМ, до systemic/transport: інакше повідомлення
/// "fix timeout … ETIMEDOUT" класифікувалося б як transport і обірвало ladder
/// замість ескалації.
const FIX_TIMEOUT_PREFIX: &str = "fix timeout ";

/// Класифікує помилку worker-а: systemic | transport | quality.
///
/// КРИТИЧНО: агентний backstop-timeout (`"fix timeout …"`) класифікується як
/// `Quality`, а НЕ `Transport` — навмисно, щоб таймаут локальної моделі
/// спричиняв ескалацію у хмару (рух ladder-ом далі), а не обривав його як
/// справжній мережевий збій. Джерело: `FIX_TIMEOUT_RE`-коментар `ladder.mjs`.
#[must_use]
pub fn classify_fix_error(error: Option<&str>) -> Option<FixErrorClass> {
    let error = error.filter(|e| !e.is_empty())?;
    let lower = error.to_lowercase();
    if lower.starts_with(FIX_TIMEOUT_PREFIX) {
        return Some(FixErrorClass::Quality);
    }
    if SYSTEMIC_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
    {
        return Some(FixErrorClass::Systemic);
    }
    if TRANSPORT_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
    {
        return Some(FixErrorClass::Transport);
    }
    Some(FixErrorClass::Quality)
}

/// Рішення ladder-а після провалу рунга: обірвати драбину / пропустити цю
/// модель на решті ladder-а / `None` — продовжити звичайним рухом далі.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LadderAction {
    /// Обірвати ladder — далі не пробувати жоден наступний рунг.
    Break,
    /// Пропустити цю модель на решті ladder-а (інші рунги з тим самим `model`
    /// не викликаються), але сам ladder не обривається.
    SkipModel,
}

/// Рішення після провального рунга — Rust-порт `decideAfterFailure` (`ladder.mjs`):
/// - `Systemic` на локальному рунгу → `SkipModel` (та сама локальна модель
///   марна вдруге, але хмарні рунги ще варто спробувати);
/// - `Systemic` на хмарному рунгу → `Break` (auth/registry-збій не лікується
///   рухом по ladder-у);
/// - `Transport` на хмарному рунгу → `Break` (мережевий збій провайдера);
/// - `Transport` на локальному рунгу і `Quality` (будь-де) → `None`, ladder
///   рухається далі звичайним порядком.
#[must_use]
pub fn decide_after_failure(rung: &Rung, error: Option<&str>) -> Option<LadderAction> {
    let kind = classify_fix_error(error)?;
    match kind {
        FixErrorClass::Systemic => Some(if rung.local {
            LadderAction::SkipModel
        } else {
            LadderAction::Break
        }),
        FixErrorClass::Transport if !rung.local => Some(LadderAction::Break),
        _ => None,
    }
}

// ── Кеп avg ──────────────────────────────────────────────────────────────────

/// Явний облік спільного avg-бюджету одного прогону (не глобальна змінна):
/// оркестратор створює один екземпляр на прогін і передає його (чи `&mut`
/// посилання) у кожен concern — Rust-порт пари `avgRemaining`/`spendAvg`
/// closures з `run-fix.mjs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AvgBudget {
    remaining: u32,
}

impl AvgBudget {
    /// Новий бюджет з `max` доступними cloud-avg викликами на прогін.
    #[must_use]
    pub fn new(max: u32) -> Self {
        Self { remaining: max }
    }

    /// Скільки avg-викликів лишилось (0 — рунг `cloud-avg` пропускається).
    #[must_use]
    pub fn remaining(&self) -> u32 {
        self.remaining
    }

    /// Чи вичерпано бюджет (немає жодного avg-виклику в запасі).
    #[must_use]
    pub fn is_exhausted(&self) -> bool {
        self.remaining == 0
    }

    /// Списує `n` одиниць бюджету. Насичується на 0 (не панікує й не йде в
    /// underflow при списанні понад залишок).
    pub fn spend(&mut self, n: u32) {
        self.remaining = self.remaining.saturating_sub(n);
    }
}

impl Default for AvgBudget {
    /// Дефолтний бюджет — {@link DEFAULT_MAX_AVG}.
    fn default() -> Self {
        Self::new(DEFAULT_MAX_AVG)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tiers::test_env::{with_env, ENV_LOCK};

    /// Ladder-специфічні env-таймаути — не входять у `tiers::test_env::ALL_VARS`
    /// (той список — лише модельні/local-provider env-змінні), тож серіалізуються
    /// власним хелпером через той самий спільний м'ютекс (як приписано у
    /// задачі: усі env-тести цього крейта йдуть через один `ENV_LOCK`, щоб
    /// паралельний `cargo test` не ганявся за той самий процесний env).
    const TIMEOUT_VARS: &[&str] = &[
        "N_LOCAL_FIX_TIMEOUT_MS",
        "N_CLOUD_FIX_TIMEOUT_MS",
        "N_CLOUD_AVG_FIX_TIMEOUT_MS",
    ];

    /// Аналог `tiers::test_env::with_env`, але для `TIMEOUT_VARS`. НЕ викликати
    /// зсередини `with_env` (і навпаки) — обидва беруть той самий `ENV_LOCK`,
    /// а `std::sync::Mutex` не реентерабельний.
    fn with_timeout_env<T>(vars: &[(&str, &str)], f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap();
        for name in TIMEOUT_VARS {
            unsafe { env::remove_var(name) };
        }
        for (name, value) in vars {
            unsafe { env::set_var(name, value) };
        }
        let result = f();
        for name in TIMEOUT_VARS {
            unsafe { env::remove_var(name) };
        }
        result
    }

    fn models(local_min: &str, cloud_min: &str, cloud_avg: &str) -> LadderModels {
        LadderModels {
            local_min: local_min.to_string(),
            cloud_min: cloud_min.to_string(),
            cloud_avg: cloud_avg.to_string(),
        }
    }

    // ── build_ladder: таймаути (ADR 260620-0556) ──

    #[test]
    fn build_ladder_default_timeouts_without_env() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
            let timeouts: Vec<(&str, u64)> = ladder
                .iter()
                .map(|r| (r.tier.as_str(), r.timeout_ms))
                .collect();
            assert_eq!(
                timeouts,
                vec![
                    ("local-min", 45_000),
                    ("local-min-retry", 45_000),
                    ("cloud-min", 120_000),
                    ("cloud-avg", 180_000),
                ]
            );
        });
    }

    #[test]
    fn build_ladder_env_override_local_and_cloud_min_independent_of_cloud_avg() {
        with_timeout_env(
            &[
                ("N_LOCAL_FIX_TIMEOUT_MS", "1000"),
                ("N_CLOUD_FIX_TIMEOUT_MS", "2000"),
            ],
            || {
                let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
                assert_eq!(find_rung(&ladder, RungTier::LocalMin).timeout_ms, 1000);
                assert_eq!(find_rung(&ladder, RungTier::CloudMin).timeout_ms, 2000);
                assert_eq!(find_rung(&ladder, RungTier::CloudAvg).timeout_ms, 180_000);
            },
        );
    }

    #[test]
    fn build_ladder_env_override_cloud_avg_independent_of_cloud_min() {
        with_timeout_env(
            &[
                ("N_CLOUD_FIX_TIMEOUT_MS", "2000"),
                ("N_CLOUD_AVG_FIX_TIMEOUT_MS", "3000"),
            ],
            || {
                let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
                assert_eq!(find_rung(&ladder, RungTier::CloudMin).timeout_ms, 2000);
                assert_eq!(find_rung(&ladder, RungTier::CloudAvg).timeout_ms, 3000);
            },
        );
    }

    #[test]
    fn build_ladder_invalid_timeout_env_falls_back_to_default() {
        with_timeout_env(
            &[
                ("N_LOCAL_FIX_TIMEOUT_MS", ""),
                ("N_CLOUD_FIX_TIMEOUT_MS", "not-a-number"),
                ("N_CLOUD_AVG_FIX_TIMEOUT_MS", "-500"),
            ],
            || {
                let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
                assert_eq!(find_rung(&ladder, RungTier::LocalMin).timeout_ms, 45_000);
                assert_eq!(find_rung(&ladder, RungTier::CloudMin).timeout_ms, 120_000);
                assert_eq!(find_rung(&ladder, RungTier::CloudAvg).timeout_ms, 180_000);
            },
        );
    }

    fn find_rung(ladder: &[Rung], tier: RungTier) -> &Rung {
        ladder
            .iter()
            .find(|r| r.tier == tier)
            .expect("rung присутній")
    }

    // ── build_ladder: склад драбини / відсів рунга без моделі ──

    #[test]
    fn build_ladder_full_composition_has_all_four_rungs_in_order() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
            assert_eq!(
                ladder.iter().map(|r| r.tier).collect::<Vec<_>>(),
                vec![
                    RungTier::LocalMin,
                    RungTier::LocalMinRetry,
                    RungTier::CloudMin,
                    RungTier::CloudAvg
                ]
            );
            let local_min = find_rung(&ladder, RungTier::LocalMin);
            assert!(!local_min.feedback);
            assert!(local_min.local);
            assert!(!local_min.is_avg);

            let retry = find_rung(&ladder, RungTier::LocalMinRetry);
            assert!(retry.feedback, "retry несе фідбек попереднього провалу");
            assert!(retry.local);
            assert_eq!(retry.model, local_min.model, "retry — та сама модель");

            let cloud_min = find_rung(&ladder, RungTier::CloudMin);
            assert!(cloud_min.feedback);
            assert!(!cloud_min.local);
            assert!(!cloud_min.is_avg);

            let cloud_avg = find_rung(&ladder, RungTier::CloudAvg);
            assert!(cloud_avg.feedback);
            assert!(!cloud_avg.local);
            assert!(cloud_avg.is_avg, "лише cloud-avg списує avg-бюджет");
        });
    }

    #[test]
    fn build_ladder_drops_rung_with_empty_model() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("", "c/min", ""));
            assert_eq!(
                ladder.iter().map(|r| r.tier).collect::<Vec<_>>(),
                vec![RungTier::CloudMin]
            );
        });
    }

    #[test]
    fn build_ladder_no_models_at_all_yields_empty_ladder() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("", "", ""));
            assert!(ladder.is_empty());
        });
    }

    // ── resolve_ladder_models: склад драбини за наявних/відсутніх env-моделей ──

    #[test]
    fn resolve_ladder_models_all_three_tiers_present() {
        with_env(
            &[
                ("N_LOCAL_MIN_MODEL", "omlx/local"),
                ("N_CLOUD_MIN_MODEL", "openai/mini"),
                ("N_CLOUD_AVG_MODEL", "openai/avg"),
            ],
            || {
                let resolved = resolve_ladder_models();
                assert_eq!(resolved.local_min, "omlx/local");
                assert_eq!(resolved.cloud_min, "openai/mini");
                assert_eq!(resolved.cloud_avg, "openai/avg");
            },
        );
    }

    #[test]
    fn resolve_ladder_models_cloud_only_env_has_no_local_rung() {
        // Без жодної N_LOCAL_*_MODEL каскад LocalMin доїжджає до cloud_min:
        // це cloud fallback, а не «локальна» модель — local_min лишається
        // порожнім, щоб не обходити skip_local_tier-звуження оркестратора.
        with_env(&[("N_CLOUD_MIN_MODEL", "openai/mini")], || {
            let resolved = resolve_ladder_models();
            assert_eq!(resolved.local_min, "");
            assert_eq!(resolved.cloud_min, "openai/mini");
        });
    }

    #[test]
    fn resolve_ladder_models_dedups_cloud_avg_equal_to_cloud_min() {
        with_env(&[("N_CLOUD_MIN_MODEL", "openai/mini")], || {
            // Без N_CLOUD_AVG_MODEL резолв ModelEnv::CloudAvg каскадить до
            // cloud_max (тут не заданий) → залишається порожнім, а не
            // дублює cloud_min: перевіряємо явний випадок дублю нижче.
            let resolved = resolve_ladder_models();
            assert_eq!(resolved.cloud_avg, "");
        });
        with_env(
            &[
                ("N_CLOUD_MIN_MODEL", "openai/mini"),
                ("N_CLOUD_AVG_MODEL", "openai/mini"),
            ],
            || {
                let resolved = resolve_ladder_models();
                assert_eq!(resolved.cloud_min, "openai/mini");
                assert_eq!(
                    resolved.cloud_avg, "",
                    "той самий cloud-виклик не повторюємо"
                );
            },
        );
    }

    #[test]
    fn resolve_ladder_models_no_env_yields_empty_ladder_via_build_ladder() {
        // `with_env` і `with_timeout_env` беруть ОДИН І ТОЙ САМИЙ `ENV_LOCK`,
        // а `std::sync::Mutex` не реентерабельний — вкладений виклик дає
        // взаємне блокування (тест висить назавжди, а не падає). Тому обидві частини
        // виконуються послідовно, без вкладення: `resolve_ladder_models`
        // читає env моделей під першим захопленням, `build_ladder` працює
        // з уже отриманими значеннями під другим.
        let resolved = with_env(&[], resolve_ladder_models);
        with_timeout_env(&[], || {
            assert!(build_ladder(&resolved).is_empty());
        });
    }

    // ── select_ladder: skip_local_tier / cloud_timeout_ms ──

    #[test]
    fn select_ladder_skip_local_tier_drops_both_local_rungs() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
            let narrowed = select_ladder(&ladder, true, None);
            assert_eq!(
                narrowed.iter().map(|r| r.tier).collect::<Vec<_>>(),
                vec![RungTier::CloudMin, RungTier::CloudAvg]
            );
        });
    }

    #[test]
    fn select_ladder_without_skip_keeps_all_rungs() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
            let narrowed = select_ladder(&ladder, false, None);
            assert_eq!(narrowed.len(), 4);
        });
    }

    #[test]
    fn select_ladder_cloud_timeout_ms_overrides_only_cloud_rungs() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
            let narrowed = select_ladder(&ladder, false, Some(9_000));
            assert_eq!(find_rung(&narrowed, RungTier::LocalMin).timeout_ms, 45_000);
            assert_eq!(
                find_rung(&narrowed, RungTier::LocalMinRetry).timeout_ms,
                45_000
            );
            assert_eq!(find_rung(&narrowed, RungTier::CloudMin).timeout_ms, 9_000);
            assert_eq!(find_rung(&narrowed, RungTier::CloudAvg).timeout_ms, 9_000);
        });
    }

    #[test]
    fn select_ladder_combines_skip_local_and_cloud_timeout() {
        with_timeout_env(&[], || {
            let ladder = build_ladder(&models("l/min", "c/min", "c/avg"));
            let narrowed = select_ladder(&ladder, true, Some(5_000));
            assert_eq!(
                narrowed.iter().map(|r| r.tier).collect::<Vec<_>>(),
                vec![RungTier::CloudMin, RungTier::CloudAvg]
            );
            assert!(narrowed.iter().all(|r| r.timeout_ms == 5_000));
        });
    }

    // ── classify_fix_error ──

    #[test]
    fn classify_fix_error_no_error_is_none() {
        assert_eq!(classify_fix_error(None), None);
        assert_eq!(classify_fix_error(Some("")), None);
    }

    #[test]
    fn classify_fix_error_systemic_examples() {
        for msg in [
            "не git-репо: nested worktree",
            "fail-closed: canonical detect не підтвердив",
            "write-guard: шлях поза target set",
            "модель не знайдена: omlx/ghost",
            "registry: 404",
            "session: expired",
            "немає ключа для openai",
            "missing API key",
        ] {
            assert_eq!(
                classify_fix_error(Some(msg)),
                Some(FixErrorClass::Systemic),
                "{msg}"
            );
        }
    }

    #[test]
    fn classify_fix_error_transport_examples() {
        for msg in [
            "connect ETIMEDOUT 10.0.0.1:443",
            "socket hang up: connection Timed Out",
            "connect ECONNREFUSED 127.0.0.1:11434",
            "Connection refused by upstream",
        ] {
            assert_eq!(
                classify_fix_error(Some(msg)),
                Some(FixErrorClass::Transport),
                "{msg}"
            );
        }
    }

    #[test]
    fn classify_fix_error_quality_default() {
        assert_eq!(
            classify_fix_error(Some("edit не пройшов anchored-verify")),
            Some(FixErrorClass::Quality)
        );
    }

    #[test]
    fn classify_fix_error_agent_backstop_timeout_is_quality_not_transport() {
        // КРИТИЧНО: агентний timeout ескалює ladder (quality), а не обриває
        // його як мережевий збій (transport) — навіть коли в тексті є "timeout".
        assert_eq!(
            classify_fix_error(Some("fix timeout 45000ms")),
            Some(FixErrorClass::Quality)
        );
        // Той самий backstop-timeout, у якого текст ще й містить справжню
        // transport-фразу (ETIMEDOUT) — префікс перевіряється ПЕРШИМ, тож і
        // тут quality, а не transport.
        assert_eq!(
            classify_fix_error(Some("fix timeout 45000ms (upstream ETIMEDOUT)")),
            Some(FixErrorClass::Quality)
        );
        // Межа префікса — рівно `^fix timeout ` З ПРОБІЛОМ (паритет із
        // `FIX_TIMEOUT_RE` у `ladder.mjs`): «fix timeout:» із двокрапкою під
        // неї НЕ підпадає, тож класифікується за загальними правилами — тут
        // transport через ETIMEDOUT. Це не недогляд порту, а дослівна
        // поведінка JS-джерела; тест фіксує саме межу.
        assert_eq!(
            classify_fix_error(Some("fix timeout: upstream ETIMEDOUT after 45000ms")),
            Some(FixErrorClass::Transport)
        );
    }

    // ── decide_after_failure ──

    fn rung(tier: RungTier, local: bool) -> Rung {
        Rung {
            tier,
            model: "x/y".to_string(),
            feedback: true,
            local,
            is_avg: false,
            timeout_ms: 1,
        }
    }

    #[test]
    fn decide_after_failure_no_error_continues() {
        assert_eq!(
            decide_after_failure(&rung(RungTier::CloudMin, false), None),
            None
        );
    }

    #[test]
    fn decide_after_failure_systemic_on_local_skips_model() {
        assert_eq!(
            decide_after_failure(&rung(RungTier::LocalMin, true), Some("fail-closed guard")),
            Some(LadderAction::SkipModel)
        );
    }

    #[test]
    fn decide_after_failure_systemic_on_cloud_breaks() {
        assert_eq!(
            decide_after_failure(&rung(RungTier::CloudMin, false), Some("немає ключа")),
            Some(LadderAction::Break)
        );
    }

    #[test]
    fn decide_after_failure_transport_on_cloud_breaks() {
        assert_eq!(
            decide_after_failure(&rung(RungTier::CloudMin, false), Some("connect ETIMEDOUT")),
            Some(LadderAction::Break)
        );
    }

    #[test]
    fn decide_after_failure_transport_on_local_continues() {
        assert_eq!(
            decide_after_failure(&rung(RungTier::LocalMin, true), Some("connect ETIMEDOUT")),
            None
        );
    }

    #[test]
    fn decide_after_failure_quality_continues_regardless_of_locality() {
        assert_eq!(
            decide_after_failure(&rung(RungTier::CloudMin, false), Some("edit rejected")),
            None
        );
        assert_eq!(
            decide_after_failure(&rung(RungTier::LocalMin, true), Some("edit rejected")),
            None
        );
    }

    #[test]
    fn decide_after_failure_cloud_agent_timeout_escalates_not_breaks() {
        // Пряме відображення сценарію з задачі: таймаут локальної моделі не
        // повинен обривати ladder — тут перевіряємо симетрично на cloud-рунгу
        // (де б transport-класифікація зламала б рух далі, якби не FIX_TIMEOUT_RE).
        let cloud_rung = rung(RungTier::CloudMin, false);
        assert_eq!(
            decide_after_failure(&cloud_rung, Some("fix timeout 120000ms")),
            None
        );
    }

    // ── AvgBudget ──

    #[test]
    fn avg_budget_default_is_default_max_avg() {
        let budget = AvgBudget::default();
        assert_eq!(budget.remaining(), DEFAULT_MAX_AVG);
        assert!(!budget.is_exhausted());
    }

    #[test]
    fn avg_budget_spend_decrements_and_exhausts() {
        let mut budget = AvgBudget::new(2);
        budget.spend(1);
        assert_eq!(budget.remaining(), 1);
        assert!(!budget.is_exhausted());
        budget.spend(1);
        assert_eq!(budget.remaining(), 0);
        assert!(budget.is_exhausted());
    }

    #[test]
    fn avg_budget_spend_saturates_at_zero() {
        let mut budget = AvgBudget::new(1);
        budget.spend(5);
        assert_eq!(budget.remaining(), 0);
        assert!(budget.is_exhausted());
    }

    // ── thinking_level_for_tier ──

    #[test]
    fn thinking_level_matches_model_tiers_mjs_mapping() {
        assert_eq!(
            thinking_level_for_tier(RungTier::LocalMin),
            ThinkingLevel::Low
        );
        assert_eq!(
            thinking_level_for_tier(RungTier::LocalMinRetry),
            ThinkingLevel::Low
        );
        assert_eq!(
            thinking_level_for_tier(RungTier::CloudMin),
            ThinkingLevel::Medium
        );
        assert_eq!(
            thinking_level_for_tier(RungTier::CloudAvg),
            ThinkingLevel::High
        );
    }

    #[test]
    fn rung_thinking_level_matches_helper() {
        let r = rung(RungTier::CloudAvg, false);
        assert_eq!(
            r.thinking_level(),
            thinking_level_for_tier(RungTier::CloudAvg)
        );
    }
}
