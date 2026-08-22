//! Дзеркальний набір map/reduce-конвеєра claims — сценарій-у-сценарій із
//! `tests/claims.test.mjs`.

use std::sync::{Arc, Mutex};

use llm_lib::attempt::BoxFuture;
use llm_lib::tiers::Tier;
use rules_docs::claims::{
    build_structured_claims, create_implemented_claim_id, ClaimsInput, ClaimsOutcome,
    CLAIM_PROMPT_VERSION, CLAIM_SCHEMA_VERSION,
};
use rules_docs::deterministic::VersionedCache;
use rules_docs::wave::{
    default_model_policy, new_chain, ChainRef, SubmitBatchFn, WaveItem, WaveResult,
};
use serde_json::{json, Value};

/// Записи хвиль: тир і `custom_id` кожного item-а — рівно те, що JS-набір
/// перевіряє через `submitBatchImpl.mock.calls`.
type Waves = Arc<Mutex<Vec<(Tier, Vec<String>)>>>;
/// Промпти хвиль у порядку відправлення.
type Prompts = Arc<Mutex<Vec<Vec<String>>>>;

fn graph() -> Value {
    json!({
        "domain": {"id": "npm:@fixture/orders"},
        "nodes": [{"id": "node:submit"}, {"id": "node:notify"}],
        "edges": [{"id": "edge:submit-notify"}],
        "evidence": [{"id": "evidence:submit"}, {"id": "evidence:notify"}]
    })
}

fn chunk_submit() -> Value {
    json!({
        "id": "chunk:submit",
        "prompt": "submit flow",
        "contentHash": "sha256:submit",
        "requiredNodeIds": ["node:submit"],
        "requiredEdgeIds": [],
        "allowedEvidenceIds": ["evidence:submit"],
        "wave": 0,
        "dependsOnChunkIds": []
    })
}

fn chunk_notify() -> Value {
    json!({
        "id": "chunk:notify",
        "prompt": "notify flow",
        "contentHash": "sha256:notify",
        "requiredNodeIds": ["node:notify"],
        "requiredEdgeIds": ["edge:submit-notify"],
        "allowedEvidenceIds": ["evidence:notify"],
        "wave": 1,
        "dependsOnChunkIds": ["chunk:submit"]
    })
}

/// Витягає масив ID із рядка промпта — Rust-відповідник регулярки JS-набору.
fn ids_from_prompt(prompt: &str, label: &str) -> Vec<String> {
    let prefix = format!("{label}: ");
    let line = prompt
        .lines()
        .find(|line| line.starts_with(&prefix))
        .unwrap_or_else(|| panic!("промпт мусить містити «{label}», було:\n{prompt}"));
    let payload = line
        .trim_start_matches(&prefix)
        .trim_end_matches('.')
        .to_string();
    serde_json::from_str(&payload).expect("список ID у промпті — JSON-масив")
}

/// Валідна строга відповідь на конкретний item: покриває рівно те, що
/// промпт оголосив обовʼязковим.
fn valid_result(prompt: &str) -> String {
    let covered_node_ids = ids_from_prompt(prompt, "Required node IDs");
    let covered_edge_ids = ids_from_prompt(prompt, "Required edge IDs");
    let claims: Vec<Value> = covered_node_ids
        .iter()
        .map(|subject_id| {
            let evidence = if subject_id == "node:notify" {
                "evidence:notify"
            } else {
                "evidence:submit"
            };
            json!({
                "subjectId": subject_id,
                "predicate": "outcome",
                "value": subject_id,
                "evidenceIds": [evidence],
                "confidence": 1
            })
        })
        .collect();
    json!({
        "claims": claims,
        "coveredNodeIds": covered_node_ids,
        "coveredEdgeIds": covered_edge_ids
    })
    .to_string()
}

