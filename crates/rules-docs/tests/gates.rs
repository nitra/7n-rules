//! Дзеркальний набір обох семантичних гейтів — сценарій-у-сценарій із
//! `tests/entailment.test.mjs` і `tests/gap-mappings.test.mjs`, плюс пін-и
//! проти ЖИВИХ значень JS (хеші й побайтовий промпт зняті з Node, не
//! відтворені з голови).
//!
//! Асерти на `evaluateGaps` тут ПОВНІ: comparator і двигун вердиктів
//! перевіряються разом, як у JS-наборі. Сенс саме в парі — comparator може
//! віддати формально валідні `mappings`, з яких двигун зробить не той
//! статус; окремо ця розбіжність не видно.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use llm_lib::attempt::BoxFuture;
use llm_lib::tiers::Tier;
use rules_docs::deterministic::{canonical_hash, VersionedCache};
use rules_docs::entailment::{verify_evidence_entailment, EntailmentInput, EntailmentOutcome};
use rules_docs::gap_mappings::{
    compare_claim_mappings, GapMappingInput, GapMappingOutcome, Mapping,
};
use rules_docs::gaps::{evaluate_gaps, GapInput, GapOutcome, Validation};
use rules_docs::wave::{
    default_model_policy, new_chain, ChainRef, SubmitBatchFn, WaveItem, WaveResult,
};
use rules_docs::{
    entailment::{ENTAILMENT_PROMPT_VERSION, ENTAILMENT_SCHEMA_VERSION},
    gap_mappings::{GAP_MAPPING_PROMPT_VERSION, GAP_MAPPING_SCHEMA_VERSION},
};
use serde_json::{json, Value};

/// Записи всіх хвиль: тир і `custom_id` кожного item-а.
type Waves = Arc<Mutex<Vec<(Tier, Vec<String>)>>>;
/// Промпти всіх хвиль — для пін-перевірки побайтовості.
type Prompts = Arc<Mutex<Vec<String>>>;

/// Фейковий транспорт: відповідь будує колбек із тиру й `custom_id`.
/// `None` від колбека — item без відповіді (як відсутній ключ у JS-мапі).
fn fake_submit(
    respond: impl Fn(Tier, &str) -> Option<Result<String, String>> + Send + Sync + 'static,
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
            .extend(items.iter().map(|item| item.prompt.clone()));
        let respond = Arc::clone(&respond);
        let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            Ok(items
                .into_iter()
                .filter_map(|item| {
                    respond(tier, &item.custom_id).map(|outcome| WaveResult {
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

/// Транспорт, який має НЕ бути викликаним.
fn never_called() -> (SubmitBatchFn, Waves) {
    let (submit, waves, _) = fake_submit(|_, _| panic!("транспорт не мав викликатись"));
    (submit, waves)
}

fn tiers(waves: &Waves) -> Vec<Tier> {
    waves
        .lock()
        .unwrap()
        .iter()
        .map(|(tier, _)| *tier)
        .collect()
}

fn implemented_claim() -> Value {
    json!({
        "id": "claim:implemented:submit",
        "layer": "implemented",
        "subjectId": "node:submit",
        "predicate": "produces",
        "value": "receipt",
        "evidenceIds": ["evidence:submit"],
        "confidence": 1,
        "sourceFingerprint": "sha256:implemented"
    })
}

fn expected_claim() -> Value {
    json!({
        "id": "claim:expected:notify",
        "layer": "expected",
        "subjectId": "node:notify",
        "predicate": "emits",
        "value": "notification",
        "evidenceIds": ["evidence:notify"],
        "confidence": 1,
        "sourceFingerprint": "sha256:expected"
    })
}

const SUBMIT_EVIDENCE: &str = "submitOrder creates a receipt before returning it.";
const NOTIFY_EVIDENCE: &str = "notifyOrder emits a notification after submission.";

fn evidence_content() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("evidence:submit".to_string(), SUBMIT_EVIDENCE.to_string()),
        ("evidence:notify".to_string(), NOTIFY_EVIDENCE.to_string()),
    ])
}

fn entailed(claim_id: &str) -> Result<String, String> {
    Ok(json!({"claimId": claim_id, "entails": true, "unsupportedFields": []}).to_string())
}

fn entailment_input<'a>(
    graph: &'a Value,
    evidence: &'a BTreeMap<String, String>,
    submit: SubmitBatchFn,
    chain: &ChainRef,
) -> EntailmentInput<'a> {
    EntailmentInput {
        graph,
        evidence_content_by_id: evidence,
        cache: None,
        cache_path: None,
        model_policy: default_model_policy(),
        prompt_version: ENTAILMENT_PROMPT_VERSION.to_string(),
        schema_version: ENTAILMENT_SCHEMA_VERSION.to_string(),
        submit,
        chain: Arc::clone(chain),
    }
}

fn gap_input<'a>(graph: &'a Value, submit: SubmitBatchFn, chain: &ChainRef) -> GapMappingInput<'a> {
    GapMappingInput {
        graph,
        cache: None,
        cache_path: None,
        model_policy: default_model_policy(),
        prompt_version: GAP_MAPPING_PROMPT_VERSION.to_string(),
        schema_version: GAP_MAPPING_SCHEMA_VERSION.to_string(),
        submit,
        chain: Arc::clone(chain),
    }
}

