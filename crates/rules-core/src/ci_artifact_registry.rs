//! Host-side резолв графа `ci.artifact@1` для `n-rules:caps/registry-reader@1.0.0::resolve-ci-artifacts`
//! (S1b карти `docs/specs/2026-08-30-contract-roadmap-blocked-concerns.md`
//! §2.3) — 1:1 семантичний порт `splitCiArtifactCollisions`
//! (`npm/scripts/lib/ci-artifact-collect.mjs`), плюс читання canonical-шаблону,
//! якого JS-оригінал НЕ робить (шаблон там читає провайдер-специфічний
//! `main.mjs` кожного consumer-а окремо; тут читання винесено в те саме
//! host-side місце, де вже відбувається колізійна перевірка — гість не
//! бачить чужого пакета взагалі, доккомент `registry-reader.wit`).
//!
//! # Хто зобов'язаний зібрати `candidates`
//!
//! Цей модуль НЕ ходить у npm-плагінний граф (`resolveSlotGraph`
//! /`getSlotContributions`, `npm/scripts/lib/plugin-slots.mjs`) — той граф
//! і сьогодні лишається JS-оркестрацією (доккомент модуля не вигадує
//! Rust-порт discovery, якого немає). [`CiArtifactCandidate`] — вже
//! резолвлена contribution (дескриптор + корінь пакета, що її зробив +
//! provenance), яку caller (`rules-napi`/майбутній `rules-cli`-двійник)
//! зібрав ДО виклику [`split_collisions`]/[`resolve_ci_artifacts`] — той
//! самий контур ін'єкції, що вже несе `ToolResolver`
//! (`crates/rules-plugin-host::ToolResolver`, задача N1): хост рахує
//! відповідь із уже зібраних входів, а сам граф резолвить оркестратор.

use std::path::{Path, PathBuf};

use rules_contract::slots::ci_artifact::CiArtifactDescriptor;
use rules_contract::validators::ci_artifact::{
    is_safe_repo_relative_path, is_safe_template_rel_path,
};

/// Одна вже зарезолвлена `ci.artifact@1`-contribution ДО колізійної
/// перевірки — вхід [`split_collisions`]/[`resolve_ci_artifacts`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CiArtifactCandidate {
    pub descriptor: CiArtifactDescriptor,
    /// Абсолютний корінь ПАКЕТА-джерела contribution-а (не consumer-репо) —
    /// `descriptor.template` резолвиться відносно цього кореня (доккомент
    /// `ci-artifact.wit::descriptor.template`).
    pub package_root: PathBuf,
    /// Provenance для діагностик і для `resolved-ci-artifact.provenance` —
    /// той самий формат, що JS `${pluginName}#${id}`
    /// (`reportCiArtifactCollectionDiagnostics`).
    pub provenance: String,
}

/// Одна виявлена колізія — той самий `{ artifactId, group }`, що JS
/// `splitCiArtifactCollisions`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CiArtifactCollision {
    pub artifact_id: String,
    pub provenances: Vec<String>,
}

/// Групує `candidates` за `artifact-id` і виявляє domain collision (spec
/// §9.10, 1:1 порт `splitCiArtifactCollisions`): той самий `artifact-id` від
/// ДВОХ РІЗНИХ contributions (різна `provenance`) — колізія, обидва
/// candidate-и випадають із `relevant`. Порядок `relevant` — порядок входу
/// (стабільний `retain`), не пересортований: той самий контракт, що JS
/// (`candidates.filter`, зберігає порядок графа).
#[must_use]
pub fn split_collisions(
    candidates: Vec<CiArtifactCandidate>,
) -> (Vec<CiArtifactCandidate>, Vec<CiArtifactCollision>) {
    use std::collections::BTreeMap;

    let mut by_artifact_id: BTreeMap<String, Vec<&CiArtifactCandidate>> = BTreeMap::new();
    for candidate in &candidates {
        by_artifact_id
            .entry(candidate.descriptor.artifact_id.clone())
            .or_default()
            .push(candidate);
    }

    let mut collided_ids = std::collections::BTreeSet::new();
    let mut collisions = Vec::new();
    for (artifact_id, group) in &by_artifact_id {
        let mut distinct: Vec<&str> = group.iter().map(|c| c.provenance.as_str()).collect();
        distinct.sort_unstable();
        distinct.dedup();
        if distinct.len() > 1 {
            collided_ids.insert(artifact_id.clone());
            collisions.push(CiArtifactCollision {
                artifact_id: artifact_id.clone(),
                provenances: group.iter().map(|c| c.provenance.clone()).collect(),
            });
        }
    }

    let relevant = candidates
        .into_iter()
        .filter(|c| !collided_ids.contains(&c.descriptor.artifact_id))
        .collect();
    (relevant, collisions)
}

