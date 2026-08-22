//! Дзеркальний набір планера — сценарій-у-сценарій із
//! `tests/chunk-planner.test.mjs`.

use rules_docs::planner::{plan_semantic_chunks, Plan, PlanOutcome, PlannerInput, SourceText};
use serde_json::{json, Value};

const DOMAIN: &str = "npm:@fixture/orders";

fn node(id: &str, path: &str, start_byte: usize, end_byte: usize) -> Value {
    json!({
        "id": id,
        "kind": "code-unit",
        "domainId": DOMAIN,
        "attributes": {"sourcePath": path, "span": {"startByte": start_byte, "endByte": end_byte}}
    })
}

fn edge(id: &str, from_id: &str, to_id: &str, evidence_id: &str) -> Value {
    json!({"id": id, "kind": "invokes", "fromId": from_id, "toId": to_id, "evidenceIds": [evidence_id]})
}

fn evidence(id: &str, path: &str, start_byte: usize, end_byte: usize) -> Value {
    json!({"id": id, "path": path, "span": {"startByte": start_byte, "endByte": end_byte}})
}

fn graph(nodes: Vec<Value>, edges: Vec<Value>, evidence: Vec<Value>) -> Value {
    json!({"schemaVersion": 1, "domain": {"id": DOMAIN}, "nodes": nodes, "edges": edges, "evidence": evidence})
}

fn source(path: &str, content: &str) -> SourceText {
    SourceText {
        path: path.to_string(),
        content: content.to_string(),
    }
}

/// Вхід із типовими політиками — те саме, що JS дає за замовчуванням.
fn input<'a>(graph: &'a Value, sources: &'a [SourceText], max_tokens: u64) -> PlannerInput<'a> {
    PlannerInput {
        graph,
        sources,
        max_tokens,
        max_reduce_inputs: rules_docs::planner::DEFAULT_REDUCE_INPUTS,
        required_node_ids: None,
        required_edge_ids: None,
        parser: json!({}),
        schema: json!({}),
        prompt: json!({}),
        model_policy: json!({}),
    }
}

fn planned(outcome: PlanOutcome) -> Plan {
    match outcome {
        PlanOutcome::Planned(plan) => *plan,
        PlanOutcome::Blocked(diagnostics) => panic!("несподівані блокери: {diagnostics:?}"),
    }
}

fn codes(outcome: PlanOutcome) -> Vec<String> {
    match outcome {
        PlanOutcome::Blocked(diagnostics) => {
            diagnostics.into_iter().map(|item| item.code).collect()
        }
        PlanOutcome::Planned(plan) => panic!(
            "очікувався блокер, отримано {} chunk(ів)",
            plan.chunks.len()
        ),
    }
}

/// Зріз береться по БАЙТАХ, а offset посеред code point — блокер. Емодзі
/// тут не декорація: у ньому 4 байти, тож `startByte: 1` вказує всередину
/// символу, і наївний зріз по символах цього б не помітив.
#[test]
fn spans_are_exact_utf8_byte_slices_and_a_split_code_point_is_rejected() {
    let text = "😀run()";
    let length = text.len();
    let sources = vec![source("src/run.mjs", text)];

    let valid_graph = graph(
        vec![node("node:run", "src/run.mjs", 0, length)],
        vec![],
        vec![],
    );
    let plan = planned(plan_semantic_chunks(input(&valid_graph, &sources, 100)));
    assert_eq!(plan.chunks[0].unit_slices.len(), 1);
    assert_eq!(plan.chunks[0].unit_slices[0].node_id, "node:run");
    assert_eq!(plan.chunks[0].unit_slices[0].text, text);
    assert_eq!(plan.chunks[0].unit_slices[0].span.start_byte, 0);
    assert_eq!(
        plan.chunks[0].unit_slices[0].span.end_byte, 9,
        "емодзі — 4 байти, тож довжина в БАЙТАХ, не в символах"
    );

    let split_graph = graph(
        vec![node("node:run", "src/run.mjs", 1, length)],
        vec![],
        vec![],
    );
    assert_eq!(
        codes(plan_semantic_chunks(input(&split_graph, &sources, 100))),
        vec!["span-invalid".to_string()]
    );
}