// ── entailment ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn passes_supported_claims_without_rewriting_them() {
    let graph = json!({"claims": [implemented_claim(), expected_claim()]});
    let evidence = evidence_content();
    let (submit, waves, prompts) = fake_submit(|_, id| Some(entailed(id)));
    let chain = new_chain("test", "entailment");

    let outcome = verify_evidence_entailment(entailment_input(&graph, &evidence, submit, &chain))
        .await
        .expect("гейт не падає");

    match outcome {
        EntailmentOutcome::Verified { claims, .. } => assert_eq!(
            claims, graph["claims"],
            "claims повертаються НЕЗМІНЕНИМИ — гейт нічого не переписує"
        ),
        EntailmentOutcome::Blocked { diagnostics, .. } => {
            panic!("несподівані блокери: {diagnostics:?}")
        }
    }
    assert_eq!(tiers(&waves), vec![Tier::Local], "одна хвиля, перший тир");
    assert!(
        prompts.lock().unwrap()[0].contains(SUBMIT_EVIDENCE),
        "промпт несе ТОЧНИЙ текст evidence, не переказ"
    );
}

#[tokio::test]
async fn blocks_unentailed_claims_after_the_whole_ladder() {
    let graph = json!({"claims": [implemented_claim(), expected_claim()]});
    let evidence = evidence_content();
    let (submit, waves, _) = fake_submit(|_, id| {
        Some(Ok(
            json!({"claimId": id, "entails": false, "unsupportedFields": ["value"]}).to_string(),
        ))
    });
    let chain = new_chain("test", "entailment");

    let outcome = verify_evidence_entailment(entailment_input(&graph, &evidence, submit, &chain))
        .await
        .expect("гейт не падає");

    match outcome {
        EntailmentOutcome::Blocked { diagnostics, .. } => assert_eq!(
            diagnostics
                .iter()
                .map(|item| item.code.as_str())
                .collect::<Vec<_>>(),
            vec!["claim-not-entailed", "claim-not-entailed"]
        ),
        EntailmentOutcome::Verified { .. } => panic!("непідтверджені claims мусять блокувати"),
    }
    assert_eq!(
        tiers(&waves),
        vec![Tier::Local, Tier::CloudMin, Tier::CloudAvg],
        "невдача проходить УСІ сходинки драбини"
    );
}

#[tokio::test]
async fn escalation_carries_only_the_unresolved_claims() {
    let graph = json!({"claims": [implemented_claim()]});
    let evidence = evidence_content();
    let (submit, waves, _) = fake_submit(|tier, id| {
        Some(if tier == Tier::Local {
            Ok("{not json".to_string())
        } else {
            entailed(id)
        })
    });
    let chain = new_chain("test", "entailment");

    let outcome = verify_evidence_entailment(entailment_input(&graph, &evidence, submit, &chain))
        .await
        .expect("гейт не падає");

    assert!(matches!(outcome, EntailmentOutcome::Verified { .. }));
    let recorded = waves.lock().unwrap().clone();
    assert_eq!(
        recorded.iter().map(|(tier, _)| *tier).collect::<Vec<_>>(),
        vec![Tier::Local, Tier::CloudMin],
        "ескалація зупиняється, щойно claim підтверджено"
    );
    assert_eq!(recorded[1].1, vec!["claim:implemented:submit".to_string()]);
}

