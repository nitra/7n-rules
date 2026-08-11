//! Петля оркестрації контуру `fix` — зшиває драбину, snapshot і veto.
//!
//! Rust-порт послідовності `run-fix.mjs` (спека
//! `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7 — детермінована
//! оркестрація поза LLM):
//!
//! ```text
//! detect → (чисто: нічого не робимо)
//!        → T0 (детерміновані фікси, PERMANENT, не відкочуються)
//!        → detect → (чисто: закрито без жодного виклику моделі)
//!        → S1
//!        → для кожної спроби: restore S1 → спроба → canonical re-detect
//!          → collateral-veto → успіх? commit : наступний рунг із фідбеком
//!        → драбина вичерпана: відкат до S1
//! ```
//!
//! # Що тут головне
//!
//! - **Успіх рунга — конʼюнкція трьох умов**: детектор чистий І немає помилки
//!   І немає veto. Заяви моделі не важать узагалі — джерело правди лише
//!   повторний прогін детектора.
//! - **Фідбек наступному рунгу формує harness, не модель** ([`describe_failure`]):
//!   текст залежить від причини відмови і містить конкретні шляхи та рядки.
//! - **Відкат гарантований навіть коли детектор кинув помилку** — його робить
//!   [`RungGuard`] на `Drop`, тож жоден шлях виходу (включно з раннім
//!   `return` і `?`) його не обходить.
//! - **T0-правки постійні**: S1 знімається ПІСЛЯ них.
//! - **Concern, який не фіксується кодом, у драбину не заходить** — fail-fast.
//! - **Кеп cloud-avg спільний на весь прогін**, а не на concern — тому
//!   [`AvgBudget`] приходить ззовні як `&mut`.
//!
//! # Межа модуля
//!
//! Сама спроба ([`AttemptFn`]) — інʼєкція, а не прямий виклик
//! [`super::runner::run_attempt`]: петля оркеструє, а НЕ знає, чим саме
//! виконується хід. Це і робить її детерміновано тестовною без мережі й
//! моделі, і лишає споживачу свободу підставити інший двигун.
//!
//! Так само детектор і T0 приходять ззовні: крейт не знає таксономії
//! concern-ів lint-поверхні.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use super::collateral::{
    find_collateral_edits, find_in_file_collateral_edits, realpath_best_effort, HUNK_WINDOW,
};
use super::ladder::{
    build_ladder, decide_after_failure, resolve_ladder_models, select_ladder, AvgBudget,
    LadderAction, Rung, RungTier,
};
use super::snapshot::{RungGuard, Snapshot};
use super::{BoxFuture, FixOutcome};

/// Одне порушення від детектора.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    /// Файл із порушенням (відносний до `cwd` або абсолютний).
    pub file: PathBuf,
    /// Рядок порушення, якщо детектор його дає — вікно hunk-veto рахується
    /// саме навколо нього.
    pub line: Option<usize>,
    /// Текст повідомлення детектора.
    pub message: String,
}

/// Чи взагалі має сенс пускати concern у драбину.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fixability {
    /// Порушення усувається правкою коду — драбина застосовна.
    Code,
    /// Конфігураційна чи структурна зміна: людське рішення, модель тут марна.
    ConfigOrStructural,
}

/// Чим завершився прогін concern-а.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PipelineOutcome {
    /// Перший же детектор чистий — роботи не було.
    CleanNoWork,
    /// Закрито детермінованим T0, без жодного виклику моделі.
    T0Closed,
    /// Закрито однією зі спроб драбини.
    Success,
    /// Драбина не запускалась: concern не фіксується кодом.
    SkippedNotFixable,
    /// Драбина вичерпана (або обірвана), порушення лишилось — дерево
    /// відкочене до S1.
    Failed,
}

/// Чому конкретний рунг не зарахований.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RungFailure {
    /// Спроба завершилась помилкою.
    Error(String),
    /// Порушення лишилось після спроби.
    StillFailing,
    /// Правки вийшли за межі дозволених файлів.
    CollateralFiles(Vec<PathBuf>),
    /// Правки вийшли за вікно рядків порушення.
    CollateralLines {
        file: PathBuf,
        from: usize,
        to: usize,
    },
    /// Спроба не змінила жодного файлу.
    NoEdits,
    /// Рунг пропущений, бо вичерпано спільний кеп cloud-avg.
    AvgCapExhausted,
}

