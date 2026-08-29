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
    /// Glob-и, за якими хост будує batch **саме для `fix`** (мажор `4.0.0`,
    /// §2.84, WIT `concern-contribution.fix-glob`). Порожній список —
    /// свідомий дефолт «fix ділить скоуп із детектом»: хост падає назад на
    /// [`Self::glob`], тобто рівно поведінка `3.x`.
    ///
    /// Мотив (§2.72): скоуп детекту й скоуп фіксу — різні величини, і поки
    /// glob був один, єдиним обхідним шляхом було РОЗШИРЕННЯ detect-скоупу
    /// заради fix-скоупу — вада, записана в реєстр тією ж §2.72.
    #[serde(default)]
    pub fix_glob: Vec<String>,
}

impl ConcernContribution {
    /// Ефективний glob для `fix`-шляху: [`Self::fix_glob`], якщо він
    /// непорожній, інакше [`Self::glob`] (доккомент поля). ЄДИНА точка, де
    /// цей fallback живе — щоб «забув перевірити `fix_glob`» у новому місці
    /// виклику було неможливо написати.
    pub fn effective_fix_glob(&self) -> &[String] {
        if self.fix_glob.is_empty() {
            &self.glob
        } else {
            &self.fix_glob
        }
    }
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
    /// Концерни, для яких плагін дає ЛИШЕ `fix`, а детект лишається за
    /// чинною реалізацією (`main.mjs`/policy/native) — мажор `4.0.0`, §2.84
    /// (WIT `manifest.fix-only-concerns`).
    ///
    /// Окремий список, а не прапорець у [`ConcernContribution`]: «fix-only»
    /// — окремий ВИД контрибуції, не атрибут scope-контрибуції (доккомент
    /// `wit/world.wit`). Ключ у ОБОХ списках одночасно — контрактна
    /// помилка, яку хост відхиляє гучно
    /// ([`crate::validators::manifest::validate_manifest`]).
    #[serde(default)]
    pub fix_only_concerns: Vec<ConcernContribution>,
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

impl Manifest {
    /// Контрибуція, за якою host будує **fix**-контур для `key`: спершу
    /// повна контрибуція ([`Self::concerns`] — плагін дає і детект, і fix),
    /// потім fix-only ([`Self::fix_only_concerns`], мажор `4.0.0`, §2.84).
    ///
    /// ЄДИНА точка цього пошуку — рівно з того самого мотиву, що
    /// [`ConcernContribution::effective_fix_glob`]: fix-шлях host-а читає
    /// контрибуцію у кількох місцях (батч `files`, обидва знімки host-diff,
    /// текст помилки `ambiguous_empty_fix_batch_err`), і «забув подивитись
    /// у другий список» у будь-якому з них дає ту саму тиху ваду — глоб
    /// невідомий, host-diff вимикається, exec-tool-фіксер повертає
    /// ПОРОЖНІЙ план, і JS-канон мовчки робить фікс удруге (§2.72).
    ///
    /// Порядок списків тут ні на що не впливає: ключ у ОБОХ списках
    /// одночасно host відхиляє ще на завантаженні плагіна
    /// ([`crate::validators::manifest::validate_manifest`]).
    pub fn fix_contribution(&self, key: &str) -> Option<&ConcernContribution> {
        self.concerns
            .iter()
            .chain(self.fix_only_concerns.iter())
            .find(|c| c.key == key)
    }
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
                fix_glob: vec![],
            }],
            fix_only_concerns: vec![],
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

    /// Порожній `fix_glob` означає «fix ділить скоуп із детектом» — хост
    /// падає назад на `glob`; непорожній — заміняє його цілком (не
    /// доповнює: обʼєднання двох списків зробило б fix-скоуп надмножиною
    /// detect-скоупу, тобто повернуло б рівно ту ваду §2.72, від якої поле
    /// й рятує).
    #[test]
    fn effective_fix_glob_falls_back_to_detect_glob_when_empty() {
        let shared = ConcernContribution {
            key: "rust/check".to_string(),
            scope: ConcernScope::Full,
            glob: vec!["Cargo.toml".to_string()],
            fix_glob: vec![],
        };
        assert_eq!(shared.effective_fix_glob(), ["Cargo.toml".to_string()]);

        let split = ConcernContribution {
            fix_glob: vec!["src/**/*.rs".to_string()],
            ..shared
        };
        assert_eq!(split.effective_fix_glob(), ["src/**/*.rs".to_string()]);
    }

    /// Обидва нових поля мажора `4.0.0` мають serde-дефолти: маніфест,
    /// серіалізований до бампу (чи руками написаний `plugin.toml`-довідник),
    /// читається без них.
    #[test]
    fn new_major_four_fields_default_to_empty() {
        let raw = serde_json::json!({
            "id": "x",
            "version": "0.1.0",
            "world_version": "4.0.0",
            "concerns": [{ "key": "a/b", "scope": "per-file", "glob": ["**/*.rs"] }],
        });
        let manifest: Manifest = serde_json::from_value(raw).unwrap();
        assert!(manifest.fix_only_concerns.is_empty());
        assert!(manifest.concerns[0].fix_glob.is_empty());
    }

    /// `fix_contribution` бачить ОБИДВА списки — і саме тому fix-only
    /// концерн не лишається без glob-а (без цього host-diff exec-tool
    /// фіксера мовчки вимикався б, доккомент методу).
    #[test]
    fn fix_contribution_finds_key_in_either_list() {
        let mut manifest = sample_manifest();
        manifest.fix_only_concerns = vec![ConcernContribution {
            key: "js/eslint".to_string(),
            scope: ConcernScope::PerFile,
            glob: vec!["**/*.mjs".to_string()],
            fix_glob: vec![],
        }];

        assert_eq!(
            manifest.fix_contribution("sample/concern").map(|c| c.scope),
            Some(ConcernScope::PerFile)
        );
        assert_eq!(
            manifest
                .fix_contribution("js/eslint")
                .map(ConcernContribution::effective_fix_glob),
            Some(["**/*.mjs".to_string()].as_slice())
        );
        assert!(manifest.fix_contribution("nope/none").is_none());
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
