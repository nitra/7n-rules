//! Native-порт **четвертого (останнього) шару** концерну `k8s/manifests` —
//! kustomize-резолюції та пʼяти залежних від неї `validate*`
//! (`npm/rules/k8s/manifests/main.mjs`).
//!
//! Це найдорожча частина кластера: усе тут тримається на **рекурсивному
//! обході дерева kustomization** (`resources` / `bases` / `components` /
//! `crds`), який читає з диска чужі каталоги, іде у вкладені
//! `kustomization.yaml` і будує з них інвентар ресурсів.
//!
//! # Таблиця відповідності
//!
//! | Rust | JS-канон |
//! |---|---|
//! | [`collect_resource_descriptors_for_kustomization_walk`] | `collectResourceDescriptorsForKustomizationWalk` (`main.mjs:1092-1180`) |
//! | [`collect_yaml_abs_paths_from_kustomization_tree`] | `collectYamlAbsPathsFromKustomizationTree` (`main.mjs:983-1063`) |
//! | [`kustomize_resource_tree_hpa_pdb_deployment_flags`] | `kustomizeResourceTreeHpaPdbDeploymentFlags` (`main.mjs:4479-4491`) |
//! | [`prod_overlay_hpa_pdb_override_needs`] | `prodOverlayHpaPdbOverrideNeeds` (`main.mjs:4713-4734`) |
//! | [`kustomization_tree_has_hasura_deployment`] | `kustomizationTreeHasHasuraDeployment` (`main.mjs:4779-4790`) |
//! | [`validate_kustomization_patch_targets_resolved`] | `validateKustomizationPatchTargetsResolved` (`main.mjs:1551-1557`) |
//! | [`validate_kustomize_hpa_pdb_only_with_base_deployment`] | `validateKustomizeHpaPdbOnlyWithBaseDeployment` (`main.mjs:4621-4653`) |
//! | [`validate_prod_kustomization_overrides`] | `validateProdKustomizationOverrides` (`main.mjs:4747-4757`) |
//! | [`validate_hasura_overlay_enabled_apis_override`] | `validateHasuraOverlayEnabledApisOverride` (`main.mjs:4929-4954`) |
//! | [`validate_hasura_overlay_enabled_log_types_override`] | `validateHasuraOverlayEnabledLogTypesOverride` (`main.mjs:4966-4991`) |
//!
//! # Два майже однакові обходи — свідомо обидва
//!
//! Канон має **два** рекурсивні обходи того самого дерева: один повертає
//! дескриптори ресурсів (для інвентарю patch-target-ів), другий — самі
//! шляхи YAML-файлів (для «чи є в base Deployment / Hasura-Deployment»).
//! Доккомент JS так і каже: «дублює обхід». Обидва перенесені окремо, бо
//! відрізняються не лише результатом: обхід дескрипторів парсить **кожен**
//! файл дерева, обхід шляхів — лише ті, що під `…/k8s/…/base/`. Злиття їх в
//! один змінило б набір читаних файлів, а отже і поведінку на битому YAML.
//!
//! # Спільний `visited` — не оптимізація, а частина семантики
//!
//! `visitedKustomization` передається **ззовні** і живе на весь один обхід:
//! повторний вхід у той самий `kustomization.yaml` дає **порожній** внесок,
//! а не другу копію ресурсів. Це і захист від циклів, і причина, чому
//! `hasHpa` для дерева з двома посиланнями на один base рахується один раз.
//!
//! # Де паритет свідомо не побайтовий
//!
//! `JSON.stringify(value)` у текстах порушень відтворено через
//! `serde_json::to_string` — ті самі дві межі, що описані в
//! [`super::k8s_manifests_workloads`] (порядок ключів вкладеного обʼєкта і
//! ціле, записане як `1.0`). У полях, які сюди доходять
//! (`HASURA_GRAPHQL_ENABLED_APIS`, `HASURA_GRAPHQL_ENABLED_LOG_TYPES`), це
//! завжди рядок.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::concerns::k8s_hasura::is_hasura_deployment_manifest;
use crate::concerns::k8s_manifests_cross_file::{
    has_yaml_extension, is_under_root, read_first_yaml_object, resolve_lexical,
};
use crate::concerns::k8s_manifests_per_file::{
    modeline_schema_url, to_lines, yaml_body_after_modeline,
};
use crate::concerns::k8s_manifests_rego::{rel_posix, rel_posix_raw, DEFAULT_REASON};
use crate::concerns::k8s_manifests_workloads::{
    is_dev_like_k8s_env_segment, is_k8s_yaml_under_base_directory, k8s_env_segment_from_rel_path,
};
use crate::diagnostics::{Severity, Violation};

/// Ім'я файла kustomization — порт `KUSTOMIZATION_FILE` (`main.mjs:6650`).
const KUSTOMIZATION_FILE: &str = "kustomization.yaml";

/// Очікуване `HASURA_GRAPHQL_ENABLED_APIS` у non-base/dev overlay — порт
/// `HASURA_OVERLAY_ENABLED_APIS` (`main.mjs:4760`).
const HASURA_OVERLAY_ENABLED_APIS: &str = "metadata,graphql";

/// JSON-Pointer ключа `HASURA_GRAPHQL_ENABLED_APIS` — порт
/// `HASURA_ENABLED_APIS_DATA_POINTER` (`main.mjs:4763`).
const HASURA_ENABLED_APIS_DATA_POINTER: &str = "/data/HASURA_GRAPHQL_ENABLED_APIS";

/// Очікуване `HASURA_GRAPHQL_ENABLED_LOG_TYPES` у non-base/dev overlay — порт
/// `HASURA_OVERLAY_ENABLED_LOG_TYPES` (`main.mjs:4766`).
const HASURA_OVERLAY_ENABLED_LOG_TYPES: &str = "startup";

/// JSON-Pointer ключа `HASURA_GRAPHQL_ENABLED_LOG_TYPES` — порт
/// `HASURA_ENABLED_LOG_TYPES_DATA_POINTER` (`main.mjs:4769`).
const HASURA_ENABLED_LOG_TYPES_DATA_POINTER: &str = "/data/HASURA_GRAPHQL_ENABLED_LOG_TYPES";

/// Вбудовані та поширені **кластерні** `kind` — порт `CLUSTER_SCOPED_KINDS`
/// (`main.mjs:251-280`). Для них `metadata.namespace` не застосовується, тож
/// дескриптор ресурсу лишається з порожнім namespace навіть коли
/// `kustomization.yaml` задає дефолтний.
const CLUSTER_SCOPED_KINDS: &[&str] = &[
    "APIService",
    "CertificateSigningRequest",
    "ClusterCIDR",
    "ClusterRole",
    "ClusterRoleBinding",
    "ComponentStatus",
    "CSIDriver",
    "CSINode",
    "CustomResourceDefinition",
    "FlowSchema",
    "IPAddress",
    "IngressClass",
    "MutatingWebhookConfiguration",
    "Namespace",
    "Node",
    "PersistentVolume",
    "PriorityClass",
    "PriorityLevelConfiguration",
    "RuntimeClass",
    "ServiceCIDR",
    "StorageClass",
    "StorageVersionMigration",
    "ValidatingAdmissionPolicy",
    "ValidatingAdmissionPolicyBinding",
    "ValidatingWebhookConfiguration",
    "VolumeAttachment",
];

