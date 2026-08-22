//! Дзеркальний набір структурованих джерел — сценарій-у-сценарій із
//! `tests/structured-sources.test.mjs`, плюс диференційна звірка ВСІХ шести
//! фрагментів із живим JS.
//!
//! Звірка тут критична: `config:`/`schema:`/`contract:`/`evidence:`/`edge:`
//! і ID кожного твердження — це digest-и, тож дрейф формули тихо перебудував
//! би граф контрактів домену.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rules_docs::deterministic::canonical_json;
use rules_docs::structured_sources::{
    load_structured_sources, merge_structured_fragments, DomainScope, Fragment,
};
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("fixtures/js-structured.json");
const DOMAIN: &str = "npm:@fixture/orders";

fn temp_root(label: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "rules-docs-structured-{}-{label}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("корінь створюється");
    std::fs::canonicalize(&root).expect("корінь канонізується")
}

fn write(root: &Path, relative: &str, content: &str) {
    let target = root.join(relative);
    std::fs::create_dir_all(target.parent().expect("є батьківська тека")).expect("тека");
    std::fs::write(target, content).expect("запис фікстури");
}

fn package_manifest(root: &Path) {
    write(
        root,
        "package.json",
        "{\"name\":\"@fixture/orders\",\"version\":\"1.0.0\"}\n",
    );
}

fn excluded() -> Vec<String> {
    vec!["packages/nested".to_string()]
}

fn scope<'a>(root: &'a Path, excluded: &'a [String]) -> DomainScope<'a> {
    DomainScope {
        id: DOMAIN,
        root,
        root_manifest: "package.json",
        source_root: ".",
        excluded_source_roots: excluded,
    }
}

/// Повне дерево контрактів — те саме, що в JS-фікстурі парності.
fn seed_contracts(root: &Path) {
    package_manifest(root);
    write(root, "config/app.yaml", "service: orders\n");
    write(
        root,
        "contracts/openapi.yaml",
        "openapi: 3.1.0\ninfo:\n  title: Orders API\n  version: 1.0.0\npaths:\n  /orders:\n    get: {}\n    post: {}\n",
    );
    write(
        root,
        "contracts/asyncapi.yaml",
        "asyncapi: 3.0.0\ninfo:\n  title: Orders events\n  version: 1.0.0\nchannels:\n  orders.created: {}\n  orders.cancelled: {}\n",
    );
    write(
        root,
        "contracts/schema.graphql",
        "type Order { id: ID! }\nquery GetOrder { order { id } }\n",
    );
    write(
        root,
        "contracts/orders.schema.json",
        "{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"title\":\"Order\",\"type\":[\"null\",\"object\"]}\n",
    );
}

fn claim_values(fragments: &[Fragment], predicate: &str) -> Vec<Value> {
    fragments
        .iter()
        .flat_map(|fragment| fragment.claims.iter())
        .filter(|claim| claim["predicate"] == json!(predicate))
        .map(|claim| claim["value"].clone())
        .collect()
}

#[test]
fn manifest_and_config_are_ingested_with_exact_content_evidence() {
    let root = temp_root("manifest");
    package_manifest(&root);
    write(&root, "config/app.yaml", "service: orders\n");
    let excluded = excluded();

    let loaded = load_structured_sources(&scope(&root, &excluded)).expect("джерела читаються");
    let paths: Vec<&str> = loaded
        .fragments
        .iter()
        .map(|fragment| fragment.path.as_str())
        .collect();
    assert_eq!(paths, vec!["config/app.yaml", "package.json"]);
    for fragment in &loaded.fragments {
        let evidence_id = fragment.evidence[0]["id"].as_str().expect("evidence id");
        assert!(
            loaded.evidence_content_by_id.contains_key(evidence_id),
            "текст evidence зберігається дослівно"
        );
        assert_eq!(
            fragment.evidence[0]["contentHash"],
            json!(fragment.content_hash),
            "відбиток evidence — це відбиток самого файла"
        );
    }
    let _ = std::fs::remove_dir_all(&root);
}

