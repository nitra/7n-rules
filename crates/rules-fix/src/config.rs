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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness::pipeline::Fixability as PipelineFixability;
    use rules_core::concern_meta::Fixability as ConcernFixability;

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
        let config = build_pipeline_config(
            &meta(ConcernFixability::Structural, false),
            cwd.clone(),
            targets.clone(),
        )
        .expect("драбина резолвиться");
        assert_eq!(config.cwd, cwd);
        assert_eq!(config.target_files, targets);
        assert_eq!(config.fixability, PipelineFixability::ConfigOrStructural);
        assert_eq!(config.caller, "rules-fix");
        assert!(config.chain_id.is_none(), "resume поза цим зрізом");
    }

    /// `skip_local_tier: true` без жодної хмарної `N_*_MODEL` у тестовому
    /// процесі → порожня драбина — тепер це ПОМИЛКА побудови конфіга
    /// (fail-fast валідацією), а не мовчазний прогін без спроб.
    #[test]
    fn skip_local_tier_without_cloud_models_is_a_config_error() {
        let result = build_pipeline_config(
            &meta(ConcernFixability::Code, true),
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