#[tokio::test]
async fn a_successful_verdict_is_reused_from_cache_without_a_model_call() {
    let graph = json!({"claims": [implemented_claim(), expected_claim()]});
    let evidence = evidence_content();
    let chain = new_chain("test", "entailment");
    let (submit, _, _) = fake_submit(|_, id| Some(entailed(id)));

    let mut first = entailment_input(&graph, &evidence, submit, &chain);
    first.cache = Some(VersionedCache::empty(1));
    let initial = verify_evidence_entailment(first)
        .await
        .expect("перший прогін");
    let EntailmentOutcome::Verified { cache, .. } = initial else {
        panic!("перший прогін мав пройти");
    };

    let entries = cache["entries"].as_object().expect("кеш має entries");
    let mut warmed = VersionedCache::empty(1);
    for (key, value) in entries {
        warmed.entries.insert(key.clone(), value.clone());
    }
    let (never, never_waves) = never_called();
    let mut second = entailment_input(&graph, &evidence, never, &chain);
    second.cache = Some(warmed);
    let cached = verify_evidence_entailment(second)
        .await
        .expect("другий прогін");

    assert!(matches!(cached, EntailmentOutcome::Verified { .. }));
    assert!(
        never_waves.lock().unwrap().is_empty(),
        "теплий кеш не коштує жодного виклику"
    );
}

