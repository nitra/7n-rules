//! Конверсія DTO між приватними Component Model біндінгами (`crate::wit`)
//! і публічними DTO `rules-contract` — ABI-межа цього крейта (рішення М
//! спеки: жоден wasmtime/wit-bindgen тип не перетинає публічну поверхню
//! `rules-plugin-host`). `Diagnostic::data` тут конвертується між
//! `Option<serde_json::Value>` (rules-contract) і WIT `option<string>`
//! (JSON-рядок) — та сама межа, що задокументована в
//! `rules_contract::diagnostic`.

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::{Diagnostic, Severity};
use rules_contract::fix::{FileEdit, FixPlan, FixRequest, WriteBytesFile, WriteFile};
use rules_contract::manifest::{Capabilities, ConcernContribution, ConcernScope, Domain, Manifest};
use rules_contract::slots::ci_artifact::{
    CiArtifactDescriptor, CiArtifactFormat, CiArtifactMergeStrategy, CiArtifactMode,
};
use rules_contract::tool::LogLevel;

use crate::error::PluginHostError;
use crate::wit;

pub(crate) fn log_level_from_wit(level: wit::LogLevel) -> LogLevel {
    match level {
        wit::LogLevel::Debug => LogLevel::Debug,
        wit::LogLevel::Info => LogLevel::Info,
        wit::LogLevel::Warn => LogLevel::Warn,
        wit::LogLevel::Error => LogLevel::Error,
    }
}

fn severity_from_wit(severity: wit::Severity) -> Severity {
    match severity {
        wit::Severity::Error => Severity::Error,
        wit::Severity::Warn => Severity::Warn,
    }
}

fn severity_to_wit(severity: Severity) -> wit::Severity {
    match severity {
        Severity::Error => wit::Severity::Error,
        Severity::Warn => wit::Severity::Warn,
    }
}

fn domain_from_wit(domain: wit::Domain) -> Domain {
    match domain {
        wit::Domain::Lint => Domain::Lint,
        wit::Domain::EcosystemOutdated => Domain::EcosystemOutdated,
        wit::Domain::DocgenRender => Domain::DocgenRender,
    }
}

fn ci_artifact_format_from_wit(
    format: wit::n_rules::slots::ci_artifact::Format,
) -> CiArtifactFormat {
    match format {
        wit::n_rules::slots::ci_artifact::Format::Yaml => CiArtifactFormat::Yaml,
    }
}

fn ci_artifact_mode_from_wit(mode: wit::n_rules::slots::ci_artifact::Mode) -> CiArtifactMode {
    match mode {
        wit::n_rules::slots::ci_artifact::Mode::RequiredFile => CiArtifactMode::RequiredFile,
        wit::n_rules::slots::ci_artifact::Mode::PatchExisting => CiArtifactMode::PatchExisting,
    }
}

fn ci_artifact_merge_strategy_from_wit(
    strategy: wit::n_rules::slots::ci_artifact::MergeStrategy,
) -> CiArtifactMergeStrategy {
    match strategy {
        wit::n_rules::slots::ci_artifact::MergeStrategy::DeepSubset => {
            CiArtifactMergeStrategy::DeepSubset
        }
        wit::n_rules::slots::ci_artifact::MergeStrategy::ContainsStep => {
            CiArtifactMergeStrategy::ContainsStep
        }
    }
}

fn concern_scope_from_wit(scope: wit::ConcernScope) -> ConcernScope {
    match scope {
        wit::ConcernScope::PerFile => ConcernScope::PerFile,
        wit::ConcernScope::Full => ConcernScope::Full,
    }
}

/// Задача N2 (передумова full-scope мосту): `Manifest::concerns` — тепер
/// структурована контрибуція, не голий рядок (доккомент `wit/world.wit`,
/// `record concern-contribution`).
fn concern_contribution_from_wit(contribution: wit::ConcernContribution) -> ConcernContribution {
    ConcernContribution {
        key: contribution.key,
        scope: concern_scope_from_wit(contribution.scope),
        glob: contribution.glob,
        // Мажор `4.0.0` (§2.84): порожній `fix-glob` тут НЕ нормалізується
        // у `glob` — fallback живе рівно в одному місці
        // (`ConcernContribution::effective_fix_glob`), тож DTO зберігає те,
        // що гість реально задекларував. Нормалізація на цій межі стерла б
        // різницю «розділив скоупи» / «не розділяв» уже на вході.
        fix_glob: contribution.fix_glob,
    }
}

fn ci_artifact_descriptor_from_wit(descriptor: wit::CiArtifactDescriptor) -> CiArtifactDescriptor {
    CiArtifactDescriptor {
        target_capability: descriptor.target_capability,
        artifact_id: descriptor.artifact_id,
        target_path: descriptor.target_path,
        format: ci_artifact_format_from_wit(descriptor.format),
        mode: ci_artifact_mode_from_wit(descriptor.mode),
        template: descriptor.template,
        merge_strategy: ci_artifact_merge_strategy_from_wit(descriptor.merge_strategy),
        fix: descriptor.fix,
    }
}

