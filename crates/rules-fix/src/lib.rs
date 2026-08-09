//! Склейка контуру `fix` (`llm_lib::fix::*`) з реальним lint-детектором і
//! метаданими concern-ів `rules-core` — зріз 7 (`crates/rules-fix`).
//!
//! # Чому окремий крейт, а не всередині `rules-core`
//!
//! `rules-core` навмисно бере `llm-lib` з `default-features = false` (лише
//! `tiers`), щоб у lint-адоні не було важкого async/HTTP/rig-стеку —
//! задокументовано в `llm-lib/crates/llm-lib/Cargo.toml` (рішення Р9) і в
//! шапці `rules-core/src/lib.rs`. Цей крейт залежить від `rules-core`
//! (домен lint-у) і від `llm-lib` зі звичайним набором фіч (цикл `fix`), тож
//! важкі залежності потрапляють лише туди, де фікс РЕАЛЬНО виконується.
//!
//! # Модулі
//!
//! - [`violation_map`] — переклад `rules_core::diagnostics::Violation` ⇄
//!   `llm_lib::fix::pipeline::Violation`, і `Fixability` ⇄ `Fixability`;
//! - [`detect`] — канонічний детектор (`DetectFn`) поверх `rules_core::concerns::run_concern`
//!   і межа редагування (`target_files`), яку рахуємо з його першого прогону;
//! - [`verify`] — `FixDeps::verify` одного attempt-у: канонічний прогін +
//!   test-gate (`compose_verify_report`);
//! - [`config`] — `PipelineConfig` з `ConcernMeta` (fixability, драбина);
//! - [`attempt`] — `PipelineDeps::attempt`, обгортка над
//!   `llm_lib::fix::runner::run_attempt` (там-таки доккомент про відому
//!   прогалину з `AttemptContext::capture` — звіт задачі).

pub mod attempt;
pub mod config;
pub mod detect;
pub mod error;
pub mod verify;
pub mod violation_map;

use std::path::Path;

use llm_lib::fix::ladder::AvgBudget;
use llm_lib::fix::pipeline::{run_fix, FixReport, PipelineDeps};
use rules_core::concern_meta::read_concern_meta;
use rules_core::rules_package::rules_root;

pub use error::FixConcernError;

/// Публічний вхід крейта: прогонить один concern (`ruleId/concernId`) через
/// петлю `fix` — реальний детектор + реальні метадані concern-а
/// (`concern.json`) замість інʼєкцій-заглушок.
///
/// `files` — той самий per-file scope, що йде і в `rules_core::concerns::run_concern`
/// (posix-relative, дзеркало `LintContext.files`); whole-repo concern-и
/// ігнорують його як і раніше.
///
/// # Errors
/// [`FixConcernError::InvalidKey`] — `key` не `ruleId/concernId`;
/// [`FixConcernError::MissingPackageRoot`] — не резолвився корінь
/// встановленого `@7n/rules` (`rules_root`); [`FixConcernError::MissingConcernMeta`] —
/// немає/невалідний `concern.json`; [`FixConcernError::Detect`] — провалився
/// перший (розвідувальний) прогін детектора; [`FixConcernError::Pipeline`] —
/// провалилась сама петля `fix`.
pub async fn fix_concern(
    key: &str,
    cwd: &Path,
    files: Option<&[String]>,
    avg_budget: &mut AvgBudget,
) -> Result<FixReport, FixConcernError> {
    let (rule_id, concern_id) = key
        .split_once('/')
        .ok_or_else(|| FixConcernError::InvalidKey(key.to_string()))?;

    let root = rules_root(cwd).ok_or(FixConcernError::MissingPackageRoot)?;
    let concern_dir = root.join(rule_id).join(concern_id);
    let meta = read_concern_meta(&concern_dir, concern_id)
        .ok_or_else(|| FixConcernError::MissingConcernMeta(key.to_string()))?;

    let files_owned = files.map(<[String]>::to_vec);

    // Розвідувальний прогін: рахує межу редагування (`target_files`) ДО
    // побудови конфіга петлі. `run_fix` (`pipeline.rs`) сам зробить ще один
    // прогін детектора як свій перший крок — легкий подвійний виклик на
    // старті, не помилка (детектори `rules-core` — CPU/fs-bound, без мережі).
    let initial = detect::run_canonical(key, cwd, files).map_err(FixConcernError::Detect)?;
    let target_files = detect::target_files_from_violations(&initial);

    let pipeline_config =
        config::build_pipeline_config(&meta, cwd.to_path_buf(), target_files.clone());

    let deps = PipelineDeps {
        detect: detect::build_detect_fn(key.to_string(), cwd.to_path_buf(), files_owned.clone()),
        // Детермінованих Rust-фіксів (T0) у `rules_core::concerns::run_concern`
        // немає — жоден запис `NATIVE_CONCERNS` не має "фіксуй сам, без
        // моделі"-сторони. Це не забутий пункт, а факт поточного стану
        // `rules-core` (звіт задачі, пункт «що лишилось незробленим»).
        t0: None,
        attempt: attempt::build_attempt_fn(
            rule_id.to_string(),
            cwd.to_path_buf(),
            key.to_string(),
            files_owned,
            target_files,
        ),
    };

    run_fix(&pipeline_config, deps, avg_budget)
        .await
        .map_err(FixConcernError::Pipeline)
}