#[tokio::test]
async fn a_claim_without_local_evidence_blocks_before_any_submission() {
    let graph = json!({"claims": [implemented_claim(), expected_claim()]});
    let evidence = BTreeMap::from([("evidence:submit".to_string(), SUBMIT_EVIDENCE.to_string())]);
    let (never, never_waves) = never_called();
    let chain = new_chain("test", "entailment");

    let outcome = verify_evidence_entailment(entailment_input(&graph, &evidence, never, &chain))
        .await
        .expect("гейт не падає");

    match outcome {
        EntailmentOutcome::Blocked { diagnostics, .. } => {
            assert_eq!(diagnostics.len(), 1);
            assert_eq!(diagnostics[0].code, "missing-evidence-content");
            assert_eq!(
                diagnostics[0].claim_id.as_deref(),
                Some("claim:expected:notify")
            );
        }
        EntailmentOutcome::Verified { .. } => panic!("claim без evidence мусить блокувати"),
    }
    assert!(never_waves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_empty_graph_passes_without_touching_the_transport() {
    let graph = json!({"claims": []});
    let evidence = BTreeMap::new();
    let (never, never_waves) = never_called();
    let chain = new_chain("test", "entailment");

    let outcome = verify_evidence_entailment(entailment_input(&graph, &evidence, never, &chain))
        .await
        .expect("гейт не падає");

    match outcome {
        EntailmentOutcome::Verified { claims, .. } => assert_eq!(claims, json!([])),
        EntailmentOutcome::Blocked { .. } => panic!("порожній граф — не помилка"),
    }
    assert!(never_waves.lock().unwrap().is_empty());
}

/// Кожен невалідний вхід блокує ДО транспорту, і кожен — своїм кодом:
/// злиття їх в один «invalid input» позбавило б runner діагностики.
#[tokio::test]
async fn invalid_inputs_are_rejected_before_transport_each_with_its_own_code() {
    let evidence = evidence_content();
    let chain = new_chain("test", "entailment");
    let valid_graph = json!({"claims": [implemented_claim()]});
    let code = |outcome: EntailmentOutcome| match outcome {
        EntailmentOutcome::Blocked { diagnostics, .. } => diagnostics[0].code.clone(),
        EntailmentOutcome::Verified { .. } => panic!("очікувався блокер"),
    };

    let (never, never_waves) = never_called();
    let empty_graph = json!({});
    let invalid_graph = verify_evidence_entailment(entailment_input(
        &empty_graph,
        &evidence,
        Arc::clone(&never),
        &chain,
    ))
    .await
    .expect("гейт не падає");

    let mut policy_input = entailment_input(&valid_graph, &evidence, Arc::clone(&never), &chain);
    policy_input.model_policy = vec![Tier::Local];
    let invalid_policy = verify_evidence_entailment(policy_input)
        .await
        .expect("гейт не падає");

    let mut version_input = entailment_input(&valid_graph, &evidence, Arc::clone(&never), &chain);
    version_input.prompt_version = String::new();
    let invalid_version = verify_evidence_entailment(version_input)
        .await
        .expect("гейт не падає");

    let blank = BTreeMap::from([("evidence:submit".to_string(), String::new())]);
    let blank_content =
        verify_evidence_entailment(entailment_input(&valid_graph, &blank, never, &chain))
            .await
            .expect("гейт не падає");

    assert_eq!(code(invalid_graph), "invalid-entailment-graph");
    assert_eq!(code(invalid_policy), "invalid-entailment-model-policy");
    assert_eq!(code(invalid_version), "invalid-entailment-version");
    assert_eq!(
        code(blank_content),
        "missing-evidence-content",
        "порожній рядок evidence — це ВІДСУТНІЙ текст, не порожній доказ"
    );
    assert!(never_waves.lock().unwrap().is_empty());
}

// ── пін-и дзеркальності проти живого JS ────────────────────────────────────────

/// Хеші зняті з `node` на цих самих значеннях. Розбіжність тут не ламає
/// нічого гучно — вона просто робить кожен накопичений cache-запис промахом,
/// тобто тихо повертає повну вартість прогону.
#[test]
fn canonical_hashes_match_the_live_js_implementation() {
    assert_eq!(
        canonical_hash(&implemented_claim()),
        "sha256:04f95098e644d05f16804e05cfa58538ddedef8ab9d1c7cf7194d8d181bc1f1a"
    );
    assert_eq!(
        canonical_hash(&json!([{"id": "evidence:submit", "content": SUBMIT_EVIDENCE}])),
        "sha256:e5adf8a399782354841cb324fb2a40df1bb20ad9be001b7f27bb9ee5b3c8c852"
    );
    assert_eq!(
        canonical_hash(&json!({"b": 1, "A": [2, {"z": 3, "a": 4}], "a_b": 5, "ab": 6})),
        "sha256:d21afccc268cc1f6c239207f692a19e32d2e567f1a59a45622670e91fd1fc410",
        "ключі з різним регістром і підкресленням — саме там, де побайтове \
         сортування розійшлося б із localeCompare"
    );
}

/// Промпт звірено ПОБАЙТОВО з тим, що JS реально кладе в item хвилі:
/// `claim` у канонічній формі, `evidence` — у порядку вставки (`id`, потім
/// `content`), який канонічний писемник переставив би.
#[tokio::test]
async fn the_entailment_prompt_is_byte_identical_to_the_js_one() {
    let graph = json!({"claims": [implemented_claim()]});
    let evidence = evidence_content();
    let (submit, _, prompts) = fake_submit(|_, _| None);
    let chain = new_chain("test", "entailment");

    let _ = verify_evidence_entailment(entailment_input(&graph, &evidence, submit, &chain)).await;

    let captured = prompts.lock().unwrap()[0].clone();
    assert_eq!(
        captured,
        concat!(
            "Verify whether every asserted field of claim is entailed by the exact local evidence.\n",
            "Do not rewrite, repair, infer beyond evidence, or return a replacement claim.\n",
            "Return exactly one JSON object with only claimId, entails, unsupportedFields.\n",
            "entails must be boolean; unsupportedFields must be an empty string array only when entails is true.\n",
            "{\"claim\":{\"confidence\":1,\"evidenceIds\":[\"evidence:submit\"],\"id\":\"claim:implemented:submit\",",
            "\"layer\":\"implemented\",\"predicate\":\"produces\",\"sourceFingerprint\":\"sha256:implemented\",",
            "\"subjectId\":\"node:submit\",\"value\":\"receipt\"},",
            "\"evidence\":[{\"id\":\"evidence:submit\",\"content\":\"submitOrder creates a receipt before returning it.\"}]}"
        )
    );
}

// ── comparator expected↔implemented ────────────────────────────────────────────

/// Граф comparator-а — дослівний порт JS-хелпера `graph(claims)`: разом із
/// `evidence[]`, який сам comparator не читає, але читає двигун вердиктів.
fn gap_graph(claims: Vec<Value>) -> Value {
    json!({
        "claims": claims,
        "evidence": [{"id": "evidence:expected"}, {"id": "evidence:implemented"}]
    })
}

/// Статус, який двигун вердиктів робить із результату comparator-а — та
/// сама пара стадій, що в конвеєрі `docs build`.
fn gap_status(graph: &Value, mappings: &[Mapping], unresolved: &[String]) -> String {
    match evaluate_gaps(GapInput {
        graph,
        mappings,
        unresolved_expected_claim_ids: unresolved,
        validation: Validation::default(),
        minimum_confidence: 1.0,
    }) {
        GapOutcome::Evaluated(gaps) => {
            assert_eq!(gaps.len(), 1, "одне очікування — одна прогалина");
            gaps[0].status.clone()
        }
        GapOutcome::Blocked(diagnostics) => panic!("двигун вердиктів заблокував: {diagnostics:?}"),
    }
}

fn gap_expected() -> Value {
    json!({
        "id": "claim:expected:receipt",
        "layer": "expected",
        "subjectId": "node:submit",
        "predicate": "produces",
        "value": "receipt",
        "evidenceIds": ["evidence:expected"],
        "confidence": 1,
        "sourceFingerprint": "sha256:expected"
    })
}

fn gap_implemented() -> Value {
    json!({
        "id": "claim:implemented:receipt",
        "layer": "implemented",
        "subjectId": "node:submit",
        "predicate": "produces",
        "value": "receipt",
        "evidenceIds": ["evidence:implemented"],
        "confidence": 1,
        "sourceFingerprint": "sha256:implemented"
    })
}

fn comparison_response(expected_id: &str, comparisons: Value, unresolved: bool) -> String {
    json!({
        "expectedClaimId": expected_id,
        "comparisons": comparisons,
        "unresolved": unresolved
    })
    .to_string()
}

#[tokio::test]
async fn an_exact_equivalent_mapping_costs_zero_model_calls() {
    let graph = gap_graph(vec![gap_expected(), gap_implemented()]);
    let (never, never_waves) = never_called();
    let chain = new_chain("test", "gap-mappings");

    let outcome = compare_claim_mappings(gap_input(&graph, never, &chain))
        .await
        .expect("comparator не падає");

    match outcome {
        GapMappingOutcome::Compared {
            mappings,
            unresolved_expected_claim_ids,
            ..
        } => {
            assert_eq!(mappings.len(), 1);
            assert_eq!(mappings[0].relation, "equivalent");
            assert_eq!(mappings[0].expected_claim_id, "claim:expected:receipt");
            assert_eq!(
                mappings[0].implemented_claim_id,
                "claim:implemented:receipt"
            );
            assert_eq!(
                mappings[0].evidence_ids,
                vec!["evidence:expected", "evidence:implemented"],
                "evidence обох сторін обʼєднується — саме його читає gap-engine"
            );
            assert!(unresolved_expected_claim_ids.is_empty());
        }
        GapMappingOutcome::Blocked { diagnostics, .. } => {
            panic!("несподівані блокери: {diagnostics:?}")
        }
    }
    assert!(never_waves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_expectation_stays_missing_only_without_a_same_subject_implementation() {
    let mut other = gap_implemented();
    other["subjectId"] = json!("node:other");
    let graph = gap_graph(vec![gap_expected(), other]);
    let (never, never_waves) = never_called();
    let chain = new_chain("test", "gap-mappings");

    let outcome = compare_claim_mappings(gap_input(&graph, never, &chain))
        .await
        .expect("comparator не падає");

    match outcome {
        GapMappingOutcome::Compared {
            mappings,
            unresolved_expected_claim_ids,
            ..
        } => {
            assert!(mappings.is_empty(), "інший субʼєкт — не кандидат");
            assert!(
                unresolved_expected_claim_ids.is_empty(),
                "відсутність кандидата детермінована: це missing, а не невизначеність"
            );
            assert_eq!(gap_status(&graph, &mappings, &[]), "missing");
        }
        GapMappingOutcome::Blocked { diagnostics, .. } => {
            panic!("несподівані блокери: {diagnostics:?}")
        }
    }
    assert!(never_waves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_semantic_contradiction_maps_with_combined_evidence() {
    let mut divergent = gap_implemented();
    divergent["value"] = json!("invoice");
    let graph = gap_graph(vec![gap_expected(), divergent]);
    let (submit, waves, _) = fake_submit(|_, id| {
        Some(Ok(comparison_response(
            id,
            json!([{"implementedClaimId": "claim:implemented:receipt", "relation": "contradicts"}]),
            false,
        )))
    });
    let chain = new_chain("test", "gap-mappings");

    let outcome = compare_claim_mappings(gap_input(&graph, submit, &chain))
        .await
        .expect("comparator не падає");

    match outcome {
        GapMappingOutcome::Compared { mappings, .. } => {
            assert_eq!(mappings.len(), 1);
            assert_eq!(mappings[0].relation, "contradicts");
            assert_eq!(
                mappings[0].evidence_ids,
                vec!["evidence:expected", "evidence:implemented"]
            );
            assert_eq!(gap_status(&graph, &mappings, &[]), "diverged");
        }
        GapMappingOutcome::Blocked { diagnostics, .. } => {
            panic!("несподівані блокери: {diagnostics:?}")
        }
    }
    assert_eq!(tiers(&waves), vec![Tier::Local], "non-exact пішов у модель");
}

#[tokio::test]
async fn an_ambiguous_comparison_stays_unresolved_instead_of_missing() {
    let mut divergent = gap_implemented();
    divergent["value"] = json!("invoice");
    let graph = gap_graph(vec![gap_expected(), divergent]);
    let (submit, _, _) = fake_submit(|_, id| Some(Ok(comparison_response(id, json!([]), true))));
    let chain = new_chain("test", "gap-mappings");

    let outcome = compare_claim_mappings(gap_input(&graph, submit, &chain))
        .await
        .expect("comparator не падає");

    match outcome {
        GapMappingOutcome::Compared {
            mappings,
            unresolved_expected_claim_ids,
            ..
        } => {
            assert!(mappings.is_empty());
            assert_eq!(
                unresolved_expected_claim_ids,
                vec!["claim:expected:receipt".to_string()],
                "невизначеність лишається ЯВНОЮ — інакше gap-engine назвав би її прогалиною"
            );
            assert_eq!(
                gap_status(&graph, &mappings, &unresolved_expected_claim_ids),
                "unresolved",
                "і двигун вердиктів справді читає цей список, а не здогадується"
            );
        }
        GapMappingOutcome::Blocked { diagnostics, .. } => {
            panic!("несподівані блокери: {diagnostics:?}")
        }
    }
}

#[tokio::test]
async fn malformed_comparison_escalates_and_the_verdict_is_then_cached() {
    let mut divergent = gap_implemented();
    divergent["value"] = json!("invoice");
    let graph = gap_graph(vec![gap_expected(), divergent]);
    let chain = new_chain("test", "gap-mappings");
    let (submit, waves, _) = fake_submit(|tier, id| {
        Some(if tier == Tier::Local {
            Ok("not-json".to_string())
        } else {
            Ok(comparison_response(
                id,
                json!([{"implementedClaimId": "claim:implemented:receipt", "relation": "equivalent"}]),
                false,
            ))
        })
    });

    let mut first = gap_input(&graph, submit, &chain);
    first.cache = Some(VersionedCache::empty(1));
    let initial = compare_claim_mappings(first).await.expect("перший прогін");
    let GapMappingOutcome::Compared {
        mappings, cache, ..
    } = initial
    else {
        panic!("перший прогін мав пройти");
    };
    assert_eq!(mappings.len(), 1);
    assert_eq!(
        tiers(&waves),
        vec![Tier::Local, Tier::CloudMin],
        "сміттєва відповідь піднімає рівно один щабель"
    );

    let mut warmed = VersionedCache::empty(1);
    for (key, value) in cache["entries"].as_object().expect("кеш має entries") {
        warmed.entries.insert(key.clone(), value.clone());
    }
    let (never, never_waves) = never_called();
    let mut second = gap_input(&graph, never, &chain);
    second.cache = Some(warmed);
    let cached = compare_claim_mappings(second).await.expect("другий прогін");

    match cached {
        GapMappingOutcome::Compared { mappings, .. } => assert_eq!(mappings.len(), 1),
        GapMappingOutcome::Blocked { diagnostics, .. } => {
            panic!("несподівані блокери: {diagnostics:?}")
        }
    }
    assert!(
        never_waves.lock().unwrap().is_empty(),
        "кешується САМЕ успішний вердикт, а не факт спроби"
    );
}