/// Транспорт-двійник: колбек вирішує долю кожного item-а за тиром і промптом.
fn fake_submit(
    respond: impl Fn(Tier, &str, &str) -> Option<Result<String, String>> + Send + Sync + 'static,
) -> (SubmitBatchFn, Waves, Prompts) {
    let waves: Waves = Arc::new(Mutex::new(Vec::new()));
    let prompts: Prompts = Arc::new(Mutex::new(Vec::new()));
    let (waves_out, prompts_out) = (Arc::clone(&waves), Arc::clone(&prompts));
    let respond = Arc::new(respond);
    let submit: SubmitBatchFn = Arc::new(move |tier: Tier, items: Vec<WaveItem>, _chain| {
        waves.lock().unwrap().push((
            tier,
            items.iter().map(|item| item.custom_id.clone()).collect(),
        ));
        prompts
            .lock()
            .unwrap()
            .push(items.iter().map(|item| item.prompt.clone()).collect());
        let respond = Arc::clone(&respond);
        let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            // Відповіді навмисно у ЗВОРОТНОМУ порядку — детермінізм виходу
            // не має залежати від порядку завершення batch-у.
            Ok(items
                .into_iter()
                .rev()
                .filter_map(|item| {
                    respond(tier, &item.custom_id, &item.prompt).map(|outcome| WaveResult {
                        custom_id: item.custom_id,
                        outcome,
                    })
                })
                .collect())
        });
        fut
    });
    (submit, waves_out, prompts_out)
}

fn successful_batch() -> (SubmitBatchFn, Waves, Prompts) {
    fake_submit(|_, _, prompt| Some(Ok(valid_result(prompt))))
}

fn input<'a>(
    graph: &'a Value,
    chunks: &'a [Value],
    submit: SubmitBatchFn,
    chain: &ChainRef,
) -> ClaimsInput<'a> {
    ClaimsInput {
        graph,
        chunks,
        parser_version: "oxc@1".to_string(),
        prompt_version: CLAIM_PROMPT_VERSION.to_string(),
        schema_version: CLAIM_SCHEMA_VERSION.to_string(),
        model_policy: default_model_policy(),
        reduce_fan_in: 2,
        cache: None,
        cache_path: None,
        submit,
        chain: Arc::clone(chain),
    }
}

fn built(outcome: ClaimsOutcome) -> (Vec<Value>, Vec<String>, Vec<String>, Value) {
    match outcome {
        ClaimsOutcome::Built {
            claims,
            coverage,
            cache,
        } => (claims, coverage.node_ids, coverage.edge_ids, cache),
        ClaimsOutcome::Blocked { blockers, .. } => panic!("несподівані блокери: {blockers:?}"),
    }
}

fn blockers(outcome: ClaimsOutcome) -> Vec<(String, String)> {
    match outcome {
        ClaimsOutcome::Blocked { blockers, .. } => blockers
            .into_iter()
            .map(|blocker| (blocker.code, blocker.chunk_id))
            .collect(),
        ClaimsOutcome::Built { claims, .. } => panic!("очікувався блокер, отримано {claims:?}"),
    }
}

fn wave_ids(waves: &Waves) -> Vec<(Tier, Vec<String>)> {
    waves.lock().unwrap().clone()
}

#[tokio::test]
async fn map_waves_run_in_dependency_order_and_carry_canonical_dependency_summaries() {
    let graph = graph();
    let chunks = vec![chunk_submit(), chunk_notify()];
    let (submit, waves, prompts) = successful_batch();
    let chain = new_chain("test", "claims");

    let outcome = build_structured_claims(input(&graph, &chunks, submit, &chain))
        .await
        .expect("конвеєр не падає");
    let (claims, _, _, _) = built(outcome);

    let recorded = wave_ids(&waves);
    assert_eq!(recorded.len(), 3, "дві map-хвилі та один reduce");
    assert_eq!(recorded[0].0, Tier::Local);
    assert_eq!(recorded[0].1, vec!["chunk:submit".to_string()]);
    assert_eq!(
        recorded[1].1,
        vec!["chunk:notify".to_string()],
        "залежний chunk фізично не їде в batch раніше за свою залежність"
    );
    assert_eq!(recorded[2].1, vec!["reduce:0:0".to_string()]);
    assert!(
        prompts.lock().unwrap()[1][0].contains("\"id\":\"chunk:submit\""),
        "промпт залежного chunk-а несе підсумок залежності"
    );

    let expected_id = create_implemented_claim_id(
        "npm:@fixture/orders",
        "node:submit",
        "outcome",
        &json!("node:submit"),
        &["evidence:submit".to_string()],
    );
    assert!(
        claims.iter().any(|claim| claim["id"] == json!(expected_id)),
        "ID claim-а обчислює конвеєр, не модель"
    );
}

