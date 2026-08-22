//! Дзеркальний набір узгодження ідентичностей — сценарій-у-сценарій із
//! `tests/identity-migration.test.mjs`, плюс звірка ВСІХ семи результатів із
//! живим JS (`fixtures/js-identity.json`).
//!
//! Звірка тут важлива через арифметику: схожість тем — це зважена сума трьох
//! перекриттів із порогом 0.75, і зсув на останньому знаку тихо перетворив би
//! «перейменування» на «нова тема» разом із втратою авторського тексту.

use rules_docs::deterministic::canonical_json;
use rules_docs::identity::{reconcile_topic_identities, MigrationOutcome};
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("fixtures/js-identity.json");
const DOMAIN: &str = "npm:@fixture/orders";
const OUTCOME: &str = "outcome:order-created";

/// Той самий фікстурний граф, що в JS: одна публічна одиниця, один outcome і
/// ребро між ними.
fn graph(
    public_id: &str,
    public_name: &str,
    fingerprint: &str,
    topic_id: &str,
    title: &str,
) -> Value {
    json!({
        "domain": {"id": DOMAIN},
        "nodes": [
            {"id": public_id, "kind": "code-unit", "name": public_name, "visibility": "public",
             "domainId": DOMAIN,
             "attributes": {"unitKind": "function", "signature": format!("{public_name}(order)")},
             "sourceFingerprint": fingerprint},
            {"id": OUTCOME, "kind": "outcome", "name": "Order created", "visibility": "public",
             "domainId": DOMAIN, "attributes": {}, "sourceFingerprint": "sha256:outcome"}
        ],
        "edges": [{"id": format!("edge:{public_id}"), "fromId": public_id, "toId": OUTCOME,
                   "kind": "produces", "evidenceIds": ["e:flow"]}],
        "topics": [{"id": topic_id, "kind": "process", "title": title, "domainId": DOMAIN,
                    "anchorIds": [public_id, OUTCOME], "aliases": []}]
    })
}

fn simple(public_id: &str, topic_id: &str) -> Value {
    graph(
        public_id,
        "submitOrder",
        "sha256:submit",
        topic_id,
        "submitOrder",
    )
}

fn topics_of(graph: &Value) -> Vec<Value> {
    graph["topics"].as_array().cloned().unwrap_or_default()
}

fn reconcile(previous: &Value, next: &Value) -> MigrationOutcome {
    reconcile_topic_identities(Some(previous), next, &topics_of(next), None)
}

fn reconcile_with_registry(previous: &Value, next: &Value, registry: &Value) -> MigrationOutcome {
    reconcile_topic_identities(Some(previous), next, &topics_of(next), Some(registry))
}

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON")
}

/// Переводить результат у форму JS-виходу — щоб звіряти поле в поле.
fn as_js(outcome: &MigrationOutcome) -> Value {
    let mappings = |plan: &rules_docs::identity::MigrationPlan| {
        json!({
            "status": plan.status,
            "mappings": plan.mappings.iter().map(|mapping| json!({
                "fromTopicId": mapping.from_topic_id,
                "toTopicId": mapping.to_topic_id,
                "score": mapping.score,
                "reason": mapping.reason,
            })).collect::<Vec<_>>()
        })
    };
    match outcome {
        MigrationOutcome::Resolved {
            topics,
            protected_zones_by_topic_id,
            plan,
        } => json!({
            "ok": true,
            "topics": topics,
            "protectedZonesByTopicId": protected_zones_by_topic_id
                .iter()
                .map(|(key, value)| (key.clone(), Value::Array(value.clone())))
                .collect::<serde_json::Map<_, _>>(),
            "migrationPlan": mappings(plan),
        }),
        MigrationOutcome::Blocked { diagnostics, plan } => json!({
            "ok": false,
            "diagnostics": diagnostics.iter().map(|item| json!({
                "code": item.code,
                "detail": item.detail,
                "previousTopicIds": item.previous_topic_ids,
                "nextTopicIds": item.next_topic_ids,
            })).collect::<Vec<_>>(),
            "migrationPlan": mappings(plan),
        }),
    }
}

fn moved_pair() -> (Value, Value) {
    let mut previous = simple(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitOrder"),
        "process:order-submit",
    );
    previous["topics"][0]["aliases"] = json!(["process:legacy-submit"]);
    let next = graph(
        &format!("code-unit:{DOMAIN}:js:src/flows/order-submit.mjs#submitOrder"),
        "submitOrder",
        "sha256:submit",
        "process:generated-new",
        "Submit an order",
    );
    (previous, next)
}

