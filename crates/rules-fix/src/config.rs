//! Побудова `harness::pipeline::PipelineConfig` з `rules_core::concern_meta::ConcernMeta`
//! (`concern.json` конкретного concern-а): `fixability` мапиться через
//! [`crate::violation_map::to_pipeline_fixability`], драбина звужується ТУТ
//! (`select_ladder` із `meta.skip_local_tier`/`meta.cloud_timeout_ms`), а
//! `policy` виставляється так, щоб повторне звуження всередині `run_fix`
//! було no-op — див. доккоментар [`build_pipeline_config`].

use std::path::PathBuf;

use harness::ladder::{build_ladder, resolve_ladder_models, select_ladder};
use harness::pipeline::PipelineConfig;
use llm_lib::budget::{EgressPolicy, FixPolicy, Rates, CONSERVATIVE_BASE_TOKENS};
use rules_core::concern_meta::ConcernMeta;

use crate::violation_map::to_pipeline_fixability;

/// Ідентифікатор застосунку, що пише trace-рядки (`TraceCommon::caller`)
/// — той самий простір імен, що й `n7n-g`.
const CALLER: &str = "rules-fix";

/// Складає [`PipelineConfig`] для одного прогону петлі `fix` над одним
/// concern-ом. `target_files` — межа редагування (типово: файли з
/// початкового прогону детектора, [`crate::detect::target_files_from_violations`]).
///
/// `key` — повний ключ concern-а (`"<rule>/<concern>"`), а не `meta.name`:
/// саме він іде в `PipelineConfig::unit` як одиниця роботи агрегатного
/// рядка ланцюжка. `meta.name` — лише basename каталогу (`"cspell"`), тож
/// однойменні концерни різних правил злились би для аналітики в одну
/// одиницю; повний ключ — той самий простір імен, яким concern адресують
/// CLI й реєстр.
///
/// # Чому драбина звужується тут, а не в `run_fix`
///
/// Новий контракт `PipelineConfig::ladder` очікує ПОВНУ драбину і звужує її
/// сам (`select_ladder` за `policy`) — але той внутрішній виклик передає
/// `cloud_timeout_ms: None` літерально, тож per-concern
/// `meta.cloud_timeout_ms` через нього НЕ проноситься. Звуження тут, із
/// таймаутом concern-а, плюс `policy.local_rungs`/`egress`, під якими
/// внутрішнє повторне звуження ідемпотентне над уже звуженим набором, —
/// зберігає поведінку `meta.cloud_timeout_ms` без зміни API harness.
///
/// # Errors
/// Порожня драбина після звуження (`skip_local_tier` без жодної хмарної
/// моделі в env) — текстом, придатним для діагностики CLI.
pub fn build_pipeline_config(
    meta: &ConcernMeta,
    key: &str,
    cwd: PathBuf,
    target_files: Vec<PathBuf>,
) -> Result<PipelineConfig, String> {
    let ladder = select_ladder(
        &build_ladder(&resolve_ladder_models()),
        !meta.skip_local_tier,
        EgressPolicy::AllowCloud,
        meta.cloud_timeout_ms,
    )
    .map_err(|err| err.to_string())?;

    let policy = FixPolicy {
        // Повторне звуження в run_fix має бути no-op над уже звуженою
        // драбиною: local_rungs=true нічого не викидає з набору, де локальні
        // рунги або вже є, або вже прибрані.
        local_rungs: true,
        egress: EgressPolicy::AllowCloud,
        // Виміряно живцем (2026-08-19, gemma-4-26b-a4b-it,
        // changelog/presence): з дефолтними 6 ходами локальний рунг згорає
        // на розвідці (6 × ls, жодного запису), з 20 — закриває порушення З
        // ПЕРШОГО рунга (14 ходів: розвідка + запис + verify). Вміщення
        // тримається навіть без оголошеної capability: 2500 + 20×1024 < 32k.
        // Env-оверрайд N_LLM_FIX_TURN_CEILING лишається понад цим.
        turns: 20,
        ..FixPolicy::default()
    };

    Ok(PipelineConfig {
        cwd,
        target_files,
        fixability: to_pipeline_fixability(meta.fixability),
        ladder,
        policy,
        rates: Rates::from_env(),
        local_capability: llm_lib::budget::local_capability(),
        // Крок 1 із двох (§3.3): консервативна оцінка ДО першого виміру.
        // Калібрувальний resolve потребує fingerprint конкретної моделі,
        // якого на рівні конфіга concern-а ще немає — модель обирає рунг.
        base_tokens: CONSERVATIVE_BASE_TOKENS,
        caller: CALLER.to_string(),
        // Нова сесія щоразу — resume журналу поза цим зрізом.
        chain_id: None,
        unit: Some(key.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness::pipeline::Fixability as PipelineFixability;
    use rules_core::concern_meta::Fixability as ConcernFixability;

    /// Ті самі змінні, що читає `harness::ladder::resolve_ladder_models`
    /// (перелік-близнюк у `tests/fix_concern.rs`): якщо жодної не задано,
    /// драбина БУДЬ-ЯКОГО concern-а порожня — і це не дефект, а середовище
    /// без моделей (саме таке в CI).
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
            .any(|name| std::env::var(name).is_ok_and(|value| !value.is_empty()))
    }

    /// Мінімальний `ConcernMeta` для тестів — лише поля, які читає
    /// [`build_pipeline_config`]; решта нейтральна.
    fn meta(fixability: ConcernFixability, skip_local_tier: bool) -> ConcernMeta {
        ConcernMeta {
            name: "concern".to_string(),
            dir: PathBuf::from("/dev/null"),
            check: false,
            policy: None,
            lint: None,
            requires_capability: None,
            fixability,
            skip_local_tier,
            cloud_timeout_ms: None,
            fix_hint: None,
        }
    }

    #[test]
    fn fixability_and_cwd_and_target_files_pass_through() {
        let cwd = PathBuf::from("/repo");
        let targets = vec![PathBuf::from("a.mjs"), PathBuf::from("b.mjs")];
        let built = build_pipeline_config(
            &meta(ConcernFixability::Structural, false),
            "text/concern",
            cwd.clone(),
            targets.clone(),
        );
        // Без жодної моделі в env драбина порожня ЗАКОНОМІРНО. Тест не
        // пропускається мовчки: він перевіряє, що це саме помилка драбини, а
        // не тихий успіх із порожнім набором рунгів.
        if !any_model_env_configured() {
            let error = built.expect_err("без моделей драбина мусить бути помилкою");
            assert!(
                error.contains("драбина порожня"),
                "очікувалась помилка драбини, а не {error}"
            );
            return;
        }
        let config = built.expect("драбина резолвиться");
        assert_eq!(config.cwd, cwd);
        assert_eq!(config.target_files, targets);
        assert_eq!(config.fixability, PipelineFixability::ConfigOrStructural);
        assert_eq!(config.caller, "rules-fix");
        assert!(config.chain_id.is_none(), "resume поза цим зрізом");
        assert_eq!(
            config.unit.as_deref(),
            Some("text/concern"),
            "одиниця роботи ланцюжка — ПОВНИЙ ключ concern-а, не basename"
        );
    }

    /// `skip_local_tier: true` без жодної хмарної `N_*_MODEL` у тестовому
    /// процесі → порожня драбина — тепер це ПОМИЛКА побудови конфіга
    /// (fail-fast валідацією), а не мовчазний прогін без спроб.
    #[test]
    fn skip_local_tier_without_cloud_models_is_a_config_error() {
        let result = build_pipeline_config(
            &meta(ConcernFixability::Code, true),
            "text/concern",
            PathBuf::from("/repo"),
            Vec::new(),
        );
        match result {
            Err(message) => assert!(!message.is_empty()),
            Ok(config) => assert!(
                config.ladder.iter().all(|rung| !rung.local),
                "якщо env процесу має хмарні моделі — жоден рунг не локальний"
            ),
        }
    }
}