/// Цикл — це одна одиниця роботи: розділивши його, планер дав би моделі
/// половину взаємної рекурсії й попросив пояснити ціле.
#[test]
fn a_cycle_stays_in_one_scc_chunk_and_dependencies_are_scheduled_first() {
    let text = "alpha(); beta(); gamma();";
    let sources = vec![source("src/a.mjs", text)];
    let source_graph = graph(
        vec![
            node("node:alpha", "src/a.mjs", 0, 8),
            node("node:beta", "src/a.mjs", 9, 16),
            node("node:gamma", "src/a.mjs", 17, 25),
        ],
        vec![
            edge("edge:alpha-beta", "node:alpha", "node:beta", "e:alpha-beta"),
            edge("edge:beta-alpha", "node:beta", "node:alpha", "e:beta-alpha"),
            edge(
                "edge:gamma-alpha",
                "node:gamma",
                "node:alpha",
                "e:gamma-alpha",
            ),
        ],
        vec![
            evidence("e:alpha-beta", "src/a.mjs", 0, 8),
            evidence("e:beta-alpha", "src/a.mjs", 9, 16),
            evidence("e:gamma-alpha", "src/a.mjs", 17, 25),
        ],
    );

    let plan = planned(plan_semantic_chunks(input(&source_graph, &sources, 100)));

    assert_eq!(plan.chunks.len(), 2);
    assert_eq!(
        plan.chunks[0].node_ids,
        vec!["node:alpha".to_string(), "node:beta".to_string()],
        "взаємна рекурсія лишається однією компонентою"
    );
    assert_eq!(plan.chunks[1].node_ids, vec!["node:gamma".to_string()]);
    assert_eq!(
        plan.chunks[1].depends_on_chunk_ids,
        vec![plan.chunks[0].id.clone()],
        "викликач іде ПІСЛЯ того, кого викликає"
    );
    assert!(plan.coverage.complete);
    assert_eq!(
        plan.coverage.covered_node_ids,
        vec![
            "node:alpha".to_string(),
            "node:beta".to_string(),
            "node:gamma".to_string()
        ]
    );
}

/// План не має залежати від порядку входу, а зміна будь-якої політики має
/// бути видимою в `cacheFingerprint` — інакше кеш віддавав би результат,
/// зроблений іншим промптом.
#[test]
fn the_plan_is_stable_across_input_order_and_fingerprints_every_policy_input() {
    let nodes = vec![
        node("node:a", "src/a.mjs", 0, 3),
        node("node:b", "src/b.mjs", 0, 3),
    ];
    let straight_graph = graph(nodes.clone(), vec![], vec![]);
    let reversed_graph = graph(nodes.into_iter().rev().collect(), vec![], vec![]);
    let straight_sources = vec![source("src/a.mjs", "a()"), source("src/b.mjs", "b()")];
    let reversed_sources = vec![source("src/b.mjs", "b()"), source("src/a.mjs", "a()")];

    let policy = |graph: &Value, sources: &[SourceText], prompt_version: &str| {
        let mut request = PlannerInput {
            max_tokens: 15,
            parser: json!({"id": "oxc", "version": "1"}),
            schema: json!({"version": 1}),
            prompt: json!({"version": prompt_version}),
            model_policy: json!({"tiers": ["local-min", "cloud"]}),
            ..input(graph, sources, 15)
        };
        request.max_tokens = 15;
        planned(plan_semantic_chunks(request))
    };

    let left = policy(&straight_graph, &straight_sources, "map-v1");
    let right = policy(&reversed_graph, &reversed_sources, "map-v1");
    let changed = policy(&straight_graph, &straight_sources, "map-v2");

    assert_eq!(
        left, right,
        "порядок вузлів і джерел на вході не спостережний"
    );
    assert_ne!(
        left.chunks[0].cache_fingerprint, changed.chunks[0].cache_fingerprint,
        "зміна версії промпта мусить знецінити кеш"
    );
    assert!(
        !left.reduce.levels.is_empty(),
        "два chunk-и — це вже reduce-дерево"
    );
}