/// Порушення без machine-специфічного `reason` — так їх реєструє `fail(msg)`
/// концерну (`reason` = `ctx.concernId`).
fn violation(message: String) -> Violation {
    Violation {
        reason: DEFAULT_REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

// ─── Примітиви ───────────────────────────────────────────────────────────────

/// Ім'я файла як рядок (порожній рядок, якщо його немає).
fn basename(abs: &Path) -> String {
    abs.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Непорожній trimmed-рядок за ключем обʼєкта, інакше `None`.
fn trimmed_str<'a>(obj: &'a Value, key: &str) -> Option<&'a str> {
    obj.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// Дескриптор ресурсу для звірки з `target` Kustomize / strategic-merge
/// фрагментом — порт `KustomizeResourceDescriptor` (`main.mjs:755`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KustomizeResourceDescriptor {
    group: String,
    version: String,
    kind: String,
    name: String,
    namespace: String,
}

/// Розбиває `apiVersion` на group і version — порт `splitK8sApiVersion`
/// (`main.mjs:763-776`).
fn split_k8s_api_version(api_version: Option<&Value>) -> (String, String) {
    let Some(raw) = api_version.and_then(Value::as_str) else {
        return (String::new(), String::new());
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (String::new(), String::new());
    }
    match trimmed.find('/') {
        None => (String::new(), trimmed.to_string()),
        Some(index) => (
            trimmed[..index].to_string(),
            trimmed[index + 1..].to_string(),
        ),
    }
}

/// Будує дескриптор з маніфесту — порт `kustomizeResourceDescriptorFromManifest`
/// (`main.mjs:914-942`). `Kustomization` і документи без `metadata.name`
/// пропускаються.
fn kustomize_resource_descriptor_from_manifest(
    obj: &Value,
    kustomization_default_ns: &str,
) -> Option<KustomizeResourceDescriptor> {
    let kind = trimmed_str(obj, "kind")?;
    if kind == "Kustomization" {
        return None;
    }
    let metadata = obj.get("metadata").filter(|meta| meta.is_object());
    let name = metadata.and_then(|meta| trimmed_str(meta, "name"))?;
    let (group, version) = split_k8s_api_version(obj.get("apiVersion"));
    let namespace = if CLUSTER_SCOPED_KINDS.contains(&kind) {
        String::new()
    } else {
        metadata
            .and_then(|meta| trimmed_str(meta, "namespace"))
            .unwrap_or_else(|| kustomization_default_ns.trim())
            .to_string()
    };
    Some(KustomizeResourceDescriptor {
        group,
        version,
        kind: kind.to_string(),
        name: name.to_string(),
        namespace,
    })
}

/// Шляхи лише з полів ресурсів Kustomization — порт
/// `resourcePathRefsFromKustomizationObject` (`main.mjs:739-751`) разом із
/// `pushStringPaths` (`main.mjs:295-300`): порядок полів значущий, бо від
/// нього залежить порядок обходу дерева, а отже і порядок повідомлень.
fn resource_path_refs_from_kustomization_object(obj: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if !obj.is_object() {
        return out;
    }
    for key in ["resources", "bases", "components", "crds"] {
        let Some(items) = obj.get(key).and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            if let Some(text) = item.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    out.push(trimmed.to_string());
                }
            }
        }
    }
    out
}

/// Тіло YAML після modeline (якщо він у першому рядку) — порт зв'язки
/// `toLines` + `MODELINE_RE.test(lines[0])` + `yamlBodyAfterModeline`
/// (`main.mjs:1105-1106` і близнюки).
fn yaml_body_without_leading_modeline(raw: &str) -> String {
    let lines = to_lines(raw);
    if lines
        .first()
        .is_some_and(|line| modeline_schema_url(line).is_some())
    {
        yaml_body_after_modeline(&lines)
    } else {
        lines.join("\n")
    }
}

/// Парсить YAML-текст і лишає лише корені-обʼєкти — порт
/// `parseK8sYamlDocumentObjectRoots` (`main.mjs:1865-1875`).
fn parse_yaml_object_roots(body: &str) -> Vec<Value> {
    serde_yaml::Deserializer::from_str(body)
        .filter_map(|doc| serde_yaml::Value::deserialize(doc).ok())
        .filter_map(|value| serde_json::to_value(value).ok())
        .filter(Value::is_object)
        .collect()
}

/// Читає k8s YAML і повертає корені документів-обʼєктів — порт
/// `readK8sYamlDocumentRootsForInventory` (`main.mjs:949-972`).
fn read_k8s_yaml_document_roots_for_inventory(abs: &Path) -> Vec<Value> {
    let Ok(raw) = std::fs::read_to_string(abs) else {
        return Vec::new();
    };
    parse_yaml_object_roots(&yaml_body_without_leading_modeline(&raw))
}

/// Перший документ файла як обʼєкт (або `None`) — порт спільного початку обох
/// обходів (`main.mjs:1099-1120`): читання, зріз modeline, `parseAllDocuments`,
/// `docs[0]?.toJSON()` з відсіюванням не-обʼєктів.
///
/// Відмінність від [`read_first_yaml_object`] принципова: тут береться саме
/// **перший** документ, і якщо він не обʼєкт — обхід зупиняється, а не шукає
/// наступний.
fn first_document_object_of_kustomization(abs: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(abs).ok()?;
    let body = yaml_body_without_leading_modeline(&raw);
    let first = serde_yaml::Deserializer::from_str(&body)
        .next()
        .and_then(|doc| serde_yaml::Value::deserialize(doc).ok())
        .and_then(|value| serde_json::to_value(value).ok())?;
    first.is_object().then_some(first)
}

/// Дефолтний namespace kustomization — порт `rec.namespace`-гілки
/// (`main.mjs:1122`).
fn kustomization_default_namespace(kust: &Value) -> String {
    trimmed_str(kust, "namespace")
        .unwrap_or_default()
        .to_string()
}

/// Абсолютний шлях до `kustomization.yaml` у каталозі, якщо файл існує — порт
/// `existsSync(join(resolved, 'kustomization.yaml')) ? … : null`
/// (`main.mjs:1051`, `main.mjs:1168`).
fn child_kustomization(dir: &Path) -> Option<PathBuf> {
    let candidate = dir.join(KUSTOMIZATION_FILE);
    candidate.is_file().then_some(candidate)
}

/// Куди веде одне посилання з `resources`/`bases`/`components`/`crds` — спільна
/// частина обох обходів (`main.mjs:1024-1056` і `main.mjs:1135-1173`).
enum ResourceRefTarget {
    /// YAML-файл під коренем репо.
    YamlFile(PathBuf),
    /// Каталог із власним `kustomization.yaml` — рекурсія.
    NestedKustomization(PathBuf),
    /// Посилання, яке обхід ігнорує (URL, вихід за корінь, неіснуючий шлях,
    /// каталог без `kustomization.yaml`, файл без YAML-розширення).
    Ignored,
}

/// Резолвить одне посилання ресурсу — спільна перша частина
/// `handleResourcePathRef` / `handleResourceDescriptorPathRef`.
fn resolve_resource_ref(kust_dir: &Path, root_norm: &Path, reference: &str) -> ResourceRefTarget {
    if reference.contains("://") {
        return ResourceRefTarget::Ignored;
    }
    let resolved = resolve_lexical(kust_dir, reference);
    if !is_under_root(root_norm, &resolved) {
        return ResourceRefTarget::Ignored;
    }
    let Ok(meta) = std::fs::metadata(&resolved) else {
        return ResourceRefTarget::Ignored;
    };
    if meta.is_file() {
        if has_yaml_extension(&resolved) {
            return ResourceRefTarget::YamlFile(resolved);
        }
        return ResourceRefTarget::Ignored;
    }
    if !meta.is_dir() {
        return ResourceRefTarget::Ignored;
    }
    match child_kustomization(&resolved) {
        Some(child) => ResourceRefTarget::NestedKustomization(child),
        None => ResourceRefTarget::Ignored,
    }
}

