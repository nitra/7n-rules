//! Native-порт `k8s/hasura_httproute` (`npm/rules/k8s/hasura_httproute/main.mjs`,
//! 35 рядків) разом із його ядром `validateHasuraHttpRouteCanon`
//! (`npm/rules/k8s/manifests/main.mjs:3187-3218`) і крос-файловим індексом
//! `collectHasuraDeploymentsAndHttpRoutes` (`main.mjs:3099-3157`).
//!
//! # Що це за концерн
//!
//! Другий **gated detector** кластера, дзеркальний до
//! [`super::k8s_hasura_configmap`]: rego-пакет `k8s.hasura_httproute` звіряє
//! канон із 4 правил Hasura-маршруту, але прогнати його на всі `hr.yaml` під
//! `k8s` не можна — звичайний HTTPRoute без Hasura дав би false positive. Гейт:
//! HTTPRoute валідується, тільки якщо в **тому самому каталозі** є
//! Hasura-Deployment із **тим самим `metadata.name`**.
//!
//! # Обсяг порту
//!
//! - індекс — один прохід по всіх `*.yaml` під `k8s`: Hasura-Deployment за
//!   каталогом + усі документи `kind: HTTPRoute` групи Gateway API;
//! - гейт — збіг `metadata.name` HTTPRoute з іменем Hasura-Deployment у його
//!   каталозі (порт `main.mjs:3194-3202`);
//! - валідація — один спавн `conftest` на namespace `k8s.hasura_httproute`;
//! - `reason` порушення — див. секцію «Reason: дефолт концерну» нижче.
//!
//! # Reason: дефолт концерну, крім rule1
//!
//! JS-версія кладе явний `reason` лише порушенням «правило 1 Hasura-канона»
//! (`REGO_HINT_HASURA_HTTPROUTE_RULE1_RE`, `main.mjs:6576`) — це маркер для
//! T0-фази, яка вміє автоматично виправити рівно цей випадок; решті `fail(msg)` іде без
//! `opts`, тобто з дефолтним `reason = ctx.concernId`. Порт відтворює обидві
//! гілки буквально: дефолт тут — рядок `"hasura_httproute"` (ім'я каталогу
//! концерну = `concernId`), як і в інших native-портах, що дзеркалять дефолтний
//! `reason` ([`super::rego_tooling`], [`super::forbidden_prettier`]).
//!
//! # `ctx.files` ігнорується — концерн full-scope
//!
//! Причина та сама, що в [`super::k8s_hasura_configmap`]: поверхня похідна від
//! `policy` (`deriveLintFromPolicy`), тобто `scope: 'full'`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::concerns::cursor_ignore::load_cursor_ignore_paths;
use crate::concerns::k8s_common::find_k8s_yaml_files;
use crate::concerns::k8s_hasura::{
    is_hasura_deployment_manifest, manifest_metadata_name, parse_k8s_yaml_docs,
    GATEWAY_API_GROUP_PREFIX,
};
use crate::conftest::run_conftest_batch;
use crate::diagnostics::{Severity, Violation};
use crate::rules_package::{missing_package_root_hint, rules_root};
use crate::RulesError;

/// Каталог rego-полісі відносно `<корінь пакета>/rules` (`main.mjs:3205`).
const POLICY_DIR_REL: &str = "k8s/hasura_httproute";

/// Namespace rego-пакета (`main.mjs:3206`).
const NAMESPACE: &str = "k8s.hasura_httproute";

/// Дефолтний `reason` — `concernId` (секція «Reason» доккоменту модуля).
const REASON_DEFAULT: &str = "hasura_httproute";

/// `reason` для автоматично виправного порушення правила 1 (`main.mjs:3214`).
const REASON_RULE1: &str = "hasura-httproute-rule1-filters";

/// Порт `REGO_HINT_HASURA_HTTPROUTE_RULE1_RE` (`main.mjs:6576`,
/// `/правило 1 Hasura-канона \(rules\[\d+\]/u`).
static RULE1_HINT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"правило 1 Hasura-канона \(rules\[\d+\]").expect("valid regex"));

/// Індекс одного прогону: імена Hasura-Deployment за каталогом і всі знайдені
/// HTTPRoute (файл + `metadata.name` документа).
///
/// `BTreeMap`/`BTreeSet` замість hash-структур JS — детермінований порядок
/// обходу без окремого сортування; на набір цілей це не впливає (гейт —
/// перевірка належності), але робить список файлів для `conftest` стабільним.
#[derive(Debug, Default)]
struct HasuraCanonIndex {
    hasura_by_dir: BTreeMap<PathBuf, BTreeSet<String>>,
    http_routes: Vec<(PathBuf, String)>,
}

