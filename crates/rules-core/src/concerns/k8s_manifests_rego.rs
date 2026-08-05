//! Native-порт rego-шару концерну `k8s/manifests` — `runAllK8sRego`
//! (`npm/rules/k8s/manifests/main.mjs:6424-6474`) разом із класифікатором
//! `k8sRegoFixHint` (`main.mjs:6397-6415`).
//!
//! # Що це за шар
//!
//! `lint()` концерну `k8s/manifests` складається з чотирьох шарів (kubescape,
//! rego-батчі, per-file цикл, cross-file `validate*`). Тут — **другий**: усі
//! пер-документні структурні правила кластера винесені у rego-пакети
//! `<пакет>/rules/k8s/<concern>/`, і JS робить лише розкладку «який файл у який
//! namespace» плюс один спавн `conftest` на namespace. Мотив, чому rego НЕ
//! портується в Rust, — доккомент [`crate::conftest`].
//!
//! # Уточнення розбору: namespace-ів **девʼять**, не шість
//!
//! Попередній розбір (PR #381) називав шість namespace-ів. Насправді
//! [`REGO_TARGETS`] їх девʼять: три на всіх YAML (`k8s.manifest`,
//! `k8s.gateway`, `k8s.hpa_pdb`), один на всіх YAML із `--data`
//! (`k8s.network_policy`) і пʼять path-фільтрованих (`k8s.kustomization`,
//! `k8s.svc_yaml`, `k8s.svc_hl_yaml`, `k8s.base_kustomization`,
//! `k8s.base_manifest`).
//!
//! Гілку `--data` вживає рівно один із них — `k8s.network_policy` (не
//! `k8s.base_manifest`, як зафіксував доккомент [`crate::conftest`] до цього
//! порту): у `templateData` їдуть два NetworkPolicy-сніпети, з якими rego
//! звіряє `spec` політики. Саме тому `--data` приїхав у [`crate::conftest`]
//! разом із цим модулем — тепер у нього є споживач.
//!
//! # Що НЕ входить
//!
//! `hasura_configmap`/`hasura_httproute` тут відсутні свідомо: у них cross-file
//! gating, і обидва — окремі native-концерни
//! ([`super::k8s_hasura_configmap`], [`super::k8s_hasura_httproute`]).
//! Ungated прогін їхніх rego на всі файли-збіги glob давав false positive
//! (доккомент JS-канону, `main.mjs:6366-6374`).

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;
use serde_json::Value;

use crate::conftest::{run_conftest_batch, run_conftest_batch_with_data, ConftestViolation};
use crate::diagnostics::{Severity, Violation};
use crate::rules_package::{missing_package_root_hint, rules_root};
use crate::RulesError;

/// Дефолтний `reason` порушень концерну — `ctx.concernId` у
/// `createViolationReporter` (`violation-reporter.mjs:27`); для `k8s/manifests`
/// це `manifests`. Ставиться на ті rego-порушення, яким `k8sRegoFixHint` не дав
/// власного `reason`.
pub(crate) const DEFAULT_REASON: &str = "manifests";