// ─── Обхід дерева kustomization ──────────────────────────────────────────────

/// Збирає дескриптори ресурсів з дерева kustomization — порт
/// `collectResourceDescriptorsForKustomizationWalk` (`main.mjs:1092-1180`).
pub(crate) fn collect_resource_descriptors_for_kustomization_walk(
    kust_abs: &Path,
    root_norm: &Path,
    visited: &mut HashSet<PathBuf>,
) -> Vec<KustomizeResourceDescriptor> {
    let norm_kust = resolve_lexical(kust_abs, "");
    if !visited.insert(norm_kust.clone()) {
        return Vec::new();
    }
    let Some(first) = first_document_object_of_kustomization(&norm_kust) else {
        return Vec::new();
    };
    let kust_ns = kustomization_default_namespace(&first);
    let kust_dir = norm_kust.parent().unwrap_or(&norm_kust).to_path_buf();

    let mut out = Vec::new();
    for reference in resource_path_refs_from_kustomization_object(&first) {
        match resolve_resource_ref(&kust_dir, root_norm, &reference) {
            ResourceRefTarget::YamlFile(path) => {
                for doc in read_k8s_yaml_document_roots_for_inventory(&path) {
                    if let Some(descriptor) =
                        kustomize_resource_descriptor_from_manifest(&doc, &kust_ns)
                    {
                        out.push(descriptor);
                    }
                }
            }
            ResourceRefTarget::NestedKustomization(child) => {
                out.extend(collect_resource_descriptors_for_kustomization_walk(
                    &child, root_norm, visited,
                ));
            }
            ResourceRefTarget::Ignored => {}
        }
    }
    out
}

/// Збирає абсолютні шляхи YAML-файлів з дерева kustomization — порт
/// `collectYamlAbsPathsFromKustomizationTree` (`main.mjs:983-1063`).
fn collect_yaml_abs_paths_from_kustomization_tree(
    kust_abs: &Path,
    root_norm: &Path,
    visited: &mut HashSet<PathBuf>,
) -> Vec<PathBuf> {
    let norm_kust = resolve_lexical(kust_abs, "");
    if !visited.insert(norm_kust.clone()) {
        return Vec::new();
    }
    let Some(first) = first_document_object_of_kustomization(&norm_kust) else {
        return Vec::new();
    };
    let kust_dir = norm_kust.parent().unwrap_or(&norm_kust).to_path_buf();

    let mut out = Vec::new();
    for reference in resource_path_refs_from_kustomization_object(&first) {
        match resolve_resource_ref(&kust_dir, root_norm, &reference) {
            ResourceRefTarget::YamlFile(path) => out.push(path),
            ResourceRefTarget::NestedKustomization(child) => {
                out.extend(collect_yaml_abs_paths_from_kustomization_tree(
                    &child, root_norm, visited,
                ));
            }
            ResourceRefTarget::Ignored => {}
        }
    }
    out
}

/// Чи є в дереві kustomization документ, що задовольняє `predicate`, у YAML під
/// `…/k8s/…/base/` — спільне ядро `kustomizationTreeHasDeploymentUnderK8sBase`
/// (`main.mjs:1071-1082`) і `kustomizationTreeHasHasuraDeployment`
/// (`main.mjs:4779-4790`): у канону це два дослівно однакові цикли, що
/// різняться лише предикатом на документі.
fn kustomization_tree_has_base_doc(
    kust_abs: &Path,
    root_norm: &Path,
    predicate: impl Fn(&Value) -> bool,
) -> bool {
    let mut visited = HashSet::new();
    let paths = collect_yaml_abs_paths_from_kustomization_tree(kust_abs, root_norm, &mut visited);
    for abs in paths {
        let rel = rel_posix_raw(root_norm, &abs);
        if !is_k8s_yaml_under_base_directory(&rel) {
            continue;
        }
        if read_k8s_yaml_document_roots_for_inventory(&abs)
            .iter()
            .any(&predicate)
        {
            return true;
        }
    }
    false
}

/// Чи в дереві kustomization є `Deployment` під `…/k8s/…/base/` — порт
/// `kustomizationTreeHasDeploymentUnderK8sBase` (`main.mjs:1071-1082`).
fn kustomization_tree_has_deployment_under_k8s_base(kust_abs: &Path, root_norm: &Path) -> bool {
    kustomization_tree_has_base_doc(kust_abs, root_norm, |doc| {
        doc.get("kind").and_then(Value::as_str) == Some("Deployment")
    })
}

/// Чи дерево kustomization містить Hasura-Deployment у шарі base — порт
/// `kustomizationTreeHasHasuraDeployment` (`main.mjs:4779-4790`).
pub(crate) fn kustomization_tree_has_hasura_deployment(kust_abs: &Path, root_norm: &Path) -> bool {
    kustomization_tree_has_base_doc(kust_abs, root_norm, is_hasura_deployment_manifest)
}

/// Прапорці наявності `Deployment` / HPA / PDB у дереві kustomization — порт
/// `kustomizeResourceTreeHpaPdbDeploymentFlags` (`main.mjs:4479-4491`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct KustomizeTreeFlags {
    has_deployment: bool,
    has_hpa: bool,
    has_pdb: bool,
}

/// Порт `kustomizeResourceTreeHpaPdbDeploymentFlags` (`main.mjs:4479-4491`).
pub(crate) fn kustomize_resource_tree_hpa_pdb_deployment_flags(
    kust_abs: &Path,
    root_norm: &Path,
) -> KustomizeTreeFlags {
    let mut visited = HashSet::new();
    let descriptors =
        collect_resource_descriptors_for_kustomization_walk(kust_abs, root_norm, &mut visited);
    KustomizeTreeFlags {
        has_deployment: kustomization_tree_has_deployment_under_k8s_base(kust_abs, root_norm),
        has_hpa: descriptors
            .iter()
            .any(|descriptor| descriptor.kind == "HorizontalPodAutoscaler"),
        has_pdb: descriptors
            .iter()
            .any(|descriptor| descriptor.kind == "PodDisruptionBudget"),
    }
}

/// Кеш прапорців дерева на один прогін `validate*` — порт
/// `treeFlagsMemo` (`main.mjs:4626-4640`). Ключ — нормалізований шлях, як і в
/// канону (`resolve(kustPath)`).
#[derive(Default)]
struct TreeFlagsMemo {
    cache: BTreeMap<PathBuf, KustomizeTreeFlags>,
}

impl TreeFlagsMemo {
    fn get(&mut self, kust_path: &Path, root_norm: &Path) -> KustomizeTreeFlags {
        let key = resolve_lexical(kust_path, "");
        if let Some(flags) = self.cache.get(&key) {
            return *flags;
        }
        let flags = kustomize_resource_tree_hpa_pdb_deployment_flags(&key, root_norm);
        self.cache.insert(key, flags);
        flags
    }
}

// ─── patch target: інвентар і надлишкові поля ────────────────────────────────

/// Чи patch-`target` використовує селектор — порт `patchTargetUsesSelector`
/// (`main.mjs:783-802`): непорожній обʼєкт або непорожній рядок у
/// `labelSelector` / `annotationSelector`.
fn patch_target_uses_selector(target: &Value) -> bool {
    ["labelSelector", "annotationSelector"]
        .iter()
        .any(|key| match target.get(*key) {
            Some(Value::Object(map)) => !map.is_empty(),
            Some(Value::String(text)) => !text.trim().is_empty(),
            _ => false,
        })
}

