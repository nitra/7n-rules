//! Native-порт **двох великих самодостатніх `validate*`** концерну
//! `k8s/manifests` (`npm/rules/k8s/manifests/main.mjs`) — шар 3 з чотирьох,
//! що лишались після зрізу 1 (PR #393).
//!
//! | Rust | JS |
//! |---|---|
//! | [`validate_deployment_hpa_pdb_and_topology`] | `validateDeploymentHpaPdbAndTopology` (`main.mjs:5422-5444`) |
//! | [`validate_network_policies_for_k8s_workloads`] | `validateNetworkPoliciesForK8sWorkloads` (`main.mjs:5455-5481`) |
//!
//! Обидві ходять по каталогах уже знайдених YAML, але **дерево
//! kustomization не резолвлять** — саме тому вони заходять цим зрізом, а
//! пʼять залежних від резолюції `validate*` лишаються наступному.
//!
//! # Що саме перевіряється
//!
//! Перша: для кожного `kind: Deployment` у шарі `…/k8s/…/base/` —
//! канонічні `topologySpreadConstraints`, заборона локальних `hpa.yaml` і
//! `pdb.yaml` у самому `base/`, і повний канон sibling-каталогу
//! `components/` (Kustomize Component з `hpa.yaml` і `pdb.yaml`, обидва з
//! dev-like межами). Друга: для кожного workload зі списку
//! `WORKLOAD_KINDS_WITH_NETWORK_POLICY` — наявність `networkpolicy.yaml`
//! поруч і збіг його `spec.podSelector.matchLabels.app` з міткою workload.
//!
//! # Знайдений дефект канону: гілка «не-base шар» недосяжна
//!
//! `validateDeploymentHpaPdbAndTopology` фільтрує вхід предикатом
//! `isK8sYamlUnderBaseDirectory(rel)` (`main.mjs:5430`), тобто до
//! `validateDeploymentsInDir` доходять **виключно** каталоги під
//! `…/k8s/…/base/`. Далі та сама функція рахує
//! `isK8sBaseLayer = isK8sYamlUnderBaseDirectory(relDir + '/probe.yaml')`
//! (`main.mjs:5294`) — предикат дивиться лише на каталоги шляху, а каталог
//! той самий, тож результат завжди `true`.
//!
//! Наслідок: гілки `hpaDocs`/`pdbDocs` через `readDocsByKindInDir`
//! (`main.mjs:5299-5300`) і виклики `validateHpaForDeployment` /
//! `validatePdbForDeployment` із `validateSingleDeploymentHpaPdbTopology`
//! (`main.mjs:5278-5279`) **недосяжні**, хоча доккомент функції обіцяє «у
//! не-base шарах — звична схема (`hpa.yaml` / `pdb.yaml` поруч)».
//!
//! Це полагоджено **не тут**: увімкнення тієї гілки — не виправлення порту,
//! а розширення області перевірки (кожен overlay-каталог із Deployment
//! почав би вимагати сусідні `hpa.yaml`/`pdb.yaml`), тобто зміна поведінки
//! для всіх споживачів `@7n/rules`. Порт відтворює канон як є, недосяжні
//! гілки перенесені разом із ним (щоб зміна фільтра колись не розвела
//! реалізації), а саме питання заведено в реєстр відкладених
//! (`docs/plans/2026-08-05-open-questions-register.md`, §5.1).
//!
//! # Полагоджений дефект канону: `readDocsByKindInDir` і порядок `readdir`
//!
//! `readDocsByKindInDir` (`main.mjs:4198-4213`) обходив каталог сирим
//! `tryReaddir`, тобто в порядку файлової системи (APFS впорядковує, ext4
//! віддає hash-порядок) — той самий патерн, що вже лагодили `k8s/hasura_configmap`
//! (#381) і `validateSingleConfigMapNameMatch` (#393). Сьогодні він
//! латентний: обидва виклики передають `filenameFilter`, тож збігається
//! щонайбільше один файл, а сама гілка ще й недосяжна (секція вище). Обхід
//! тут відсортований, і те саме сортування додано в JS-канон — щоб міна не
//! спрацювала, коли гілку колись увімкнуть.
//!
//! # Де паритет свідомо не побайтовий
//!
//! `JSON.stringify(value)` у текстах порушень відтворено через
//! `serde_json::to_string`. Розбіжності лишаються рівно на двох формах, яких
//! у цих полях (`apiVersion`, `kind`, `name`, `app`) не буває: порядок
//! ключів вкладеного обʼєкта (JS — порядок вставки, serde — лексикографічний)
//! і ціле число, записане в YAML як `1.0` (JS дає `1`, serde — `1.0`).
//! Відсутній ключ дає літерал `undefined` — як і шаблонний рядок JS.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::concerns::k8s_hasura::parse_k8s_yaml_docs;
use crate::concerns::k8s_manifests_rego::{rel_posix, rel_posix_raw, DEFAULT_REASON};
use crate::diagnostics::{Severity, Violation};

/// Ім'я файла HPA поруч із Deployment — порт `HPA_FILENAME` (`main.mjs:3475`).
const HPA_FILENAME: &str = "hpa.yaml";

/// Ім'я файла PDB — порт `PDB_FILENAME` (`main.mjs:3480`).
const PDB_FILENAME: &str = "pdb.yaml";

/// Ім'я файла NetworkPolicy — порт `NETWORK_POLICY_FILENAME` (`main.mjs:3485`).
const NETWORK_POLICY_FILENAME: &str = "networkpolicy.yaml";

/// Каталог Kustomize Component — порт `COMPONENTS_DIR` (`main.mjs:3504`).
const COMPONENTS_DIR: &str = "components";

/// `apiVersion` маніфесту Kustomize Component — порт
/// `KUSTOMIZE_COMPONENT_API_VERSION` (`main.mjs:3509`).
const KUSTOMIZE_COMPONENT_API_VERSION: &str = "kustomize.config.k8s.io/v1alpha1";

/// Канонічний `topologyKey` — порт `TOPOLOGY_SPREAD_TOPOLOGY_KEY`
/// (`main.mjs:3514`).
const TOPOLOGY_SPREAD_TOPOLOGY_KEY: &str = "kubernetes.io/hostname";

/// Workload-типи, для яких обовʼязковий NetworkPolicy — порт
/// `WORKLOAD_KINDS_WITH_NETWORK_POLICY` (`main.mjs:3491-3497`). Порядок
/// значущий: `collectNetworkPolicyWorkloadsByDir` групує документи саме за
/// ним, а не за порядком у файлі.
const WORKLOAD_KINDS_WITH_NETWORK_POLICY: &[&str] =
    &["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"];

/// Межа `Number.isSafeInteger` — `2^53 - 1`.
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

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

// ─── Примітиви доступу до AST ────────────────────────────────────────────────

/// Вкладений обʼєкт за ключем — порт `getNestedObject` (`main.mjs:2404-2408`).
fn nested_object<'a>(parent: &'a Value, key: &str) -> Option<&'a serde_json::Map<String, Value>> {
    parent.get(key).and_then(Value::as_object)
}

