//! Наскрізний прогін петлі `fix` на РЕАЛЬНОМУ детекторі `rules-core`
//! (`text/forbidden-prettier` — тривіальний у налаштуванні NATIVE_CONCERNS-запис,
//! пряме читання cwd, ніякого зовнішнього стану) з інʼєктованим ФЕЙКОВИМ
//! attempt-виконавцем — без мережі й моделі, як і вимагає задача.
//!
//! Навмисно НЕ через `rules_fix::fix_concern` (він завжди підключає
//! бойовий `attempt::build_attempt_fn` — реальний `llm_lib::fix::runner::run_attempt`,
//! тобто реальну мережу): тест іде через ту саму пару `detect`/`violation_map`,
//! що й `fix_concern`, але з власним, детермінованим `attempt`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use harness::ladder::{Rung, RungCapBudget, RungTier};
use harness::pipeline::{
    run_fix, AttemptContext, AttemptFn, Fixability, PipelineConfig, PipelineDeps, PipelineOutcome,
};
use llm_lib::fix::{FixOutcome, StopReason};

use rules_fix::detect::build_detect_fn;

/// Один рунг, достатній для тесту: модель фейкова — `attempt` нижче її
/// взагалі не читає, лише виправляє файл напряму.
fn one_rung() -> Vec<Rung> {
    vec![Rung {
        tier: RungTier::Local,
        model: "fake/model".to_string(),
        feedback: false,
        local: true,
        timeout_ms: 5_000,
    }]
}

/// `PipelineConfig` тесту: один фейковий рунг і консервативні бюджети — все,
/// що поза перевірюваним (detect/attempt), нейтральне.
fn test_config(cwd: PathBuf, target_files: Vec<PathBuf>) -> PipelineConfig {
    PipelineConfig {
        cwd,
        target_files,
        fixability: Fixability::Code,
        ladder: one_rung(),
        // `FixPolicy::default()` має `local_rungs: false` — внутрішнє
        // звуження run_fix викинуло б єдиний (локальний) тест-рунг.
        policy: llm_lib::budget::FixPolicy {
            local_rungs: true,
            ..llm_lib::budget::FixPolicy::default()
        },
        rates: llm_lib::budget::Rates::from_env(),
        local_capability: None,
        base_tokens: llm_lib::budget::CONSERVATIVE_BASE_TOKENS,
        caller: "rules-fix-test".to_string(),
        chain_id: None,
    }
}

/// Фейковий виконавець спроби: замість моделі просто видаляє
/// `.prettierrc` — точно ту саму дію, яку зробив би реальний фікс
/// `text/forbidden-prettier` (`forbidden-prettier.mdc`: конфіг заборонено,
/// прибрати файл). Рахує виклики, щоб тест міг перевірити, що спроба
/// відбулась рівно один раз.
fn fake_attempt(cwd: PathBuf, calls: Arc<AtomicUsize>) -> AttemptFn {
    Arc::new(move |ctx: AttemptContext| {
        let cwd = cwd.clone();
        let calls = Arc::clone(&calls);
        Box::pin(async move {
            calls.fetch_add(1, Ordering::SeqCst);
            assert!(
                !ctx.violations.is_empty(),
                "петля не повинна кликати attempt, коли детектор уже чистий"
            );
            let target = cwd.join(".prettierrc");
            (ctx.capture)(target.clone());
            std::fs::remove_file(&target).expect("прибрати заборонений конфіг");
            FixOutcome {
                ok: true,
                touched_files: vec![target],
                edit_log: Vec::new(),
                turns: 1,
                tool_calls: 1,
                elapsed_ms: 1,
                empty_completion: false,
                stop_reason: StopReason::Completed,
                error: None,
                verify_attempts: 0,
                prompt_tokens: None,
                completion_tokens: None,
                cached_tokens: None,
                reasoning_tokens: None,
                compacted: false,
                compaction_input_tokens: None,
                compaction_output_tokens: None,
            }
        })
    })
}

#[tokio::test]
async fn real_detector_with_fake_attempt_closes_the_concern() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::write(tmp.path().join(".prettierrc"), "{}").expect("написати заборонений конфіг");

    let cwd = tmp.path().to_path_buf();
    let key = "text/forbidden-prettier".to_string();

    let detect = build_detect_fn(key.clone(), cwd.clone(), None);
    let calls = Arc::new(AtomicUsize::new(0));

    let config = test_config(cwd.clone(), vec![PathBuf::from(".prettierrc")]);
    let deps = PipelineDeps {
        detect,
        t0: None,
        attempt: fake_attempt(cwd.clone(), Arc::clone(&calls)),
    };
    let mut caps = RungCapBudget::new();

    let report = run_fix(&config, deps, &mut caps)
        .await
        .expect("петля fix не має повертати помилку — детектор без збоїв");

    assert_eq!(report.outcome, PipelineOutcome::Success, "{report:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 1, "рівно одна спроба");
    assert!(
        !tmp.path().join(".prettierrc").exists(),
        "заборонений конфіг видалений насправді, не лише за звітом"
    );
}

#[tokio::test]
async fn real_detector_reports_clean_when_nothing_to_fix() {
    let tmp = tempfile::tempdir().expect("tempdir — без .prettierrc");

    let cwd = tmp.path().to_path_buf();
    let detect = build_detect_fn("text/forbidden-prettier".to_string(), cwd.clone(), None);
    let calls = Arc::new(AtomicUsize::new(0));

    let config = test_config(cwd.clone(), Vec::new());
    let deps = PipelineDeps {
        detect,
        t0: None,
        attempt: fake_attempt(cwd, Arc::clone(&calls)),
    };
    let mut caps = RungCapBudget::new();

    let report = run_fix(&config, deps, &mut caps)
        .await
        .expect("петля fix не має повертати помилку");

    assert_eq!(report.outcome, PipelineOutcome::CleanNoWork, "{report:?}");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "чистий детектор — жодної спроби моделі"
    );
}