/// Чи `target` варто звіряти з інвентарем — порт
/// `shouldValidateKustomizePatchTarget` (`main.mjs:809-820`).
fn should_validate_kustomize_patch_target(target: &Value) -> bool {
    if !target.is_object() {
        return false;
    }
    if trimmed_str(target, "kind").is_none() || trimmed_str(target, "name").is_none() {
        return false;
    }
    !patch_target_uses_selector(target)
}

/// Чи `target` відповідає дескриптору — порт
/// `kustomizePatchTargetMatchesDescriptor` (`main.mjs:828-851`): пропущені поля
/// `target` не звужують добір, як і в самому Kustomize.
fn kustomize_patch_target_matches_descriptor(
    target: &Value,
    res: &KustomizeResourceDescriptor,
) -> bool {
    let (Some(kind), Some(name)) = (
        target.get("kind").and_then(Value::as_str),
        target.get("name").and_then(Value::as_str),
    ) else {
        return false;
    };
    if kind.trim() != res.kind || name.trim() != res.name {
        return false;
    }
    for (key, expected) in [
        ("group", &res.group),
        ("version", &res.version),
        ("namespace", &res.namespace),
    ] {
        if let Some(value) = trimmed_str(target, key) {
            if expected != value {
                return false;
            }
        }
    }
    true
}

/// Чи є в каталозі ресурс під `target` — порт
/// `kustomizeResourceCatalogMatchesPatchTarget` (`main.mjs:859-864`).
fn kustomize_resource_catalog_matches_patch_target(
    catalog: &[KustomizeResourceDescriptor],
    target: &Value,
) -> bool {
    if !should_validate_kustomize_patch_target(target) {
        return true;
    }
    catalog
        .iter()
        .any(|res| kustomize_patch_target_matches_descriptor(target, res))
}

/// Один запис `patches[]` / `patchesJson6902[]` з явним `target`.
struct ExplicitPatchTarget {
    section: &'static str,
    index: usize,
    target: Value,
}

/// Витягує записи з явним `target` — порт
/// `extractExplicitPatchTargetsFromKustomization` (`main.mjs:1187-1221`).
/// Ключ `target` рахується **за наявністю** (`'target' in it`), а не за
/// «непорожнім значенням»: `target: null` теж потрапляє в перелік.
fn extract_explicit_patch_targets(kust: &Value) -> Vec<ExplicitPatchTarget> {
    let mut out = Vec::new();
    if !kust.is_object() {
        return out;
    }
    for section in ["patches", "patchesJson6902"] {
        let Some(items) = kust.get(section).and_then(Value::as_array) else {
            continue;
        };
        for (offset, item) in items.iter().enumerate() {
            let Some(map) = item.as_object() else {
                continue;
            };
            if let Some(target) = map.get("target") {
                out.push(ExplicitPatchTarget {
                    section,
                    index: offset + 1,
                    target: target.clone(),
                });
            }
        }
    }
    out
}

/// Людинозчитуваний опис `target` — порт
/// `formatKustomizePatchTargetForMessage` (`main.mjs:1228-1255`).
fn format_patch_target_for_message(target: &Value) -> String {
    if !target.is_object() {
        return match target {
            Value::Null => "null".to_string(),
            Value::String(text) => text.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
    }
    let parts: Vec<String> = ["group", "version", "kind", "name", "namespace"]
        .iter()
        .filter_map(|key| trimmed_str(target, key).map(|value| format!("{key}={value}")))
        .collect();
    if parts.is_empty() {
        serde_json::to_string(target).unwrap_or_default()
    } else {
        parts.join(", ")
    }
}

/// Опис надлишкових `group`/`version` — порт `describePatchTargetRedundancy`
/// (`main.mjs:1301-1322`).
fn describe_patch_target_redundancy(
    entry: &ExplicitPatchTarget,
    catalog: &[KustomizeResourceDescriptor],
) -> Option<(String, String, Vec<&'static str>)> {
    let target = &entry.target;
    if !target.is_object() {
        return None;
    }
    let kind = trimmed_str(target, "kind")?;
    let name = trimmed_str(target, "name")?;
    if patch_target_uses_selector(target) {
        return None;
    }
    let group = trimmed_str(target, "group");
    let version = trimmed_str(target, "version");
    if group.is_none() && version.is_none() {
        return None;
    }
    let distinct_gvk: BTreeSet<String> = catalog
        .iter()
        .filter(|res| res.kind == kind && res.name == name)
        .map(|res| format!("{}/{}", res.group, res.version))
        .collect();
    if distinct_gvk.len() > 1 {
        return None;
    }
    let mut redundant = Vec::new();
    if group.is_some() {
        redundant.push("group");
    }
    if version.is_some() {
        redundant.push("version");
    }
    Some((kind.to_string(), name.to_string(), redundant))
}

// ─── validateKustomizationPatchTargetsResolved ───────────────────────────────

/// Резолвить існуючий YAML-файл під коренем — порт
/// `resolveExistingYamlFileUnderRoot` (`main.mjs:1367-1385`).
fn resolve_existing_yaml_file_under_root(
    kust_dir: &Path,
    path_str: &str,
    root_norm: &Path,
) -> Option<PathBuf> {
    let resolved = resolve_lexical(kust_dir, path_str);
    if !is_under_root(root_norm, &resolved) {
        return None;
    }
    let meta = std::fs::metadata(&resolved).ok()?;
    (meta.is_file() && has_yaml_extension(&resolved)).then_some(resolved)
}

/// Спільний контекст перевірки patch-посилань одного `kustomization.yaml` —
/// шість значень, які канон тягне через усі `failIf*`-хелпери окремими
/// аргументами (`main.mjs:1336-1485`).
struct PatchCatalogContext<'a> {
    /// Шлях самого `kustomization.yaml` для тексту порушення.
    rel: &'a str,
    /// Корінь репо як його передали в `validate*` (для `relative`).
    root: &'a Path,
    /// Той самий корінь у нормалізованій формі (для перевірки виходу за межі).
    root_norm: &'a Path,
    /// Каталог `kustomization.yaml`, від якого резолвляться посилання.
    kust_dir: &'a Path,
    /// Інвентар ресурсів дерева.
    catalog: &'a [KustomizeResourceDescriptor],
    /// Дефолтний namespace із `kustomization.yaml`.
    kust_ns: &'a str,
}

/// Документи patch-файла проти інвентарю — порт
/// `failIfYamlFileRootsMissingFromCatalog` (`main.mjs:1336-1358`).
fn yaml_file_roots_missing_from_catalog(
    ctx: &PatchCatalogContext<'_>,
    resolved_abs: &Path,
    rel_patch_fallback: &str,
    violation_intro: &str,
    out: &mut Vec<Violation>,
) {
    let (rel, root) = (ctx.rel, ctx.root);
    for (offset, doc) in read_k8s_yaml_document_roots_for_inventory(resolved_abs)
        .iter()
        .enumerate()
    {
        let doc_idx = offset + 1;
        let Some(descriptor) = kustomize_resource_descriptor_from_manifest(doc, ctx.kust_ns) else {
            continue;
        };
        if ctx.catalog.contains(&descriptor) {
            continue;
        }
        let rel_patch_raw = rel_posix_raw(root, resolved_abs);
        let rel_patch = if rel_patch_raw.is_empty() {
            rel_patch_fallback.to_string()
        } else {
            rel_patch_raw
        };
        let namespace = if descriptor.namespace.is_empty() {
            "(порожньо)".to_string()
        } else {
            descriptor.namespace.clone()
        };
        let group = if descriptor.group.is_empty() {
            "core".to_string()
        } else {
            descriptor.group.clone()
        };
        out.push(violation(format!(
            "{rel}: {violation_intro} «{rel_patch}» документ {doc_idx} — у каталозі resources немає ресурсу {}/{} (namespace={namespace}, apiVersion group/version={group}/{})",
            descriptor.kind, descriptor.name, descriptor.version
        )));
    }
}

