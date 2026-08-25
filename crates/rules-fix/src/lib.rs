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
//!   `harness::pipeline::Violation`, і `Fixability` ⇄ `Fixability`;
//! - [`detect`] — канонічний детектор (`DetectFn`) поверх `rules_core::concerns::run_concern`
//!   і межа редагування (`target_files`), яку рахуємо з його першого прогону;
//! - [`verify`] — `FixDeps::verify` одного attempt-у: канонічний прогін +
//!   test-gate (`compose_verify_report`);
//! - [`config`] — `PipelineConfig` з `ConcernMeta` (fixability, драбина);
//! - [`attempt`] — `PipelineDeps::attempt`, обгортка над
//!   `llm_lib::fix::runner::run_attempt` (там-таки доккомент про відому
//!   прогалину з `AttemptContext::capture` — звіт задачі).

/// Модуль спроби `fix`: будує `AttemptFn` і обгортає `llm_lib::fix::runner::run_attempt`.
pub mod attempt;
/// Модуль конфіга `fix`: збирає `PipelineConfig` з `ConcernMeta`.
pub mod config;
/// Модуль детекції `fix`: канонічний detector і розрахунок `target_files`.
pub mod detect;
/// Модуль помилок `fix`: типи помилок для публічного API крейта.
pub mod error;
/// Модуль `T0`-кроку: детермінований стартовий крок для `fix`-потоку.
pub mod t0;
/// Модуль верифікації `fix`: перевіряє один attempt і будує звіт.
pub mod verify;
/// Модуль мапінгу порушень: переводить типи violation між `rules-core` і pipeline.
pub mod violation_map;
/// Модуль worker-ів: спеціалізовані виконавці для окремих concern-ів.
pub mod workers;

use std::path::Path;

use harness::ladder::RungCapBudget;
use harness::pipeline::{run_fix, FixReport, PipelineDeps, PipelineOutcome};
use rules_core::concern_meta::read_concern_meta;
use rules_core::rules_package::rules_root;

pub use error::FixConcernError;

/// Резолвить файловий скоуп per-file concern-а з його глоба, коли викликач
/// не передав список явно.
///
/// `None` — резолв не потрібен (concern не per-file, або список уже задано,
/// або глоб порожній). Порожній `Some(vec![])` теж значущий: у дереві просто
/// немає файлів під цей concern, і детектор має отримати саме порожній
/// список, а не «скоуп невідомий».
///
/// Перед обходом хост сам читає consumer-репо конфіг —
/// [`rules_core::concerns::cursor_ignore::walk_repo`] (корінь конфігу == корінь
/// обходу тут завжди `cwd`) — той самий порядок операцій, що `loadCursorIgnorePaths`
/// → обхід дерева → фільтр глобами у JS-каноні цього ж резолву
/// (`npm/scripts/lib/resolve-target-files.mjs:96-99`), і що вже роблять
/// native full-scope концерни та napi-міст `build_full_scope_files`
/// (доккомент `cursor_ignore.rs`, секція «Відхилення від Р5»). До фіксу тут
/// стояв жорсткий `walk_dir(cwd, &[])` — і це гірший випадок того самого
/// класу, ніж уже виправлений `build_full_scope_files`: там зайвий файл лише
/// ЧИТАВСЯ детектором, а тут він потрапляє у скоуп петлі `fix`, тобто в межу
/// РЕДАГУВАННЯ — автофікс отримував право писати у теку, яку споживач явно
/// виключив у `.n-rules.json`.
fn resolve_per_file_scope(
    meta: &rules_core::concern_meta::ConcernMeta,
    cwd: &Path,
    files: Option<&[String]>,
) -> Option<Vec<String>> {
    if files.is_some() {
        return None;
    }
    let lint = meta.lint.as_ref()?;
    if lint.scope != rules_core::concern_meta::LintScope::PerFile || lint.glob.is_empty() {
        return None;
    }
    let all = rules_core::concerns::cursor_ignore::walk_repo(cwd);
    Some(rules_core::lint_plan::match_lint_globs(&lint.glob, &all))
}

/// Результат прогону одного concern-а в межах спільного прогону
/// ([`fix_concerns`]).
#[derive(Debug)]
pub struct ConcernRun {
    /// Ключ concern-а (`ruleId/concernId`).
    pub key: String,
    /// Звіт петлі або помилка, що завадила його отримати. Помилка ОДНОГО
    /// concern-а свідомо не зупиняє решту: інакше один зламаний
    /// `concern.json` знецінив би весь прогін.
    pub outcome: Result<FixReport, FixConcernError>,
}

