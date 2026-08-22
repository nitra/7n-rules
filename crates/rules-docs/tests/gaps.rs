//! Дзеркальний набір вердиктів — сценарій-у-сценарій із
//! `tests/gap-engine.test.mjs`, на тій самій фікстурі графа.

use rules_docs::expected::{apply_expected_overlay, OverlayOutcome};
use rules_docs::gap_mappings::Mapping;
use rules_docs::gaps::{evaluate_gaps, Gap, GapInput, GapOutcome, GateState, Validation};
use serde_json::{json, Value};

const BASE_GRAPH: &str = include_str!("fixtures/base-graph.json");
const EXPECTED_ID: &str = "claim:expected:order-accepted";
const IMPLEMENTED_ID: &str = "claim:implemented:accepts-order";
const SUBJECT_ID: &str = "code-unit:npm:@fixture/orders:js:submitOrder";

fn base_graph() -> Value {
    serde_json::from_str(BASE_GRAPH).expect("фікстура — валідний JSON")
}

/// Граф із одним явним очікуванням — той самий хелпер, що в JS-наборі.
fn graph_with_expectation() -> Value {
    let overlay = json!({"claims": [{
        "id": EXPECTED_ID,
        "subjectId": SUBJECT_ID,
        "predicate": "order-status",
        "value": "accepted",
        "evidenceIds": ["evidence:spec"],
        "confidence": 1,
        "sourceFingerprint": "expected-hash"
    }]});
    match apply_expected_overlay(&base_graph(), &overlay) {
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

fn input<'a>(graph: &'a Value, mappings: &'a [Mapping], unresolved: &'a [String]) -> GapInput<'a> {
    GapInput {
        graph,
        mappings,
        unresolved_expected_claim_ids: unresolved,
        validation: Validation::default(),
        minimum_confidence: 1.0,
    }
}

fn gaps(outcome: GapOutcome) -> Vec<Gap> {
    match outcome {
        GapOutcome::Evaluated(gaps) => gaps,
        GapOutcome::Blocked(diagnostics) => panic!("несподівані блокери: {diagnostics:?}"),
    }
}

fn evaluate(graph: &Value, mappings: &[Mapping]) -> Vec<Gap> {
    gaps(evaluate_gaps(input(graph, mappings, &[])))
}

#[test]
fn a_graph_without_an_explicit_expectation_has_no_gaps() {
    assert!(evaluate(&base_graph(), &[]).is_empty());
}

#[test]
fn an_exact_evidence_backed_equivalent_mapping_is_satisfied() {
    let graph = graph_with_expectation();
    let result = evaluate(&graph, &[mapping("equivalent")]);

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].id, format!("gap:{EXPECTED_ID}"));
    assert_eq!(result[0].status, "satisfied");
    assert_eq!(result[0].expected_claim_id, EXPECTED_ID);
    assert_eq!(
        result[0].implemented_claim_ids,
        vec![IMPLEMENTED_ID.to_string()]
    );
    assert_eq!(
        result[0].evidence_ids,
        vec![
            "evidence:code".to_string(),
            "evidence:mapping".to_string(),
            "evidence:spec".to_string()
        ],
        "evidence прогалини — обʼєднання очікування, звʼязку та реалізації"
    );
}

#[test]
fn an_evidence_backed_expectation_without_a_mapping_is_missing() {
    let graph = graph_with_expectation();
    let result = evaluate(&graph, &[]);
    assert_eq!(result[0].status, "missing");
    assert!(result[0].implemented_claim_ids.is_empty());
}

#[test]
fn an_exact_contradictory_mapping_is_diverged() {
    let graph = graph_with_expectation();
    assert_eq!(
        evaluate(&graph, &[mapping("contradicts")])[0].status,
        "diverged"
    );
}