/// Зламаний розпізнаний контракт блокує ВЕСЬ прогін: «майже розібраний»
/// OpenAPI дав би твердження, яких у файлі немає.
#[test]
fn a_malformed_recognized_contract_fails_closed() {
    let root = temp_root("malformed");
    package_manifest(&root);
    write(&root, "contracts/openapi.yaml", "openapi: [\n");
    let excluded = excluded();

    let diagnostics = load_structured_sources(&scope(&root, &excluded)).expect_err("розбір падає");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "structured-parse-failed");
    assert_eq!(
        diagnostics[0].path.as_deref(),
        Some("contracts/openapi.yaml")
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Зламаний GraphQL теж блокує — попри те, що парсер толерантний до помилок
/// і міг би повернути часткове дерево.
#[test]
fn a_malformed_graphql_contract_fails_closed() {
    let root = temp_root("bad-graphql");
    package_manifest(&root);
    write(&root, "contracts/schema.graphql", "type Order { id: ID!\n");
    let excluded = excluded();

    let diagnostics = load_structured_sources(&scope(&root, &excluded)).expect_err("розбір падає");
    assert_eq!(diagnostics[0].code, "structured-parse-failed");
    assert_eq!(
        diagnostics[0].path.as_deref(),
        Some("contracts/schema.graphql")
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn contracts_of_an_excluded_nested_domain_are_not_read() {
    let root = temp_root("nested");
    package_manifest(&root);
    write(
        &root,
        "packages/nested/package.json",
        "{\"name\":\"@fixture/nested\"}\n",
    );
    write(
        &root,
        "packages/nested/openapi.yaml",
        "openapi: 3.1.0\ninfo:\n  title: Nested API\n  version: 1.0.0\npaths: {}\n",
    );
    let excluded = excluded();

    let loaded = load_structured_sources(&scope(&root, &excluded)).expect("джерела читаються");
    assert_eq!(
        loaded
            .fragments
            .iter()
            .map(|fragment| fragment.path.as_str())
            .collect::<Vec<_>>(),
        vec!["package.json"],
        "вкладений пакет документує себе сам"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Проєктується рівно ПОВЕРХНЯ контракту — шляхи, методи, канали, імена
/// типів; вміст операцій і схем у твердження не потрапляє.
#[test]
fn only_deterministic_contract_surface_claims_are_projected() {
    let root = temp_root("surface");
    seed_contracts(&root);
    let excluded = excluded();

    let loaded = load_structured_sources(&scope(&root, &excluded)).expect("джерела читаються");
    let operations = claim_values(&loaded.fragments, "declares-openapi-operation");
    assert!(operations.contains(&json!({"path": "/orders", "method": "get"})));
    assert!(operations.contains(&json!({"path": "/orders", "method": "post"})));

    let channels = claim_values(&loaded.fragments, "declares-asyncapi-channel");
    assert!(channels.contains(&json!({"channel": "orders.created"})));
    assert!(channels.contains(&json!({"channel": "orders.cancelled"})));

    let graphql = claim_values(&loaded.fragments, "declares-graphql-definition");
    assert!(
        graphql.contains(&json!({"definition": "ObjectTypeDefinition", "name": "Order"})),
        "типи: {graphql:?}"
    );
    assert!(
        graphql.contains(
            &json!({"definition": "operation", "operation": "query", "name": "GetOrder"})
        ),
        "операції з ТОГО САМОГО документа: {graphql:?}"
    );

    let schemas = claim_values(&loaded.fragments, "declares-json-schema");
    assert!(schemas.contains(&json!({"title": "Order", "type": ["null", "object"]})));

    // Порядок тверджень у кожному фрагменті стабільний за id.
    for fragment in &loaded.fragments {
        let ids: Vec<&str> = fragment
            .claims
            .iter()
            .filter_map(|claim| claim["id"].as_str())
            .collect();
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        assert_eq!(ids, sorted, "{}", fragment.path);
    }
    let _ = std::fs::remove_dir_all(&root);
}

/// Вид вузла, якого схема графа v1 не дозволяє, відхиляється при вливанні.
#[test]
fn a_node_kind_outside_graph_schema_v1_is_rejected() {
    let fragment = Fragment {
        path: "schema.json".to_string(),
        content_hash: "sha256:schema".to_string(),
        nodes: vec![json!({
            "id": "schema:forbidden", "kind": "schema", "visibility": "public", "domainId": DOMAIN
        })],
        edges: Vec::new(),
        evidence: Vec::new(),
        claims: Vec::new(),
    };
    let graph = json!({"nodes": [], "edges": [], "evidence": []});
    let diagnostics =
        merge_structured_fragments(&graph, DOMAIN, &[fragment]).expect_err("вид вузла заборонений");
    assert_eq!(
        diagnostics
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>(),
        vec!["invalid-structured-node"]
    );
}

/// Твердження з підробленою ідентичністю або з довільним вмістом у значенні
/// не має права потрапити в граф.
#[test]
fn non_deterministic_and_non_metadata_claims_are_rejected() {
    let evidence = json!({
        "id": "evidence:x", "kind": "config", "path": "package.json",
        "contentHash": "sha256:manifest", "role": "syntax"
    });
    let node = json!({
        "id": "config:npm:@fixture/orders:token", "kind": "config",
        "visibility": "package", "domainId": DOMAIN
    });
    let base = |claim: Value| Fragment {
        path: "package.json".to_string(),
        content_hash: "sha256:manifest".to_string(),
        nodes: vec![node.clone()],
        edges: Vec::new(),
        evidence: vec![evidence.clone()],
        claims: vec![claim],
    };
    let graph = json!({"nodes": [], "edges": [], "evidence": [], "claims": []});

    // Ідентичність подана, а не обчислена з полів.
    let forged = base(json!({
        "id": "claim:forged", "subjectId": "config:npm:@fixture/orders:token",
        "layer": "implemented", "predicate": "declares-artifact",
        "value": {"artifact": "manifest", "format": "json"},
        "evidenceIds": ["evidence:x"], "confidence": 1, "sourceFingerprint": "sha256:manifest"
    }));
    assert_eq!(
        merge_structured_fragments(&graph, DOMAIN, &[forged])
            .expect_err("підроблений id")
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>(),
        vec!["invalid-structured-claim"]
    );

    // Значення несе довільний вміст артефакта — privacy-гейт це відхиляє.
    let leaky = base(json!({
        "id": "claim:leaky", "subjectId": "config:npm:@fixture/orders:token",
        "layer": "implemented", "predicate": "declares-artifact",
        "value": {"artifact": "manifest", "format": "json", "secret": "token"},
        "evidenceIds": ["evidence:x"], "confidence": 1, "sourceFingerprint": "sha256:manifest"
    }));
    assert_eq!(
        merge_structured_fragments(&graph, DOMAIN, &[leaky])
            .expect_err("зайве поле у значенні")
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>(),
        vec!["invalid-structured-claim"]
    );
}

/// Диференційна звірка: усі шість фрагментів поле в поле з живим JS.
#[test]
fn every_fragment_matches_the_js_loader() {
    let expected: Value = serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON");
    let reference = expected["loaded"]["fragments"]
        .as_array()
        .expect("фрагменти у фікстурі");
    let root = temp_root("parity");
    seed_contracts(&root);
    let excluded = excluded();

    let loaded = load_structured_sources(&scope(&root, &excluded)).expect("джерела читаються");
    assert_eq!(loaded.fragments.len(), reference.len());
    for (fragment, expected_fragment) in loaded.fragments.iter().zip(reference) {
        assert_eq!(fragment.path, expected_fragment["file"]["path"]);
        assert_eq!(
            fragment.content_hash,
            expected_fragment["file"]["contentHash"]
        );
        for (key, actual) in [
            ("nodes", &fragment.nodes),
            ("edges", &fragment.edges),
            ("evidence", &fragment.evidence),
            ("claims", &fragment.claims),
        ] {
            assert_eq!(
                canonical_json(&Value::Array(actual.clone())),
                canonical_json(&expected_fragment[key]),
                "{} → {key} розійшлось",
                fragment.path
            );
        }
    }
    let _ = std::fs::remove_dir_all(&root);
}