/// Хто саме бере файл у батч — порт трьох форм фільтра `runAllK8sRego`
/// (`main.mjs:6427-6436`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TargetFilter {
    /// Усі знайдені YAML (`allYaml`).
    AllYaml,
    /// Точна назва файла з case-insensitive порівнянням (`kustomization.yaml`).
    BasenameCaseInsensitive(&'static str),
    /// Точна назва файла байт-у-байт (`svc.yaml`, `svc-hl.yaml`) — JS тут
    /// свідомо БЕЗ `toLowerCase()`, на відміну від kustomization.
    BasenameExact(&'static str),
    /// `k8s/base/kustomization.yaml` — `isBaseKustomizationPath`
    /// (`main.mjs:1565-1567`).
    BaseKustomization,
    /// Ресурс під `k8s/base/`, який НЕ `kustomization.yaml`
    /// (`main.mjs:6432-6436`).
    BaseResource,
}

/// Один rego-батч: namespace, каталог полісі відносно `<пакет>/rules` і фільтр
/// цілей. Порядок масиву — порядок violations у виводі лінту, тож він частина
/// паритету (`main.mjs:6441-6459`).
struct RegoTarget {
    /// Повне ім'я rego-пакета (`--namespace`).
    namespace: &'static str,
    /// Каталог полісі відносно кореня `rules/`.
    policy_dir_rel: &'static str,
    /// Які з YAML потрапляють у цей батч.
    filter: TargetFilter,
    /// Чи потрібен цьому батчу `--data` з парою сніпетів NetworkPolicy.
    needs_snippets: bool,
}

/// Розкладка батч-цілей — рядок-у-рядок за `targets` (`main.mjs:6441-6459`).
const REGO_TARGETS: &[RegoTarget] = &[
    RegoTarget {
        namespace: "k8s.manifest",
        policy_dir_rel: "k8s/manifest",
        filter: TargetFilter::AllYaml,
        needs_snippets: false,
    },
    RegoTarget {
        namespace: "k8s.gateway",
        policy_dir_rel: "k8s/gateway",
        filter: TargetFilter::AllYaml,
        needs_snippets: false,
    },
    RegoTarget {
        namespace: "k8s.hpa_pdb",
        policy_dir_rel: "k8s/hpa_pdb",
        filter: TargetFilter::AllYaml,
        needs_snippets: false,
    },
    RegoTarget {
        namespace: "k8s.network_policy",
        policy_dir_rel: "k8s/network_policy",
        filter: TargetFilter::AllYaml,
        needs_snippets: true,
    },
    RegoTarget {
        namespace: "k8s.kustomization",
        policy_dir_rel: "k8s/kustomization",
        filter: TargetFilter::BasenameCaseInsensitive("kustomization.yaml"),
        needs_snippets: false,
    },
    RegoTarget {
        namespace: "k8s.svc_yaml",
        policy_dir_rel: "k8s/svc_yaml",
        filter: TargetFilter::BasenameExact("svc.yaml"),
        needs_snippets: false,
    },
    RegoTarget {
        namespace: "k8s.svc_hl_yaml",
        policy_dir_rel: "k8s/svc_hl_yaml",
        filter: TargetFilter::BasenameExact("svc-hl.yaml"),
        needs_snippets: false,
    },
    RegoTarget {
        namespace: "k8s.base_kustomization",
        policy_dir_rel: "k8s/base_kustomization",
        filter: TargetFilter::BaseKustomization,
        needs_snippets: false,
    },
    RegoTarget {
        namespace: "k8s.base_manifest",
        policy_dir_rel: "k8s/base_manifest",
        filter: TargetFilter::BaseResource,
        needs_snippets: false,
    },
];

/// Файли сніпетів NetworkPolicy відносно кореня `rules/` — порт
/// `NETWORK_POLICY_SNIPPET_URLS` (`main.mjs:3828-3831`), де URL рахуються від
/// `npm/rules/k8s/manifests/main.mjs`.
const SNIPPET_FILES: &[(&str, &str)] = &[
    (
        "deployment_snippet",
        "k8s/network_policy/template/deployment.snippet.yaml",
    ),
    (
        "stateful_set_snippet",
        "k8s/network_policy/template/stateful-set.snippet.yaml",
    ),
];

/// `spec.strategy має бути RollingUpdate` — літерал `REGO_HINT_DEPLOYMENT_STRATEGY_RE`
/// (`main.mjs:6383`). Патерн — чистий літерал, тож `contains`.
const HINT_DEPLOYMENT_STRATEGY: &str = "spec.strategy має бути RollingUpdate";

/// Літерал `REGO_HINT_NETWORKPOLICY_EGRESS_RE` (`main.mjs:6384`).
const HINT_NETWORK_POLICY_EGRESS: &str = "відсутнє обовʼязкове egress-правило";

/// Літерал `REGO_HINT_KUSTOMIZATION_PATCHES_RE` (`main.mjs:6385`).
const HINT_KUSTOMIZATION_PATCHES: &str = "patches має бути за алфавітом";

/// `REGO_HINT_SVC_CLUSTERIP_RE` (`main.mjs:6386`) — тут альтернація з `[^\n]*`
/// на `contains` не вироджується, тож лишається регексом.
static HINT_SVC_CLUSTER_IP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"spec\.type[^\n]*ClusterIP|додай spec\.type: ClusterIP").expect("valid regex")
});

