//! Дзеркальний набір overlay — сценарій-у-сценарій із
//! `tests/expected-overlay.test.mjs`. Фікстура графа — той самий файл, що
//! читає JS-набір (`tests/fixtures/gaps/base-graph.json`).

use rules_docs::expected::{apply_expected_overlay, OverlayOutcome};
use serde_json::{json, Value};

const BASE_GRAPH: &str = include_str!("fixtures/base-graph.json");
const SUBJECT_ID: &str = "code-unit:npm:@fixture/orders:js:submitOrder";

fn base_graph() -> Value {
    serde_json::from_str(BASE_GRAPH).expect("фікстура — валідний JSON")
}

fn merged(outcome: OverlayOutcome) -> Value {
    match outcome {
        OverlayOutcome::Merged(graph) => *graph,
        OverlayOutcome::Blocked(diagnostics) => panic!("несподівані блокери: {diagnostics:?}"),
    }
}

fn codes(outcome: OverlayOutcome) -> Vec<String> {
    match outcome {
        OverlayOutcome::Blocked(diagnostics) => {
            diagnostics.into_iter().map(|item| item.code).collect()
        }
        OverlayOutcome::Merged(_) => panic!("очікувався блокер"),
    }
}

fn expectation(id: &str) -> Value {
    json!({
        "id": id,
        "subjectId": SUBJECT_ID,
        "predicate": "order-status",
        "value": "accepted",
        "evidenceIds": ["evidence:spec"],
        "confidence": 1,
        "sourceFingerprint": "expected-hash"
    })
}

fn ids(graph: &Value, collection: &str) -> Vec<String> {
    graph[collection]
        .as_array()
        .expect("колекція — масив")
        .iter()
        .map(|item| item["id"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[test]
fn an_expectation_is_added_immutably_and_in_stable_order() {
    let graph = base_graph();
    let outcome = apply_expected_overlay(
        &graph,
        &json!({"claims": [expectation("claim:expected:order-accepted")]}),
    );
    let result = merged(outcome);

    assert_eq!(
        graph["claims"].as_array().expect("claims").len(),
        1,
        "вхідний граф НЕ мутується"
    );
    assert_eq!(
        ids(&result, "claims"),
        vec![
            "claim:expected:order-accepted".to_string(),
            "claim:implemented:accepts-order".to_string()
        ],
        "claims упорядковані за id, а не за порядком додавання"
    );
    assert_eq!(result["claims"][0]["layer"], json!("expected"));
}

/// Очікування без evidence — це намір без підстав; публікувати його
/// означало б видати бажане за задокументоване.
#[test]
fn an_expectation_without_evidence_is_blocked() {
    let mut claim = expectation("claim:expected:no-evidence");
    claim["evidenceIds"] = json!([]);
    assert_eq!(
        codes(apply_expected_overlay(
            &base_graph(),
            &json!({"claims": [claim]})
        )),
        vec!["expected-without-evidence".to_string()]
    );
}

#[test]
fn a_subject_outside_the_domain_graph_is_blocked() {
    let mut claim = expectation("claim:expected:outside");
    claim["subjectId"] = json!("code-unit:npm:@other:js:outside");
    assert_eq!(
        codes(apply_expected_overlay(
            &base_graph(),
            &json!({"claims": [claim]})
        )),
        vec!["unknown-expected-subject".to_string()]
    );
}

#[test]
fn new_evidence_is_added_and_malformed_overlay_contracts_are_rejected() {
    let graph = base_graph();
    let mut claim = expectation("claim:expected:new");
    claim["value"] = json!("reviewed");
    claim["evidenceIds"] = json!(["evidence:new-spec"]);
    claim["sourceFingerprint"] = json!("expected-new");
    let added = merged(apply_expected_overlay(
        &graph,
        &json!({
            "evidence": [{"id": "evidence:new-spec", "kind": "spec", "path": "docs/new.md", "contentHash": "new-hash"}],
            "claims": [claim]
        }),
    ));
    assert!(ids(&added, "evidence").contains(&"evidence:new-spec".to_string()));

    assert!(matches!(
        apply_expected_overlay(&Value::Null, &json!({})),
        OverlayOutcome::Blocked(_)
    ));
    assert!(matches!(
        apply_expected_overlay(&json!({}), &json!({})),
        OverlayOutcome::Blocked(_)
    ));
    assert!(
        matches!(
            apply_expected_overlay(&graph, &json!({"claims": {}, "evidence": []})),
            OverlayOutcome::Blocked(_)
        ),
        "claims не-масивом — це зламаний контракт overlay, а не порожній overlay"
    );
}

/// Усі дефекти збираються за ОДИН прохід: викликач має побачити повну
/// картину, а не найперший блокер.
#[test]
fn duplicate_unknown_and_invalid_expectation_evidence_all_block() {
    let base = expectation("claim:expected:invalid");
    let mut missing_evidence = base.clone();
    missing_evidence["evidenceIds"] = json!(["evidence:missing"]);

    let mut wrong_layer = base.clone();
    wrong_layer["id"] = json!("claim:expected:layer");
    wrong_layer["layer"] = json!("implemented");

    let mut duplicate_id = base.clone();
    duplicate_id["id"] = json!("claim:implemented:accepts-order");

    let mut bad_confidence = base;
    bad_confidence["id"] = json!("claim:expected:confidence");
    bad_confidence["confidence"] = json!(2);

    let reported = codes(apply_expected_overlay(
        &base_graph(),
        &json!({
            "evidence": [
                {"id": "evidence:spec"},
                {"id": "evidence:duplicate"},
                {"id": "evidence:duplicate"}
            ],
            "claims": [missing_evidence, wrong_layer, duplicate_id, bad_confidence]
        }),
    ));

    for code in [
        "duplicate-evidence-id",
        "unknown-expected-evidence",
        "invalid-expected-layer",
        "duplicate-claim-id",
        "invalid-expected-confidence",
    ] {
        assert!(
            reported.iter().any(|item| item == code),
            "очікувався код {code}, було: {reported:?}"
        );
    }
}