/// Прогонить кілька concern-ів ПОСЛІДОВНО зі СПІЛЬНИМ бюджетом найдорожчого
/// тиру.
///
/// Спільний бюджет — не деталь реалізації, а вимога спеки (рішення И
/// `2026-08-08-llm-lib-acp-only-rust-goose.md`): кеп cloud-avg рахується на
/// весь прогін, а не на concern. Інакше двадцять concern-ів отримали б
/// двадцять окремих бюджетів найдорожчої моделі — рівно та вартість, від
/// якої кеп і має захищати.
///
/// Послідовно, а не паралельно, теж навмисно: кожен concern бере snapshot
/// робочого дерева й відкочує його на провалі, тож паралельні прогони
/// затирали б відкати один одного.
pub async fn fix_concerns(
    keys: &[String],
    cwd: &Path,
    files: Option<&[String]>,
    avg_budget: &mut RungCapBudget,
) -> Vec<ConcernRun> {
    let mut runs = Vec::with_capacity(keys.len());
    for key in keys {
        let outcome = fix_concern(key, cwd, files, avg_budget).await;
        runs.push(ConcernRun {
            key: key.clone(),
            outcome,
        });
    }
    runs
}

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
    avg_budget: &mut RungCapBudget,
) -> Result<FixReport, FixConcernError> {
    let (rule_id, concern_id) = key
        .split_once('/')
        .ok_or_else(|| FixConcernError::InvalidKey(key.to_string()))?;

    let root = rules_root(cwd).ok_or(FixConcernError::MissingPackageRoot)?;
    let concern_dir = root.join(rule_id).join(concern_id);
    let meta = read_concern_meta(&concern_dir, concern_id)
        .ok_or_else(|| FixConcernError::MissingConcernMeta(key.to_string()))?;

    // Per-file concern без явного списку файлів — резолвимо його з глоба
    // `concern.json`. Без цього детектор такого concern-а бачить порожній
    // список і чесно повертає «порушень немає»: наскрізний виклик давав
    // ФАЛЬШИВО-ЗЕЛЕНИЙ результат, а T0 для нього не викликався ніколи.
    // `scope: "full"`-концерни обходять дерево самі, їм `files` не потрібен.
    let resolved_files = resolve_per_file_scope(&meta, cwd, files);
    let files: Option<&[String]> = files.or(resolved_files.as_deref());
    let files_owned = files.map(<[String]>::to_vec);

    // Розвідувальний прогін: рахує межу редагування (`target_files`) ДО
    // побудови конфіга петлі. `run_fix` (`pipeline.rs`) сам зробить ще один
    // прогін детектора як свій перший крок — легкий подвійний виклик на
    // старті, не помилка (детектори `rules-core` — CPU/fs-bound, без мережі).
    let initial = detect::run_canonical(key, cwd, files).map_err(FixConcernError::Detect)?;
    let target_files = detect::target_files_from_violations(&initial);

    let pipeline_config =
        config::build_pipeline_config(&meta, key, cwd.to_path_buf(), target_files.clone())
            .map_err(FixConcernError::Pipeline)?;

    // Порожня драбина + наявні порушення: рунга, який міг би лагодити, немає
    // взагалі. `run_fix` у цьому випадку віддає помилку конвеєра, але для
    // виклику це не збій — це чесний звіт «нікому лагодити», рівно як і
    // `CleanNoWork` для concern-а без порушень (його `run_fix` складає сам).
    // Без цієї межі `rules-fix` падав би скрізь, де моделі не налаштовані.
    if pipeline_config.ladder.is_empty() && !initial.is_empty() {
        return Ok(FixReport {
            outcome: PipelineOutcome::Failed,
            resolved_by: None,
            attempts: Vec::new(),
            rollbacks: 0,
            cap_skipped: false,
            touched_files: Vec::new(),
            t0_touched: Vec::new(),
            t0_error: None,
            rollback_failures: Vec::new(),
            usage_unreported_fallbacks: 0,
            chain_id: String::new(),
            journal_persist_errors: Vec::new(),
            git_snapshot_error: None,
            journal: std::sync::Arc::new(std::sync::Mutex::new(llm_lib::journal::Journal::new())),
        });
    }

    // Воркерні concern-и (клас «один one-shot усередині драбини», дзеркало
    // JS fix-worker.mjs) отримують воркер ЗАМІСТЬ агентної сесії — та сама
    // драбина, той самий re-detect, інший виконавець спроби.
    let attempt_fn = workers::build_fix_worker(key, cwd, files).unwrap_or_else(|| {
        attempt::build_attempt_fn(
            rule_id.to_string(),
            cwd.to_path_buf(),
            key.to_string(),
            files_owned.clone(),
            target_files,
            meta.fix_hint.clone(),
            pipeline_config.policy.clone(),
        )
    });

    let deps = PipelineDeps {
        detect: detect::build_detect_fn(key.to_string(), cwd.to_path_buf(), files_owned),
        t0: t0::build_t0_step(key, cwd, files),
        attempt: attempt_fn,
    };

    run_fix(&pipeline_config, deps, avg_budget)
        .await
        .map_err(FixConcernError::Pipeline)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rules_core::concern_meta::{ConcernMeta, Fixability, LintScope, LintSurface};
    use std::path::PathBuf;

    fn meta_with(lint: Option<LintSurface>) -> ConcernMeta {
        ConcernMeta {
            name: "c".to_string(),
            dir: PathBuf::from("."),
            check: true,
            policy: None,
            lint,
            requires_capability: None,
            fixability: Fixability::Code,
            skip_local_tier: false,
            cloud_timeout_ms: None,
            fix_hint: None,
        }
    }

    /// Регрес: per-file concern БЕЗ явного списку файлів отримував порожній
    /// скоуп, детектор чесно казав «порушень немає», і наскрізний виклик
    /// давав фальшиво-зелений результат (а T0 для нього не викликався
    /// ніколи). Тепер скоуп резолвиться з глоба `concern.json`.
    #[test]
    fn per_file_scope_is_resolved_from_glob_when_caller_gave_no_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("dremio_v2/templates")).expect("дерево");
        std::fs::write(
            dir.path().join("dremio_v2/templates/zookeeper.yaml"),
            "kind: ConfigMap\n",
        )
        .expect("цільовий файл");
        std::fs::write(dir.path().join("other.yaml"), "kind: Other\n").expect("сторонній файл");

        let meta = meta_with(Some(LintSurface {
            scope: LintScope::PerFile,
            glob: vec!["**/dremio_v2/templates/zookeeper.yaml".to_string()],
            anchors: Vec::new(),
        }));
        let resolved = resolve_per_file_scope(&meta, dir.path(), None).expect("скоуп резолвиться");
        assert_eq!(
            resolved,
            vec!["dremio_v2/templates/zookeeper.yaml".to_string()],
            "лише файли під глобом concern-а"
        );
    }

    #[test]
    fn explicit_files_win_over_glob_resolution() {
        let dir = tempfile::tempdir().expect("tempdir");
        let meta = meta_with(Some(LintSurface {
            scope: LintScope::PerFile,
            glob: vec!["**/*.yaml".to_string()],
            anchors: Vec::new(),
        }));
        let explicit = vec!["a.yaml".to_string()];
        assert!(
            resolve_per_file_scope(&meta, dir.path(), Some(&explicit)).is_none(),
            "явний список викликача не перекривається"
        );
    }

    /// `scope: "full"`-концерни обходять дерево самі — резолв їм не потрібен
    /// і не має підмінювати їхню поведінку.
    #[test]
    fn full_scope_concern_needs_no_file_resolution() {
        let dir = tempfile::tempdir().expect("tempdir");
        let meta = meta_with(Some(LintSurface {
            scope: LintScope::Full,
            glob: vec!["**/*".to_string()],
            anchors: Vec::new(),
        }));
        assert!(resolve_per_file_scope(&meta, dir.path(), None).is_none());
    }

    // --- `resolve_per_file_scope`: консультується з `.n-rules.json:ignore` ---
    //
    // Той самий клас дефекту, що вже виправлений для `build_full_scope_files`
    // (`crates/rules-napi/src/lib.rs`), але у ШЛЯХУ АВТОФІКСУ, і тому гірший:
    // там зайвий файл лише ЧИТАВСЯ детектором, тут він потрапляє в межу
    // редагування петлі `fix` — тобто в кандидати на ЗАПИС. До фіксу обхід
    // ішов `walk_dir(cwd, &[])` — з порожнім consumer-ignore, тоді як
    // JS-канон (`npm/scripts/lib/resolve-target-files.mjs:96`) завжди кличе
    // `loadCursorIgnorePaths(root)` перед обходом. Отже — регресія порту
    // проти власного JS-канону, не успадкована властивість.

    /// Дерево-фікстура для per-file резолву: `keep.yaml` у корені +
    /// `vendor/skip.yaml` під директорією-кандидатом на ignore. Повертає
    /// `TempDir`, щоб фікстура не звільнилась до кінця тесту.
    fn fixture_tree_with_vendor_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("keep.yaml"), "kind: Keep\n").expect("keep.yaml");
        std::fs::create_dir_all(dir.path().join("vendor")).expect("vendor/");
        std::fs::write(dir.path().join("vendor/skip.yaml"), "kind: Skip\n")
            .expect("vendor/skip.yaml");
        dir
    }

    /// Per-file concern із глобом на всі `*.yaml` — резолв бачить обидва
    /// файли фікстури, тож різницю робить САМЕ consumer-ignore.
    fn per_file_yaml_meta() -> ConcernMeta {
        meta_with(Some(LintSurface {
            scope: LintScope::PerFile,
            glob: vec!["**/*.yaml".to_string()],
            anchors: Vec::new(),
        }))
    }

    /// Резолвлений скоуп НЕ містить файлів із директорії, названої в
    /// `.n-rules.json:ignore` — головний регрес-кейс фіксу: інакше петля
    /// `fix` отримала б право писати у явно виключену споживачем теку.
    #[test]
    fn per_file_scope_excludes_dir_from_n_rules_json_ignore() {
        let dir = fixture_tree_with_vendor_dir();
        std::fs::write(dir.path().join(".n-rules.json"), r#"{"ignore":["vendor"]}"#)
            .expect(".n-rules.json");

        let resolved = resolve_per_file_scope(&per_file_yaml_meta(), dir.path(), None)
            .expect("скоуп резолвиться");

        assert_eq!(resolved, vec!["keep.yaml".to_string()]);
    }

    /// Без конфігу (`.n-rules.json` відсутній) поведінка не змінилась —
    /// обидва файли лишаються у скоупі, як і до фіксу.
    #[test]
    fn per_file_scope_without_config_matches_everything() {
        let dir = fixture_tree_with_vendor_dir();

        let resolved = resolve_per_file_scope(&per_file_yaml_meta(), dir.path(), None)
            .expect("скоуп резолвиться");

        assert_eq!(
            resolved,
            vec!["keep.yaml".to_string(), "vendor/skip.yaml".to_string()]
        );
    }

    /// Побитий JSON у `.n-rules.json` — tolerant-парсинг
    /// ([`rules_core::concerns::cursor_ignore::load_cursor_ignore_paths`]
    /// повертає порожній список), не крах: той самий результат, що й без
    /// конфігу взагалі.
    #[test]
    fn per_file_scope_survives_broken_json_config() {
        let dir = fixture_tree_with_vendor_dir();
        std::fs::write(dir.path().join(".n-rules.json"), "{ not: json").expect(".n-rules.json");

        let resolved = resolve_per_file_scope(&per_file_yaml_meta(), dir.path(), None)
            .expect("скоуп резолвиться");

        assert_eq!(
            resolved,
            vec!["keep.yaml".to_string(), "vendor/skip.yaml".to_string()]
        );
    }

    /// Ignore-шлях поза `cwd` не ламає обхід — `to_relative_ignore_globs`
    /// відкидає його (rel починався б з `..`), `walk_dir` отримує порожній
    /// `extra_ignore_globs` і повертає звичайний повний список.
    #[test]
    fn per_file_scope_ignore_path_outside_cwd_does_not_break_walk() {
        let dir = fixture_tree_with_vendor_dir();
        let outside = tempfile::tempdir().expect("outside tempdir");
        std::fs::write(
            dir.path().join(".n-rules.json"),
            serde_json::json!({ "ignore": [outside.path().join("elsewhere").to_string_lossy()] })
                .to_string(),
        )
        .expect(".n-rules.json");

        let resolved = resolve_per_file_scope(&per_file_yaml_meta(), dir.path(), None)
            .expect("скоуп резолвиться");

        assert_eq!(
            resolved,
            vec!["keep.yaml".to_string(), "vendor/skip.yaml".to_string()]
        );
    }
}
