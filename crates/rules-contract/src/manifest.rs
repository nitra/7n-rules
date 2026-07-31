//! `Manifest`/`Capabilities`/`Domain` — те, що повертає `export describe`
//! (WIT `wit/world.wit`), плюс JSON Schema (`schemars`) — спека §2 рішення І:
//! LLM-скіл авторингу плагінів валідує/генерує `plugin.toml` за цією схемою,
//! тому вона має бути публічно обчислюваною без запуску wasm-компонента.
//!
//! Маніфест дзеркалить `plugin.toml` (спека §3.1: id, версія, версія world,
//! контрибуції, capabilities, tools) і перелік підтримуваних доменів
//! (рішення К) — хост будує мапу «домен → чи підтримано» і не викликає
//! незадекларовані експорти.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::slots::ci_artifact::CiArtifactDescriptor;

/// Домен, який плагін МОЖЕ підтримувати — точний відповідник WIT
/// `enum domain`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Domain {
    Lint,
    EcosystemOutdated,
    DocgenRender,
}

/// Scope контрибуції концерну (задача N2, передумова full-scope мосту) —
/// точний відповідник WIT `enum concern-scope`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ConcernScope {
    PerFile,
    Full,
}

/// Одна контрибуція `Manifest::concerns` — точний структурний відповідник
/// WIT `record concern-contribution` (задача N2): `key` — `ruleId/concernId`,
/// `scope`/`glob` дозволяють host-у самостійно побудувати full-scope batch,
/// коли виклик не передав явний список файлів (`crates/rules-napi`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ConcernContribution {
    pub key: String,
    pub scope: ConcernScope,
    #[serde(default)]
    pub glob: Vec<String>,
}

/// Capability-декларація маніфеста (рішення Е спеки): scope `fs_read` —
/// хост відкриває плагіну доступ лише до переданих шляхів, `network`
/// заборонена за замовчуванням (`false`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct Capabilities {
    /// Repo-relative шляхи/глоби, які плагіну потрібно читати з файлової
    /// системи напряму — типовий концерн лишає це порожнім (вміст файлів
    /// хост уже передає inline у `DetectBatch`/`FixRequest`).
    #[serde(default)]
    pub fs_read: Vec<String>,
    /// Чи потрібен мережевий доступ (дефолт — ні).
    #[serde(default)]
    pub network: bool,
}

/// Маніфест плагіна — точний структурний відповідник WIT `record manifest`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Manifest {
    pub id: String,
    pub version: String,
    /// Версія `n-rules:plugin` world, під яку зібраний плагін (напр.
    /// `"3.0.0"`, [`crate::version::PLUGIN_WORLD_VERSION`]) — negotiation
    /// зі skip-not-crash семантикою (рішення З).
    pub world_version: String,
    /// Домени, які плагін реально реалізує (не заглушки).
    #[serde(default)]
    pub domains: Vec<Domain>,
    /// Контрибуції концернів, які плагін обробляє в lint-домені
    /// (`detect`/`fix`) — структуровані (задача N2: `key`/`scope`/`glob`),
    /// щоб хост міг самостійно побудувати full-scope batch.
    #[serde(default)]
    pub concerns: Vec<ConcernContribution>,
    /// Contribution-и слоту `ci.artifact@1`.
    #[serde(default)]
    pub ci_artifacts: Vec<CiArtifactDescriptor>,
    #[serde(default)]
    pub capabilities: Capabilities,
    /// Декларовані зовнішні tool-залежності (рішення Д), напр.
    /// `"shellcheck@^0.9"`.
    #[serde(default)]
    pub tools: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slots::ci_artifact::{CiArtifactFormat, CiArtifactMergeStrategy, CiArtifactMode};

    fn sample_manifest() -> Manifest {
        Manifest {
            id: "sample-plugin".to_string(),
            version: "0.1.0".to_string(),
            world_version: crate::version::PLUGIN_WORLD_VERSION.to_string(),
            domains: vec![Domain::Lint],
            concerns: vec![ConcernContribution {
                key: "sample/concern".to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.rs".to_string()],
            }],
            ci_artifacts: vec![CiArtifactDescriptor {
                target_capability: "ci:github".to_string(),
                artifact_id: "lint-demo".to_string(),
                target_path: ".github/workflows/lint-demo.yml".to_string(),
                format: CiArtifactFormat::Yaml,
                mode: CiArtifactMode::RequiredFile,
                template: "./github/lint-demo.yml.snippet.yml".to_string(),
                merge_strategy: CiArtifactMergeStrategy::DeepSubset,
                fix: true,
            }],
            capabilities: Capabilities::default(),
            tools: vec!["shellcheck@^0.9".to_string()],
        }
    }

    #[test]
    fn manifest_round_trips_through_json() {
        let manifest = sample_manifest();
        let json = serde_json::to_value(&manifest).unwrap();
        let back: Manifest = serde_json::from_value(json).unwrap();
        assert_eq!(back.id, "sample-plugin");
        assert_eq!(back.domains, vec![Domain::Lint]);
        assert_eq!(back.ci_artifacts.len(), 1);
    }

    /// Дефолтна `Capabilities` — порожній `fs_read`, `network: false`
    /// (безпечний-за-замовчуванням дефолт, рішення Е).
    #[test]
    fn missing_capabilities_default_to_no_network_no_fs_read() {
        let raw = serde_json::json!({
            "id": "x",
            "version": "0.1.0",
            "world_version": "3.0.0",
        });
        let manifest: Manifest = serde_json::from_value(raw).unwrap();
        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
        assert!(manifest.domains.is_empty());
    }

    /// Схема генерується без паніки і містить назву типу — мінімальний
    /// smoke-тест: скіл авторингу плагінів (рішення І) споживає цю схему,
    /// тому вона має бути обчислюваною детерміновано.
    #[test]
    fn json_schema_generates_and_mentions_manifest_shape() {
        let schema = schemars::schema_for!(Manifest);
        let json = serde_json::to_value(&schema).unwrap();
        assert!(json["properties"]["id"].is_object());
        assert!(json["properties"]["world_version"].is_object());
    }
}