/// Дві причини невизначеності — слабка реалізація і суперечливі звʼязки —
/// дають один і той самий статус: `unresolved`, не `missing` і не
/// `diverged`.
#[test]
fn low_confidence_and_ambiguous_mappings_stay_unresolved() {
    let mut weak_graph = graph_with_expectation();
    for claim in weak_graph["claims"].as_array_mut().expect("claims") {
        if claim["id"] == json!(IMPLEMENTED_ID) {
            claim["confidence"] = json!(0.5);
        }
    }
    let low_confidence = evaluate(&weak_graph, &[mapping("equivalent")]);

    let graph = graph_with_expectation();
    let ambiguous = evaluate(&graph, &[mapping("equivalent"), mapping("contradicts")]);

    assert_eq!(low_confidence[0].status, "unresolved");
    assert_eq!(
        ambiguous[0].status, "unresolved",
        "два різні relation на одне очікування — це невизначеність, а не вибір"
    );
}

#[test]
fn an_explicitly_unresolved_expectation_is_honoured() {
    let graph = graph_with_expectation();
    let unresolved = vec![EXPECTED_ID.to_string()];
    let result = gaps(evaluate_gaps(input(&graph, &[], &unresolved)));

    assert_eq!(result[0].status, "unresolved");
    assert!(result[0].implemented_claim_ids.is_empty());
}

/// Провалений parser чи coverage віддається ЯК Є: інакше одна поламана
/// стадія перетворилась би на купу «невизначених» прогалин, і причину
/// довелося б шукати наосліп.
#[test]
fn parser_and_coverage_failures_block_instead_of_producing_gaps() {
    let graph = graph_with_expectation();
    let blocked = |validation: Validation| match evaluate_gaps(GapInput {
        graph: &graph,
        mappings: &[],
        unresolved_expected_claim_ids: &[],
        validation,
        minimum_confidence: 1.0,
    }) {
        GapOutcome::Blocked(diagnostics) => diagnostics
            .into_iter()
            .map(|item| (item.code, item.message))
            .collect::<Vec<_>>(),
        GapOutcome::Evaluated(gaps) => panic!("очікувався блокер, отримано {gaps:?}"),
    };

    assert_eq!(
        blocked(Validation {
            parser: Some(GateState {
                ok: false,
                message: Some("Syntax error".to_string())
            }),
            coverage: None,
        }),
        vec![("parser-blocked".to_string(), "Syntax error".to_string())]
    );
    assert_eq!(
        blocked(Validation {
            parser: None,
            coverage: Some(GateState {
                ok: false,
                message: Some("Required edge missing".to_string())
            }),
        }),
        vec![(
            "coverage-blocked".to_string(),
            "Required edge missing".to_string()
        )]
    );
}

/// Понад JS-набір: звʼязок на неіснуючий claim чи на evidence поза графом —
/// блокер, а не мовчазне ігнорування. Форму самого звʼязку в Rust гарантує
/// тип `Mapping`, тож лишились саме перехресні перевірки.
#[test]
fn a_mapping_that_points_outside_the_graph_blocks() {
    let graph = graph_with_expectation();
    let unknown_claim = Mapping {
        implemented_claim_id: "claim:implemented:nonexistent".to_string(),
        ..mapping("equivalent")
    };
    let unknown_evidence = Mapping {
        evidence_ids: vec!["evidence:nonexistent".to_string()],
        ..mapping("equivalent")
    };
    let bad_relation = mapping("resembles");

    let codes = |mappings: &[Mapping]| match evaluate_gaps(input(&graph, mappings, &[])) {
        GapOutcome::Blocked(diagnostics) => diagnostics
            .into_iter()
            .map(|item| item.code)
            .collect::<Vec<_>>(),
        GapOutcome::Evaluated(gaps) => panic!("очікувався блокер, отримано {gaps:?}"),
    };

    assert_eq!(
        codes(&[unknown_claim]),
        vec!["unknown-gap-claim".to_string()]
    );
    assert_eq!(
        codes(&[unknown_evidence]),
        vec!["invalid-gap-evidence".to_string()]
    );
    assert_eq!(
        codes(&[bad_relation]),
        vec!["invalid-gap-mapping".to_string()]
    );
}