/// Один резолвлений артефакт — форма, яку `n-rules:caps/registry-reader@1.0.0`
/// віддає гостю (`resolved-ci-artifact`): дескриптор + прочитаний вміст
/// canonical-шаблону + provenance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCiArtifact {
    pub descriptor: CiArtifactDescriptor,
    pub template_content: String,
    pub provenance: String,
}

/// Помилка читання одного candidate-а — не валить увесь виклик (той самий
/// fail-loud-БЕЗ-fail-stop принцип, що host-diff §2.83: одна побита
/// contribution не ховає решту, але й не проходить мовчки — `reason`
/// призначений для `log` host-функції).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CiArtifactReadError {
    pub artifact_id: String,
    pub provenance: String,
    pub reason: String,
}

/// Повний резолв: колізії (доккомент [`split_collisions`]) + читання
/// canonical-шаблону кожного candidate-а, що лишився, з package_root.
/// Не-UTF-8 шаблон, небезпечний `template`-шлях чи відсутній файл — типізована
/// відмова ЦЬОГО candidate-а (`errors`), не паніка й не мовчазний пропуск
/// усього виклику: той самий клас гучності, що
/// `rules-napi::non_utf8_source_file_err` (§2.83 реєстру відкритих питань).
#[must_use]
pub fn resolve_ci_artifacts(
    candidates: Vec<CiArtifactCandidate>,
) -> (
    Vec<ResolvedCiArtifact>,
    Vec<CiArtifactCollision>,
    Vec<CiArtifactReadError>,
) {
    let (relevant, collisions) = split_collisions(candidates);
    let mut resolved = Vec::new();
    let mut errors = Vec::new();
    for candidate in relevant {
        match read_template(&candidate.package_root, &candidate.descriptor.template) {
            Ok(template_content) => resolved.push(ResolvedCiArtifact {
                descriptor: candidate.descriptor,
                template_content,
                provenance: candidate.provenance,
            }),
            Err(reason) => errors.push(CiArtifactReadError {
                artifact_id: candidate.descriptor.artifact_id,
                provenance: candidate.provenance,
                reason,
            }),
        }
    }
    (resolved, collisions, errors)
}

