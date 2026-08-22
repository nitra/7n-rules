//! Дзеркальний набір побудови графа — сценарії з
//! `tests/normalized-graph.test.mjs` плюс повна диференційна звірка з живим
//! JS (`fixtures/js-graph.json`).
//!
//! Звірка тут головна: `evidence:`, `edge:` і `contract:` — це хеші, тож
//! будь-який дрейф (порядок ключів у хешованому JSON, обрізка до 24
//! символів, фолбек ролі) тихо перебудував би ідентичності всього графа.
//!
//! Сценарій «граф проходить committed v1 schema» не переноситься: він
//! перевіряє Ajv-валідацію, тобто `validator.mjs`, який лишається наступним
//! окремим зрізом.

use rules_docs::graph::{
    build_normalized_graph, create_code_unit_id, serialize_knowledge_graph, Domain, GraphOutcome,
};
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("fixtures/js-graph.json");
const DOMAIN_ID: &str = "npm:@fixture/orders";

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON")
}

fn domain() -> Domain {
    Domain {
        id: DOMAIN_ID.to_string(),
        ecosystem: Some("npm".to_string()),
        name: Some("@fixture/orders".to_string()),
        root_manifest: Some("package.json".to_string()),
        source_fingerprint: Some("domain-hash".to_string()),
    }
}

/// Фрагмент екстрактора: span-и проставляються так само, як у JS-хелпері —
/// за індексом одиниці, якщо власного span немає.
fn fragment(path: &str, units: Vec<Value>, edges: Vec<Value>) -> Value {
    let units: Vec<Value> = units
        .into_iter()
        .enumerate()
        .map(|(index, unit)| {
            let mut with_span = json!({
                "span": {"startByte": index * 10, "endByte": index * 10 + 8}
            });
            let target = with_span.as_object_mut().expect("обʼєкт");
            for (key, value) in unit.as_object().expect("одиниця — обʼєкт") {
                target.insert(key.clone(), value.clone());
            }
            with_span
        })
        .collect();
    json!({
        "ok": true,
        "parser": {"id": "fixture", "grammarVersion": "1", "runtimeVersion": "1"},
        "file": {"path": path, "language": "js", "contentHash": format!("hash:{path}")},
        "units": units,
        "edges": edges,
        "entryPoints": [], "imports": [], "chunks": [],
        "coverage": {"requiredUnits": 0, "requiredEdges": 0}
    })
}

fn fragment_a() -> Value {
    fragment(
        "src/a.mjs",
        vec![
            json!({"localId": "submit", "qualifiedPath": "src/a.mjs#submitOrder", "kind": "function",
                   "name": "submitOrder", "visibility": "public", "signature": "(cart)",
                   "attributes": {"zeta": 1, "alpha": 2}}),
            json!({"localId": "persist", "qualifiedPath": "src/a.mjs#persistOrder", "kind": "function",
                   "name": "persistOrder"}),
        ],
        vec![
            json!({"kind": "invokes", "fromLocalId": "submit", "to": {"localId": "persist"},
                   "evidence": [{"span": {"startByte": 0, "endByte": 4}, "role": "syntax"}]}),
            json!({"kind": "integrates", "fromLocalId": "persist",
                   "to": {"unresolvedSpecifier": "stripe", "opaque": true},
                   "evidence": [{"span": {"startByte": 4, "endByte": 8}}]}),
        ],
    )
}

fn fragment_b() -> Value {
    fragment(
        "src/b.mjs",
        vec![
            json!({"localId": "notify", "qualifiedPath": "src/b.mjs#notify", "kind": "function",
                    "name": "notify", "visibility": "public"}),
        ],
        Vec::new(),
    )
}

fn built(outcome: GraphOutcome) -> Value {
    match outcome {
        GraphOutcome::Built(graph) => *graph,
        GraphOutcome::Blocked(diagnostics) => panic!("несподівані блокери: {diagnostics:?}"),
    }
}

fn codes(outcome: GraphOutcome) -> Vec<String> {
    match outcome {
        GraphOutcome::Blocked(diagnostics) => {
            diagnostics.into_iter().map(|item| item.code).collect()
        }
        GraphOutcome::Built(_) => panic!("очікувався блокер"),
    }
}

/// Порядок фрагментів на вході не спостережний — інакше кожен прогін давав
/// би інший fingerprint домену без жодної зміни коду.
#[test]
fn differently_ordered_fragments_give_a_byte_identical_graph() {
    let straight = built(build_normalized_graph(
        &domain(),
        &[fragment_a(), fragment_b()],
    ));
    let reversed = built(build_normalized_graph(
        &domain(),
        &[fragment_b(), fragment_a()],
    ));
    assert_eq!(straight, reversed);
    assert_eq!(
        serialize_knowledge_graph(&straight),
        serialize_knowledge_graph(&reversed)
    );
}

/// Приватні одиниці лишаються в графі traceability: прибрати їх означало б
/// втратити ребра, які через них проходять. Змінювати їхню видимість —
/// теж не можна.
#[test]
fn private_units_stay_in_the_graph_with_their_visibility_intact() {
    let graph = built(build_normalized_graph(&domain(), &[fragment_a()]));
    let nodes = graph["nodes"].as_array().expect("nodes");
    let private = nodes
        .iter()
        .find(|node| {
            node["id"]
                == json!(create_code_unit_id(
                    DOMAIN_ID,
                    "js",
                    "src/a.mjs#persistOrder"
                ))
        })
        .expect("приватна одиниця в графі");
    assert_eq!(
        private["visibility"],
        json!("private"),
        "відсутня visibility — це private, а не «невідомо»"
    );
}