/// `metadata.name` як непорожній після `trim` рядок — порт
/// `manifestMetadataName` (`main.mjs:3545-3550`). Повертається значення **як
/// у YAML**, без обрізання (JS теж віддає сирий `n`).
fn manifest_metadata_name(manifest: &Value) -> Option<&str> {
    nested_object(manifest, "metadata")?
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
}

/// `spec.template.spec` — порт `extractPodSpec` (`main.mjs:2415-2421`).
fn pod_spec(deployment: &Value) -> Option<&serde_json::Map<String, Value>> {
    let spec = deployment.get("spec")?;
    let template = spec.get("template")?;
    template.get("spec").and_then(Value::as_object)
}

/// `spec.selector.matchLabels.app` Deployment — порт `deploymentAppLabel`
/// (`main.mjs:3557-3566`).
fn deployment_app_label(deployment: &Value) -> Option<&str> {
    deployment
        .get("spec")
        .and_then(|spec| spec.get("selector"))
        .and_then(|selector| selector.get("matchLabels"))
        .filter(|labels| labels.is_object())
        .and_then(|labels| labels.get("app"))
        .and_then(Value::as_str)
        .filter(|app| !app.trim().is_empty())
}

/// `spec.template.metadata.labels.app` — порт `appLabelFromPodTemplate`
/// (`main.mjs:3592-3601`); джерело мітки для Job і CronJob, де ручний
/// `spec.selector` невалідний без `manualSelector: true`.
fn app_label_from_pod_template(spec: &Value) -> Option<&str> {
    spec.get("template")
        .and_then(|template| template.get("metadata"))
        .and_then(|metadata| metadata.get("labels"))
        .filter(|labels| labels.is_object())
        .and_then(|labels| labels.get("app"))
        .and_then(Value::as_str)
        .filter(|app| !app.trim().is_empty())
}

/// Мітка `app` workload за його `kind` — порт `workloadAppLabel`
/// (`main.mjs:3614-3626`).
fn workload_app_label(manifest: &Value) -> Option<&str> {
    let kind = manifest.get("kind").and_then(Value::as_str)?;
    let spec = manifest.get("spec").filter(|spec| spec.is_object())?;
    match kind {
        "CronJob" => {
            let job_spec = spec
                .get("jobTemplate")
                .filter(|node| node.is_object())?
                .get("spec")
                .filter(|node| node.is_object())?;
            app_label_from_pod_template(job_spec)
        }
        "Job" => app_label_from_pod_template(spec),
        // `appLabelFromSpecSelector` (`main.mjs:3573-3580`).
        _ => spec
            .get("selector")
            .filter(|node| node.is_object())?
            .get("matchLabels")
            .filter(|node| node.is_object())?
            .get("app")
            .and_then(Value::as_str)
            .filter(|app| !app.trim().is_empty()),
    }
}