/// `patches[]` лише з `path` — порт `failIfOnePathOnlyPatchNotInCatalog`
/// (`main.mjs:1400-1425`).
fn path_only_patch_violations(
    ctx: &PatchCatalogContext<'_>,
    patch: &Value,
    index: usize,
    out: &mut Vec<Violation>,
) {
    let Some(map) = patch.as_object() else { return };
    let has_target_key = map.get("target").is_some_and(|value| !value.is_null());
    let path_str = map
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let inline_patch = map
        .get("patch")
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty());
    if has_target_key || path_str.is_empty() || inline_patch || path_str.contains("://") {
        return;
    }
    let Some(resolved) =
        resolve_existing_yaml_file_under_root(ctx.kust_dir, path_str, ctx.root_norm)
    else {
        return;
    };
    yaml_file_roots_missing_from_catalog(
        ctx,
        &resolved,
        path_str,
        &format!("patches[{index}] path"),
        out,
    );
}

/// Один `kustomization.yaml` — порт `validatePatchTargetsOneKustomizationFile`
/// (`main.mjs:1495-1542`).
fn patch_targets_one_kustomization_file(
    root: &Path,
    kust_abs: &Path,
    root_norm: &Path,
    out: &mut Vec<Violation>,
) {
    let rel = rel_posix(root, kust_abs);
    let raw = match std::fs::read_to_string(kust_abs) {
        Ok(raw) => raw,
        Err(error) => {
            out.push(violation(format!(
                "{rel}: не вдалося прочитати для перевірки patch target ({error})"
            )));
            return;
        }
    };
    let body = yaml_body_without_leading_modeline(&raw);
    let Some(first) = serde_yaml::Deserializer::from_str(&body)
        .next()
        .and_then(|doc| serde_yaml::Value::deserialize(doc).ok())
        .and_then(|value| serde_json::to_value(value).ok())
        .filter(Value::is_object)
    else {
        return;
    };
    if first.get("kind").and_then(Value::as_str) != Some("Kustomization") {
        return;
    }
    let mut visited = HashSet::new();
    let catalog =
        collect_resource_descriptors_for_kustomization_walk(kust_abs, root_norm, &mut visited);
    let kust_dir = resolve_lexical(kust_abs, "")
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| kust_abs.to_path_buf());
    let kust_ns = kustomization_default_namespace(&first);
    let ctx = PatchCatalogContext {
        rel: &rel,
        root,
        root_norm,
        kust_dir: &kust_dir,
        catalog: &catalog,
        kust_ns: &kust_ns,
    };

    for entry in extract_explicit_patch_targets(&first) {
        if !kustomize_resource_catalog_matches_patch_target(&catalog, &entry.target) {
            out.push(violation(format!(
                "{rel}: {}[{}].target — немає відповідного ресурсу в resources/bases/components/crds (рекурсивно): {}",
                entry.section,
                entry.index,
                format_patch_target_for_message(&entry.target)
            )));
        }
    }
    for entry in extract_explicit_patch_targets(&first) {
        let Some((kind, name, redundant)) = describe_patch_target_redundancy(&entry, &catalog)
        else {
            continue;
        };
        out.push(violation(format!(
            "{rel}: {}[{}].target — прибери зайві поля {}; для kind={kind}, name={name} в інвентарі немає колізії між різними API-групами/версіями (див. k8s.mdc «patches[].target: лише kind і name»)",
            entry.section,
            entry.index,
            redundant.join(", ")
        )));
    }
    if let Some(patches) = first.get("patches").and_then(Value::as_array) {
        for (offset, patch) in patches.iter().enumerate() {
            path_only_patch_violations(&ctx, patch, offset + 1, out);
        }
    }
    if let Some(items) = first.get("patchesStrategicMerge").and_then(Value::as_array) {
        for (offset, item) in items.iter().enumerate() {
            let Some(reference) = item.as_str() else {
                continue;
            };
            let trimmed = reference.trim();
            if trimmed.is_empty() || reference.contains("://") {
                continue;
            }
            let Some(resolved) =
                resolve_existing_yaml_file_under_root(&kust_dir, trimmed, root_norm)
            else {
                continue;
            };
            yaml_file_roots_missing_from_catalog(
                &ctx,
                &resolved,
                reference,
                &format!("patchesStrategicMerge[{}]", offset + 1),
                out,
            );
        }
    }
}

/// Усі `kustomization.yaml` під `k8s`: patch-`target` і strategic-merge
/// посилання не вказують на ресурс поза інвентарем — порт
/// `validateKustomizationPatchTargetsResolved` (`main.mjs:1551-1557`).
pub fn validate_kustomization_patch_targets_resolved(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    let root_norm = resolve_lexical(root, "");
    let mut out = Vec::new();
    for kust_abs in yaml_files
        .iter()
        .filter(|abs| basename(abs).to_lowercase() == KUSTOMIZATION_FILE)
    {
        patch_targets_one_kustomization_file(root, kust_abs, &root_norm, &mut out);
    }
    out
}

// ─── validateKustomizeHpaPdbOnlyWithBaseDeployment ───────────────────────────

/// Чи relative-шлях — `…/k8s/…/base/kustomization.yaml` — порт
/// `isK8sBaseKustomizationRelPath` (`main.mjs:4386-4393`): дивиться на
/// **батьківський каталог**, а не на весь шлях.
fn is_k8s_base_kustomization_rel_path(rel: &str) -> bool {
    let dir = match rel.rfind('/') {
        Some(index) => &rel[..index],
        None => ".",
    };
    let last = dir.rsplit('/').next().unwrap_or(dir);
    if last != "base" {
        return false;
    }
    dir.starts_with("k8s/") || dir.contains("/k8s/")
}

/// Чи relative-шлях каталогу лежить під `k8s` — порт `isUnderK8sPathRelToRoot`
/// (`main.mjs:4402-4411`).
fn is_under_k8s_path_rel_to_root(root_norm: &Path, dir_abs: &Path) -> bool {
    let rel = rel_posix_raw(root_norm, dir_abs);
    if rel.is_empty() || rel == "." {
        return false;
    }
    if rel.starts_with("../") || rel == ".." {
        return false;
    }
    rel == "k8s" || rel.starts_with("k8s/") || rel.contains("/k8s/")
}

/// Чи каталог — k8s-`base` із `kustomization.yaml` — порт `isK8sBaseDir`
/// (`main.mjs:4434-4445`).
fn is_k8s_base_dir(resolved: &Path, root_norm: &Path) -> bool {
    if basename(resolved) != "base" {
        return false;
    }
    if !resolved.join(KUSTOMIZATION_FILE).exists() {
        return false;
    }
    if !is_under_k8s_path_rel_to_root(root_norm, resolved) {
        return false;
    }
    std::fs::metadata(resolved).is_ok_and(|meta| meta.is_dir())
}