/// Запис про одну спробу — для телеметрії й розбору польотів.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttemptRecord {
    /// Тир рунга.
    pub tier: RungTier,
    /// Модель рунга.
    pub model: String,
    /// Чи зарахований рунг.
    pub ok: bool,
    /// Скільки ходів моделі спожила спроба — разом із `tool_calls` це єдине,
    /// що пояснює вартість прогону й дозволяє тюнити стелю за даними, а не
    /// навпомацки.
    pub turns: usize,
    /// Скільки викликів інструментів зробила спроба.
    pub tool_calls: usize,
    /// Причина, якщо не зарахований.
    pub failure: Option<RungFailure>,
}

/// Підсумок прогону concern-а.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixReport {
    /// Чим завершилось.
    pub outcome: PipelineOutcome,
    /// Хто закрив: `"t0"` або `"<тир>:<модель>"`.
    pub resolved_by: Option<String>,
    /// Усі спроби по порядку.
    pub attempts: Vec<AttemptRecord>,
    /// Скільки разів відкочували дерево до S1.
    pub rollbacks: usize,
    /// Чи пропускали рунг через вичерпаний кеп cloud-avg.
    pub avg_cap_skipped: bool,
    /// Файли, які лишились зміненими (лише на успіху).
    pub touched_files: Vec<PathBuf>,
}

/// Хук «зараз торкнуся файлу»: виконавець МУСИТЬ викликати його ДО запису.
/// Інакше pre-image знімається вже з правленого вмісту, і collateral-veto
/// стає сліпим — саме цей дефект спіймав тест `collateral_outside_target_set…`.
/// У бойовому коді сюди підключається `WriteGuard::with_on_capture`, який
/// спрацьовує на перший дотик усередині сесії агента.
pub type CaptureFn = Arc<dyn Fn(PathBuf) + Send + Sync>;

/// Контекст однієї спроби, який петля передає виконавцю.
#[derive(Clone)]
pub struct AttemptContext {
    /// Сигнал «зараз торкнуся файлу» — обовʼязково ДО запису.
    pub capture: CaptureFn,
    /// Рунг, у межах якого йде спроба (тир, модель, таймаут).
    pub rung: Rung,
    /// Фідбек попереднього провалу — `None` на першому рунгу.
    pub feedback: Option<String>,
    /// Актуальні порушення на момент спроби.
    pub violations: Vec<Violation>,
}

/// Виконавець однієї спроби — інʼєкція (у бойовому коді обгортка над
/// [`super::runner::run_attempt`], у тестах — фейк без мережі).
pub type AttemptFn = Arc<dyn Fn(AttemptContext) -> BoxFuture<'static, FixOutcome> + Send + Sync>;

/// Канонічний детектор: джерело правди про успіх.
pub type DetectFn =
    Arc<dyn Fn() -> BoxFuture<'static, Result<Vec<Violation>, String>> + Send + Sync>;

/// Детермінований фікс до будь-якої моделі (T0).
pub type T0Fn = Arc<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>;

/// Інʼєкції петлі — усе, чого крейт не знає про lint-поверхню споживача.
#[derive(Clone)]
pub struct PipelineDeps {
    /// Повторний прогін детектора.
    pub detect: DetectFn,
    /// Детермінований фікс; `None` — концерн його не має.
    pub t0: Option<T0Fn>,
    /// Виконавець спроби.
    pub attempt: AttemptFn,
}

/// Налаштування прогону concern-а.
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Корінь роботи.
    pub cwd: PathBuf,
    /// Файли, які дозволено редагувати.
    pub target_files: Vec<PathBuf>,
    /// Чи фіксується concern правкою коду.
    pub fixability: Fixability,
    /// Драбина спроб — будується ззовні ([`resolve_default_ladder`] у
    /// бойовому коді). Петля свідомо НЕ читає env сама: інакше її поведінка
    /// залежала б від оточення процесу, а тести мусили б синхронізуватись на
    /// спільному env-мʼютексі поперек `await`-точок.
    pub ladder: Vec<Rung>,
}

/// Стандартна драбина з env-контракту `N_*_MODEL` — те, що бойовий споживач
/// кладе у [`PipelineConfig::ladder`].
#[must_use]
pub fn resolve_default_ladder(skip_local_tier: bool, cloud_timeout_ms: Option<u64>) -> Vec<Rung> {
    select_ladder(
        &build_ladder(&resolve_ladder_models()),
        skip_local_tier,
        cloud_timeout_ms,
    )
}