/// Чи документ — HTTPRoute групи Gateway API (порт умови `main.mjs:3152-3154`).
fn is_gateway_api_http_route(doc: &Value) -> bool {
    let Some(rec) = doc.as_object() else {
        return false;
    };
    rec.get("kind").and_then(Value::as_str) == Some("HTTPRoute")
        && rec
            .get("apiVersion")
            .and_then(Value::as_str)
            .is_some_and(|api| api.starts_with(GATEWAY_API_GROUP_PREFIX))
}

/// Один прохід по всіх `*.yaml` під `k8s` — порт
/// `collectHasuraDeploymentsAndHttpRoutes` (`main.mjs:3099-3115`) разом із
/// `indexOneK8sYamlForHasuraCanon`/`recordHasuraDeploymentName`.
///
/// `docIndex` JS-версії тут не збирається: він потрібен лише для
/// повідомлень fix-фази, а detector-гілка (`validateHasuraHttpRouteCanon`)
/// передає в rego сам ФАЙЛ, не документ.
fn build_index(yaml_files: &[PathBuf]) -> HasuraCanonIndex {
    let mut index = HasuraCanonIndex::default();
    for abs in yaml_files {
        let Some(dir) = abs.parent() else { continue };
        for doc in parse_k8s_yaml_docs(abs) {
            if is_hasura_deployment_manifest(&doc) {
                if let Some(name) = manifest_metadata_name(&doc) {
                    index
                        .hasura_by_dir
                        .entry(dir.to_path_buf())
                        .or_default()
                        .insert(name.to_string());
                }
            }
            if is_gateway_api_http_route(&doc) {
                let name = manifest_metadata_name(&doc).unwrap_or_default().to_string();
                index.http_routes.push((abs.clone(), name));
            }
        }
    }
    index
}

/// Файли HTTPRoute, спарені з Hasura-Deployment того самого каталогу за
/// `metadata.name` — порт `pairedFiles` (`main.mjs:3194-3202`). Дедуп
/// (кілька HTTPRoute-документів в одному файлі → файл один раз) — як `Set` у JS.
fn paired_http_route_files(index: &HasuraCanonIndex) -> Vec<PathBuf> {
    let mut paired: BTreeSet<PathBuf> = BTreeSet::new();
    for (abs, name) in &index.http_routes {
        if name.is_empty() {
            continue;
        }
        let Some(dir) = abs.parent() else { continue };
        if index
            .hasura_by_dir
            .get(dir)
            .is_some_and(|names| names.contains(name))
        {
            paired.insert(abs.clone());
        }
    }
    paired.into_iter().collect()
}

/// posix-relative шлях від `root`, або сам `abs` — порт
/// `relative(root, v.filename) || v.filename` (`main.mjs:3210`).
fn rel_posix(root: &Path, abs: &Path) -> String {
    match abs.strip_prefix(root) {
        Ok(rel) if !rel.as_os_str().is_empty() => rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
        _ => abs.to_string_lossy().into_owned(),
    }
}