#[tokio::test]
async fn warm_map_and_reduce_cache_costs_no_model_calls() {
    let graph = graph();
    let chunks = vec![chunk_submit(), chunk_notify()];
    let chain = new_chain("test", "claims");
    let (submit, _, _) = successful_batch();

    let mut first = input(&graph, &chunks, submit, &chain);
    first.cache = Some(VersionedCache::empty(1));
    let (initial_claims, initial_nodes, initial_edges, cache) =
        built(build_structured_claims(first).await.expect("перший прогін"));

    let mut warmed = VersionedCache::empty(1);
    for (key, value) in cache["entries"].as_object().expect("кеш має entries") {
        warmed.entries.insert(key.clone(), value.clone());
    }
    let (never, never_waves, _) = fake_submit(|_, _, _| panic!("транспорт не мав викликатись"));
    let mut second = input(&graph, &chunks, never, &chain);
    second.cache = Some(warmed);
    let (cached_claims, cached_nodes, cached_edges, _) = built(
        build_structured_claims(second)
            .await
            .expect("другий прогін"),
    );

    assert_eq!(cached_claims, initial_claims);
    assert_eq!(cached_nodes, initial_nodes);
    assert_eq!(cached_edges, initial_edges);
    assert!(never_waves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn only_the_failed_chunk_escalates_to_the_next_tier() {
    let graph = graph();
    let chunks = vec![chunk_submit(), chunk_notify()];
    let (submit, waves, _) = fake_submit(|tier, id, prompt| {
        Some(if tier == Tier::Local && id == "chunk:notify" {
            Err("transient".to_string())
        } else {
            Ok(valid_result(prompt))
        })
    });
    let chain = new_chain("test", "claims");

    let outcome = build_structured_claims(input(&graph, &chunks, submit, &chain))
        .await
        .expect("конвеєр не падає");
    built(outcome);

    let recorded = wave_ids(&waves);
    assert_eq!(recorded[0].1, vec!["chunk:submit".to_string()]);
    assert_eq!(recorded[1].0, Tier::Local);
    assert_eq!(recorded[1].1, vec!["chunk:notify".to_string()]);
    assert_eq!(recorded[2].0, Tier::CloudMin);
    assert_eq!(
        recorded[2].1,
        vec!["chunk:notify".to_string()],
        "на сильніший тир їде ЛИШЕ невдалий item"
    );
}

#[tokio::test]
async fn invalid_json_fails_closed_instead_of_accepting_unverified_claims() {
    let graph = graph();
    let chunks = vec![chunk_submit()];
    let (submit, waves, _) = fake_submit(|_, _, _| Some(Ok("not JSON".to_string())));
    let chain = new_chain("test", "claims");

    let mut request = input(&graph, &chunks, submit, &chain);
    request.model_policy = vec![Tier::Local, Tier::CloudMin];
    let outcome = build_structured_claims(request)
        .await
        .expect("конвеєр не падає");

    assert_eq!(
        blockers(outcome),
        vec![("invalid-json".to_string(), "chunk:submit".to_string())]
    );
    assert_eq!(
        wave_ids(&waves).len(),
        2,
        "драбина пройдена рівно по заданій політиці"
    );
}

#[tokio::test]
async fn every_required_unit_needs_a_behavioral_claim_and_the_taxonomy_is_stated() {
    let graph = graph();
    let chunks = vec![chunk_submit()];
    let (submit, _, prompts) = fake_submit(|_, _, _| {
        Some(Ok(
            json!({"claims": [], "coveredNodeIds": ["node:submit"], "coveredEdgeIds": []})
                .to_string(),
        ))
    });
    let chain = new_chain("test", "claims");

    let mut request = input(&graph, &chunks, submit, &chain);
    request.model_policy = vec![Tier::Local];
    let outcome = build_structured_claims(request)
        .await
        .expect("конвеєр не падає");

    assert!(
        prompts.lock().unwrap()[0][0].contains(
            "purpose, actor, trigger, precondition, step, business-rule, state-change, integration, outcome"
        ),
        "таксономія оголошена в промпті дослівно"
    );
    assert_eq!(
        blockers(outcome),
        vec![(
            "behavioral-coverage-incomplete".to_string(),
            "chunk:submit".to_string()
        )],
        "формально повне покриття без жодного твердження — це bypass"
    );
}

#[tokio::test]
async fn a_missing_result_and_an_uncovered_required_edge_both_block() {
    let graph = graph();
    let chain = new_chain("test", "claims");

    let chunks = vec![chunk_submit()];
    let (empty, _, _) = fake_submit(|_, _, _| None);
    let mut request = input(&graph, &chunks, empty, &chain);
    request.model_policy = vec![Tier::Local];
    let missing = build_structured_claims(request)
        .await
        .expect("конвеєр не падає");

    let mut standalone_notify = chunk_notify();
    standalone_notify["wave"] = json!(0);
    standalone_notify["dependsOnChunkIds"] = json!([]);
    let notify_chunks = vec![standalone_notify];
    let (uncovered_submit, _, _) = fake_submit(|_, _, _| {
        Some(Ok(json!({
            "claims": [{
                "subjectId": "node:notify",
                "predicate": "outcome",
                "value": "notice",
                "evidenceIds": ["evidence:notify"],
                "confidence": 1
            }],
            "coveredNodeIds": ["node:notify"],
            "coveredEdgeIds": []
        })
        .to_string()))
    });
    let mut request = input(&graph, &notify_chunks, uncovered_submit, &chain);
    request.model_policy = vec![Tier::Local];
    let uncovered = build_structured_claims(request)
        .await
        .expect("конвеєр не падає");

    assert_eq!(
        blockers(missing),
        vec![("missing-result".to_string(), "chunk:submit".to_string())]
    );
    assert_eq!(
        blockers(uncovered),
        vec![(
            "coverage-incomplete".to_string(),
            "chunk:notify".to_string()
        )],
        "оголошений required edge не можна лишити непокритим"
    );
}

#[tokio::test]
async fn graph_global_evidence_outside_the_chunk_scope_is_rejected() {
    let graph = graph();
    let chunks = vec![chunk_submit()];
    // `evidence:notify` існує в графі, але не входить у scope цього chunk-а.
    let (submit, _, _) = fake_submit(|_, _, _| {
        Some(Ok(json!({
            "claims": [{
                "subjectId": "node:submit",
                "predicate": "outcome",
                "value": "order",
                "evidenceIds": ["evidence:notify"],
                "confidence": 1
            }],
            "coveredNodeIds": ["node:submit"],
            "coveredEdgeIds": []
        })
        .to_string()))
    });
    let chain = new_chain("test", "claims");

    let mut request = input(&graph, &chunks, submit, &chain);
    request.model_policy = vec![Tier::Local];
    let outcome = build_structured_claims(request)
        .await
        .expect("конвеєр не падає");

    assert_eq!(
        blockers(outcome),
        vec![("invalid-claim-refs".to_string(), "chunk:submit".to_string())]
    );
}

#[tokio::test]
async fn predicates_outside_the_stable_taxonomy_are_rejected() {
    let graph = graph();
    let chunks = vec![chunk_submit()];
    let (submit, _, _) = fake_submit(|_, _, _| {
        Some(Ok(json!({
            "claims": [{
                "subjectId": "node:submit",
                "predicate": "arbitrary-relation",
                "value": "order",
                "evidenceIds": ["evidence:submit"],
                "confidence": 1
            }],
            "coveredNodeIds": ["node:submit"],
            "coveredEdgeIds": []
        })
        .to_string()))
    });
    let chain = new_chain("test", "claims");

    let mut request = input(&graph, &chunks, submit, &chain);
    request.model_policy = vec![Tier::Local];
    let outcome = build_structured_claims(request)
        .await
        .expect("конвеєр не падає");

    assert_eq!(
        blockers(outcome),
        vec![("invalid-claim-refs".to_string(), "chunk:submit".to_string())]
    );
}

#[tokio::test]
async fn missing_and_cyclic_dependency_plans_block_before_any_model_call() {
    let graph = graph();
    let chain = new_chain("test", "claims");

    let mut dangling = chunk_submit();
    dangling["dependsOnChunkIds"] = json!(["chunk:missing"]);
    let dangling_chunks = vec![dangling];
    let (never, never_waves, _) = fake_submit(|_, _, _| panic!("транспорт не мав викликатись"));
    let missing =
        build_structured_claims(input(&graph, &dangling_chunks, Arc::clone(&never), &chain))
            .await
            .expect("конвеєр не падає");

    let mut left = chunk_submit();
    left["dependsOnChunkIds"] = json!(["chunk:notify"]);
    left["wave"] = json!(1);
    let mut right = chunk_notify();
    right["dependsOnChunkIds"] = json!(["chunk:submit"]);
    right["wave"] = json!(2);
    let cyclic_chunks = vec![left, right];
    let cyclic = build_structured_claims(input(&graph, &cyclic_chunks, never, &chain))
        .await
        .expect("конвеєр не падає");

    assert_eq!(
        blockers(missing),
        vec![(
            "unknown-chunk-dependency".to_string(),
            "chunk:submit".to_string()
        )]
    );
    assert!(
        blockers(cyclic)
            .iter()
            .any(|(code, _)| code == "cyclic-chunk-dependency"),
        "цикл ловиться до моделі"
    );
    assert!(never_waves.lock().unwrap().is_empty());
}

/// Порядок chunk-ів на вході й порядок завершення batch-у не мають впливати
/// на вихід — інакше кеш і публікація «дрейфували» б без жодної зміни коду.
#[tokio::test]
async fn the_result_is_stable_regardless_of_input_and_completion_order() {
    let graph = graph();
    let chain = new_chain("test", "claims");

    let straight = vec![chunk_submit(), chunk_notify()];
    let (submit, _, _) = successful_batch();
    let (left_claims, left_nodes, left_edges, _) = built(
        build_structured_claims(input(&graph, &straight, submit, &chain))
            .await
            .expect("прямий порядок"),
    );

    let reversed = vec![chunk_notify(), chunk_submit()];
    let (submit, _, _) = successful_batch();
    let (right_claims, right_nodes, right_edges, _) = built(
        build_structured_claims(input(&graph, &reversed, submit, &chain))
            .await
            .expect("зворотний порядок"),
    );

    assert_eq!(right_claims, left_claims);
    assert_eq!(right_nodes, left_nodes);
    assert_eq!(right_edges, left_edges);
}

/// Пін проти ЖИВОГО JS: і canonical `claim:`-ID, і `sourceFingerprint`
/// обчислюються з хешів, тож розбіжність порту була б тихою — граф просто
/// наповнився б іншими ідентичностями, і дедуплікація між прогонами JS і
/// Rust перестала б працювати.
#[tokio::test]
async fn claim_identity_matches_the_live_js_implementation() {
    assert_eq!(
        create_implemented_claim_id(
            "npm:@fixture/orders",
            "node:submit",
            "outcome",
            &json!("node:submit"),
            &["evidence:submit".to_string()],
        ),
        "claim:sha256:5276f7dacf073b59d087204b536eb5d95bcd0286c9193f8402c519a341b10ccf"
    );

    let graph = graph();
    let chunks = vec![chunk_submit()];
    let (submit, _, _) = successful_batch();
    let chain = new_chain("test", "claims");
    let mut request = input(&graph, &chunks, submit, &chain);
    request.model_policy = vec![Tier::Local];
    let (claims, _, _, _) = built(
        build_structured_claims(request)
            .await
            .expect("конвеєр не падає"),
    );

    assert_eq!(claims.len(), 1);
    assert_eq!(
        claims[0]["sourceFingerprint"],
        json!("sha256:e11e257204fc5c0dd8e3cd60ec36f9fdc76b6c7c34a912ec1f3a399ae8ea1bf6"),
        "fingerprint рахується з chunkId і СИРОГО claim-а моделі"
    );
    assert_eq!(claims[0]["layer"], json!("implemented"));
}