/// Формулює фідбек наступному рунгу — порт `describeVetoOutcome`
/// (`run-fix.mjs`). Текст навмисно конкретний: модель має бачити, ЩО саме
/// відхилено і які межі, інакше наступна спроба повторює ту саму помилку.
#[must_use]
pub fn describe_failure(failure: &RungFailure, target_files: &[PathBuf]) -> String {
    let targets = target_files
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    match failure {
        RungFailure::Error(err) => {
            format!("попередня спроба завершилась помилкою: {err}")
        }
        RungFailure::StillFailing => {
            "попередня спроба не закрила порушення — детектор і далі червоний".to_string()
        }
        RungFailure::CollateralFiles(files) => {
            let list = files
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "попередня спроба зачепила файли поза дозволеними ({list}) — усі правки \
                 відхилено. Редагуй ЛИШЕ: {targets}"
            )
        }
        RungFailure::CollateralLines { file, from, to } => {
            format!(
                "попередня спроба зачепила рядки поза ділянкою порушення ({}:{from}-{to}) — \
                 усі правки відхилено. Редагуй ЛИШЕ рядки самого порушення",
                file.display()
            )
        }
        RungFailure::NoEdits => {
            "попередня спроба не змінила жодного файлу — зміни потрібні".to_string()
        }
        RungFailure::AvgCapExhausted => {
            "рунг пропущено: вичерпано спільний бюджет найдорожчого тиру".to_string()
        }
    }
}

/// Перевіряє правки рунга на collateral: спершу cross-file (чужі наявні
/// файли), потім hunk-window у межах дозволених. Повертає `None`, якщо все
/// в межах ділянки порушення.
fn check_collateral(
    snapshot: &Snapshot,
    config: &PipelineConfig,
    violations: &[Violation],
) -> Option<RungFailure> {
    let modified = snapshot.modified_existing();
    let outside = find_collateral_edits(&modified, &config.target_files, &config.cwd);
    if !outside.is_empty() {
        return Some(RungFailure::CollateralFiles(outside));
    }

    for path in modified {
        let lines: Vec<usize> = violations
            .iter()
            .filter(|v| realpath_best_effort(&config.cwd.join(&v.file)) == path)
            .filter_map(|v| v.line)
            .collect();
        if lines.is_empty() {
            continue;
        }
        let current = std::fs::read_to_string(&path).ok();
        let range = find_in_file_collateral_edits(
            snapshot.pre_image_of(&path),
            current.as_deref(),
            &lines,
            HUNK_WINDOW,
        );
        if let Some(range) = range {
            return Some(RungFailure::CollateralLines {
                file: path,
                from: range.start,
                to: range.end,
            });
        }
    }
    None
}

