//! Дзеркальний набір валідатора — сценарії з `tests/validator.test.mjs`,
//! anti-drift на вендоровану схему і диференційний корпус мутацій проти
//! ЖИВОГО Ajv.
//!
//! Корпус — головна перевірка цього зрізу: він доводить, що Rust і Ajv
//! однаково відповідають на питання «валідний/невалідний» на 29 варіантах
//! графа. Тексти при цьому свідомо НЕ звіряються — див. доккоментар
//! `validator::schema_diagnostic`.

use rules_docs::validator::{validate_knowledge_graph, ValidationInput};
use serde_json::{json, Value};

const CORPUS: &str = include_str!("fixtures/js-schema-corpus.json");
const VENDORED_SCHEMA: &str = include_str!("../schema/knowledge-graph-v1.schema.json");
const DOMAIN: &str = "npm:@fixture/orders";

fn graph() -> Value {
    json!({
        "schemaVersion": 1,
        "domain": {"id": DOMAIN, "ecosystem": "npm", "name": "@fixture/orders",
                   "rootManifest": "package.json", "sourceFingerprint": "sha256:domain"},
        "nodes": [
            {"id": "code:submit", "kind": "code-unit", "name": "submitOrder", "visibility": "public",
             "domainId": DOMAIN, "attributes": {}, "sourceFingerprint": "sha256:submit"},
            {"id": "code:secret", "kind": "code-unit", "name": "privateSecret", "visibility": "private",
             "domainId": DOMAIN, "attributes": {}, "sourceFingerprint": "sha256:secret"}
        ],
        "edges": [{"id": "edge:submit-secret", "fromId": "code:submit", "toId": "code:secret",
                   "kind": "invokes", "evidenceIds": ["evidence:submit"]}],
        "claims": [{"id": "claim:submit", "subjectId": "code:submit", "layer": "implemented",
                    "predicate": "produces", "value": "order", "evidenceIds": ["evidence:submit"],
                    "confidence": 1, "sourceFingerprint": "sha256:claim"}],
        "topics": [{"id": "process:submit", "kind": "process", "title": "Submit order",
                    "domainId": DOMAIN, "anchorIds": ["code:submit"]}],
        "gaps": [],
        "evidence": [{"id": "evidence:submit", "kind": "code", "path": "src/submit.mjs",
                      "contentHash": "sha256:evidence"}]
    })
}

fn fragment() -> Value {
    json!({
        "ok": true,
        "file": {"path": "src/submit.mjs"},
        "coverage": {"requiredUnits": 2, "coveredUnits": 2, "requiredEdges": 1, "coveredEdges": 1, "complete": true}
    })
}

fn validate(
    graph: &Value,
    fragments: &[Value],
    domain: Option<&str>,
    projection: Option<&str>,
) -> rules_docs::validator::ValidationReport {
    validate_knowledge_graph(ValidationInput {
        graph,
        fragments,
        expected_domain_id: domain,
        human_projection: projection,
    })
}

#[test]
fn a_schema_valid_complete_and_private_safe_graph_is_accepted() {
    let report = validate(
        &graph(),
        &[fragment()],
        Some(DOMAIN),
        Some("Submit order persists an order."),
    );
    assert!(report.ok, "несподівані блокери: {:?}", report.diagnostics);
    assert!(report.diagnostics.is_empty());
}

/// Неповне покриття — це БЛОКЕР, а не прогалина: прогалина означає «ми
/// подивились і не знайшли», а тут ми просто не подивились.
#[test]
fn incomplete_extractor_coverage_blocks_and_never_becomes_a_gap() {
    let mut incomplete = fragment();
    incomplete["coverage"]["coveredEdges"] = json!(0);
    let report = validate(&graph(), &[incomplete], None, None);

    assert!(!report.ok);
    assert!(report
        .diagnostics
        .iter()
        .any(|item| item.code == "coverage-incomplete"));
    assert!(
        !report
            .diagnostics
            .iter()
            .any(|item| item.code.contains("gap")),
        "жодна діагностика не перетворилась на прогалину"
    );
}