/// `spec.podSelector.matchLabels.app` NetworkPolicy — порт
/// `networkPolicyPodSelectorAppLabel` (`main.mjs:6305-6313`): неповний
/// ланцюжок дає порожній рядок, а не «немає».
fn network_policy_pod_selector_app_label(spec: Option<&Value>) -> &str {
    spec.and_then(|spec| spec.get("podSelector"))
        .filter(|node| node.is_object())
        .and_then(|node| node.get("matchLabels"))
        .filter(|node| node.is_object())
        .and_then(|node| node.get("app"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

/// Ціле число з YAML-значення — порт `coerceInteger` (`main.mjs:3633-3637`).
/// `1.0` у YAML — теж ціле: у JS це те саме `Number` і
/// `Number.isSafeInteger(1.0)` істинний.
fn coerce_integer(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => {
            if let Some(int) = number.as_i64() {
                return (int.abs() <= MAX_SAFE_INTEGER).then_some(int);
            }
            let float = number.as_f64()?;
            (float.floor() == float && float.abs() <= MAX_SAFE_INTEGER as f64)
                .then_some(float as i64)
        }
        Some(Value::String(raw)) => {
            let trimmed = raw.trim();
            // `INTEGER_STRING_RE` — `^-?\d+$` під `/u`, тобто ASCII-цифри.
            let digits = trimmed.strip_prefix('-').unwrap_or(trimmed);
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            trimmed.parse::<i64>().ok()
        }
        _ => None,
    }
}

/// `JSON.stringify(value)` у шаблонному рядку JS: відсутній ключ дає літерал
/// `undefined`, решта — звичайний JSON.
fn js_json_stringify(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(value) => serde_json::to_string(value).unwrap_or_else(|_| "undefined".to_string()),
    }
}

// ─── Шляхові предикати ───────────────────────────────────────────────────────

/// Чи POSIX-шлях лежить під `…/k8s/…/base/` — порт
/// `isK8sYamlUnderBaseDirectory` (`main.mjs:30-36`): останній сегмент
/// вважається іменем файла і в перевірку не входить.
fn is_k8s_yaml_under_base_directory(rel_posix: &str) -> bool {
    let parts: Vec<&str> = rel_posix
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let Some(k) = parts.iter().position(|part| *part == "k8s") else {
        return false;
    };
    // `parts.slice(k + 1, -1)`: останній сегмент — ім'я файла, у зріз не йде.
    let dirs_end = parts.len().saturating_sub(1);
    k < dirs_end && parts[k + 1..dirs_end].contains(&"base")
}

/// Сегмент середовища після `/k8s/` — порт `k8sEnvSegmentFromRelPath`
/// (`main.mjs:3522-3525`) поверх `K8S_ENV_SEGMENT_RE`
/// (`(?:^|\/)k8s\/([^/]+)(?:\/|$)`).
fn k8s_env_segment_from_rel_path(rel_path: &str) -> Option<&str> {
    let bytes = rel_path.as_bytes();
    let mut from = 0usize;
    while let Some(offset) = rel_path[from..].find("k8s/") {
        let at = from + offset;
        if at == 0 || bytes[at - 1] == b'/' {
            let after = at + "k8s/".len();
            let end = rel_path[after..]
                .find('/')
                .map_or(rel_path.len(), |pos| after + pos);
            if end > after {
                return Some(&rel_path[after..end]);
            }
        }
        from = at + 1;
    }
    None
}

/// Чи сегмент середовища dev-like — порт `isDevLikeK8sEnvSegment`
/// (`main.mjs:3534-3538`).
fn is_dev_like_k8s_env_segment(segment: Option<&str>) -> bool {
    match segment {
        None | Some("") => false,
        Some("base" | "dev") => true,
        Some(segment) => segment.ends_with("-qa"),
    }
}

// ─── HPA / PDB / topologySpreadConstraints ───────────────────────────────────

/// Порушення HPA — порт `hpaManifestViolations` (`main.mjs:3737-3764`).
pub fn hpa_manifest_violations(
    manifest: &Value,
    expected_deploy_name: &str,
    is_dev_like: bool,
) -> Vec<String> {
    let mut errs = Vec::new();
    let Some(rec) = manifest.as_object() else {
        errs.push("HPA має бути обʼєктом YAML".to_string());
        return errs;
    };
    if rec.get("kind").and_then(Value::as_str) != Some("HorizontalPodAutoscaler") {
        errs.push(format!(
            "kind має бути HorizontalPodAutoscaler (зараз: {})",
            js_json_stringify(rec.get("kind"))
        ));
    }
    if rec.get("apiVersion").and_then(Value::as_str) != Some("autoscaling/v2") {
        errs.push(format!(
            "apiVersion має бути autoscaling/v2 (зараз: {})",
            js_json_stringify(rec.get("apiVersion"))
        ));
    }
    let Some(spec) = rec.get("spec").and_then(Value::as_object) else {
        errs.push("spec відсутній або некоректний".to_string());
        return errs;
    };
    validate_hpa_scale_target_ref(spec, expected_deploy_name, &mut errs);
    validate_hpa_replica_limits(
        coerce_integer(spec.get("minReplicas")),
        coerce_integer(spec.get("maxReplicas")),
        is_dev_like,
        &mut errs,
    );
    if spec
        .get("metrics")
        .and_then(Value::as_array)
        .is_none_or(|metrics| metrics.is_empty())
    {
        errs.push(
            "spec.metrics має бути непорожнім масивом (наприклад, Resource/cpu/Utilization)"
                .to_string(),
        );
    }
    validate_hpa_behavior(spec, &mut errs);
    errs
}

/// `spec.scaleTargetRef` — порт `validateHpaScaleTargetRef`
/// (`main.mjs:3645-3658`).
fn validate_hpa_scale_target_ref(
    spec: &serde_json::Map<String, Value>,
    expected_deploy_name: &str,
    errs: &mut Vec<String>,
) {
    let Some(target) = spec.get("scaleTargetRef").and_then(Value::as_object) else {
        errs.push("spec.scaleTargetRef відсутній".to_string());
        return;
    };
    if target.get("apiVersion").and_then(Value::as_str) != Some("apps/v1") {
        errs.push(format!(
            "spec.scaleTargetRef.apiVersion має бути apps/v1 (зараз: {})",
            js_json_stringify(target.get("apiVersion"))
        ));
    }
    if target.get("kind").and_then(Value::as_str) != Some("Deployment") {
        errs.push(format!(
            "spec.scaleTargetRef.kind має бути Deployment (зараз: {})",
            js_json_stringify(target.get("kind"))
        ));
    }
    if target.get("name").and_then(Value::as_str) != Some(expected_deploy_name) {
        errs.push(format!(
            "spec.scaleTargetRef.name має бути '{expected_deploy_name}' (зараз: {})",
            js_json_stringify(target.get("name"))
        ));
    }
}

/// Env-залежні межі реплік — порт `validateHpaReplicaLimits`
/// (`main.mjs:3691-3702`).
fn validate_hpa_replica_limits(
    min_replicas: Option<i64>,
    max_replicas: Option<i64>,
    is_dev_like: bool,
    errs: &mut Vec<String>,
) {
    if min_replicas.is_none() {
        errs.push("spec.minReplicas має бути цілим числом".to_string());
    }
    if max_replicas.is_none() {
        errs.push("spec.maxReplicas має бути цілим числом".to_string());
    }
    if let (Some(min), Some(max)) = (min_replicas, max_replicas) {
        if min > max {
            errs.push(format!(
                "spec.minReplicas ({min}) не може бути більше spec.maxReplicas ({max})"
            ));
        }
    }
    if is_dev_like {
        if let Some(min) = min_replicas.filter(|min| *min != 1) {
            errs.push(format!(
                "spec.minReplicas для dev-like (base/dev/*-qa) має бути 1 (зараз: {min})"
            ));
        }
        if let Some(max) = max_replicas.filter(|max| *max != 1) {
            errs.push(format!(
                "spec.maxReplicas для dev-like (base/dev/*-qa) має бути 1 (зараз: {max})"
            ));
        }
        return;
    }
    if let Some(min) = min_replicas.filter(|min| *min < 2) {
        errs.push(format!(
            "spec.minReplicas для прод середовища має бути мінімум 2 (зараз: {min})"
        ));
    }
    if let Some(max) = max_replicas.filter(|max| *max < 2) {
        errs.push(format!(
            "spec.maxReplicas для прод середовища має бути мінімум 2 (зараз: {max})"
        ));
    }
}

/// `spec.behavior` — порт `validateHpaBehavior` (`main.mjs:3709-3727`).
fn validate_hpa_behavior(spec: &serde_json::Map<String, Value>, errs: &mut Vec<String>) {
    let Some(behavior) = spec.get("behavior").and_then(Value::as_object) else {
        errs.push("spec.behavior відсутній (має містити scaleUp і scaleDown)".to_string());
        return;
    };
    for key in ["scaleUp", "scaleDown"] {
        let Some(node) = behavior.get(key).and_then(Value::as_object) else {
            errs.push(format!("spec.behavior.{key} відсутній"));
            continue;
        };
        if node
            .get("policies")
            .and_then(Value::as_array)
            .is_none_or(|policies| policies.is_empty())
        {
            errs.push(format!(
                "spec.behavior.{key}.policies має бути непорожнім масивом"
            ));
        }
    }
}

/// Порушення PDB — порт `pdbManifestViolations` (`main.mjs:3817-3840`).
pub fn pdb_manifest_violations(
    manifest: &Value,
    expected_app_label: &str,
    is_dev_like: bool,
) -> Vec<String> {
    let mut errs = Vec::new();
    let Some(rec) = manifest.as_object() else {
        errs.push("PDB має бути обʼєктом YAML".to_string());
        return errs;
    };
    if rec.get("kind").and_then(Value::as_str) != Some("PodDisruptionBudget") {
        errs.push(format!(
            "kind має бути PodDisruptionBudget (зараз: {})",
            js_json_stringify(rec.get("kind"))
        ));
    }
    if rec.get("apiVersion").and_then(Value::as_str) != Some("policy/v1") {
        errs.push(format!(
            "apiVersion має бути policy/v1 (зараз: {})",
            js_json_stringify(rec.get("apiVersion"))
        ));
    }
    let Some(spec) = rec.get("spec").and_then(Value::as_object) else {
        errs.push("spec відсутній або некоректний".to_string());
        return errs;
    };
    validate_pdb_min_available(
        coerce_integer(spec.get("minAvailable")),
        is_dev_like,
        &mut errs,
    );
    validate_pdb_selector(spec, expected_app_label, &mut errs);
    errs
}

/// `spec.minAvailable` — порт `validatePdbMinAvailable` (`main.mjs:3772-3780`).
fn validate_pdb_min_available(
    min_available: Option<i64>,
    is_dev_like: bool,
    errs: &mut Vec<String>,
) {
    let Some(min_available) = min_available else {
        errs.push("spec.minAvailable має бути цілим числом".to_string());
        return;
    };
    if is_dev_like {
        if min_available != 0 {
            errs.push(format!(
                "spec.minAvailable для dev-like (base/dev/*-qa) має бути 0 (зараз: {min_available})"
            ));
        }
    } else if min_available < 1 {
        errs.push(format!(
            "spec.minAvailable для прод середовища має бути мінімум 1 (зараз: {min_available})"
        ));
    }
}

/// `spec.selector.matchLabels.app` — порт `validatePdbSelector`
/// (`main.mjs:3788-3807`).
fn validate_pdb_selector(
    spec: &serde_json::Map<String, Value>,
    expected_app_label: &str,
    errs: &mut Vec<String>,
) {
    let Some(selector) = spec.get("selector").and_then(Value::as_object) else {
        errs.push("spec.selector відсутній".to_string());
        return;
    };
    let Some(match_labels) = selector.get("matchLabels").and_then(Value::as_object) else {
        errs.push("spec.selector.matchLabels відсутній".to_string());
        return;
    };
    if match_labels.get("app").and_then(Value::as_str) != Some(expected_app_label) {
        errs.push(format!(
            "spec.selector.matchLabels.app має бути '{expected_app_label}' (зараз: {})",
            js_json_stringify(match_labels.get("app"))
        ));
    }
}

/// Канонічність одного елемента `topologySpreadConstraints` — порт
/// `isCanonicalTopologySpreadConstraint` (`main.mjs:4130-4141`).
fn is_canonical_topology_spread_constraint(item: &Value, expected_app_label: &str) -> bool {
    let Some(item) = item.as_object() else {
        return false;
    };
    if coerce_integer(item.get("maxSkew")) != Some(1) {
        return false;
    }
    if item.get("topologyKey").and_then(Value::as_str) != Some(TOPOLOGY_SPREAD_TOPOLOGY_KEY) {
        return false;
    }
    if item.get("whenUnsatisfiable").and_then(Value::as_str) != Some("ScheduleAnyway") {
        return false;
    }
    item.get("labelSelector")
        .and_then(|node| nested_object(node, "matchLabels"))
        .and_then(|labels| labels.get("app"))
        .and_then(Value::as_str)
        == Some(expected_app_label)
}

/// Порушення `topologySpreadConstraints` Deployment — порт
/// `deploymentTopologySpreadConstraintsViolation` (`main.mjs:4151-4165`).
pub fn deployment_topology_spread_constraints_violation(
    manifest: &Value,
    expected_app_label: &str,
) -> Option<String> {
    if !manifest.is_object() {
        return None;
    }
    if manifest.get("kind").and_then(Value::as_str) != Some("Deployment") {
        return None;
    }
    let Some(pod_spec) = pod_spec(manifest) else {
        return Some("spec.template.spec відсутній".to_string());
    };
    let constraints = pod_spec
        .get("topologySpreadConstraints")
        .and_then(Value::as_array);
    let Some(constraints) = constraints.filter(|items| !items.is_empty()) else {
        return Some(format!(
            "spec.template.spec.topologySpreadConstraints: додай запис maxSkew=1, topologyKey={TOPOLOGY_SPREAD_TOPOLOGY_KEY}, whenUnsatisfiable=ScheduleAnyway, labelSelector.matchLabels.app='{expected_app_label}' (k8s.mdc)"
        ));
    };
    if constraints
        .iter()
        .any(|item| is_canonical_topology_spread_constraint(item, expected_app_label))
    {
        return None;
    }
    Some(format!(
        "spec.template.spec.topologySpreadConstraints: бракує запису maxSkew=1, topologyKey={TOPOLOGY_SPREAD_TOPOLOGY_KEY}, whenUnsatisfiable=ScheduleAnyway, labelSelector.matchLabels.app='{expected_app_label}' (k8s.mdc)"
    ))
}

// ─── Читання документів ──────────────────────────────────────────────────────

/// Документи заданого `kind` з файла — порт `readAllDocsByKindFromFile`
/// (`main.mjs:4173-4179`).
fn read_docs_by_kind_from_file(path: &Path, kind: &str) -> Vec<Value> {
    parse_k8s_yaml_docs(path)
        .into_iter()
        .filter(|doc| doc.get("kind").and_then(Value::as_str) == Some(kind))
        .collect()
}

/// Чи ім'я файла проходить фільтр — порт `matchesYamlFilter`
/// (`main.mjs:4187-4189`) поверх `K8S_YAML_EXT_RE` (`/\.ya?ml$/iu`).
fn matches_yaml_filter(entry: &str, filename_filter: Option<&str>) -> bool {
    match filename_filter {
        Some(filter) => entry == filter,
        None => {
            let lower = entry.to_ascii_lowercase();
            lower.ends_with(".yaml") || lower.ends_with(".yml")
        }
    }
}

/// Документи заданого `kind` у каталозі — порт `readDocsByKindInDir`
/// (`main.mjs:4198-4213`) з **відсортованим** обходом (секція «Полагоджений
/// дефект канону» у доккоменті модуля).
fn read_docs_by_kind_in_dir(dir: &Path, kind: &str, filename_filter: Option<&str>) -> Vec<Value> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
        .into_iter()
        .filter(|name| matches_yaml_filter(name, filename_filter))
        .flat_map(|name| read_docs_by_kind_from_file(&dir.join(name), kind))
        .collect()
}