/// `REGO_HINT_SVC_HL_CLUSTERIP_RE` (`main.mjs:6387`).
static HINT_SVC_HL_CLUSTER_IP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"spec\.clusterIP[^\n]*None|додай spec\.clusterIP: None").expect("valid regex")
});

/// Форма сніпета: беремо з YAML лише `spec` (`loadSnippetSpec` повертає
/// `parseDocument(raw).toJS().spec`, `main.mjs:3848`).
#[derive(Debug, Deserialize)]
struct SnippetDocument {
    spec: Value,
}

/// posix-relative шлях від `root`, або сам `abs` — порт
/// `relative(root, abs).replaceAll('\\','/') || abs` (`main.mjs:6425`).
///
/// Семантика `path.relative` Node відтворена повністю, разом із виходом за
/// корінь через `..`: `strip_prefix` тут не досить — гілка «посилання виходить
/// за межі репозиторію» (`main.mjs:580-582`) друкує саме `../…`-форму, і
/// підміна її абсолютним шляхом ламала б текст порушення.
pub(crate) fn rel_posix(root: &Path, abs: &Path) -> String {
    let from: Vec<_> = root.components().collect();
    let to: Vec<_> = abs.components().collect();
    let common = from
        .iter()
        .zip(to.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - common];
    parts.extend(
        to[common..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    let rel = parts.join("/");
    // `|| abs` JS-канону: порожній результат означає «це той самий шлях».
    if rel.is_empty() {
        abs.to_string_lossy().into_owned()
    } else {
        rel
    }
}

/// Ім'я файла (порожнє, якщо шлях закінчується `..` тощо).
fn basename(abs: &Path) -> String {
    abs.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Чи relative-шлях — `k8s/base/kustomization.yaml` — порт
/// `K8S_BASE_KUSTOMIZATION_PATH_RE` (`main.mjs:193`,
/// `/(^|\/)k8s\/base\/kustomization\.yaml$/`).
fn is_base_kustomization_path(rel_posix: &str) -> bool {
    rel_posix == "k8s/base/kustomization.yaml"
        || rel_posix.ends_with("/k8s/base/kustomization.yaml")
}

/// Чи relative-шлях лежить під `k8s/base/` — порт `K8S_BASE_SEGMENT_RE`
/// (`main.mjs:194`, `/(^|\/)k8s\/base\//`).
pub(crate) fn has_k8s_base_segment(rel_posix: &str) -> bool {
    rel_posix.starts_with("k8s/base/") || rel_posix.contains("/k8s/base/")
}

/// Цілі одного батчу — порт фільтрів `main.mjs:6427-6436`.
fn files_for(filter: TargetFilter, root: &Path, yaml_files: &[PathBuf]) -> Vec<PathBuf> {
    yaml_files
        .iter()
        .filter(|abs| {
            let name = basename(abs);
            match filter {
                TargetFilter::AllYaml => true,
                TargetFilter::BasenameCaseInsensitive(expected) => name.to_lowercase() == expected,
                TargetFilter::BasenameExact(expected) => name == expected,
                TargetFilter::BaseKustomization => {
                    is_base_kustomization_path(&rel_posix(root, abs))
                }
                TargetFilter::BaseResource => {
                    has_k8s_base_segment(&rel_posix(root, abs))
                        && name.to_lowercase() != "kustomization.yaml"
                }
            }
        })
        .cloned()
        .collect()
}

/// `templateData` для `k8s.network_policy` — порт
/// `{ deployment_snippet: loadSnippetSpec('deployment'), stateful_set_snippet:
/// loadSnippetSpec('statefulSet') }` (`main.mjs:6449-6452`).
///
/// Нечитабельний сніпет або сніпет без `spec` — [`RulesError::Concern`], а не тихий
/// пропуск: rego без `data.template.*` мовчки перестав би репортувати
/// (fail-open), і зникнення перевірки не було б видно (той самий контракт, що
/// `throw` у `loadSnippetSpec`).
fn load_snippet_template_data(rules_root: &Path) -> Result<Value, RulesError> {
    let mut map = serde_json::Map::new();
    for (key, rel) in SNIPPET_FILES {
        let abs = rules_root.join(rel);
        let raw = std::fs::read_to_string(&abs).map_err(|error| {
            RulesError::Concern(format!(
                "k8s.network_policy: не читається сніпет {}: {error}",
                abs.display()
            ))
        })?;
        let doc: SnippetDocument = serde_yaml::from_str(&raw).map_err(|error| {
            RulesError::Concern(format!(
                "k8s.network_policy: сніпет {} без spec: {error}",
                abs.display()
            ))
        })?;
        map.insert((*key).to_string(), doc.spec);
    }
    Ok(Value::Object(map))
}

/// Structured fix-hint для одного rego-порушення — порт `k8sRegoFixHint`
/// (`main.mjs:6397-6415`). `None` — порушення без підказки (тоді `reason`
/// дефолтний, а `file`/`data` не проставляються, як у `fail(msg, undefined)`).
fn rego_fix_hint(namespace: &str, message: &str) -> Option<&'static str> {
    match namespace {
        "k8s.manifest" if message.contains(HINT_DEPLOYMENT_STRATEGY) => Some("deployment-strategy"),
        "k8s.network_policy" if message.contains(HINT_NETWORK_POLICY_EGRESS) => {
            Some("networkpolicy-egress")
        }
        "k8s.kustomization" if message.contains(HINT_KUSTOMIZATION_PATCHES) => {
            Some("kustomization-patches-sort")
        }
        "k8s.svc_yaml" if HINT_SVC_CLUSTER_IP_RE.is_match(message) => Some("svc-clusterip-type"),
        "k8s.svc_hl_yaml" if HINT_SVC_HL_CLUSTER_IP_RE.is_match(message) => {
            Some("svc-hl-cluster-ip")
        }
        _ => None,
    }
}

/// Перетворює одне порушення conftest у [`Violation`] — порт
/// `fail(`${rel}: ${v.message}`, k8sRegoFixHint(...))` (`main.mjs:6470-6471`)
/// з розкладкою `createViolationReporter` (`violation-reporter.mjs:34-40`).
fn to_violation(root: &Path, namespace: &str, raw: &ConftestViolation) -> Violation {
    let rel = rel_posix(root, Path::new(&raw.filename));
    let message = format!("{rel}: {}", raw.message);
    match rego_fix_hint(namespace, &raw.message) {
        Some(reason) => Violation {
            reason: reason.to_string(),
            message,
            file: Some(rel),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "kind": reason })),
        },
        None => Violation {
            reason: DEFAULT_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        },
    }
}