#[test]
fn broken_references_and_a_domain_mismatch_both_block() {
    let mut candidate = graph();
    candidate["edges"][0]["toId"] = json!("code:missing");
    let report = validate(&candidate, &[fragment()], Some("npm:@fixture/other"), None);

    assert!(!report.ok);
    assert_eq!(
        report
            .diagnostics
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>(),
        vec!["domain-identity-mismatch", "edge-target-missing"],
        "порядок діагностик стабільний: за кодом, потім за id"
    );
}

/// Приватне імʼя легальне В ГРАФІ і заборонене в людській проєкції — це
/// різні речі, і валідатор розрізняє саме їх.
#[test]
fn private_names_block_in_the_human_projection_but_stay_legal_in_the_graph() {
    let report = validate(
        &graph(),
        &[fragment()],
        None,
        Some("submitOrder calls privateSecret."),
    );
    assert!(!report.ok);
    let leak = report
        .diagnostics
        .iter()
        .find(|item| item.code == "private-symbol-leak")
        .expect("витік знайдено");
    assert_eq!(leak.id.as_deref(), Some("code:secret"));

    let clean = validate(&graph(), &[fragment()], None, Some("Submit order works."));
    assert!(clean.ok, "той самий граф без витоку в тексті — валідний");
}

/// Схема — ПЕРШИЙ гейт: при її провалі семантичний обхід не виконується
/// взагалі, інакше ми б звітували про наслідок замість причини.
#[test]
fn schema_diagnostics_come_before_any_semantic_traversal() {
    let mut candidate = graph();
    candidate["domain"]
        .as_object_mut()
        .expect("domain")
        .remove("sourceFingerprint");
    // Ребро теж зламане — але про нього не має бути ні слова.
    candidate["edges"][0]["toId"] = json!("code:missing");

    let report = validate(&candidate, &[], None, None);
    assert!(!report.ok);
    assert_eq!(report.diagnostics.len(), 1);
    assert_eq!(report.diagnostics[0].code, "schema-invalid");
    assert!(
        !report.diagnostics[0].message.is_empty(),
        "машинні поля порушення заповнені: {:?}",
        report.diagnostics[0]
    );
}

/// Вендорена схема мусить лишатись побайтово тією самою, що джерело правди
/// у JS-пакеті: дві копії, що розійшлись, — це два різні контракти.
#[test]
fn the_vendored_schema_matches_the_javascript_source_byte_for_byte() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../npm/rules/doc-files/package_knowledge/schema/knowledge-graph-v1.schema.json");
    let original = std::fs::read_to_string(&source)
        .unwrap_or_else(|error| panic!("джерело схеми читається ({}): {error}", source.display()));
    assert_eq!(
        VENDORED_SCHEMA,
        original,
        "вендорена копія розійшлась із {}",
        source.display()
    );
}

/// Диференційний корпус: 29 варіантів графа з вердиктами ЖИВОГО Ajv.
///
/// Звіряються саме вердикти, не тексти: без `allErrors` Ajv віддає одну
/// помилку — першу за порядком обходу, — а порядок специфікацією не заданий,
/// тож однаковий текст від іншої реалізації недосяжний у принципі. А от
/// відповідь «валідний/невалідний» мусить збігатися завжди.
#[test]
fn every_corpus_verdict_matches_live_ajv() {
    let corpus: Value = serde_json::from_str(CORPUS).expect("корпус — валідний JSON");
    let cases = corpus["cases"].as_array().expect("масив кейсів");
    assert!(cases.len() >= 25, "корпус не має здрібніти непомітно");

    let mut checked = 0;
    for case in cases {
        let name = case["name"].as_str().unwrap_or_default();
        let expected_ok = case["ok"].as_bool().expect("вердикт Ajv");
        let report = validate(&case["graph"], &[], None, None);
        // Семантичні гейти тут не працюють: без фрагментів і expectedDomainId
        // єдине джерело діагностик — схема або посилання графа. Тому
        // порівнюємо саме наявність `schema-invalid`.
        let schema_ok = !report
            .diagnostics
            .iter()
            .any(|item| item.code == "schema-invalid");
        assert_eq!(
            schema_ok, expected_ok,
            "кейс «{name}»: Rust каже {schema_ok}, Ajv каже {expected_ok}"
        );
        checked += 1;
    }
    assert_eq!(checked, cases.len());
}