/// Каталоги `…/base` серед посилань kustomize — порт
/// `k8sBaseDirsFromKustomizeResourcePathRefs` (`main.mjs:4454-4469`): без
/// дедуплікації, як у канону.
fn k8s_base_dirs_from_resource_path_refs(
    kust_dir: &Path,
    path_refs: &[String],
    root_norm: &Path,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for reference in path_refs {
        if reference.contains("://") || reference.trim().is_empty() {
            continue;
        }
        let resolved = resolve_lexical(kust_dir, reference.trim());
        if is_under_root(root_norm, &resolved) && is_k8s_base_dir(&resolved, root_norm) {
            out.push(resolved);
        }
    }
    out
}

/// Чи серед документів файла є HPA або PDB — порт
/// `yamlFileContainsHpaOrPdbDocument` (`main.mjs:4498-4514`).
///
/// Свідома різниця з обходом інвентарю: тут modeline **не** зрізається —
/// канон читає файл сирим `tryReadFileUtf8` і віддає в `parseAllDocuments`
/// як є. Для `# …`-коментаря це нешкідливо (YAML його ковтає), але
/// відтворено дослівно, щоб на екзотичному вмісті обидві реалізації
/// поводились однаково.
fn yaml_file_contains_hpa_or_pdb_document(file_abs: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(file_abs) else {
        return false;
    };
    let docs: Vec<Value> = serde_yaml::Deserializer::from_str(&raw)
        .filter_map(|doc| serde_yaml::Value::deserialize(doc).ok())
        .filter_map(|value| serde_json::to_value(value).ok())
        .filter(Value::is_object)
        .collect();
    docs.iter().any(|doc| {
        matches!(
            doc.get("kind").and_then(Value::as_str),
            Some("HorizontalPodAutoscaler") | Some("PodDisruptionBudget")
        )
    })
}

/// Чи файл усередині каталогу — порт `isResolvedFileUnderDirectory`
/// (`main.mjs:4419-4427`).
fn is_resolved_file_under_directory(dir_abs: &Path, file_abs: &Path) -> bool {
    let rel = rel_posix_raw(dir_abs, file_abs);
    if rel.is_empty() || rel == "." {
        return true;
    }
    !rel.starts_with("../") && rel != ".."
}

/// Одне посилання overlay — порт `checkOverlayRefHpaPdb` (`main.mjs:4587-4610`).
fn overlay_ref_hpa_pdb_violation(
    root_norm: &Path,
    kust_dir: &Path,
    rel: &str,
    reference: &str,
    base_dirs: &[PathBuf],
    any_base_has_dep: bool,
) -> Option<Violation> {
    let file_abs = resolve_lexical(kust_dir, reference.trim());
    if !is_under_root(root_norm, &file_abs) || !file_abs.exists() {
        return None;
    }
    let meta = std::fs::metadata(&file_abs).ok()?;
    if !meta.is_file() || !has_yaml_extension(&file_abs) {
        return None;
    }
    if base_dirs
        .iter()
        .any(|base| is_resolved_file_under_directory(base, &file_abs))
    {
        return None;
    }
    if !yaml_file_contains_hpa_or_pdb_document(&file_abs) {
        return None;
    }
    if any_base_has_dep {
        // pass-гілка канону — детектор її не репортить.
        return None;
    }
    Some(violation(format!(
        "{rel}: посилання «{reference}» містить HorizontalPodAutoscaler і/або PodDisruptionBudget, а наслідуваний k8s/base не дає у дереві Deployment — прибери HPA/PDB або додай Deployment у base (k8s.mdc)"
    )))
}

/// Overlay, що посилається на base — порт
/// `verifyOverlayHpaPdbFileRefsRespectBaseDeployment` (`main.mjs:4550-4574`).
fn overlay_hpa_pdb_file_refs_violations(
    root_norm: &Path,
    kust_abs: &Path,
    rel: &str,
    kust: &Value,
    memo: &mut TreeFlagsMemo,
    out: &mut Vec<Violation>,
) {
    let kust_dir = kust_abs.parent().unwrap_or(kust_abs).to_path_buf();
    let path_refs = resource_path_refs_from_kustomization_object(kust);
    let base_dirs = k8s_base_dirs_from_resource_path_refs(&kust_dir, &path_refs, root_norm);
    if base_dirs.is_empty() {
        return;
    }
    let any_base_has_dep = base_dirs
        .iter()
        .map(|base| memo.get(&base.join(KUSTOMIZATION_FILE), root_norm))
        .any(|flags| flags.has_deployment);
    for reference in &path_refs {
        if reference.contains("://") || reference.trim().is_empty() {
            continue;
        }
        if let Some(found) = overlay_ref_hpa_pdb_violation(
            root_norm,
            &kust_dir,
            rel,
            reference,
            &base_dirs,
            any_base_has_dep,
        ) {
            out.push(found);
        }
    }
}

/// HPA/PDB у base-дереві заборонені; overlay не додає їх без Deployment у
/// base — порт `validateKustomizeHpaPdbOnlyWithBaseDeployment`
/// (`main.mjs:4621-4653`).
pub fn validate_kustomize_hpa_pdb_only_with_base_deployment(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    let root_norm = resolve_lexical(root, "");
    let mut memo = TreeFlagsMemo::default();
    let mut out = Vec::new();
    for kust_abs in yaml_files
        .iter()
        .filter(|abs| basename(abs).to_lowercase() == KUSTOMIZATION_FILE)
    {
        let rel = rel_posix(&root_norm, kust_abs);
        let Some(kust) = read_first_yaml_object(kust_abs) else {
            continue;
        };
        if is_k8s_base_kustomization_rel_path(&rel) {
            let flags = memo.get(kust_abs, &root_norm);
            if flags.has_hpa || flags.has_pdb {
                out.push(violation(format!(
                    "{rel}: у base-дереві kustomize є HorizontalPodAutoscaler і/або PodDisruptionBudget — HPA/PDB заборонені у base, переведіть у sibling каталог components/ і підключайте з overlay (k8s.mdc)"
                )));
            }
        } else {
            overlay_hpa_pdb_file_refs_violations(
                &root_norm, kust_abs, &rel, &kust, &mut memo, &mut out,
            );
        }
    }
    out
}

// ─── JSON6902 / Strategic Merge: шляхи, які змінює inline-patch ──────────────

/// Перший YAML-документ тексту patch як JSON — порт
/// `firstValidYamlJsonFromPatchText` (`main.mjs:4797-4811`).
fn first_valid_yaml_json_from_patch_text(patch_text: &str) -> Option<Value> {
    serde_yaml::Deserializer::from_str(patch_text)
        .next()
        .and_then(|doc| serde_yaml::Value::deserialize(doc).ok())
        .and_then(|value| serde_json::to_value(value).ok())
}

/// Операції JSON6902 з тексту patch — порт
/// `collectJson6902OperationsFromPatchText` (`main.mjs:1998-2027`) разом із
/// `extractJson6902OpsFromArray` (`main.mjs:1967-1990`). JSON-гілка канону
/// (`t.startsWith('[')` + `JSON.parse`) тут не потрібна окремо: JSON —
/// підмножина YAML, і той самий текст уже розібрано вище.
fn collect_json6902_operations(patch_text: &str) -> Vec<(String, String)> {
    let trimmed = patch_text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for doc in serde_yaml::Deserializer::from_str(trimmed)
        .filter_map(|doc| serde_yaml::Value::deserialize(doc).ok())
        .filter_map(|value| serde_json::to_value(value).ok())
    {
        let Some(items) = doc.as_array() else {
            continue;
        };
        for item in items {
            let (Some(op), Some(path)) = (
                item.get("op").and_then(Value::as_str),
                item.get("path").and_then(Value::as_str),
            ) else {
                continue;
            };
            let path = path.trim();
            if !path.is_empty() {
                out.push((op.trim().to_lowercase(), path.to_string()));
            }
        }
        return out;
    }
    out
}