/// Прогін усіх девʼяти rego-цілей одним батчем на namespace — порт `runAllK8sRego`
/// (`main.mjs:6424-6474`).
///
/// Порожній батч пропускається без спавна (`if (t.files.length === 0) continue`),
/// тож дерево без жодного `svc.yaml` не платить за namespace `k8s.svc_yaml`.
pub fn run_all_k8s_rego(root: &Path, yaml_files: &[PathBuf]) -> Result<Vec<Violation>, RulesError> {
    let batches: Vec<(&RegoTarget, Vec<PathBuf>)> = REGO_TARGETS
        .iter()
        .map(|target| (target, files_for(target.filter, root, yaml_files)))
        .filter(|(_, files)| !files.is_empty())
        .collect();
    if batches.is_empty() {
        return Ok(Vec::new());
    }

    let rules_root =
        rules_root(root).ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?;
    // Сніпети читаються один раз на прогін (JS кешує їх у `_snippetCache`) і
    // лише якщо батч, що їх вживає, реально непорожній.
    let snippets = if batches.iter().any(|(target, _)| target.needs_snippets) {
        Some(load_snippet_template_data(&rules_root)?)
    } else {
        None
    };

    let mut violations = Vec::new();
    for (target, files) in batches {
        let policy_abs = rules_root.join(target.policy_dir_rel);
        let failures = match (target.needs_snippets, snippets.as_ref()) {
            (true, Some(data)) => {
                run_conftest_batch_with_data(&policy_abs, target.namespace, &files, data)?
            }
            _ => run_conftest_batch(&policy_abs, target.namespace, &files)?,
        };
        violations.extend(
            failures
                .iter()
                .map(|failure| to_violation(root, target.namespace, failure)),
        );
    }
    Ok(violations)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    /// Усі девʼять батч-цілей — і в тому порядку, у якому їх перелічує JS-канон:
    /// порядок визначає порядок violations у виводі.
    #[test]
    fn targets_mirror_js_namespace_order() {
        assert_eq!(
            REGO_TARGETS.iter().map(|t| t.namespace).collect::<Vec<_>>(),
            vec![
                "k8s.manifest",
                "k8s.gateway",
                "k8s.hpa_pdb",
                "k8s.network_policy",
                "k8s.kustomization",
                "k8s.svc_yaml",
                "k8s.svc_hl_yaml",
                "k8s.base_kustomization",
                "k8s.base_manifest",
            ]
        );
        // `--data` вживає рівно один батч.
        assert_eq!(REGO_TARGETS.iter().filter(|t| t.needs_snippets).count(), 1);
    }

    /// Розкладка «файл → батч» на дереві, що покриває всі пʼять форм фільтра.
    #[test]
    fn filters_split_files_per_namespace() {
        let root = Path::new("/repo");
        let files: Vec<PathBuf> = [
            "k8s/base/kustomization.yaml",
            "k8s/base/deployment.yaml",
            "k8s/base/svc.yaml",
            "k8s/base/svc-hl.yaml",
            "k8s/overlays/prod/Kustomization.yaml",
            "svc/k8s/overlays/prod/hpa.yaml",
        ]
        .iter()
        .map(|rel| root.join(rel))
        .collect();

        let by = |filter| {
            files_for(filter, root, &files)
                .iter()
                .map(|abs| rel_posix(root, abs))
                .collect::<Vec<_>>()
        };

        assert_eq!(by(TargetFilter::AllYaml).len(), 6);
        // kustomization — case-insensitive, тож `Kustomization.yaml` теж.
        assert_eq!(
            by(TargetFilter::BasenameCaseInsensitive("kustomization.yaml")),
            vec![
                "k8s/base/kustomization.yaml",
                "k8s/overlays/prod/Kustomization.yaml"
            ]
        );
        assert_eq!(
            by(TargetFilter::BasenameExact("svc.yaml")),
            vec!["k8s/base/svc.yaml"]
        );
        assert_eq!(
            by(TargetFilter::BasenameExact("svc-hl.yaml")),
            vec!["k8s/base/svc-hl.yaml"]
        );
        assert_eq!(
            by(TargetFilter::BaseKustomization),
            vec!["k8s/base/kustomization.yaml"]
        );
        // base-ресурси — усе під `k8s/base/`, окрім самої kustomization.
        assert_eq!(
            by(TargetFilter::BaseResource),
            vec![
                "k8s/base/deployment.yaml",
                "k8s/base/svc.yaml",
                "k8s/base/svc-hl.yaml"
            ]
        );
    }

    /// `svc.yaml`-фільтр у JS свідомо БЕЗ `toLowerCase()` — `Svc.yaml` у батч
    /// не потрапляє (на відміну від kustomization).
    #[test]
    fn svc_filter_is_case_sensitive_unlike_kustomization() {
        let root = Path::new("/repo");
        let files = vec![root.join("k8s/base/Svc.yaml")];
        assert!(files_for(TargetFilter::BasenameExact("svc.yaml"), root, &files).is_empty());
    }

    /// `k8s/base/` розпізнається і на корені репо, і в підкаталозі — але не як
    /// підрядок чужого імені (`myk8s/base/`).
    #[test]
    fn base_segment_matches_only_exact_k8s_component() {
        assert!(has_k8s_base_segment("k8s/base/deploy.yaml"));
        assert!(has_k8s_base_segment("svc/k8s/base/deploy.yaml"));
        assert!(!has_k8s_base_segment("svc/myk8s/base/deploy.yaml"));
        assert!(!has_k8s_base_segment("k8s/overlays/prod/deploy.yaml"));
        assert!(is_base_kustomization_path("k8s/base/kustomization.yaml"));
        assert!(is_base_kustomization_path("a/k8s/base/kustomization.yaml"));
        assert!(!is_base_kustomization_path("k8s/base/kustomization.yml"));
    }

    /// Класифікатор підказок: кожна з пʼяти гілок і namespace-гейт (той самий
    /// текст в іншому namespace підказки не дає).
    #[test]
    fn fix_hints_match_js_classification() {
        assert_eq!(
            rego_fix_hint(
                "k8s.manifest",
                "deploy.yaml: spec.strategy має бути RollingUpdate"
            ),
            Some("deployment-strategy")
        );
        assert_eq!(
            rego_fix_hint(
                "k8s.network_policy",
                "у політиці відсутнє обовʼязкове egress-правило"
            ),
            Some("networkpolicy-egress")
        );
        assert_eq!(
            rego_fix_hint("k8s.kustomization", "patches має бути за алфавітом"),
            Some("kustomization-patches-sort")
        );
        assert_eq!(
            rego_fix_hint("k8s.svc_yaml", "додай spec.type: ClusterIP"),
            Some("svc-clusterip-type")
        );
        assert_eq!(
            rego_fix_hint("k8s.svc_yaml", "spec.type у svc.yaml має бути ClusterIP"),
            Some("svc-clusterip-type")
        );
        assert_eq!(
            rego_fix_hint("k8s.svc_hl_yaml", "додай spec.clusterIP: None"),
            Some("svc-hl-cluster-ip")
        );
        // Гейт за namespace: той самий текст у чужому пакеті — без підказки.
        assert_eq!(
            rego_fix_hint("k8s.gateway", "spec.strategy має бути RollingUpdate"),
            None
        );
        assert_eq!(rego_fix_hint("k8s.manifest", "щось інше"), None);
    }

    /// Порушення з підказкою несе `reason`/`file`/`data`, без підказки —
    /// дефолтний `reason` і жодного `file`/`data` (форма `fail(msg)` у
    /// `createViolationReporter`).
    #[test]
    fn violation_shape_follows_hint_presence() {
        let root = Path::new("/repo");
        let raw = ConftestViolation {
            filename: "/repo/k8s/base/svc.yaml".to_string(),
            namespace: "k8s.svc_yaml".to_string(),
            message: "додай spec.type: ClusterIP".to_string(),
        };
        let hinted = to_violation(root, "k8s.svc_yaml", &raw);
        assert_eq!(hinted.reason, "svc-clusterip-type");
        assert_eq!(hinted.file.as_deref(), Some("k8s/base/svc.yaml"));
        assert_eq!(
            hinted.message,
            "k8s/base/svc.yaml: додай spec.type: ClusterIP"
        );
        assert_eq!(
            hinted.data,
            Some(serde_json::json!({ "kind": "svc-clusterip-type" }))
        );

        let plain = to_violation(
            root,
            "k8s.gateway",
            &ConftestViolation {
                filename: "/repo/k8s/base/gw.yaml".to_string(),
                namespace: "k8s.gateway".to_string(),
                message: "щось не так".to_string(),
            },
        );
        assert_eq!(plain.reason, DEFAULT_REASON);
        assert!(plain.file.is_none());
        assert!(plain.data.is_none());
    }

    /// Порожній список YAML → жодного батчу, тобто ані спавна `conftest`, ані
    /// походу за коренем пакета (інакше було б fail-closed на tmp-дереві).
    #[test]
    fn empty_yaml_list_skips_every_batch() {
        let tmp = TempDir::new().unwrap();
        assert!(run_all_k8s_rego(tmp.path(), &[]).unwrap().is_empty());
    }

    /// Сніпети читаються з `<rules>/k8s/network_policy/template/` і дають рівно
    /// `spec` кожного документа під ключами, які чекає rego.
    #[test]
    fn snippet_template_data_carries_spec_under_rego_keys() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/network_policy/template/deployment.snippet.yaml",
            "kind: NetworkPolicy\nspec:\n  policyTypes:\n    - Egress\n",
        );
        write(
            &tmp,
            "k8s/network_policy/template/stateful-set.snippet.yaml",
            "kind: NetworkPolicy\nspec:\n  policyTypes:\n    - Ingress\n",
        );
        assert_eq!(
            load_snippet_template_data(tmp.path()).unwrap(),
            serde_json::json!({
                "deployment_snippet": { "policyTypes": ["Egress"] },
                "stateful_set_snippet": { "policyTypes": ["Ingress"] }
            })
        );
    }

    /// Відсутній сніпет — hard error, а не тихий прогін без `--data`: rego без
    /// `data.template.*` перестав би репортувати, і зникнення перевірки було б
    /// невидиме.
    #[test]
    fn missing_snippet_fails_closed() {
        let tmp = TempDir::new().unwrap();
        let err = load_snippet_template_data(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("не читається сніпет"), "{err}");
    }
}
