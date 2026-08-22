//! Диференційна звірка шару expected і вердиктів із ЖИВИМ JS: фікстура
//! `fixtures/js-gaps.json` — дослівний вихід `applyExpectedOverlay` і
//! `evaluateGaps` на тих самих входах, знятий із Node.
//!
//! Порівнюється весь злитий граф і всі шість вердиктів разом із їхніми
//! `evidenceIds` та `implementedClaimIds` — тобто не лише «який статус», а й
//! «з чого він зроблений».

use rules_docs::expected::{apply_expected_overlay, OverlayOutcome};
use rules_docs::gap_mappings::Mapping;
use rules_docs::gaps::{evaluate_gaps, GapInput, GapOutcome, Validation};
use serde_json::{json, Value};

const BASE_GRAPH: &str = include_str!("fixtures/base-graph.json");
const FIXTURES: &str = include_str!("fixtures/js-gaps.json");
const EXPECTED_ID: &str = "claim:expected:order-accepted";
const IMPLEMENTED_ID: &str = "claim:implemented:accepts-order";
const SUBJECT_ID: &str = "code-unit:npm:@fixture/orders:js:submitOrder";

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON")
}

fn merged_graph() -> Value {
    let base: Value = serde_json::from_str(BASE_GRAPH).expect("базовий граф");
    let overlay = json!({"claims": [{
        "id": EXPECTED_ID, "subjectId": SUBJECT_ID, "predicate": "order-status",
        "value": "accepted", "evidenceIds": ["evidence:spec"], "confidence": 1,
        "sourceFingerprint": "expected-hash"
    }]});
    match apply_expected_overlay(&base, &overlay) {
        OverlayOutcome::Merged(graph) => *graph,
        OverlayOutcome::Blocked(diagnostics) => panic!("overlay не наклався: {diagnostics:?}"),
    }
}

fn mapping(relation: &str) -> Mapping {
    Mapping {
        expected_claim_id: EXPECTED_ID.to_string(),
        implemented_claim_id: IMPLEMENTED_ID.to_string(),
        relation: relation.to_string(),
        evidence_ids: vec!["evidence:mapping".to_string()],
    }
}

/// Вердикти у формі JS-результату `{ok, gaps}` — щоб порівнювати з
/// фікстурою поле в поле, а не переказувати її структуру.
fn gaps_as_js(graph: &Value, mappings: &[Mapping], unresolved: &[String]) -> Value {
    match evaluate_gaps(GapInput {
        graph,
        mappings,
        unresolved_expected_claim_ids: unresolved,
        validation: Validation::default(),
        minimum_confidence: 1.0,
    }) {
        GapOutcome::Evaluated(gaps) => json!({
            "ok": true,
            "gaps": gaps.into_iter().map(|gap| json!({
                "id": gap.id,
                "status": gap.status,
                "expectedClaimId": gap.expected_claim_id,
                "implementedClaimIds": gap.implemented_claim_ids,
                "evidenceIds": gap.evidence_ids,
            })).collect::<Vec<_>>(),
        }),
        GapOutcome::Blocked(diagnostics) => panic!("несподівані блокери: {diagnostics:?}"),
    }
}

#[test]
fn the_merged_graph_matches_the_js_overlay() {
    assert_eq!(merged_graph(), fixtures()["mergedGraph"]);
}

#[test]
fn every_gap_verdict_matches_the_js_engine() {
    let graph = merged_graph();
    let mut weak = graph.clone();
    for claim in weak["claims"].as_array_mut().expect("claims") {
        if claim["id"] == json!(IMPLEMENTED_ID) {
            claim["confidence"] = json!(0.5);
        }
    }
    let expected = fixtures();

    for (name, graph, mappings, unresolved) in [
        (
            "satisfied",
            &graph,
            vec![mapping("equivalent")],
            Vec::<String>::new(),
        ),
        ("missing", &graph, Vec::new(), Vec::new()),
        ("diverged", &graph, vec![mapping("contradicts")], Vec::new()),
        (
            "ambiguous",
            &graph,
            vec![mapping("equivalent"), mapping("contradicts")],
            Vec::new(),
        ),
        (
            "lowConfidence",
            &weak,
            vec![mapping("equivalent")],
            Vec::new(),
        ),
        (
            "explicitUnresolved",
            &graph,
            Vec::new(),
            vec![EXPECTED_ID.to_string()],
        ),
    ] {
        assert_eq!(
            gaps_as_js(graph, &mappings, &unresolved),
            expected[name],
            "вердикт «{name}» розійшовся з JS"
        );
    }
}