/// Зовнішня залежність стає непрозорим вузлом-контрактом: у графі вона є як
/// межа, але без жодного знання про її нутрощі.
#[test]
fn external_dependencies_become_opaque_contract_nodes() {
    let graph = built(build_normalized_graph(&domain(), &[fragment_a()]));
    let opaque: Vec<&Value> = graph["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter(|node| node["kind"] == json!("integration"))
        .collect();
    assert_eq!(opaque.len(), 1);
    assert_eq!(opaque[0]["name"], json!("stripe"));
    assert_eq!(opaque[0]["visibility"], json!("external"));
    assert_eq!(opaque[0]["attributes"]["opaque"], json!(true));
}

/// Провал будь-якого екстрактора блокує ВЕСЬ граф — і несе його ВЛАСНУ
/// діагностику, а не підмінену загальною.
#[test]
fn any_failed_extractor_blocks_the_whole_graph() {
    let failed = json!({"ok": false, "diagnostics": [
        {"code": "parse-failed", "detail": "boom", "path": "src/c.mjs"}
    ]});
    assert_eq!(
        codes(build_normalized_graph(&domain(), &[fragment_a(), failed])),
        vec!["parse-failed".to_string()]
    );

    let silent = json!({"ok": false});
    assert_eq!(
        codes(build_normalized_graph(&domain(), &[silent])),
        vec!["extractor-failed".to_string()],
        "мовчазний провал теж блокує — просто своїм кодом"
    );
}

/// Ребро без provenance — це припущення, а не факт про код.
#[test]
fn semantic_edges_without_evidence_are_rejected() {
    let source = fragment(
        "src/d.mjs",
        vec![json!({"localId": "x", "qualifiedPath": "p#x", "kind": "function", "name": "x"})],
        vec![
            json!({"kind": "invokes", "fromLocalId": "x", "to": {"localId": "x"}, "evidence": []}),
        ],
    );
    assert_eq!(
        codes(build_normalized_graph(&domain(), &[source])),
        vec!["edge-without-evidence".to_string()]
    );
}

#[test]
fn evidence_without_an_exact_byte_span_is_rejected() {
    let source = fragment(
        "src/e.mjs",
        vec![json!({"localId": "x", "qualifiedPath": "p#x", "kind": "function", "name": "x"})],
        vec![
            json!({"kind": "invokes", "fromLocalId": "x", "to": {"localId": "x"},
                    "evidence": [{"span": {"startByte": 5, "endByte": 1}}]}),
        ],
    );
    assert_eq!(
        codes(build_normalized_graph(&domain(), &[source])),
        vec!["invalid-edge-evidence".to_string()],
        "перевернутий span — не «майже валідний», а блокер"
    );
}

/// Диференційна звірка: увесь граф і його байт-стабільна серіалізація.
#[test]
fn the_graph_and_its_serialization_match_the_js_builder() {
    let expected = fixtures();
    assert_eq!(
        create_code_unit_id(DOMAIN_ID, "js", "src/a.mjs#submitOrder"),
        expected["codeUnitId"].as_str().unwrap_or_default()
    );

    let graph = built(build_normalized_graph(
        &domain(),
        &[fragment_b(), fragment_a()],
    ));
    assert_eq!(graph, expected["graph"], "граф поле в поле");
    assert_eq!(
        serialize_knowledge_graph(&graph),
        expected["serialized"].as_str().unwrap_or_default(),
        "серіалізація побайтово, включно з відступами й фінальним newline"
    );
}

/// Диференційна звірка діагностик — коди і тексти, а не лише «щось впало».
#[test]
fn the_blocking_diagnostics_match_the_js_builder() {
    let expected = fixtures();
    let reported = |outcome: GraphOutcome| match outcome {
        GraphOutcome::Blocked(diagnostics) => diagnostics
            .into_iter()
            .map(|item| json!({"code": item.code, "detail": item.detail, "path": item.path}))
            .collect::<Vec<_>>(),
        GraphOutcome::Built(_) => panic!("очікувався блокер"),
    };

    let failed = json!({"ok": false, "diagnostics": [
        {"code": "parse-failed", "detail": "boom", "path": "src/c.mjs"}
    ]});
    assert_eq!(
        Value::Array(reported(build_normalized_graph(
            &domain(),
            &[fragment_a(), failed]
        ))),
        expected["failedExtractor"]
    );

    let no_evidence = fragment(
        "src/d.mjs",
        vec![json!({"localId": "x", "qualifiedPath": "p#x", "kind": "function", "name": "x"})],
        vec![
            json!({"kind": "invokes", "fromLocalId": "x", "to": {"localId": "x"}, "evidence": []}),
        ],
    );
    assert_eq!(
        Value::Array(reported(build_normalized_graph(&domain(), &[no_evidence]))),
        expected["noEvidence"]
    );

    let bad_span = fragment(
        "src/e.mjs",
        vec![json!({"localId": "x", "qualifiedPath": "p#x", "kind": "function", "name": "x"})],
        vec![
            json!({"kind": "invokes", "fromLocalId": "x", "to": {"localId": "x"},
                    "evidence": [{"span": {"startByte": 5, "endByte": 1}}]}),
        ],
    );
    assert_eq!(
        Value::Array(reported(build_normalized_graph(&domain(), &[bad_span]))),
        expected["badSpan"]
    );
}