/// Перший валідний YAML-обʼєкт файла — порт `readFirstYamlObject`
/// (`main.mjs:4350-4366`).
fn read_first_yaml_object(path: &Path) -> Option<Value> {
    parse_k8s_yaml_docs(path)
        .into_iter()
        .find(serde_json::Value::is_object)
}

// ─── validateDeploymentHpaPdbAndTopology ─────────────────────────────────────

/// HPA/PDB/topology для Deployment шару `…/k8s/…/base/` — порт
/// `validateDeploymentHpaPdbAndTopology` (`main.mjs:5422-5444`).
pub fn validate_deployment_hpa_pdb_and_topology(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    // `Map` JS ітерується в порядку вставки, а `yamlFilesAbs` уже
    // відсортований `findK8sYamlFiles` — тож `Vec` пар зберігає той самий
    // порядок і не потребує впорядкованого словника.
    let mut by_dir: Vec<(PathBuf, Vec<Value>)> = Vec::new();
    for abs in yaml_files {
        if !is_k8s_yaml_under_base_directory(&rel_posix(root, abs)) {
            continue;
        }
        let deployments = read_docs_by_kind_from_file(abs, "Deployment");
        if deployments.is_empty() {
            continue;
        }
        let dir = abs.parent().unwrap_or(abs).to_path_buf();
        match by_dir.iter_mut().find(|(known, _)| *known == dir) {
            Some((_, merged)) => merged.extend(deployments),
            None => by_dir.push((dir, deployments)),
        }
    }

    let mut out = Vec::new();
    for (dir, deployments) in by_dir {
        validate_deployments_in_dir(&deployments, &dir, root, &mut out);
    }
    out
}

