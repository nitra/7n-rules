//! `CiArtifactDescriptor` — точний структурний відповідник WIT
//! `n-rules:slots/ci-artifact.{descriptor}` (`wit/deps/slots/ci-artifact.wit`),
//! форма якого витягнута з canonical JS-контракту
//! `npm/scripts/lib/slot-contracts-ci.mjs` (`CiArtifactDescriptor` typedef,
//! `validateCiArtifactPayload`).
//!
//! Тут — лише **типізована форма** (поля, обов'язковість, enum-membership
//! `format`/`mode`/`merge_strategy`) без семантичних перевірок вмісту рядків
//! (regex `artifact_id`, safe-path `target_path`/`template`) — ці перевірки
//! WIT-типізація не покриває і вони лишаються host-валідатором
//! [`crate::validators::ci_artifact`] (рішення Л спеки).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Формат цільового файлу артефакту. v1: лише `yaml` (JS `KNOWN_FORMATS`) —
/// точний відповідник WIT `enum format`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CiArtifactFormat {
    Yaml,
}

/// Режим застосування артефакту (JS `KNOWN_MODES`) — точний відповідник
/// WIT `enum mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CiArtifactMode {
    /// Файл обов'язковий — T0 створює з `template`, якщо відсутній.
    RequiredFile,
    /// Застосовується лише коли target вже існує.
    PatchExisting,
}

/// Стратегія злиття snippet-у з існуючим цільовим файлом (JS
/// `KNOWN_MERGE_STRATEGIES`) — точний відповідник WIT `enum merge-strategy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CiArtifactMergeStrategy {
    /// GitHub-стиль structural merge.
    DeepSubset,
    /// Azure-стиль пошук canonical кроку на будь-якій глибині.
    ContainsStep,
}

/// Payload слоту `ci.artifact@1` — точний структурний відповідник
/// JS `CiArtifactDescriptor` (`slot-contracts-ci.mjs`) і WIT
/// `n-rules:slots/ci-artifact.{descriptor}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CiArtifactDescriptor {
    /// Capability активного consumer-а (напр. `"ci:github"`).
    pub target_capability: String,
    /// Domain collision key — має відповідати
    /// [`crate::validators::ci_artifact::CI_ARTIFACT_ID_RE`].
    pub artifact_id: String,
    /// Consumer-repo-relative шлях цільового файлу — форму (без `..`, без
    /// абсолютних) перевіряє
    /// [`crate::validators::ci_artifact::is_safe_repo_relative_path`].
    pub target_path: String,
    pub format: CiArtifactFormat,
    pub mode: CiArtifactMode,
    /// Шлях до canonical snippet-у, відносний від каталогу дескриптора —
    /// форму перевіряє
    /// [`crate::validators::ci_artifact::is_safe_template_rel_path`].
    pub template: String,
    pub merge_strategy: CiArtifactMergeStrategy,
    /// Чи дозволений deterministic T0 fix для цього артефакту.
    pub fix: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> CiArtifactDescriptor {
        CiArtifactDescriptor {
            target_capability: "ci:github".to_string(),
            artifact_id: "lint-demo".to_string(),
            target_path: ".github/workflows/lint-demo.yml".to_string(),
            format: CiArtifactFormat::Yaml,
            mode: CiArtifactMode::RequiredFile,
            template: "./github/lint-demo.yml.snippet.yml".to_string(),
            merge_strategy: CiArtifactMergeStrategy::DeepSubset,
            fix: true,
        }
    }

    /// Serde-форма перелічень — kebab-case для `mode`/`merge_strategy`
    /// (звірка з JS-рядковими значеннями `required-file`, `deep-subset`
    /// тощо), lowercase для одноелементного `format`.
    #[test]
    fn descriptor_serializes_with_js_matching_enum_strings() {
        let json = serde_json::to_value(sample()).unwrap();
        assert_eq!(json["format"], "yaml");
        assert_eq!(json["mode"], "required-file");
        assert_eq!(json["merge_strategy"], "deep-subset");
    }

    #[test]
    fn descriptor_round_trips_through_json() {
        let d = sample();
        let json = serde_json::to_value(&d).unwrap();
        let back: CiArtifactDescriptor = serde_json::from_value(json).unwrap();
        assert_eq!(back, d);
    }
}
