//! Побудова `llm_lib::fix::pipeline::PipelineConfig` з `rules_core::concern_meta::ConcernMeta`
//! (`concern.json` конкретного concern-а) — крок 3 задачі: `fixability`
//! мапиться через [`crate::violation_map::to_pipeline_fixability`], а
//! драбина береться готовою через `resolve_default_ladder`, звужена так
//! само, як і бойовий JS-канон: `meta.skip_local_tier`/`meta.cloud_timeout_ms`.

use std::path::PathBuf;

use llm_lib::fix::pipeline::{resolve_default_ladder, PipelineConfig};
use rules_core::concern_meta::ConcernMeta;

use crate::violation_map::to_pipeline_fixability;

/// Складає [`PipelineConfig`] для одного прогону петлі `fix` над одним
/// concern-ом. `target_files` — межа редагування (типово: файли з
/// початкового прогону детектора, [`crate::detect::target_files_from_violations`]).
#[must_use]
pub fn build_pipeline_config(
    meta: &ConcernMeta,
    cwd: PathBuf,
    target_files: Vec<PathBuf>,
) -> PipelineConfig {
    PipelineConfig {
        cwd,
        target_files,
        fixability: to_pipeline_fixability(meta.fixability),
        ladder: resolve_default_ladder(meta.skip_local_tier, meta.cloud_timeout_ms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use llm_lib::fix::pipeline::Fixability as PipelineFixability;
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
        );
        assert_eq!(config.cwd, cwd);
        assert_eq!(config.target_files, targets);
        assert_eq!(config.fixability, PipelineFixability::ConfigOrStructural);
    }

    /// `skip_local_tier: true` (без жодної `N_*_MODEL` env-змінної в
    /// тестовому процесі) звужує драбину до порожньої — той самий
    /// детермінований результат, що й `select_ladder(&[], true, None)`,
    /// без потреби мутувати процесний env.
    #[test]
    fn skip_local_tier_is_forwarded_to_ladder_resolution() {
        let config = build_pipeline_config(
            &meta(ConcernFixability::Code, true),
            PathBuf::from("/repo"),
            Vec::new(),
        );
        assert!(
            config.ladder.iter().all(|rung| !rung.local),
            "жоден рунг драбини не має бути локальним при skip_local_tier"
        );
    }
}