/// Один каталог із Deployment — порт `validateDeploymentsInDir`
/// (`main.mjs:5290-5316`).
fn validate_deployments_in_dir(
    deployments: &[Value],
    dir: &Path,
    root: &Path,
    out: &mut Vec<Violation>,
) {
    let rel_dir = rel_posix_raw(root, dir);
    let is_dev_like =
        is_dev_like_k8s_env_segment(k8s_env_segment_from_rel_path(&format!("{rel_dir}/")));
    let is_k8s_base_layer = is_k8s_yaml_under_base_directory(&format!("{rel_dir}/probe.yaml"));
    let deploy_rel = if rel_dir.is_empty() { "." } else { &rel_dir };

    if is_k8s_base_layer && !deployments.is_empty() {
        fail_if_base_layer_has_local_hpa_or_pdb(dir, deploy_rel, out);
    }
    let hpa_docs = if is_k8s_base_layer {
        Vec::new()
    } else {
        read_docs_by_kind_in_dir(dir, "HorizontalPodAutoscaler", Some(HPA_FILENAME))
    };
    let pdb_docs = if is_k8s_base_layer {
        Vec::new()
    } else {
        read_docs_by_kind_in_dir(dir, "PodDisruptionBudget", Some(PDB_FILENAME))
    };

    for deployment in deployments {
        validate_single_deployment_hpa_pdb_topology(
            deployment,
            deploy_rel,
            is_dev_like,
            is_k8s_base_layer,
            &hpa_docs,
            &pdb_docs,
            out,
        );
        if is_k8s_base_layer {
            validate_base_layer_components_if_named(deployment, dir, root, out);
        }
    }
}

/// Локальні `hpa.yaml`/`pdb.yaml` у `base/` заборонені — порт
/// `failIfBaseLayerHasLocalHpaOrPdb` (`main.mjs:5324-5335`).
fn fail_if_base_layer_has_local_hpa_or_pdb(dir: &Path, deploy_rel: &str, out: &mut Vec<Violation>) {
    if dir.join(HPA_FILENAME).exists() {
        out.push(violation(format!(
            "{deploy_rel}/{HPA_FILENAME}: у шарі k8s/.../base не тримай локальний hpa.yaml — HPA живе у sibling components/ (k8s.mdc)"
        )));
    }
    if dir.join(PDB_FILENAME).exists() {
        out.push(violation(format!(
            "{deploy_rel}/{PDB_FILENAME}: у шарі k8s/.../base не тримай локальний pdb.yaml — PDB живе у sibling components/ (k8s.mdc)"
        )));
    }
}

/// Один Deployment — порт `validateSingleDeploymentHpaPdbTopology`
/// (`main.mjs:5249-5280`).
fn validate_single_deployment_hpa_pdb_topology(
    deployment: &Value,
    deploy_rel: &str,
    is_dev_like: bool,
    is_k8s_base_layer: bool,
    hpa_docs: &[Value],
    pdb_docs: &[Value],
    out: &mut Vec<Violation>,
) {
    let Some(deploy_name) = manifest_metadata_name(deployment).map(str::to_string) else {
        out.push(violation(format!(
            "{deploy_rel}: Deployment без metadata.name — не можу перевірити HPA/PDB (k8s.mdc)"
        )));
        return;
    };
    let Some(app_label) = deployment_app_label(deployment).map(str::to_string) else {
        out.push(violation(format!(
            "{deploy_rel}: Deployment '{deploy_name}' без spec.selector.matchLabels.app — додай мітку (k8s.mdc)"
        )));
        return;
    };
    if let Some(tsc_violation) =
        deployment_topology_spread_constraints_violation(deployment, &app_label)
    {
        out.push(violation(format!(
            "{deploy_rel}: Deployment '{deploy_name}': {tsc_violation}"
        )));
    }
    if is_k8s_base_layer {
        return;
    }
    // Недосяжно за чинного фільтра каталогів — секція «гілка "не-base шар"
    // недосяжна» у доккоменті модуля.
    validate_hpa_for_deployment(
        hpa_docs,
        &deploy_name,
        is_dev_like,
        &format!("{deploy_rel}/{HPA_FILENAME}"),
        out,
    );
    validate_pdb_for_deployment(
        pdb_docs,
        &deploy_name,
        &app_label,
        is_dev_like,
        &format!("{deploy_rel}/{PDB_FILENAME}"),
        out,
    );
}

/// Звірка sibling-`components/`, якщо Deployment має ім'я і мітку — порт
/// `validateBaseLayerComponentsIfNamed` (`main.mjs:5347-5352`).
fn validate_base_layer_components_if_named(
    deployment: &Value,
    dir: &Path,
    root: &Path,
    out: &mut Vec<Violation>,
) {
    let (Some(deploy_name), Some(app_label)) = (
        manifest_metadata_name(deployment).map(str::to_string),
        deployment_app_label(deployment).map(str::to_string),
    ) else {
        return;
    };
    validate_components_for_base_deployment(dir, &deploy_name, &app_label, root, out);
}

/// HPA поруч із Deployment — порт `validateHpaForDeployment`
/// (`main.mjs:5023-5037`).
fn validate_hpa_for_deployment(
    hpa_docs: &[Value],
    deploy_name: &str,
    is_dev_like: bool,
    hpa_rel: &str,
    out: &mut Vec<Violation>,
) {
    // `findHpaByDeployName` (`main.mjs:4986-4994`).
    let matched = hpa_docs.iter().find(|doc| {
        doc.get("spec")
            .and_then(|spec| nested_object(spec, "scaleTargetRef"))
            .and_then(|target| target.get("name"))
            .and_then(Value::as_str)
            == Some(deploy_name)
    });
    let Some(matched) = matched else {
        out.push(violation(format!(
            "{hpa_rel}: відсутній або не знайдено HPA зі scaleTargetRef.name='{deploy_name}' поруч із Deployment (k8s.mdc)"
        )));
        return;
    };
    for err in hpa_manifest_violations(matched, deploy_name, is_dev_like) {
        out.push(violation(format!("{hpa_rel}: {err} (k8s.mdc)")));
    }
}

/// PDB поруч із Deployment — порт `validatePdbForDeployment`
/// (`main.mjs:5049-5063`).
fn validate_pdb_for_deployment(
    pdb_docs: &[Value],
    _deploy_name: &str,
    app_label: &str,
    is_dev_like: bool,
    pdb_rel: &str,
    out: &mut Vec<Violation>,
) {
    // `findPdbByAppLabel` (`main.mjs:5002-5012`).
    let matched = pdb_docs.iter().find(|doc| {
        doc.get("spec")
            .and_then(|spec| nested_object(spec, "selector"))
            .and_then(|selector| selector.get("matchLabels"))
            .filter(|labels| labels.is_object())
            .and_then(|labels| labels.get("app"))
            .and_then(Value::as_str)
            == Some(app_label)
    });
    let Some(matched) = matched else {
        out.push(violation(format!(
            "{pdb_rel}: відсутній або не знайдено PDB зі selector.matchLabels.app='{app_label}' поруч із Deployment (k8s.mdc)"
        )));
        return;
    };
    for err in pdb_manifest_violations(matched, app_label, is_dev_like) {
        out.push(violation(format!("{pdb_rel}: {err} (k8s.mdc)")));
    }
}

