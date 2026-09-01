//! Автогенеровані Component Model біндінги `n-rules:caps/registry-reader@1.0.0`
//! (`wasmtime::component::bindgen!` на `crates/rules-contract/wit`, S1 карти
//! `docs/specs/2026-08-30-contract-roadmap-blocked-concerns.md` §2.2/§2.3,
//! реалізовано за зразком кроку 4.1 спеки
//! `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1: окремий приватний
//! модуль, той самий прийом, що `crate::caps_file_reader`/
//! `crate::caps_llm_consumer` — незалежний `Host`-трейт
//! (`RegistryReaderImports`), власна `add_to_linker_imports`, вибіркове
//! долінкування через `crate::world_linker`.
//!
//! `imports: { default: async }` — той самий мотив, що інші `caps_*`-модулі
//! (доккомент `crate::wit`): однорідний async-виклик усіх host-функцій на
//! `Engine` із `wasm_component_model_async(true)`.
wasmtime::component::bindgen!({
    path: "../rules-contract/wit",
    world: "n-rules:caps/registry-reader@1.0.0",
    imports: { default: async },
});

use std::future::Future;
use std::pin::Pin;

use rules_contract::slots::ci_artifact::{
    CiArtifactFormat, CiArtifactMergeStrategy, CiArtifactMode,
};
use rules_core::ci_artifact_registry::{
    CiArtifactCandidate, ResolvedCiArtifact as CoreResolvedCiArtifact,
};

/// `Future`, вироблений [`RegistryProvider`] — той самий alias-патерн, що
/// [`crate::caps_llm_consumer::BoxFuture`].
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Ін'єктована точка доступу до host-рівневого реєстру (S1 карти, §2.2/§2.3:
/// «хост знає, гість не має права знати») — той самий DI-мотив, що
/// [`crate::caps_llm_consumer::LlmCaller`]/[`crate::tool_resolver::ToolResolver`]:
/// граф підключених плагінів і `.n-rules.json` (`active-domains`), чужі
/// пакети й canonical-шаблони (`resolve-ci-artifacts`) — ресурси, які
/// `rules-plugin-host` сам НЕ discovers (той граф лишається JS/оркестраційним
/// шаром, доккомент `rules_core::ci_artifact_registry`), тож провайдер
/// ін'єктується ЗЗОВНІ (`rules-napi`/`rules-cli`), а не побудований усередині
/// цього крейта.
///
/// `None` з будь-якого методу — легітимний стан «хост НЕ МАЄ реєстру» (WIT
/// `option`, без `domain-error`-каналу — доккомент `registry-reader.wit`),
/// не помилка: [`NoRegistryProvider`] — коректний дефолт [`crate::PluginHost::new`]
/// для викликачів, які ще не інʼєктували реальний провайдер.
pub trait RegistryProvider: Send + Sync {
    /// Активні lint-домени для `path` (repo-relative) — `None`, якщо хост не
    /// тримає реєстру для цього виклику.
    fn active_domains(&self, path: &str) -> BoxFuture<'static, Option<Vec<String>>>;

    /// Резолвлений граф `ci.artifact@1` для `target_capability` — `None` з
    /// тієї самої причини.
    fn resolve_ci_artifacts(
        &self,
        target_capability: &str,
    ) -> BoxFuture<'static, Option<Vec<CoreResolvedCiArtifact>>>;
}

/// Дефолтний провайдер [`crate::PluginHost::new`] — хост БЕЗ ін'єктованого
/// реєстру: обидва методи чесно повертають `None` (skip-not-crash, той
/// самий стан, що невідомий slot `host-context`), а не вигадують порожню
/// відповідь. Продакшн-викликачі (`rules-napi`), коли дістануть реальний
/// граф, переходять на `PluginHost::new_with_registry_provider`.
pub(crate) struct NoRegistryProvider;

impl RegistryProvider for NoRegistryProvider {
    fn active_domains(&self, _path: &str) -> BoxFuture<'static, Option<Vec<String>>> {
        Box::pin(async { None })
    }

    fn resolve_ci_artifacts(
        &self,
        _target_capability: &str,
    ) -> BoxFuture<'static, Option<Vec<CoreResolvedCiArtifact>>> {
        Box::pin(async { None })
    }
}

/// Провайдер над уже зібраним переліком candidate-ів (S1b, §2.3 карти):
/// [`rules_core::ci_artifact_registry::resolve_ci_artifacts`] робить колізійну
/// перевірку й читання шаблонів host-side, ЦЕЙ тип лише тримає готовий вхід
/// (граф резолвить caller — доккомент модуля `rules_core::ci_artifact_registry`)
/// і `by_rule`/`enabled`/`changed`-трійку для `active-domains`
/// (`rules_core::ci_plan::compute_active_domains`).
pub struct StaticRegistryProvider {
    active_domains: Option<Vec<String>>,
    ci_artifact_candidates: Option<Vec<CiArtifactCandidate>>,
}