/// Плоскі JSON-Pointer-шляхи до листків обʼєкта — порт `walk` усередині
/// `kustomizePatchModifiedPaths` (`main.mjs:4265-4276`): проміжні обʼєкти
/// «зміненими» не вважаються, масив — листок.
fn strategic_merge_leaf_paths(node: &Value, prefix: &str, out: &mut BTreeSet<String>) {
    let Some(map) = node.as_object() else { return };
    for (key, value) in map {
        let path = format!("{prefix}/{key}");
        if value.is_object() {
            strategic_merge_leaf_paths(value, &path, out);
        } else {
            out.insert(path);
        }
    }
}

/// Шляхи, які змінює один inline `patch` — порт `kustomizePatchModifiedPaths`
/// (`main.mjs:4237-4279`).
fn kustomize_patch_modified_paths(patch_text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let trimmed = patch_text.trim();
    if trimmed.is_empty() {
        return out;
    }
    let ops = collect_json6902_operations(patch_text);
    if !ops.is_empty() {
        out.extend(ops.into_iter().map(|(_, path)| path));
        return out;
    }
    let Some(parsed) = first_valid_yaml_json_from_patch_text(trimmed) else {
        return out;
    };
    if !parsed.is_object() {
        return out;
    }
    strategic_merge_leaf_paths(&parsed, "", &mut out);
    out
}

/// `kind` зі Strategic-Merge-тіла — порт `strategicMergePatchKind`
/// (`main.mjs:4287-4302`).
fn strategic_merge_patch_kind(patch_text: &str) -> Option<String> {
    let trimmed = patch_text.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_yaml::Deserializer::from_str(trimmed)
        .filter_map(|doc| serde_yaml::Value::deserialize(doc).ok())
        .filter_map(|value| serde_json::to_value(value).ok())
        .filter(Value::is_object)
        .find_map(|doc| {
            doc.get("kind")
                .and_then(Value::as_str)
                .filter(|kind| !kind.is_empty())
                .map(str::to_string)
        })
}

/// `kind` цілі одного inline patch — порт `resolvePatchTargetKind`
/// (`main.mjs:4313-4321`).
fn resolve_patch_target_kind(patch: &Value) -> Option<String> {
    if let Some(target) = patch.get("target").filter(|value| value.is_object()) {
        if let Some(kind) = target
            .get("kind")
            .and_then(Value::as_str)
            .filter(|kind| !kind.is_empty())
        {
            return Some(kind.to_string());
        }
    }
    patch
        .get("patch")
        .and_then(Value::as_str)
        .and_then(strategic_merge_patch_kind)
}

/// Шляхи всіх inline `patches[]`, згруповані за `kind` цілі — порт
/// `kustomizationPatchPathsByTargetKind` (`main.mjs:4345-4357`).
fn kustomization_patch_paths_by_target_kind(kust: &Value) -> BTreeMap<String, BTreeSet<String>> {
    let mut by_kind: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let Some(patches) = kust.get("patches").and_then(Value::as_array) else {
        return by_kind;
    };
    for patch in patches {
        if !patch.is_object() {
            continue;
        }
        let Some(text) = patch.get("patch").and_then(Value::as_str) else {
            continue;
        };
        let Some(kind) = resolve_patch_target_kind(patch) else {
            continue;
        };
        by_kind
            .entry(kind)
            .or_default()
            .extend(kustomize_patch_modified_paths(text));
    }
    by_kind
}

// ─── validateProdKustomizationOverrides ──────────────────────────────────────

/// Які прод-оверрайди потрібні для `kustomization.yaml` — порт
/// `prodOverlayHpaPdbOverrideNeeds` (`main.mjs:4713-4734`).
pub(crate) fn prod_overlay_hpa_pdb_override_needs(
    root_norm: &Path,
    kust_abs: &Path,
) -> (bool, bool) {
    let rel = rel_posix(root_norm, kust_abs);
    let segment = k8s_env_segment_from_rel_path(&rel);
    if segment.is_none() || is_dev_like_k8s_env_segment(segment) {
        return (false, false);
    }
    if read_first_yaml_object(kust_abs)
        .and_then(|kust| kust.get("kind").and_then(Value::as_str).map(str::to_string))
        .as_deref()
        == Some("Component")
    {
        return (false, false);
    }
    let flags = kustomize_resource_tree_hpa_pdb_deployment_flags(kust_abs, root_norm);
    (flags.has_hpa, flags.has_pdb)
}

/// Прод-оверрайди у `patches[]` — порт `checkProdOverridesInKustomization`
/// (`main.mjs:4667-4695`), pass-гілка опущена (детектор її не репортить).
fn prod_overrides_violations(
    kust: &Value,
    rel: &str,
    needs_hpa: bool,
    needs_pdb: bool,
    out: &mut Vec<Violation>,
) {
    let by_kind = kustomization_patch_paths_by_target_kind(kust);
    let empty = BTreeSet::new();
    let hpa_paths = by_kind.get("HorizontalPodAutoscaler").unwrap_or(&empty);
    let pdb_paths = by_kind.get("PodDisruptionBudget").unwrap_or(&empty);
    if needs_hpa {
        if !hpa_paths.contains("/spec/minReplicas") {
            out.push(violation(format!(
                "{rel}: прод-оверлей має перевизначати spec.minReplicas для HorizontalPodAutoscaler (мінімум 2 у проді) (k8s.mdc)"
            )));
        }
        if !hpa_paths.contains("/spec/maxReplicas") {
            out.push(violation(format!(
                "{rel}: прод-оверлей має перевизначати spec.maxReplicas для HorizontalPodAutoscaler (мінімум 2 у проді) (k8s.mdc)"
            )));
        }
    }
    if needs_pdb && !pdb_paths.contains("/spec/minAvailable") {
        out.push(violation(format!(
            "{rel}: прод-оверлей має перевизначати spec.minAvailable для PodDisruptionBudget (мінімум 1 у проді) (k8s.mdc)"
        )));
    }
}

/// Прод-оверлеї мають перевизначати HPA/PDB-межі — порт
/// `validateProdKustomizationOverrides` (`main.mjs:4747-4757`).
///
/// Фільтр basename тут **чутливий до регістру** (`=== 'kustomization.yaml'`),
/// на відміну від сусіднього `validateKustomizeHpaPdbOnlyWithBaseDeployment`
/// (`.toLowerCase()`). Розбіжність канону перенесена як є.
pub fn validate_prod_kustomization_overrides(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    let root_norm = resolve_lexical(root, "");
    let mut out = Vec::new();
    for kust_abs in yaml_files
        .iter()
        .filter(|abs| basename(abs) == KUSTOMIZATION_FILE)
    {
        let rel = rel_posix(&root_norm, kust_abs);
        let (needs_hpa, needs_pdb) = prod_overlay_hpa_pdb_override_needs(&root_norm, kust_abs);
        if !needs_hpa && !needs_pdb {
            continue;
        }
        if let Some(kust) = read_first_yaml_object(kust_abs) {
            prod_overrides_violations(&kust, &rel, needs_hpa, needs_pdb, &mut out);
        }
    }
    out
}