/// Sibling-каталог `components/` для Deployment із `base/` — порт
/// `validateComponentsForBaseDeployment` (`main.mjs:5125-5147`).
fn validate_components_for_base_deployment(
    base_dir: &Path,
    deploy_name: &str,
    app_label: &str,
    root: &Path,
    out: &mut Vec<Violation>,
) {
    let components_dir = base_dir.parent().unwrap_or(base_dir).join(COMPONENTS_DIR);
    let components_rel = rel_posix(root, &components_dir);
    if !components_dir.exists() {
        out.push(violation(format!(
            "{components_rel}: для Deployment '{deploy_name}' з sibling base/ обов'язковий каталог components/ з hpa.yaml і pdb.yaml (Kustomize Component) (k8s.mdc)"
        )));
        return;
    }
    if !components_dir.is_dir() {
        out.push(violation(format!(
            "{components_rel}: очікується каталог Kustomize Component (k8s.mdc)"
        )));
        return;
    }
    validate_components_kustomization_manifest(&components_dir, &components_rel, out);
    validate_components_hpa_file(&components_dir, &components_rel, deploy_name, out);
    validate_components_pdb_file(
        &components_dir,
        &components_rel,
        deploy_name,
        app_label,
        out,
    );
}

/// `components/kustomization.yaml` — порт
/// `validateComponentsKustomizationManifest` (`main.mjs:5159-5192`).
fn validate_components_kustomization_manifest(
    components_dir: &Path,
    components_rel: &str,
    out: &mut Vec<Violation>,
) {
    let kust_abs = components_dir.join("kustomization.yaml");
    if !kust_abs.exists() {
        out.push(violation(format!(
            "{components_rel}/kustomization.yaml: відсутній — додай Kustomize Component-маніфест (k8s.mdc)"
        )));
        return;
    }
    let Some(obj) = read_first_yaml_object(&kust_abs) else {
        out.push(violation(format!(
            "{components_rel}/kustomization.yaml: не вдалося розібрати перший YAML-документ (k8s.mdc)"
        )));
        return;
    };
    let api_version_ok =
        obj.get("apiVersion").and_then(Value::as_str) == Some(KUSTOMIZE_COMPONENT_API_VERSION);
    if !api_version_ok {
        out.push(violation(format!(
            "{components_rel}/kustomization.yaml: apiVersion має бути '{KUSTOMIZE_COMPONENT_API_VERSION}' (зараз: {}) (k8s.mdc)",
            js_json_stringify(obj.get("apiVersion"))
        )));
    }
    let kind_ok = obj.get("kind").and_then(Value::as_str) == Some("Component");
    if !kind_ok {
        out.push(violation(format!(
            "{components_rel}/kustomization.yaml: kind має бути 'Component' (зараз: {}) (k8s.mdc)",
            js_json_stringify(obj.get("kind"))
        )));
    }
    let resources: Vec<&str> = obj
        .get("resources")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !resources.contains(&HPA_FILENAME) {
        out.push(violation(format!(
            "{components_rel}/kustomization.yaml: у resources має бути '{HPA_FILENAME}' (k8s.mdc)"
        )));
    }
    if !resources.contains(&PDB_FILENAME) {
        out.push(violation(format!(
            "{components_rel}/kustomization.yaml: у resources має бути '{PDB_FILENAME}' (k8s.mdc)"
        )));
    }
    // Гілка `passFn` при повному збігу — no-op у detector-поверхні.
    let _ = api_version_ok && kind_ok;
}

/// `components/hpa.yaml` — порт `validateComponentsHpaFile`
/// (`main.mjs:5203-5212`).
fn validate_components_hpa_file(
    components_dir: &Path,
    components_rel: &str,
    deploy_name: &str,
    out: &mut Vec<Violation>,
) {
    let hpa_abs = components_dir.join(HPA_FILENAME);
    let hpa_rel = format!("{components_rel}/{HPA_FILENAME}");
    if !hpa_abs.exists() {
        out.push(violation(format!(
            "{hpa_rel}: відсутній — додай HorizontalPodAutoscaler для Deployment '{deploy_name}' (k8s.mdc)"
        )));
        return;
    }
    let hpa_docs = read_docs_by_kind_from_file(&hpa_abs, "HorizontalPodAutoscaler");
    validate_hpa_for_deployment(&hpa_docs, deploy_name, true, &hpa_rel, out);
}

/// `components/pdb.yaml` — порт `validateComponentsPdbFile`
/// (`main.mjs:5224-5233`).
fn validate_components_pdb_file(
    components_dir: &Path,
    components_rel: &str,
    deploy_name: &str,
    app_label: &str,
    out: &mut Vec<Violation>,
) {
    let pdb_abs = components_dir.join(PDB_FILENAME);
    let pdb_rel = format!("{components_rel}/{PDB_FILENAME}");
    if !pdb_abs.exists() {
        out.push(violation(format!(
            "{pdb_rel}: відсутній — додай PodDisruptionBudget для Deployment '{deploy_name}' (k8s.mdc)"
        )));
        return;
    }
    let pdb_docs = read_docs_by_kind_from_file(&pdb_abs, "PodDisruptionBudget");
    validate_pdb_for_deployment(&pdb_docs, deploy_name, app_label, true, &pdb_rel, out);
}

// ─── validateNetworkPoliciesForK8sWorkloads ──────────────────────────────────

/// NetworkPolicy для workload під `k8s` — порт
/// `validateNetworkPoliciesForK8sWorkloads` (`main.mjs:5455-5481`).
pub fn validate_network_policies_for_k8s_workloads(
    root: &Path,
    yaml_files: &[PathBuf],
) -> Vec<Violation> {
    let by_dir = collect_network_policy_workloads_by_dir(yaml_files);
    let mut out = Vec::new();
    for (dir, workloads) in by_dir {
        let rel_dir = rel_posix(root, &dir);
        let deploy_rel = if rel_dir.is_empty() { "." } else { &rel_dir };
        let np_abs = dir.join(NETWORK_POLICY_FILENAME);
        let np_rel = rel_posix(root, &np_abs);
        let np_docs = if np_abs.exists() {
            read_docs_by_kind_from_file(&np_abs, "NetworkPolicy")
        } else {
            Vec::new()
        };
        for workload in &workloads {
            let workload_kind = workload
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("workload");
            let Some(workload_name) = manifest_metadata_name(workload) else {
                out.push(violation(format!(
                    "{deploy_rel}: {workload_kind} без metadata.name — не можу перевірити NetworkPolicy (k8s.mdc)"
                )));
                continue;
            };
            let Some(app_label) = workload_app_label(workload) else {
                out.push(violation(format!(
                    "{deploy_rel}: {workload_kind} '{workload_name}' без мітки app (spec.selector.matchLabels.app; Job — spec.template.metadata.labels.app; CronJob — spec.jobTemplate.spec.template.metadata.labels.app) (k8s.mdc)"
                )));
                continue;
            };
            validate_network_policy_for_workload(
                &np_docs,
                workload_name,
                app_label,
                workload_kind,
                &np_rel,
                &mut out,
            );
        }
    }
    out
}