/// Detector `k8s/hasura_httproute` — порт `lint(ctx)`
/// (`hasura_httproute/main.mjs:20-35`) + `validateHasuraHttpRouteCanon`.
pub fn k8s_hasura_httproute(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let yaml_files = find_k8s_yaml_files(cwd, &ignore_paths);
    if yaml_files.is_empty() {
        return Ok(Vec::new());
    }

    let index = build_index(&yaml_files);
    if index.hasura_by_dir.is_empty() || index.http_routes.is_empty() {
        return Ok(Vec::new());
    }
    let paired = paired_http_route_files(&index);
    if paired.is_empty() {
        return Ok(Vec::new());
    }

    let policy_abs = rules_root(cwd)
        .ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?
        .join(POLICY_DIR_REL);
    let failures = run_conftest_batch(&policy_abs, NAMESPACE, &paired)?;

    Ok(failures
        .into_iter()
        .map(|failure| {
            let rel = rel_posix(cwd, Path::new(&failure.filename));
            let is_rule1 = RULE1_HINT_RE.is_match(&failure.message);
            Violation {
                reason: if is_rule1 {
                    REASON_RULE1
                } else {
                    REASON_DEFAULT
                }
                .to_string(),
                message: format!("{rel}: {}", failure.message),
                // JS кладе `file`/`data` лише в rule1-гілці (`hint`); решта
                // `fail(msg)` іде без них — дзеркалимо буквально.
                file: is_rule1.then(|| rel.clone()),
                severity: Severity::Error,
                data: is_rule1.then(|| serde_json::json!({ "kind": REASON_RULE1 })),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    const HASURA_DEPLOYMENT: &str = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: db-h\nspec:\n  template:\n    spec:\n      containers:\n        - name: h\n          image: hasura/graphql-engine:v2.49.0\n";

    /// HTTPRoute Gateway API із заданим `metadata.name`.
    fn http_route(name: &str) -> String {
        format!("apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: {name}\nspec:\n  rules: []\n")
    }

    /// Порожнє дерево — 0 violations без походу в rego.
    #[test]
    fn empty_tree_returns_no_violations() {
        let tmp = TempDir::new().unwrap();
        assert!(k8s_hasura_httproute(tmp.path()).unwrap().is_empty());
    }

    /// HTTPRoute без Hasura-Deployment поруч — гейт закритий.
    #[test]
    fn http_route_without_hasura_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/hr.yaml", &http_route("web"));
        assert!(k8s_hasura_httproute(tmp.path()).unwrap().is_empty());
    }

    /// Hasura-Deployment є, але `metadata.name` HTTPRoute інший — пари немає,
    /// гейт лишається закритим (саме цю прив'язку за іменем і робить канон).
    #[test]
    fn http_route_with_other_name_is_not_paired() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/hr.yaml", &http_route("web"));
        write(&tmp, "k8s/base/deployment.yaml", HASURA_DEPLOYMENT);
        let index = build_index(&find_k8s_yaml_files(tmp.path(), &[]));
        assert!(paired_http_route_files(&index).is_empty());
    }

    /// Той самий `metadata.name` у тому самому каталозі — пара є.
    #[test]
    fn http_route_with_matching_name_is_paired() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/hr.yaml", &http_route("db-h"));
        write(&tmp, "k8s/base/deployment.yaml", HASURA_DEPLOYMENT);
        let index = build_index(&find_k8s_yaml_files(tmp.path(), &[]));
        assert_eq!(
            paired_http_route_files(&index),
            vec![tmp.path().join("k8s/base/hr.yaml")]
        );
    }

    /// Прив'язка діє **в межах каталогу**: той самий `metadata.name`, але HTTPRoute в
    /// іншому каталозі — пари немає.
    #[test]
    fn pairing_is_scoped_to_the_same_directory() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/deployment.yaml", HASURA_DEPLOYMENT);
        write(&tmp, "k8s/overlays/prod/hr.yaml", &http_route("db-h"));
        let index = build_index(&find_k8s_yaml_files(tmp.path(), &[]));
        assert!(paired_http_route_files(&index).is_empty());
    }

    /// HTTPRoute чужої групи (`apiVersion` не Gateway API) не індексується
    /// взагалі — навіть із правильним іменем.
    #[test]
    fn non_gateway_api_http_route_is_ignored() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/hr.yaml",
            "apiVersion: extensions/v1beta1\nkind: HTTPRoute\nmetadata:\n  name: db-h\n",
        );
        write(&tmp, "k8s/base/deployment.yaml", HASURA_DEPLOYMENT);
        let index = build_index(&find_k8s_yaml_files(tmp.path(), &[]));
        assert!(index.http_routes.is_empty());
    }

    /// Кілька HTTPRoute-документів в одному файлі → файл потрапляє в цілі один
    /// раз (дедуп `Set` JS-канону).
    #[test]
    fn multiple_routes_in_one_file_are_deduped() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/hr.yaml",
            &format!("{}---\n{}", http_route("db-h"), http_route("db-h")),
        );
        write(&tmp, "k8s/base/deployment.yaml", HASURA_DEPLOYMENT);
        let index = build_index(&find_k8s_yaml_files(tmp.path(), &[]));
        assert_eq!(index.http_routes.len(), 2);
        assert_eq!(paired_http_route_files(&index).len(), 1);
    }

    /// Регекс rule1 відрізняє автоматично виправне порушення від решти — саме він
    /// вирішує, який `reason` і чи буде `file`/`data`.
    #[test]
    fn rule1_hint_matches_only_rule1_messages() {
        assert!(RULE1_HINT_RE.is_match("правило 1 Hasura-канона (rules[0]) має redirect"));
        assert!(!RULE1_HINT_RE.is_match("правило 2 Hasura-канона (rules[1]) відсутнє"));
        assert!(!RULE1_HINT_RE.is_match("правило 1 Hasura-канона без індексу"));
    }

    /// Гейт відкритий, але корінь пакета не резолвиться → fail-closed із
    /// підказкою, а не мовчазні 0 violations.
    #[test]
    fn open_gate_without_package_root_fails_closed() {
        if std::env::var("N_RULES_PACKAGE_ROOT").is_ok() {
            return; // оточення з явним override — сценарій недосяжний
        }
        let tmp = TempDir::new().unwrap();
        write(&tmp, "k8s/base/hr.yaml", &http_route("db-h"));
        write(&tmp, "k8s/base/deployment.yaml", HASURA_DEPLOYMENT);

        let err = k8s_hasura_httproute(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("N_RULES_PACKAGE_ROOT"), "{err}");
    }
}