/// Прогін одного concern-а: детектор → T0 → драбина → відкат.
///
/// `avg_budget` навмисно `&mut` ззовні: кеп найдорожчого тиру спільний на
/// весь прогін lint-поверхні, а не на окремий concern.
///
/// # Errors
/// Помилка детектора на першому ж виклику (до будь-яких правок) — повертаємо
/// її викликачу без спроб: якщо стан невідомий, лікувати нічого.
pub async fn run_fix(
    config: &PipelineConfig,
    deps: PipelineDeps,
    avg_budget: &mut AvgBudget,
) -> Result<FixReport, String> {
    let mut report = FixReport {
        outcome: PipelineOutcome::Failed,
        resolved_by: None,
        attempts: Vec::new(),
        rollbacks: 0,
        avg_cap_skipped: false,
        touched_files: Vec::new(),
    };

    // 1. Перший детект: чисто — роботи немає.
    let mut violations = (deps.detect)().await?;
    if violations.is_empty() {
        report.outcome = PipelineOutcome::CleanNoWork;
        return Ok(report);
    }

    // 2. T0 — детерміновані правки ПЕРЕД будь-якою моделлю і і не відкочуються.
    if let Some(t0) = &deps.t0 {
        t0().await;
        violations = (deps.detect)().await?;
        if violations.is_empty() {
            report.outcome = PipelineOutcome::T0Closed;
            report.resolved_by = Some("t0".to_string());
            return Ok(report);
        }
    }

    // 3. Gate придатності: те, що не фіксується кодом, у драбину не заходить.
    if config.fixability != Fixability::Code {
        report.outcome = PipelineOutcome::SkippedNotFixable;
        return Ok(report);
    }

    // 4. S1 — знімається ПІСЛЯ T0, тож детерміновані правки лишаються назавжди.
    let snapshot = Arc::new(Mutex::new(Snapshot::new()));
    {
        let mut snap = snapshot.lock().unwrap_or_else(PoisonError::into_inner);
        for file in &config.target_files {
            let abs = realpath_best_effort(&config.cwd.join(file));
            // Помилка читання не фатальна: файл міг бути видалений між
            // детектом і зняттям S1 — тоді його pre-image просто відсутній.
            let _ = snap.record(&abs);
        }
    }

    let mut feedback: Option<String> = None;
    let mut skipped_models: HashSet<String> = HashSet::new();

    for rung in config.ladder.clone() {
        if skipped_models.contains(&rung.model) {
            continue;
        }
        if rung.is_avg && avg_budget.is_exhausted() {
            report.avg_cap_skipped = true;
            report.attempts.push(AttemptRecord {
                tier: rung.tier,
                model: rung.model.clone(),
                ok: false,
                turns: 0,
                tool_calls: 0,
                failure: Some(RungFailure::AvgCapExhausted),
            });
            continue;
        }

        // Guard відкочує дерево до S1 на будь-якому шляху виходу зі скоупу —
        // включно з раннім `return` і помилкою детектора нижче.
        let guard = RungGuard::new(Arc::clone(&snapshot));
        if rung.is_avg {
            avg_budget.spend(1);
        }

        let capture: CaptureFn = {
            let snapshot = Arc::clone(&snapshot);
            Arc::new(move |path: PathBuf| {
                let mut snap = snapshot.lock().unwrap_or_else(PoisonError::into_inner);
                let _ = snap.record(&path);
            })
        };

        let outcome: FixOutcome = (deps.attempt)(AttemptContext {
            capture,
            rung: rung.clone(),
            feedback: feedback.clone(),
            violations: violations.clone(),
        })
        .await;

        let failure = evaluate_attempt(&outcome, &snapshot, config, &violations, &deps).await;

        match failure {
            None => {
                let touched = {
                    let snap = snapshot.lock().unwrap_or_else(PoisonError::into_inner);
                    snap.touched()
                };
                guard.commit();
                report.attempts.push(AttemptRecord {
                    tier: rung.tier,
                    model: rung.model.clone(),
                    ok: true,
                    turns: outcome.turns,
                    tool_calls: outcome.tool_calls,
                    failure: None,
                });
                report.outcome = PipelineOutcome::Success;
                report.resolved_by = Some(format!("{}:{}", rung.tier, rung.model));
                report.touched_files = touched;
                return Ok(report);
            }
            Some(failure) => {
                // Guard не комітимо — `Drop` відкотить дерево до S1, тож
                // наступний рунг стартує з чистого стану.
                drop(guard);
                report.rollbacks += 1;
                feedback = Some(describe_failure(&failure, &config.target_files));
                let error_text = match &failure {
                    RungFailure::Error(err) => Some(err.clone()),
                    _ => None,
                };
                report.attempts.push(AttemptRecord {
                    tier: rung.tier,
                    model: rung.model.clone(),
                    ok: false,
                    turns: outcome.turns,
                    tool_calls: outcome.tool_calls,
                    failure: Some(failure),
                });
                match decide_after_failure(&rung, error_text.as_deref()) {
                    Some(LadderAction::Break) => break,
                    Some(LadderAction::SkipModel) => {
                        skipped_models.insert(rung.model.clone());
                    }
                    None => {}
                }
            }
        }
    }

    Ok(report)
}