/// Workload-и з вимогою NetworkPolicy, згруповані за каталогом — порт
/// `collectNetworkPolicyWorkloadsByDir` (`main.mjs:5392-5409`).
fn collect_network_policy_workloads_by_dir(yaml_files: &[PathBuf]) -> Vec<(PathBuf, Vec<Value>)> {
    let mut by_dir: Vec<(PathBuf, Vec<Value>)> = Vec::new();
    for abs in yaml_files {
        let docs = parse_k8s_yaml_docs(abs);
        // `extractNetworkPolicyWorkloadsFromFile` (`main.mjs:5372-5385`)
        // групує за `kind` у порядку `WORKLOAD_KINDS_WITH_NETWORK_POLICY`,
        // а не за порядком документів у файлі.
        let mut workloads: Vec<Value> = Vec::new();
        for kind in WORKLOAD_KINDS_WITH_NETWORK_POLICY {
            workloads.extend(
                docs.iter()
                    .filter(|doc| doc.get("kind").and_then(Value::as_str) == Some(*kind))
                    .cloned(),
            );
        }
        if workloads.is_empty() {
            continue;
        }
        let dir = abs.parent().unwrap_or(abs).to_path_buf();
        match by_dir.iter_mut().find(|(known, _)| *known == dir) {
            Some((_, merged)) => merged.extend(workloads),
            None => by_dir.push((dir, workloads)),
        }
    }
    by_dir
}