/// Переміщення незміненого файла не має створювати нову тему: ID, aliases і
/// привʼязаний до них текст лишаються.
#[test]
fn a_moved_unchanged_file_keeps_its_topic_id_and_aliases() {
    let (previous, next) = moved_pair();
    let outcome = reconcile(&previous, &next);
    let MigrationOutcome::Resolved { topics, plan, .. } = &outcome else {
        panic!("очікувалось узгодження: {outcome:?}");
    };
    assert_eq!(plan.status, "resolved");
    assert_eq!(topics.len(), 1);
    assert_eq!(topics[0]["id"], json!("process:order-submit"));
    assert_eq!(
        topics[0]["title"],
        json!("Submit an order"),
        "заголовок оновився"
    );
    assert_eq!(topics[0]["aliases"], json!(["process:legacy-submit"]));
}

/// Перейменування символу впізнається за семантичним підписом і околицею —
/// навіть коли відбиток джерела змінився.
#[test]
fn a_symbol_rename_is_recognised_from_signature_and_neighborhood() {
    let previous = simple(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitOrder"),
        "process:order-submit",
    );
    let next = graph(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#placeOrder"),
        "placeOrder",
        "sha256:changed-source",
        "process:generated-new",
        "placeOrder",
    );

    let outcome = reconcile(&previous, &next);
    let MigrationOutcome::Resolved { topics, plan, .. } = &outcome else {
        panic!("очікувалось узгодження: {outcome:?}");
    };
    assert_eq!(topics[0]["id"], json!("process:order-submit"));
    assert_eq!(topics[0]["title"], json!("placeOrder"));
    assert!(
        plan.mappings.iter().any(|mapping| {
            mapping.from_topic_id == "process:order-submit" && mapping.reason == "semantic-rename"
        }),
        "перейменування зафіксоване як semantic-rename: {:?}",
        plan.mappings
    );
}

/// Неоднозначність — це ПЛАН, а не вибір: інакше модуль мовчки вирішував би
/// за людину, яка одна знає, що саме сталося з темою.
#[test]
fn ambiguous_splits_and_merges_block_with_an_explicit_plan() {
    let previous = simple(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitOrder"),
        "process:old",
    );
    let first = graph(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitDomesticOrder"),
        "submitDomesticOrder",
        "sha256:submit",
        "process:domestic",
        "submitDomesticOrder",
    );
    let second = graph(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitInternationalOrder"),
        "submitInternationalOrder",
        "sha256:submit",
        "process:international",
        "submitInternationalOrder",
    );
    let mut split = first.clone();
    let mut nodes: Vec<Value> = first["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter(|node| node["id"] != json!(OUTCOME))
        .cloned()
        .collect();
    nodes.extend(second["nodes"].as_array().expect("nodes").iter().cloned());
    split["nodes"] = json!(nodes);
    split["edges"] = json!([first["edges"][0].clone(), second["edges"][0].clone()]);
    split["topics"] = json!([first["topics"][0].clone(), second["topics"][0].clone()]);

    let split_outcome = reconcile(&previous, &split);
    let MigrationOutcome::Blocked { diagnostics, plan } = &split_outcome else {
        panic!("split мав заблокувати: {split_outcome:?}");
    };
    assert_eq!(plan.status, "blocked");
    assert!(diagnostics
        .iter()
        .any(|item| item.code == "ambiguous-topic-split"));

    let merged = simple(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitOrder"),
        "process:merged",
    );
    let merge_outcome = reconcile(&split, &merged);
    let MigrationOutcome::Blocked { diagnostics, .. } = &merge_outcome else {
        panic!("merge мав заблокувати: {merge_outcome:?}");
    };
    assert!(diagnostics
        .iter()
        .any(|item| item.code == "ambiguous-topic-merge"));
}

/// Захищений текст переноситься ЛИШЕ через однозначне зіставлення: інакше
/// авторський абзац просто зник би разом зі старим ID.
#[test]
fn a_protected_registry_survives_only_through_an_unambiguous_mapping() {
    let (previous, next) = moved_pair();
    let registry = json!({
        "process:order-submit": [
            {"id": "order-context", "kind": "MANUAL", "content": "Keep the operational context."},
            {"id": "must-create", "kind": "EXPECTED", "content": "Must create an order."}
        ]
    });

    let kept = reconcile_with_registry(&previous, &next, &registry);
    let MigrationOutcome::Resolved {
        protected_zones_by_topic_id,
        ..
    } = &kept
    else {
        panic!("реєстр мав перенестись: {kept:?}");
    };
    assert_eq!(
        protected_zones_by_topic_id.get("process:order-submit"),
        registry["process:order-submit"].as_array()
    );

    let mut unmatched = graph(
        &format!("code-unit:{DOMAIN}:js:src/other.mjs#cancelOrder"),
        "cancelOrder",
        "sha256:cancel",
        "process:cancel-order",
        "cancelOrder",
    );
    unmatched["topics"][0]["kind"] = json!("contract");
    let unresolved = reconcile_with_registry(&previous, &unmatched, &registry);
    let MigrationOutcome::Blocked { diagnostics, .. } = &unresolved else {
        panic!("без зіставлення реєстр мав заблокувати: {unresolved:?}");
    };
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "protected-zone-migration-unresolved");
}

