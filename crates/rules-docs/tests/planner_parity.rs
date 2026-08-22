//! Диференційна звірка планера з ЖИВИМ JS: фікстура
//! `fixtures/js-plans.json` — це дослівний вихід `planSemanticChunks`
//! (`chunk-planner.mjs`) на тих самих входах, знятий із Node.
//!
//! Порівнюється ВЕСЬ план, а не окремі поля: кожен `scc:`/`chunk:`/`reduce:`
//! ідентифікатор, кожен `cacheFingerprint`, кожна оцінка вартості. Для
//! детермінованого модуля це найсильніша перевірка, яка взагалі можлива —
//! дрейф у будь-якій із дрібниць (порядок сортування, формула токенів,
//! обрізка хеша) видно одразу, а не через місяць у вигляді холодного кешу.

use rules_docs::planner::{plan_semantic_chunks, PlanOutcome, PlannerInput, SourceText};
use serde_json::{json, Value};

const DOMAIN: &str = "npm:@fixture/orders";
const FIXTURES: &str = include_str!("fixtures/js-plans.json");

fn node(id: &str, start_byte: usize, end_byte: usize) -> Value {
    json!({
        "id": id, "kind": "code-unit", "domainId": DOMAIN,
        "attributes": {"sourcePath": "src/a.mjs", "span": {"startByte": start_byte, "endByte": end_byte}}
    })
}

fn edge(id: &str, from_id: &str, to_id: &str, evidence_id: &str) -> Value {
    json!({"id": id, "kind": "invokes", "fromId": from_id, "toId": to_id, "evidenceIds": [evidence_id]})
}

fn evidence(id: &str, start_byte: usize, end_byte: usize) -> Value {
    json!({"id": id, "path": "src/a.mjs", "span": {"startByte": start_byte, "endByte": end_byte}})
}

fn plan_to_value(outcome: PlanOutcome) -> Value {
    match outcome {
        PlanOutcome::Planned(plan) => serde_json::to_value(&*plan).expect("план серіалізується"),
        PlanOutcome::Blocked(diagnostics) => panic!("несподівані блокери: {diagnostics:?}"),
    }
}

/// Рекурсивно впорядковує ключі — порівнюємо ЗМІСТ, а не порядок полів
/// (він у Rust заданий структурою, у JS — вставкою).
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(entries) => {
            let mut sorted: Vec<(&String, &Value)> = entries.iter().collect();
            sorted.sort_by(|left, right| left.0.cmp(right.0));
            Value::Object(
                sorted
                    .into_iter()
                    .map(|(key, item)| (key.clone(), canonical(item)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

fn expected(name: &str) -> Value {
    let fixtures: Value = serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON");
    canonical(&fixtures[name])
}

/// Взаємна рекурсія в одній SCC плюс залежний викликач у другій хвилі.
#[test]
fn the_cycle_plan_matches_the_js_planner_field_for_field() {
    let graph = json!({
        "schemaVersion": 1, "domain": {"id": DOMAIN},
        "nodes": [node("node:alpha", 0, 8), node("node:beta", 9, 16), node("node:gamma", 17, 25)],
        "edges": [
            edge("edge:alpha-beta", "node:alpha", "node:beta", "e:alpha-beta"),
            edge("edge:beta-alpha", "node:beta", "node:alpha", "e:beta-alpha"),
            edge("edge:gamma-alpha", "node:gamma", "node:alpha", "e:gamma-alpha")
        ],
        "evidence": [evidence("e:alpha-beta", 0, 8), evidence("e:beta-alpha", 9, 16), evidence("e:gamma-alpha", 17, 25)]
    });
    let sources = vec![SourceText {
        path: "src/a.mjs".to_string(),
        content: "alpha(); beta(); gamma();".to_string(),
    }];

    let plan = plan_to_value(plan_semantic_chunks(PlannerInput {
        graph: &graph,
        sources: &sources,
        max_tokens: 100,
        max_reduce_inputs: rules_docs::planner::DEFAULT_REDUCE_INPUTS,
        required_node_ids: None,
        required_edge_ids: None,
        parser: json!({}),
        schema: json!({}),
        prompt: json!({}),
        model_policy: json!({}),
    }));

    assert_eq!(canonical(&plan), expected("cycle"));
}

/// Бюджет ріже план на три chunk-и, політики заповнені, fan-in reduce = 2 —
/// тобто перевіряються і пакування, і багаторівневе reduce-дерево.
#[test]
fn the_budget_split_plan_matches_the_js_planner_field_for_field() {
    let graph = json!({
        "schemaVersion": 1, "domain": {"id": DOMAIN},
        "nodes": [node("node:a", 0, 4), node("node:b", 4, 8), node("node:c", 8, 12)],
        "edges": [
            edge("edge:a-b", "node:a", "node:b", "e:a-b"),
            edge("edge:b-c", "node:b", "node:c", "e:b-c")
        ],
        "evidence": [evidence("e:a-b", 0, 4), evidence("e:b-c", 4, 8)]
    });
    let sources = vec![SourceText {
        path: "src/a.mjs".to_string(),
        content: "a();b();c();".to_string(),
    }];

    let plan = plan_to_value(plan_semantic_chunks(PlannerInput {
        graph: &graph,
        sources: &sources,
        max_tokens: 30,
        max_reduce_inputs: 2,
        required_node_ids: None,
        required_edge_ids: None,
        parser: json!({"id": "oxc", "version": "1"}),
        schema: json!({"version": 1}),
        prompt: json!({"version": "map-v1"}),
        model_policy: json!({"tiers": ["local-min", "cloud"]}),
    }));

    assert_eq!(canonical(&plan), expected("budget"));
}