/// NetworkPolicy для одного workload — порт
/// `validateNetworkPolicyForWorkload` (`main.mjs:5085-5102`).
fn validate_network_policy_for_workload(
    np_docs: &[Value],
    workload_name: &str,
    app_label: &str,
    workload_kind: &str,
    np_rel: &str,
    out: &mut Vec<Violation>,
) {
    let matched = np_docs
        .iter()
        .find(|doc| manifest_metadata_name(doc) == Some(workload_name));
    let Some(matched) = matched else {
        out.push(violation(format!(
            "{np_rel}: відсутній або не знайдено NetworkPolicy з metadata.name='{workload_name}' для {workload_kind} (k8s.mdc)"
        )));
        return;
    };
    let found_label = network_policy_pod_selector_app_label(matched.get("spec"));
    if found_label != app_label {
        out.push(violation(format!(
            "{np_rel}: NetworkPolicy '{workload_name}' spec.podSelector.matchLabels.app='{found_label}' не відповідає мітці workload '{app_label}' (k8s.mdc)"
        )));
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    /// Канонічний Deployment для фікстур.
    fn deployment_yaml(name: &str) -> String {
        format!(
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  selector:\n    matchLabels:\n      app: {name}\n  template:\n    metadata:\n      labels:\n        app: {name}\n    spec:\n      topologySpreadConstraints:\n        - maxSkew: 1\n          topologyKey: kubernetes.io/hostname\n          whenUnsatisfiable: ScheduleAnyway\n          labelSelector:\n            matchLabels:\n              app: {name}\n"
        )
    }

    /// Канонічний Kustomize Component із HPA і PDB.
    fn write_canonical_components(tmp: &TempDir, name: &str) {
        write(
            tmp,
            "svc/k8s/components/kustomization.yaml",
            "apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - hpa.yaml\n  - pdb.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/components/hpa.yaml",
            &format!(
                "apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: {name}\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: {name}\n  minReplicas: 1\n  maxReplicas: 1\n  metrics:\n    - type: Resource\n  behavior:\n    scaleUp:\n      policies:\n        - type: Percent\n    scaleDown:\n      policies:\n        - type: Percent\n"
            ),
        );
        write(
            tmp,
            "svc/k8s/components/pdb.yaml",
            &format!(
                "apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: {name}\nspec:\n  minAvailable: 0\n  selector:\n    matchLabels:\n      app: {name}\n"
            ),
        );
    }

    /// Тексти порушень першої перевірки для одного файла.
    fn deployment_messages(tmp: &TempDir, rel: &str) -> Vec<String> {
        let files = vec![tmp.path().join(rel)];
        validate_deployment_hpa_pdb_and_topology(tmp.path(), &files)
            .into_iter()
            .map(|v| v.message)
            .collect()
    }

    #[test]
    fn canonical_base_deployment_with_components_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "svc/k8s/base/deploy.yaml", &deployment_yaml("api"));
        write_canonical_components(&tmp, "api");
        assert!(deployment_messages(&tmp, "svc/k8s/base/deploy.yaml").is_empty());
    }

    #[test]
    fn missing_components_directory_is_reported_once() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "svc/k8s/base/deploy.yaml", &deployment_yaml("api"));
        assert_eq!(
            deployment_messages(&tmp, "svc/k8s/base/deploy.yaml"),
            vec![
                "svc/k8s/components: для Deployment 'api' з sibling base/ обов'язковий каталог components/ з hpa.yaml і pdb.yaml (Kustomize Component) (k8s.mdc)"
            ]
        );
    }

    #[test]
    fn local_hpa_and_pdb_in_base_layer_are_forbidden() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "svc/k8s/base/deploy.yaml", &deployment_yaml("api"));
        write(
            &tmp,
            "svc/k8s/base/hpa.yaml",
            "kind: HorizontalPodAutoscaler\n",
        );
        write(&tmp, "svc/k8s/base/pdb.yaml", "kind: PodDisruptionBudget\n");
        write_canonical_components(&tmp, "api");
        let msgs = deployment_messages(&tmp, "svc/k8s/base/deploy.yaml");
        assert_eq!(msgs.len(), 2);
        assert!(msgs[0].starts_with("svc/k8s/base/hpa.yaml: у шарі k8s/.../base"));
        assert!(msgs[1].starts_with("svc/k8s/base/pdb.yaml: у шарі k8s/.../base"));
    }

    #[test]
    fn deployment_outside_base_layer_is_ignored_entirely() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "svc/k8s/prod/deploy.yaml", &deployment_yaml("api"));
        assert!(deployment_messages(&tmp, "svc/k8s/prod/deploy.yaml").is_empty());
    }

    #[test]
    fn missing_topology_spread_constraints_is_reported() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "svc/k8s/base/deploy.yaml",
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  selector:\n    matchLabels:\n      app: api\n  template:\n    spec:\n      containers: []\n",
        );
        write_canonical_components(&tmp, "api");
        let msgs = deployment_messages(&tmp, "svc/k8s/base/deploy.yaml");
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].contains("topologySpreadConstraints: додай запис maxSkew=1"));
    }

    #[test]
    fn components_hpa_with_prod_replicas_fails_dev_like_bounds() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "svc/k8s/base/deploy.yaml", &deployment_yaml("api"));
        write_canonical_components(&tmp, "api");
        write(
            &tmp,
            "svc/k8s/components/hpa.yaml",
            "apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: api\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: api\n  minReplicas: 3\n  maxReplicas: 5\n  metrics:\n    - type: Resource\n  behavior:\n    scaleUp:\n      policies:\n        - type: Percent\n    scaleDown:\n      policies:\n        - type: Percent\n",
        );
        let msgs = deployment_messages(&tmp, "svc/k8s/base/deploy.yaml");
        assert_eq!(
            msgs,
            vec![
                "svc/k8s/components/hpa.yaml: spec.minReplicas для dev-like (base/dev/*-qa) має бути 1 (зараз: 3) (k8s.mdc)",
                "svc/k8s/components/hpa.yaml: spec.maxReplicas для dev-like (base/dev/*-qa) має бути 1 (зараз: 5) (k8s.mdc)"
            ]
        );
    }

    #[test]
    fn network_policy_is_required_next_to_workload() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "svc/k8s/base/deploy.yaml", &deployment_yaml("api"));
        let files = vec![tmp.path().join("svc/k8s/base/deploy.yaml")];
        let msgs: Vec<String> = validate_network_policies_for_k8s_workloads(tmp.path(), &files)
            .into_iter()
            .map(|v| v.message)
            .collect();
        assert_eq!(
            msgs,
            vec![
                "svc/k8s/base/networkpolicy.yaml: відсутній або не знайдено NetworkPolicy з metadata.name='api' для Deployment (k8s.mdc)"
            ]
        );
    }

    #[test]
    fn network_policy_label_mismatch_is_reported() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "svc/k8s/base/deploy.yaml", &deployment_yaml("api"));
        write(
            &tmp,
            "svc/k8s/base/networkpolicy.yaml",
            "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: api\nspec:\n  podSelector:\n    matchLabels:\n      app: other\n",
        );
        let files = vec![
            tmp.path().join("svc/k8s/base/deploy.yaml"),
            tmp.path().join("svc/k8s/base/networkpolicy.yaml"),
        ];
        let msgs: Vec<String> = validate_network_policies_for_k8s_workloads(tmp.path(), &files)
            .into_iter()
            .map(|v| v.message)
            .collect();
        assert_eq!(
            msgs,
            vec![
                "svc/k8s/base/networkpolicy.yaml: NetworkPolicy 'api' spec.podSelector.matchLabels.app='other' не відповідає мітці workload 'api' (k8s.mdc)"
            ]
        );
    }

    #[test]
    fn cron_job_app_label_comes_from_job_template_pod_labels() {
        let manifest = json!({
            "kind": "CronJob",
            "spec": { "jobTemplate": { "spec": { "template": { "metadata": { "labels": { "app": "cleanup" } } } } } }
        });
        assert_eq!(workload_app_label(&manifest), Some("cleanup"));
    }

    #[test]
    fn job_app_label_comes_from_pod_template_labels() {
        let manifest = json!({
            "kind": "Job",
            "spec": { "template": { "metadata": { "labels": { "app": "seed" } } } }
        });
        assert_eq!(workload_app_label(&manifest), Some("seed"));
    }

    #[test]
    fn env_segment_drives_dev_like_classification() {
        assert_eq!(
            k8s_env_segment_from_rel_path("svc/k8s/tr-qa/"),
            Some("tr-qa")
        );
        assert!(is_dev_like_k8s_env_segment(Some("tr-qa")));
        assert!(is_dev_like_k8s_env_segment(Some("base")));
        assert!(!is_dev_like_k8s_env_segment(Some("prod")));
        assert!(!is_dev_like_k8s_env_segment(None));
    }

    #[test]
    fn base_directory_predicate_ignores_the_file_name_segment() {
        assert!(is_k8s_yaml_under_base_directory("svc/k8s/base/deploy.yaml"));
        assert!(!is_k8s_yaml_under_base_directory("svc/k8s/base"));
        assert!(!is_k8s_yaml_under_base_directory(
            "svc/k8s/prod/deploy.yaml"
        ));
        assert!(!is_k8s_yaml_under_base_directory("svc/base/deploy.yaml"));
    }

    #[test]
    fn coerce_integer_accepts_numeric_strings_and_whole_floats() {
        assert_eq!(coerce_integer(Some(&json!(2))), Some(2));
        assert_eq!(coerce_integer(Some(&json!(2.0))), Some(2));
        assert_eq!(coerce_integer(Some(&json!(" -3 "))), Some(-3));
        assert_eq!(coerce_integer(Some(&json!(2.5))), None);
        assert_eq!(coerce_integer(Some(&json!("x"))), None);
        assert_eq!(coerce_integer(None), None);
    }

    #[test]
    fn json_stringify_mirrors_template_literal_of_missing_key() {
        assert_eq!(js_json_stringify(None), "undefined");
        assert_eq!(js_json_stringify(Some(&Value::Null)), "null");
        assert_eq!(js_json_stringify(Some(&json!("apps/v2"))), "\"apps/v2\"");
    }

    #[test]
    fn pdb_violations_cover_selector_and_dev_like_bound() {
        let manifest = json!({
            "apiVersion": "policy/v1",
            "kind": "PodDisruptionBudget",
            "spec": { "minAvailable": 2, "selector": { "matchLabels": { "app": "other" } } }
        });
        assert_eq!(
            pdb_manifest_violations(&manifest, "api", true),
            vec![
                "spec.minAvailable для dev-like (base/dev/*-qa) має бути 0 (зараз: 2)",
                "spec.selector.matchLabels.app має бути 'api' (зараз: \"other\")"
            ]
        );
    }

    #[test]
    fn hpa_violations_report_missing_behavior_and_metrics() {
        let manifest = json!({
            "apiVersion": "autoscaling/v2",
            "kind": "HorizontalPodAutoscaler",
            "spec": {
                "scaleTargetRef": { "apiVersion": "apps/v1", "kind": "Deployment", "name": "api" },
                "minReplicas": 2,
                "maxReplicas": 4
            }
        });
        assert_eq!(
            hpa_manifest_violations(&manifest, "api", false),
            vec![
                "spec.metrics має бути непорожнім масивом (наприклад, Resource/cpu/Utilization)",
                "spec.behavior відсутній (має містити scaleUp і scaleDown)"
            ]
        );
    }

    #[test]
    fn non_object_manifest_is_rejected_before_any_field_check() {
        assert_eq!(
            hpa_manifest_violations(&json!("scalar"), "api", true),
            vec!["HPA має бути обʼєктом YAML"]
        );
        assert_eq!(
            pdb_manifest_violations(&json!([1, 2]), "api", true),
            vec!["PDB має бути обʼєктом YAML"]
        );
    }
}