/// Читає canonical-шаблон candidate-а: `template` (`./…`-relative до
/// `package_root`, доккомент `ci-artifact.wit::descriptor.template`) —
/// форму звіряє [`is_safe_template_rel_path`] (без `..`, з `./`), сам
/// `package_root` мусить лишатись коренем ПАКЕТА (не consumer-репо, доккомент
/// [`CiArtifactCandidate::package_root`]), тож додатковий `is_safe_repo_relative_path`-
/// прогін ТУТ не потрібен — небезпека вже виключена формою `template`.
fn read_template(package_root: &Path, template: &str) -> Result<String, String> {
    if !is_safe_template_rel_path(template) {
        return Err(format!(
            "template `{template}` не є безпечним package-relative шляхом (має починатись з \
             `./`, без `..`-сегментів)"
        ));
    }
    // `./foo/bar` → `foo/bar`, щоб `Path::join` не сплутав `./` із коренем
    // ОС (`Path::join` з абсолютним аргументом ігнорує базу — тут аргумент
    // відносний, тож ризику нема, але префікс `./` варто зняти явно для
    // читабельності побудованого шляху в помилках).
    let relative = template.strip_prefix("./").unwrap_or(template);
    debug_assert!(is_safe_repo_relative_path(relative) || relative.is_empty());
    let path = package_root.join(relative);
    let bytes =
        std::fs::read(&path).map_err(|err| format!("не вдалось прочитати `{template}`: {err}"))?;
    String::from_utf8(bytes).map_err(|_| {
        format!("шаблон `{template}` не є валідним UTF-8 — байтових шаблонів у слоті не буває")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rules_contract::slots::ci_artifact::{
        CiArtifactFormat, CiArtifactMergeStrategy, CiArtifactMode,
    };

    fn descriptor(artifact_id: &str, template: &str) -> CiArtifactDescriptor {
        CiArtifactDescriptor {
            target_capability: "ci:github".to_string(),
            artifact_id: artifact_id.to_string(),
            target_path: ".github/workflows/demo.yml".to_string(),
            format: CiArtifactFormat::Yaml,
            mode: CiArtifactMode::RequiredFile,
            template: template.to_string(),
            merge_strategy: CiArtifactMergeStrategy::DeepSubset,
            fix: true,
        }
    }

    fn candidate(artifact_id: &str, provenance: &str, root: &Path) -> CiArtifactCandidate {
        CiArtifactCandidate {
            descriptor: descriptor(artifact_id, "./template.yml"),
            package_root: root.to_path_buf(),
            provenance: provenance.to_string(),
        }
    }

    #[test]
    fn no_collision_when_single_source_per_artifact_id() {
        let root = std::env::temp_dir();
        let candidates = vec![
            candidate("lint-demo", "plugin-a#lint-demo", &root),
            candidate("other-demo", "plugin-b#other-demo", &root),
        ];
        let (relevant, collisions) = split_collisions(candidates);
        assert_eq!(relevant.len(), 2);
        assert!(collisions.is_empty());
    }

    #[test]
    fn collision_detected_for_same_artifact_id_different_provenance() {
        let root = std::env::temp_dir();
        let candidates = vec![
            candidate("lint-demo", "plugin-a#lint-demo", &root),
            candidate("lint-demo", "plugin-b#lint-demo", &root),
        ];
        let (relevant, collisions) = split_collisions(candidates);
        assert!(
            relevant.is_empty(),
            "обидва candidate-и колізійного id мають випасти"
        );
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].artifact_id, "lint-demo");
        assert_eq!(collisions[0].provenances.len(), 2);
    }

    #[test]
    fn same_provenance_repeated_is_not_a_collision() {
        // Той самий candidate двічі в списку (напр. подвійне читання графа)
        // — та сама `provenance`, тобто НЕ дві різні contributions.
        let root = std::env::temp_dir();
        let candidates = vec![
            candidate("lint-demo", "plugin-a#lint-demo", &root),
            candidate("lint-demo", "plugin-a#lint-demo", &root),
        ];
        let (relevant, collisions) = split_collisions(candidates);
        assert_eq!(relevant.len(), 2);
        assert!(collisions.is_empty());
    }

    #[test]
    fn resolve_reads_template_content_from_package_root() {
        let dir = tempfile_dir();
        std::fs::write(dir.join("template.yml"), "steps:\n  - run: echo hi\n").unwrap();
        let candidates = vec![candidate("lint-demo", "plugin-a#lint-demo", &dir)];
        let (resolved, collisions, errors) = resolve_ci_artifacts(candidates);
        assert!(collisions.is_empty());
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].template_content, "steps:\n  - run: echo hi\n");
        assert_eq!(resolved[0].provenance, "plugin-a#lint-demo");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_reports_missing_template_as_typed_error_not_panic() {
        let dir = tempfile_dir();
        let candidates = vec![candidate("lint-demo", "plugin-a#lint-demo", &dir)];
        let (resolved, collisions, errors) = resolve_ci_artifacts(candidates);
        assert!(resolved.is_empty());
        assert!(collisions.is_empty());
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].artifact_id, "lint-demo");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_rejects_non_utf8_template_loudly() {
        let dir = tempfile_dir();
        std::fs::write(dir.join("template.yml"), [0xff, 0xfe, 0x00, 0xff]).unwrap();
        let candidates = vec![candidate("lint-demo", "plugin-a#lint-demo", &dir)];
        let (resolved, _collisions, errors) = resolve_ci_artifacts(candidates);
        assert!(resolved.is_empty());
        assert_eq!(errors.len(), 1);
        assert!(errors[0].reason.contains("UTF-8"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_rejects_unsafe_template_path() {
        let dir = tempfile_dir();
        let mut descriptor = descriptor("lint-demo", "../escape.yml");
        descriptor.template = "../escape.yml".to_string();
        let candidates = vec![CiArtifactCandidate {
            descriptor,
            package_root: dir.clone(),
            provenance: "plugin-a#lint-demo".to_string(),
        }];
        let (resolved, _collisions, errors) = resolve_ci_artifacts(candidates);
        assert!(resolved.is_empty());
        assert_eq!(errors.len(), 1);
        assert!(errors[0].reason.contains("package-relative"));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Ізольований tempdir на тест — уникає гонки паралельних тестів на
    /// спільному `template.yml` у `std::env::temp_dir()`.
    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ci-artifact-registry-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