/// Бюджет ріже план на chunk-и, але не викидає хвіст: непокритий вузол — це
/// блокер, а не «стільки, скільки влізло».
#[test]
fn every_required_node_and_edge_is_covered_instead_of_truncating_the_tail() {
    let sources = vec![source("src/a.mjs", "a();b();c();")];
    let source_graph = graph(
        vec![
            node("node:a", "src/a.mjs", 0, 4),
            node("node:b", "src/a.mjs", 4, 8),
            node("node:c", "src/a.mjs", 8, 12),
        ],
        vec![
            edge("edge:a-b", "node:a", "node:b", "e:a-b"),
            edge("edge:b-c", "node:b", "node:c", "e:b-c"),
        ],
        vec![
            evidence("e:a-b", "src/a.mjs", 0, 4),
            evidence("e:b-c", "src/a.mjs", 4, 8),
        ],
    );

    let plan = planned(plan_semantic_chunks(input(&source_graph, &sources, 30)));

    assert_eq!(plan.chunks.len(), 3);
    assert_eq!(
        plan.coverage.required_node_ids,
        vec![
            "node:a".to_string(),
            "node:b".to_string(),
            "node:c".to_string()
        ]
    );
    assert_eq!(
        plan.coverage.required_edge_ids,
        vec!["edge:a-b".to_string(), "edge:b-c".to_string()]
    );
    assert_eq!(
        plan.coverage.covered_node_ids,
        plan.coverage.required_node_ids
    );
    assert_eq!(
        plan.coverage.covered_edge_ids,
        plan.coverage.required_edge_ids
    );
    assert!(plan.coverage.complete);
}

/// Типово плануються лише ребра, що ВИХОДЯТЬ із code-unit: решта зв'язків
/// графа лишається в ньому, але промпта не отримує — їх нема кому пояснити
/// з локального джерела.
#[test]
fn only_code_unit_originated_edges_are_planned_by_default() {
    let text = "submit();";
    let sources = vec![source("src/orders.mjs", text)];
    let source_graph = graph(
        vec![
            node("node:submit", "src/orders.mjs", 0, text.len()),
            json!({
                "id": "config:openapi", "kind": "config", "domainId": DOMAIN,
                "attributes": {"sourcePath": "contracts/openapi.yaml", "artifact": "schema"}
            }),
            json!({
                "id": "contract:orders-api", "kind": "integration", "domainId": DOMAIN,
                "attributes": {"sourcePath": "contracts/openapi.yaml", "boundary": "contract"}
            }),
        ],
        vec![
            edge("edge:submit", "node:submit", "node:submit", "e:submit"),
            edge(
                "edge:contract",
                "config:openapi",
                "contract:orders-api",
                "e:contract",
            ),
        ],
        vec![
            evidence("e:submit", "src/orders.mjs", 0, text.len()),
            json!({"id": "e:contract", "path": "contracts/openapi.yaml"}),
        ],
    );

    let plan = planned(plan_semantic_chunks(input(&source_graph, &sources, 100)));

    assert_eq!(
        plan.coverage.required_edge_ids,
        vec!["edge:submit".to_string()],
        "ребро з config-вузла не планується — його джерело поза AST"
    );
    assert_eq!(
        plan.coverage.covered_edge_ids,
        vec!["edge:submit".to_string()]
    );
}

/// Завеликий вузол і завелика компонента — різні коди: перше означає «одна
/// функція не влазить», друге «не влазить цикл цілком», і лікуються вони
/// по-різному.
#[test]
fn an_oversized_unit_and_an_oversized_scc_fail_explicitly_instead_of_clipping() {
    let text = "veryLongUnit();";
    let unit_sources = vec![source("src/a.mjs", text)];
    let unit_graph = graph(
        vec![node("node:large", "src/a.mjs", 0, text.len())],
        vec![],
        vec![],
    );
    assert_eq!(
        codes(plan_semantic_chunks(input(&unit_graph, &unit_sources, 2))),
        vec!["oversized-unit".to_string()]
    );

    let cycle_sources = vec![source("src/a.mjs", "a();b();")];
    let cycle_graph = graph(
        vec![
            node("node:a", "src/a.mjs", 0, 4),
            node("node:b", "src/a.mjs", 4, 8),
        ],
        vec![
            edge("edge:a-b", "node:a", "node:b", "e:a-b"),
            edge("edge:b-a", "node:b", "node:a", "e:b-a"),
        ],
        vec![
            evidence("e:a-b", "src/a.mjs", 0, 4),
            evidence("e:b-a", "src/a.mjs", 4, 8),
        ],
    );
    assert_eq!(
        codes(plan_semantic_chunks(input(
            &cycle_graph,
            &cycle_sources,
            20
        ))),
        vec!["oversized-scc".to_string()]
    );
}
