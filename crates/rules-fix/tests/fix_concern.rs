//! `fix_concern` — зʼєднання верхнього рівня (концерн-ключ → `rules_root` →
//! `concern.json` → `target_files` з реального детектора → `PipelineConfig`),
//! без мережі: тест навмисно тримає драбину ПОРОЖНЬОЮ (жодної `N_*_MODEL`
//! env-змінної в тестовому процесі), тож `attempt::build_attempt_fn`
//! (реальний `run_attempt`) жодного разу не викликається — драбина
//! просто нема чого проходити.
//!
//! Якщо тестове середовище має хоч одну `N_*_MODEL`-змінну, тест чесно
//! пропускається (`eprintln` + ранній `return`) замість недетермінованого
//! походу в мережу — той самий підхід, що й `git_available()`-скіп у
//! `llm-lib/crates/llm-lib/src/write_guard.rs`.

use std::path::Path;

use llm_lib::fix::ladder::AvgBudget;
use llm_lib::fix::pipeline::PipelineOutcome;

/// Той самий перелік, що читає `llm_lib::fix::ladder::resolve_ladder_models`
/// (`local_min`/`local_avg`/`local_max`/`cloud_min`/`cloud_avg`/`cloud_max`
/// у `tiers.rs`) — якщо жодної не задано, драбина будь-якого concern-а
/// гарантовано порожня.
const MODEL_ENV_VARS: &[&str] = &[
    "N_LOCAL_MIN_MODEL",
    "N_LOCAL_AVG_MODEL",
    "N_LOCAL_MAX_MODEL",
    "N_CLOUD_MIN_MODEL",
    "N_CLOUD_AVG_MODEL",
    "N_CLOUD_MAX_MODEL",
];

fn any_model_env_configured() -> bool {
    MODEL_ENV_VARS
        .iter()
        .any(|name| std::env::var(name).is_ok_and(|v| !v.is_empty()))
}

/// Готує tempdir, що одночасно є і «consumer-репо» (`cwd`), і dev-репо
/// пакета `@7n/rules` (`rules_core::rules_package::package_root_from_tree`
/// приймає `<cwd>/npm/package.json` з `"name":"@7n/rules"` як корінь) —
/// жодної мутації процесного env (`N_RULES_PACKAGE_ROOT`) не треба, а
/// сама функція резолву явно рекомендує уникати такої мутації в тестах
/// (доккомент `rules_package.rs`).
fn write_fake_package_with_concern(root: &Path, key: &str) {
    std::fs::create_dir_all(root.join("npm")).expect("створити npm/");
    std::fs::write(
        root.join("npm").join("package.json"),
        r#"{ "name": "@7n/rules" }"#,
    )
    .expect("написати npm/package.json");
    let (rule_id, concern_id) = key.split_once('/').expect("key у форматі rule/concern");
    let concern_dir = root
        .join("npm")
        .join("rules")
        .join(rule_id)
        .join(concern_id);
    std::fs::create_dir_all(&concern_dir).expect("створити теку concern-а");
    std::fs::write(
        concern_dir.join("concern.json"),
        r#"{ "lint": { "scope": "full", "glob": [] }, "fixability": "code" }"#,
    )
    .expect("написати concern.json");
}

#[tokio::test]
async fn resolves_concern_meta_and_target_files_without_any_network_call() {
    if any_model_env_configured() {
        eprintln!("skip: тестове середовище має задану N_*_MODEL — драбина не була б порожньою");
        return;
    }

    let tmp = tempfile::tempdir().expect("tempdir");
    let key = "text/forbidden-prettier";
    write_fake_package_with_concern(tmp.path(), key);
    // `npm/` подвоює роль dev-репо пакета і не заважає детектору: сам
    // concern читає лише корінь `cwd`, де ми окремо кладемо порушення.
    std::fs::write(tmp.path().join(".prettierrc"), "{}").expect("написати заборонений конфіг");

    let mut avg = AvgBudget::new(1);
    let report = rules_fix::fix_concern(key, tmp.path(), None, &mut avg)
        .await
        .expect("concern.json валідний, детектор без збоїв");

    assert_eq!(
        report.outcome,
        PipelineOutcome::Failed,
        "порожня драбина не закриває concern, але й не панікує: {report:?}"
    );
    assert!(report.attempts.is_empty(), "жодного рангу — жодної спроби");
}

#[tokio::test]
async fn reports_clean_when_the_concern_has_nothing_to_fix() {
    if any_model_env_configured() {
        eprintln!("skip: тестове середовище має задану N_*_MODEL");
        return;
    }

    let tmp = tempfile::tempdir().expect("tempdir");
    let key = "text/forbidden-prettier";
    write_fake_package_with_concern(tmp.path(), key);

    let mut avg = AvgBudget::new(1);
    let report = rules_fix::fix_concern(key, tmp.path(), None, &mut avg)
        .await
        .expect("concern.json валідний, детектор без збоїв");

    assert_eq!(report.outcome, PipelineOutcome::CleanNoWork, "{report:?}");
}

#[tokio::test]
async fn invalid_key_is_rejected_before_any_filesystem_lookup() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let mut avg = AvgBudget::new(1);

    let error = rules_fix::fix_concern("не-має-слеша", tmp.path(), None, &mut avg)
        .await
        .expect_err("ключ без '/' невалідний");

    assert!(matches!(error, rules_fix::FixConcernError::InvalidKey(_)));
}

#[tokio::test]
async fn missing_concern_json_is_reported() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(tmp.path().join("npm")).expect("створити npm/");
    std::fs::write(
        tmp.path().join("npm").join("package.json"),
        r#"{ "name": "@7n/rules" }"#,
    )
    .expect("написати npm/package.json");
    let mut avg = AvgBudget::new(1);

    let error = rules_fix::fix_concern("text/forbidden-prettier", tmp.path(), None, &mut avg)
        .await
        .expect_err("немає concern.json для цього ключа");

    assert!(matches!(
        error,
        rules_fix::FixConcernError::MissingConcernMeta(_)
    ));
}