impl StaticRegistryProvider {
    /// `active_domains`/`ci_artifact_candidates`: `None` — хост не має
    /// відповідного реєстру для ЖОДНОГО запиту (легітимний стан, доккомент
    /// [`RegistryProvider`]); `Some` — фіксована відповідь на БУДЬ-ЯКИЙ
    /// `path`/`target_capability` (production caller типово будує один
    /// `StaticRegistryProvider` на один `detect`/`fix`-виклик, де
    /// `path`/`target_capability` вже відомі з контексту виклику — той
    /// самий per-call мотив, що `LoadedPlugin::set_repo_root`).
    #[must_use]
    pub fn new(
        active_domains: Option<Vec<String>>,
        ci_artifact_candidates: Option<Vec<CiArtifactCandidate>>,
    ) -> Self {
        Self {
            active_domains,
            ci_artifact_candidates,
        }
    }
}

impl RegistryProvider for StaticRegistryProvider {
    fn active_domains(&self, _path: &str) -> BoxFuture<'static, Option<Vec<String>>> {
        let value = self.active_domains.clone();
        Box::pin(async move { value })
    }

    fn resolve_ci_artifacts(
        &self,
        target_capability: &str,
    ) -> BoxFuture<'static, Option<Vec<CoreResolvedCiArtifact>>> {
        let Some(candidates) = self.ci_artifact_candidates.clone() else {
            return Box::pin(async { None });
        };
        let target_capability = target_capability.to_string();
        Box::pin(async move {
            let scoped: Vec<CiArtifactCandidate> = candidates
                .into_iter()
                .filter(|c| c.descriptor.target_capability == target_capability)
                .collect();
            let (resolved, _collisions, _errors) =
                rules_core::ci_artifact_registry::resolve_ci_artifacts(scoped);
            Some(resolved)
        })
    }
}

fn format_to_wit(format: CiArtifactFormat) -> n_rules::slots::ci_artifact::Format {
    match format {
        CiArtifactFormat::Yaml => n_rules::slots::ci_artifact::Format::Yaml,
    }
}

fn mode_to_wit(mode: CiArtifactMode) -> n_rules::slots::ci_artifact::Mode {
    match mode {
        CiArtifactMode::RequiredFile => n_rules::slots::ci_artifact::Mode::RequiredFile,
        CiArtifactMode::PatchExisting => n_rules::slots::ci_artifact::Mode::PatchExisting,
    }
}

fn merge_strategy_to_wit(
    strategy: CiArtifactMergeStrategy,
) -> n_rules::slots::ci_artifact::MergeStrategy {
    match strategy {
        CiArtifactMergeStrategy::DeepSubset => {
            n_rules::slots::ci_artifact::MergeStrategy::DeepSubset
        }
        CiArtifactMergeStrategy::ContainsStep => {
            n_rules::slots::ci_artifact::MergeStrategy::ContainsStep
        }
    }
}

/// Конверсія `rules_core::ci_artifact_registry::ResolvedCiArtifact` (DTO,
/// незалежний від wasmtime) → WIT `resolved-ci-artifact` цього world-а —
/// зворотний напрям [`crate::convert::ci_artifact_descriptor_from_wit`]
/// (доккомент `crate::convert`: та функція йде WIT→DTO для `manifest.ci_artifacts`,
/// ця — DTO→WIT для host-відповіді, окремий, незалежний біндінг-модуль).
pub(crate) fn resolved_ci_artifact_to_wit(value: CoreResolvedCiArtifact) -> ResolvedCiArtifact {
    ResolvedCiArtifact {
        descriptor: CiArtifactDescriptor {
            target_capability: value.descriptor.target_capability,
            artifact_id: value.descriptor.artifact_id,
            target_path: value.descriptor.target_path,
            format: format_to_wit(value.descriptor.format),
            mode: mode_to_wit(value.descriptor.mode),
            template: value.descriptor.template,
            merge_strategy: merge_strategy_to_wit(value.descriptor.merge_strategy),
            fix: value.descriptor.fix,
        },
        template_content: value.template_content,
        provenance: value.provenance,
    }
}

/// Ре-експорт для caller-ів (`rules-napi`), що будують `CiArtifactCandidate`-и
/// для [`StaticRegistryProvider::new`] — не мусять імпортувати `rules_core`
/// окремо лише заради цього типу.
pub use rules_core::ci_artifact_registry::CiArtifactCandidate as RegistryCiArtifactCandidate;