/// `describe()` guest → публічний `Manifest` (host → крейт-споживач).
pub(crate) fn manifest_from_wit(manifest: wit::Manifest) -> Manifest {
    Manifest {
        id: manifest.id,
        version: manifest.version,
        world_version: manifest.world_version,
        domains: manifest.domains.into_iter().map(domain_from_wit).collect(),
        concerns: manifest
            .concerns
            .into_iter()
            .map(concern_contribution_from_wit)
            .collect(),
        // Мажор `4.0.0` (§2.84): другий, окремий список контрибуцій —
        // «лише fix, детект лишається за чинною реалізацією» (доккомент
        // `wit/world.wit` біля `manifest.fix-only-concerns`).
        fix_only_concerns: manifest
            .fix_only_concerns
            .into_iter()
            .map(concern_contribution_from_wit)
            .collect(),
        ci_artifacts: manifest
            .ci_artifacts
            .into_iter()
            .map(ci_artifact_descriptor_from_wit)
            .collect(),
        capabilities: Capabilities {
            fs_read: manifest.capabilities.fs_read,
            network: manifest.capabilities.network,
        },
        tools: manifest.tools,
    }
}

fn source_file_to_wit(file: &SourceFile) -> wit::SourceFile {
    wit::SourceFile {
        path: file.path.clone(),
        content: file.content.clone(),
    }
}

/// Вхід `detect` (крейт-споживач → guest).
pub(crate) fn detect_batch_to_wit(batch: &DetectBatch) -> wit::DetectBatch {
    wit::DetectBatch {
        concern_id: batch.concern_id.clone(),
        files: batch.files.iter().map(source_file_to_wit).collect(),
    }
}

/// Одна діагностика guest → публічний `Diagnostic`. `data` — JSON-рядок на
/// WIT-боці, `Option<serde_json::Value>` на боці DTO (доккомент
/// `rules_contract::diagnostic`); невалідний JSON від плагіна — типізована
/// помилка, не паніка (плагін недовірений код).
fn diagnostic_from_wit(diagnostic: wit::Diagnostic) -> Result<Diagnostic, PluginHostError> {
    let data = diagnostic
        .data
        .map(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw).map_err(|err| {
                PluginHostError::InvalidContractData(format!(
                    "diagnostic.data не є валідним JSON: {err}"
                ))
            })
        })
        .transpose()?;
    Ok(Diagnostic {
        reason: diagnostic.reason,
        message: diagnostic.message,
        file: diagnostic.file,
        severity: severity_from_wit(diagnostic.severity),
        data,
    })
}

/// Результат `detect` guest → публічний `Vec<Diagnostic>`.
pub(crate) fn diagnostics_from_wit(
    diagnostics: Vec<wit::Diagnostic>,
) -> Result<Vec<Diagnostic>, PluginHostError> {
    diagnostics.into_iter().map(diagnostic_from_wit).collect()
}

fn diagnostic_to_wit(diagnostic: &Diagnostic) -> wit::Diagnostic {
    wit::Diagnostic {
        reason: diagnostic.reason.clone(),
        message: diagnostic.message.clone(),
        file: diagnostic.file.clone(),
        severity: severity_to_wit(diagnostic.severity),
        // `unwrap_or_default` тут неможливий (Value не має "порожнього"
        // варіанту, що завжди валідний рядок) — серіалізація `Value` в
        // JSON-рядок не може провалитись (`serde_json::to_string` на
        // `Value` — total-функція).
        data: diagnostic.data.as_ref().map(|value| {
            serde_json::to_string(value).expect("serde_json::Value завжди серіалізується")
        }),
    }
}

/// Вхід `fix` (крейт-споживач → guest).
pub(crate) fn fix_request_to_wit(request: &FixRequest) -> wit::FixRequest {
    wit::FixRequest {
        concern_id: request.concern_id.clone(),
        files: request.files.iter().map(source_file_to_wit).collect(),
        diagnostics: request.diagnostics.iter().map(diagnostic_to_wit).collect(),
    }
}

fn file_edit_from_wit(edit: wit::FileEdit) -> FileEdit {
    match edit {
        wit::FileEdit::Write(write) => FileEdit::Write(WriteFile {
            path: write.path,
            content: write.content,
        }),
        wit::FileEdit::Delete(path) => FileEdit::Delete { path },
        // Мажор `4.0.0` (§2.84): байти з canonical ABI (`list<u8>`) їдуть
        // у DTO як `Vec<u8>` без жодного перекодування — base64
        // зʼявляється лише на наступній межі, napi→JS (доккомент
        // `rules_contract::fix`).
        wit::FileEdit::WriteBytes(write) => FileEdit::WriteBytes(WriteBytesFile {
            path: write.path,
            content: write.content,
        }),
    }
}

/// Результат `fix` guest → публічний `FixPlan`.
pub(crate) fn fix_plan_from_wit(plan: wit::FixPlan) -> FixPlan {
    FixPlan {
        edits: plan.edits.into_iter().map(file_edit_from_wit).collect(),
    }
}