/// Першому прогону нема з чим узгоджуватись — і це не помилка.
#[test]
fn a_first_run_without_a_previous_manifest_resolves_trivially() {
    let (_, next) = moved_pair();
    let outcome = reconcile_topic_identities(None, &next, &topics_of(&next), None);
    let MigrationOutcome::Resolved { topics, plan, .. } = &outcome else {
        panic!("перший прогін не блокується: {outcome:?}");
    };
    assert_eq!(plan.status, "resolved");
    assert!(plan.mappings.is_empty());
    assert_eq!(topics.len(), 1);
}

/// Диференційна звірка всіх семи результатів із живим JS.
#[test]
fn every_reconciliation_matches_the_js_implementation() {
    let expected = fixtures();
    let (moved_previous, moved_next) = moved_pair();

    let renamed_previous = simple(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitOrder"),
        "process:order-submit",
    );
    let renamed_next = graph(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#placeOrder"),
        "placeOrder",
        "sha256:changed-source",
        "process:generated-new",
        "placeOrder",
    );

    let split_previous = simple(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitOrder"),
        "process:old",
    );
    let first = graph(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitDomesticOrder"),
        "submitDomesticOrder",
        "sha256:submit",
        "process:domestic",
        "submitDomesticOrder",
    );
    let second = graph(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitInternationalOrder"),
        "submitInternationalOrder",
        "sha256:submit",
        "process:international",
        "submitInternationalOrder",
    );
    let mut split = first.clone();
    let mut nodes: Vec<Value> = first["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter(|node| node["id"] != json!(OUTCOME))
        .cloned()
        .collect();
    nodes.extend(second["nodes"].as_array().expect("nodes").iter().cloned());
    split["nodes"] = json!(nodes);
    split["edges"] = json!([first["edges"][0].clone(), second["edges"][0].clone()]);
    split["topics"] = json!([first["topics"][0].clone(), second["topics"][0].clone()]);
    let merged = simple(
        &format!("code-unit:{DOMAIN}:js:src/orders.mjs#submitOrder"),
        "process:merged",
    );

    let registry = json!({
        "process:order-submit": [
            {"id": "order-context", "kind": "MANUAL", "content": "Keep the operational context."},
            {"id": "must-create", "kind": "EXPECTED", "content": "Must create an order."}
        ]
    });
    let mut unmatched = graph(
        &format!("code-unit:{DOMAIN}:js:src/other.mjs#cancelOrder"),
        "cancelOrder",
        "sha256:cancel",
        "process:cancel-order",
        "cancelOrder",
    );
    unmatched["topics"][0]["kind"] = json!("contract");

    for (name, actual) in [
        ("moved", as_js(&reconcile(&moved_previous, &moved_next))),
        (
            "renamed",
            as_js(&reconcile(&renamed_previous, &renamed_next)),
        ),
        ("split", as_js(&reconcile(&split_previous, &split))),
        ("merge", as_js(&reconcile(&split, &merged))),
        (
            "registryKept",
            as_js(&reconcile_with_registry(
                &moved_previous,
                &moved_next,
                &registry,
            )),
        ),
        (
            "registryUnresolved",
            as_js(&reconcile_with_registry(
                &moved_previous,
                &unmatched,
                &registry,
            )),
        ),
        (
            "firstRun",
            as_js(&reconcile_topic_identities(
                None,
                &moved_next,
                &topics_of(&moved_next),
                None,
            )),
        ),
    ] {
        // Порівнюємо КАНОНІЧНИМ JSON, а не `Value`: `score` — це f64, і
        // `serde_json` розрізняє `1.0` та `1`, тоді як `JSON.stringify` пише
        // ціле значення без дробової частини. Наш писемник цю саму семантику
        // вже відтворює, тож він і є правильним арбітром.
        assert_eq!(
            canonical_json(&actual),
            canonical_json(&expected[name]),
            "сценарій «{name}» розійшовся з JS"
        );
    }
}