/// Оцінює спробу трьома незалежними рубежами: помилка виконавця → канонічний
/// детектор → collateral. `None` = рунг зарахований.
async fn evaluate_attempt(
    outcome: &FixOutcome,
    snapshot: &Arc<Mutex<Snapshot>>,
    config: &PipelineConfig,
    violations: &[Violation],
    deps: &PipelineDeps,
) -> Option<RungFailure> {
    if let Some(err) = &outcome.error {
        return Some(RungFailure::Error(err.clone()));
    }
    if outcome.touched_files.is_empty() && outcome.edit_log.is_empty() {
        return Some(RungFailure::NoEdits);
    }

    // Свідомо НЕ записуємо тут pre-image для `outcome.touched_files`: після
    // правки він дорівнював би вже зміненому вмісту, і `modified_existing`
    // (вхід collateral-veto) вважав би файл незміненим. Єдиний коректний
    // момент — ДО запису, через `AttemptContext::capture`.

    // Канонічний детектор — єдине джерело правди про закриття порушення.
    match (deps.detect)().await {
        Err(err) => return Some(RungFailure::Error(err)),
        Ok(after) if !after.is_empty() => return Some(RungFailure::StillFailing),
        Ok(_) => {}
    }

    let snap = snapshot.lock().unwrap_or_else(PoisonError::into_inner);
    check_collateral(&snap, config, violations)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fix::StopReason;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Драбина з двох спроб, задана явно — тести не залежать від env
    /// оточення процесу.
    fn test_ladder() -> Vec<Rung> {
        vec![
            Rung {
                tier: RungTier::LocalMin,
                model: "local/min".to_string(),
                feedback: false,
                local: true,
                is_avg: false,
                timeout_ms: 45_000,
            },
            Rung {
                tier: RungTier::CloudMin,
                model: "cloud/min".to_string(),
                feedback: true,
                local: false,
                is_avg: false,
                timeout_ms: 120_000,
            },
        ]
    }

    fn cfg(cwd: PathBuf, targets: Vec<PathBuf>) -> PipelineConfig {
        PipelineConfig {
            cwd,
            target_files: targets,
            fixability: Fixability::Code,
            ladder: test_ladder(),
        }
    }

    fn ok_outcome(touched: Vec<PathBuf>) -> FixOutcome {
        FixOutcome {
            ok: true,
            touched_files: touched,
            edit_log: Vec::new(),
            turns: 1,
            tool_calls: 1,
            empty_completion: false,
            stop_reason: StopReason::Completed,
            error: None,
        }
    }

    fn err_outcome(msg: &str) -> FixOutcome {
        FixOutcome {
            ok: false,
            touched_files: Vec::new(),
            edit_log: Vec::new(),
            turns: 1,
            tool_calls: 0,
            empty_completion: true,
            stop_reason: StopReason::ProviderError,
            error: Some(msg.to_string()),
        }
    }

    fn detect_returning(sequence: Vec<Vec<Violation>>) -> DetectFn {
        let calls = Arc::new(AtomicUsize::new(0));
        Arc::new(move || {
            let idx = calls.fetch_add(1, Ordering::SeqCst);
            let seq = sequence.clone();
            Box::pin(async move {
                let last = seq.last().cloned().unwrap_or_default();
                Ok(seq.get(idx).cloned().unwrap_or(last))
            })
        })
    }

    fn violation(file: &str, line: usize) -> Violation {
        Violation {
            file: PathBuf::from(file),
            line: Some(line),
            message: "порушення".to_string(),
        }
    }

    fn never_called_attempt() -> AttemptFn {
        Arc::new(|_ctx| {
            Box::pin(async {
                panic!("виконавець не мав викликатись");
            })
        })
    }

    #[tokio::test]
    async fn clean_first_detect_does_no_work() {
        let deps = PipelineDeps {
            detect: detect_returning(vec![vec![]]),
            t0: None,
            attempt: never_called_attempt(),
        };
        let mut avg = AvgBudget::new(3);
        let report = run_fix(&cfg(PathBuf::from("."), vec![]), deps, &mut avg)
            .await
            .expect("детектор без помилки");
        assert_eq!(report.outcome, PipelineOutcome::CleanNoWork);
        assert!(report.attempts.is_empty());
    }

    #[tokio::test]
    async fn t0_closing_concern_skips_the_ladder_entirely() {
        let t0_calls = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&t0_calls);
        let deps = PipelineDeps {
            detect: detect_returning(vec![vec![violation("a.rs", 1)], vec![]]),
            t0: Some(Arc::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                Box::pin(async {})
            })),
            attempt: never_called_attempt(),
        };
        let mut avg = AvgBudget::new(3);
        let report = run_fix(&cfg(PathBuf::from("."), vec![]), deps, &mut avg)
            .await
            .expect("детектор без помилки");
        assert_eq!(report.outcome, PipelineOutcome::T0Closed);
        assert_eq!(report.resolved_by.as_deref(), Some("t0"));
        assert_eq!(t0_calls.load(Ordering::SeqCst), 1);
        assert!(report.attempts.is_empty(), "жодної спроби моделі");
    }

    #[tokio::test]
    async fn concern_not_fixable_by_code_never_enters_the_ladder() {
        let mut config = cfg(PathBuf::from("."), vec![]);
        config.fixability = Fixability::ConfigOrStructural;
        let deps = PipelineDeps {
            detect: detect_returning(vec![vec![violation("a.rs", 1)]]),
            t0: None,
            attempt: never_called_attempt(),
        };
        let mut avg = AvgBudget::new(3);
        let report = run_fix(&config, deps, &mut avg)
            .await
            .expect("детектор без помилки");
        assert_eq!(report.outcome, PipelineOutcome::SkippedNotFixable);
        assert!(report.attempts.is_empty());
    }

    #[tokio::test]
    async fn attempt_error_is_recorded_and_rolls_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deps = PipelineDeps {
            detect: detect_returning(vec![vec![violation("a.rs", 1)]]),
            t0: None,
            attempt: Arc::new(|_ctx| Box::pin(async { err_outcome("boom") })),
        };
        let mut avg = AvgBudget::new(3);
        let report = run_fix(
            &cfg(dir.path().to_path_buf(), vec![PathBuf::from("a.rs")]),
            deps,
            &mut avg,
        )
        .await
        .expect("детектор без помилки");
        assert_eq!(report.outcome, PipelineOutcome::Failed);
        assert!(report.rollbacks >= 1, "провал рунга відкочує дерево");
        assert!(report
            .attempts
            .iter()
            .any(|a| matches!(a.failure, Some(RungFailure::Error(_)))));
    }

    #[tokio::test]
    async fn collateral_outside_target_set_rejects_even_when_detector_is_clean() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("a.rs");
        let stranger = dir.path().join("b.rs");
        fs::write(&target, "ціль\n").expect("записати ціль");
        fs::write(&stranger, "чужий\n").expect("записати чужий");

        let touched = stranger.clone();
        let deps = PipelineDeps {
            detect: detect_returning(vec![vec![violation("a.rs", 1)], vec![]]),
            t0: None,
            attempt: Arc::new(move |ctx| {
                let touched = touched.clone();
                Box::pin(async move {
                    // Як і бойовий write-guard: спершу сигнал про дотик,
                    // потім сам запис.
                    (ctx.capture)(touched.clone());
                    fs::write(&touched, "зіпсовано\n").expect("правка чужого файлу");
                    ok_outcome(vec![touched])
                })
            }),
        };
        let mut avg = AvgBudget::new(3);
        let report = run_fix(
            &cfg(dir.path().to_path_buf(), vec![PathBuf::from("a.rs")]),
            deps,
            &mut avg,
        )
        .await
        .expect("детектор без помилки");

        assert_eq!(
            report.outcome,
            PipelineOutcome::Failed,
            "зелений детектор не рятує рунг із collateral"
        );
        assert!(report
            .attempts
            .iter()
            .any(|a| matches!(a.failure, Some(RungFailure::CollateralFiles(_)))));
        assert_eq!(
            fs::read_to_string(&stranger).expect("прочитати чужий файл"),
            "чужий\n",
            "відкат повернув чужий файл"
        );
    }

    #[tokio::test]
    async fn attempt_without_edits_is_rejected_as_no_edits() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deps = PipelineDeps {
            detect: detect_returning(vec![vec![violation("a.rs", 1)]]),
            t0: None,
            attempt: Arc::new(|_ctx| Box::pin(async { ok_outcome(vec![]) })),
        };
        let mut avg = AvgBudget::new(3);
        let report = run_fix(
            &cfg(dir.path().to_path_buf(), vec![PathBuf::from("a.rs")]),
            deps,
            &mut avg,
        )
        .await
        .expect("детектор без помилки");
        assert!(report
            .attempts
            .iter()
            .any(|a| matches!(a.failure, Some(RungFailure::NoEdits))));
    }

    #[test]
    fn feedback_names_the_rejected_files_and_allowed_targets() {
        let text = describe_failure(
            &RungFailure::CollateralFiles(vec![PathBuf::from("b.rs")]),
            &[PathBuf::from("a.rs")],
        );
        assert!(text.contains("b.rs"), "названо відхилений файл");
        assert!(text.contains("a.rs"), "названо дозволену ціль");
    }

    #[test]
    fn feedback_names_the_line_range_outside_the_violation_window() {
        let text = describe_failure(
            &RungFailure::CollateralLines {
                file: PathBuf::from("a.rs"),
                from: 80,
                to: 95,
            },
            &[PathBuf::from("a.rs")],
        );
        assert!(text.contains("80-95"), "названо діапазон рядків");
    }
}