// ─── Hasura-overlay overrides ────────────────────────────────────────────────

/// Значення, яке patch присвоює ключу `data.<key>`.
enum OverrideValue {
    /// Жоден patch цього ключа не чіпає (`null` у канону).
    NotTouched,
    /// Ключ присвоєно, але значення відсутнє — `JSON.stringify(undefined)`
    /// у JS дає літерал `undefined`, який далі потрапляє в текст порушення.
    Undefined,
    /// Присвоєне значення (рядок як є, решта — через `JSON.stringify`).
    Assigned(String),
}

/// Значення з JSON6902-патчу — порт `hasuraDataKeyValueFromJson6902`
/// (`main.mjs:4820-4831`).
fn data_key_value_from_json6902(ops: &[Value], data_pointer: &str) -> OverrideValue {
    for item in ops {
        if !item.is_object() {
            continue;
        }
        let op = item
            .get("op")
            .and_then(Value::as_str)
            .map(|op| op.trim().to_lowercase())
            .unwrap_or_default();
        let path = item
            .get("path")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if (op == "add" || op == "replace") && path == data_pointer {
            return match item.get("value") {
                None => OverrideValue::Undefined,
                Some(Value::String(text)) => OverrideValue::Assigned(text.clone()),
                Some(other) => OverrideValue::Assigned(
                    serde_json::to_string(other).unwrap_or_else(|_| "null".to_string()),
                ),
            };
        }
    }
    OverrideValue::NotTouched
}

/// Значення зі Strategic-Merge-патчу — порт
/// `hasuraDataKeyValueFromStrategicMerge` (`main.mjs:4839-4846`).
fn data_key_value_from_strategic_merge(parsed: &Value, data_key: &str) -> OverrideValue {
    let Some(data) = parsed.get("data").filter(|value| value.is_object()) else {
        return OverrideValue::NotTouched;
    };
    match data.get(data_key) {
        None => OverrideValue::NotTouched,
        Some(Value::String(text)) => OverrideValue::Assigned(text.clone()),
        Some(other) => OverrideValue::Assigned(
            serde_json::to_string(other).unwrap_or_else(|_| "null".to_string()),
        ),
    }
}

/// Значення, яке inline-`patch` присвоює `data.<key>` — порт
/// `hasuraDataKeyValueFromPatchText` (`main.mjs:4857-4864`).
fn data_key_value_from_patch_text(
    patch_text: &str,
    data_key: &str,
    data_pointer: &str,
) -> OverrideValue {
    let trimmed = patch_text.trim();
    if trimmed.is_empty() {
        return OverrideValue::NotTouched;
    }
    let Some(parsed) = first_valid_yaml_json_from_patch_text(trimmed) else {
        return OverrideValue::NotTouched;
    };
    if let Some(ops) = parsed.as_array() {
        return data_key_value_from_json6902(ops, data_pointer);
    }
    if !parsed.is_object() {
        return OverrideValue::NotTouched;
    }
    data_key_value_from_strategic_merge(&parsed, data_key)
}

/// Значення, яке `patches[]` присвоюють `data.<key>` на цілі ConfigMap — порт
/// `hasuraDataKeyOverrideValue` (`main.mjs:4885-4897`).
fn hasura_data_key_override_value(
    kust: &Value,
    data_key: &str,
    data_pointer: &str,
) -> OverrideValue {
    let Some(patches) = kust.get("patches").and_then(Value::as_array) else {
        return OverrideValue::NotTouched;
    };
    for patch in patches {
        if !patch.is_object() {
            continue;
        }
        let Some(text) = patch.get("patch").and_then(Value::as_str) else {
            continue;
        };
        if resolve_patch_target_kind(patch).as_deref() != Some("ConfigMap") {
            continue;
        }
        match data_key_value_from_patch_text(text, data_key, data_pointer) {
            OverrideValue::NotTouched => {}
            found => return found,
        }
    }
    OverrideValue::NotTouched
}

/// Спільне ядро двох Hasura-перевірок overlay-а — порт
/// `validateHasuraOverlayEnabledApisOverride` (`main.mjs:4929-4954`) і
/// `validateHasuraOverlayEnabledLogTypesOverride` (`main.mjs:4966-4991`): у
/// канону це два дослівно однакові цикли, що різняться лише ключем,
/// очікуваним значенням і «хвостом» тексту порушення.
fn hasura_overlay_override_violations(
    root: &Path,
    yaml_files: &[PathBuf],
    data_key: &str,
    data_pointer: &str,
    expected: &str,
    missing_tail: &str,
) -> Vec<Violation> {
    let root_norm = resolve_lexical(root, "");
    let mut out = Vec::new();
    for kust_abs in yaml_files
        .iter()
        .filter(|abs| basename(abs) == KUSTOMIZATION_FILE)
    {
        let rel = rel_posix(&root_norm, kust_abs);
        let Some(segment) = k8s_env_segment_from_rel_path(&rel) else {
            continue;
        };
        if segment == "base" || segment == "dev" {
            continue;
        }
        let segment = segment.to_string();
        let Some(kust) = read_first_yaml_object(kust_abs) else {
            continue;
        };
        if kust.get("kind").and_then(Value::as_str) == Some("Component") {
            continue;
        }
        if !kustomization_tree_has_hasura_deployment(kust_abs, &root_norm) {
            continue;
        }
        match hasura_data_key_override_value(&kust, data_key, data_pointer) {
            OverrideValue::Assigned(value) if value == expected => {}
            OverrideValue::NotTouched => out.push(violation(format!(
                "{rel}: overlay '{segment}' має у patches[] перевизначати data.{data_key} до \"{expected}\" ({missing_tail}) (k8s.mdc)"
            ))),
            OverrideValue::Undefined => out.push(violation(format!(
                "{rel}: overlay '{segment}' patch data.{data_key} має бути \"{expected}\" (зараз: undefined) (k8s.mdc)"
            ))),
            OverrideValue::Assigned(value) => {
                let shown = serde_json::to_string(&value).unwrap_or_else(|_| "undefined".to_string());
                out.push(violation(format!(
                    "{rel}: overlay '{segment}' patch data.{data_key} має бути \"{expected}\" (зараз: {shown}) (k8s.mdc)"
                )));
            }
        }
    }
    out
}

/// Non-base/dev overlay Hasura має перевизначати `HASURA_GRAPHQL_ENABLED_APIS`
/// — порт `validateHasuraOverlayEnabledApisOverride` (`main.mjs:4929-4954`).
pub fn validate_hasura_overlay_enabled_apis_override(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    hasura_overlay_override_violations(
        root,
        yaml_files,
        "HASURA_GRAPHQL_ENABLED_APIS",
        HASURA_ENABLED_APIS_DATA_POINTER,
        HASURA_OVERLAY_ENABLED_APIS,
        "pgdump лише для base/dev",
    )
}

/// Non-base/dev overlay Hasura має перевизначати
/// `HASURA_GRAPHQL_ENABLED_LOG_TYPES` — порт
/// `validateHasuraOverlayEnabledLogTypesOverride` (`main.mjs:4966-4991`).
pub fn validate_hasura_overlay_enabled_log_types_override(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    hasura_overlay_override_violations(
        root,
        yaml_files,
        "HASURA_GRAPHQL_ENABLED_LOG_TYPES",
        HASURA_ENABLED_LOG_TYPES_DATA_POINTER,
        HASURA_OVERLAY_ENABLED_LOG_TYPES,
        "http-log лише для base/dev",
    )
}
