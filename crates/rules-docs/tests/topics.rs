//! Дзеркальний набір тем — сценарій-у-сценарій із
//! `tests/topic-discovery.test.mjs`, плюс звірка ідентичностей із живим JS.
//!
//! Звірка тут не формальність: ID теми — це хеш замикання, і будь-який
//! дрейф (порядок ключів у хешованому JSON, обрізка до 24 символів,
//! сортування) тихо перейменував би ВСІ вже опубліковані теми.

use rules_docs::topics::{collect_reachable_node_ids, discover_topics, resolve_topic, Topic};
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("fixtures/js-topics.json");
const DOMAIN: &str = "npm:@fixture/orders";
const SUBMIT: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#submitOrder";
const PRIVATE: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#persistOrder";
const OUTCOME: &str = "outcome:order-created";
const CONTRACT: &str = "contract:payments";

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON")
}

fn graph(public_name: &str) -> Value {
    json!({
        "domain": {"id": DOMAIN},
        "nodes": [
            {"id": SUBMIT, "kind": "code-unit", "name": public_name, "visibility": "public", "domainId": DOMAIN},
            {"id": PRIVATE, "kind": "code-unit", "name": "persistOrder", "visibility": "private", "domainId": DOMAIN},
            {"id": OUTCOME, "kind": "outcome", "name": "Order created", "visibility": "public", "domainId": DOMAIN},
            {"id": CONTRACT, "kind": "integration", "name": "payments", "visibility": "external", "domainId": DOMAIN},
            {"id": "code-unit:foreign:js:outside", "kind": "code-unit", "name": "outside", "visibility": "public", "domainId": "npm:foreign"}
        ],
        "edges": [
            {"id": "edge:submit-private", "fromId": SUBMIT, "toId": PRIVATE, "evidenceIds": ["e:submit-private"]},
            {"id": "edge:private-outcome", "fromId": PRIVATE, "toId": OUTCOME, "evidenceIds": ["e:private-outcome"]},
            {"id": "edge:private-contract", "fromId": PRIVATE, "toId": CONTRACT, "evidenceIds": ["e:private-contract"]},
            {"id": "edge:without-evidence", "fromId": PRIVATE, "toId": "code-unit:foreign:js:outside", "evidenceIds": []}
        ]
    })
}

fn ids(topics: &[Topic]) -> Vec<String> {
    topics.iter().map(|topic| topic.id.clone()).collect()
}

fn expected_ids(name: &str) -> Vec<String> {
    fixtures()["topics"][name]
        .as_array()
        .expect("теми у фікстурі")
        .iter()
        .map(|topic| topic["id"].as_str().unwrap_or_default().to_string())
        .collect()
}

/// Ідентичність теми не залежить від відображуваного імені: перейменування
/// публічної функції не має «створювати» нову тему й ламати посилання.
#[test]
fn public_flow_anchors_give_a_title_independent_stable_identity() {
    let initial = discover_topics(&graph("submitOrder"), &json!({}));
    let renamed = discover_topics(&graph("placeOrder"), &json!({}));

    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].kind, "process");
    assert_eq!(initial[0].title, "submitOrder");
    assert_eq!(initial[0].domain_id, DOMAIN);
    let mut anchors = vec![
        SUBMIT.to_string(),
        OUTCOME.to_string(),
        CONTRACT.to_string(),
    ];
    anchors.sort();
    assert_eq!(initial[0].anchor_ids, anchors);
    assert_eq!(renamed[0].id, initial[0].id);
    assert_eq!(renamed[0].title, "placeOrder");
    assert!(
        !initial[0].id.contains("submitOrder"),
        "ID не несе імені символу"
    );

    let mut reachable = vec![
        CONTRACT.to_string(),
        OUTCOME.to_string(),
        PRIVATE.to_string(),
        SUBMIT.to_string(),
    ];
    reachable.sort();
    assert_eq!(
        collect_reachable_node_ids(&graph("submitOrder"), &[SUBMIT.to_string()]),
        reachable,
        "ребро без evidence не створює досяжності"
    );

    assert_eq!(ids(&initial), expected_ids("base"), "ID збігаються з JS");
    assert_eq!(ids(&renamed), expected_ids("renamed"));
}

#[test]
fn explicit_aliases_resolve_to_the_canonical_topic() {
    let canonical = discover_topics(&graph("submitOrder"), &json!({}));
    let aliases = json!({canonical[0].id.clone(): ["process:legacy-order"]});
    let topics = discover_topics(&graph("submitOrder"), &aliases);

    assert_eq!(topics[0].aliases, vec!["process:legacy-order".to_string()]);
    assert_eq!(
        resolve_topic(&topics, "process:legacy-order").map(|topic| topic.id.clone()),
        Some(canonical[0].id.clone())
    );
    assert_eq!(ids(&topics), expected_ids("aliased"));
}

/// Дві точки входу з ОДНАКОВИМ замиканням — одна тема; колишні одиничні ID
/// лишаються aliases, інакше групування тихо зламало б усі посилання.
#[test]
fn entries_sharing_a_closure_group_into_one_flow_and_keep_legacy_ids() {
    let mut source = graph("submitOrder");
    let second = "code-unit:npm:@fixture/orders:js:src/orders.mjs#retryOrder";
    source["nodes"].as_array_mut().expect("nodes").push(
        json!({"id": second, "kind": "code-unit", "name": "retryOrder", "visibility": "public", "domainId": DOMAIN}),
    );
    source["edges"].as_array_mut().expect("edges").push(
        json!({"id": "edge:retry-private", "fromId": second, "toId": PRIVATE, "evidenceIds": ["e:retry-private"]}),
    );

    let topics = discover_topics(&source, &json!({}));
    assert_eq!(topics.len(), 1);
    let mut anchors = vec![
        CONTRACT.to_string(),
        OUTCOME.to_string(),
        SUBMIT.to_string(),
        second.to_string(),
    ];
    anchors.sort();
    assert_eq!(topics[0].anchor_ids, anchors);
    assert_eq!(topics[0].aliases.len(), 2, "обидва колишні ID лишились");
    assert_eq!(
        resolve_topic(&topics, &topics[0].aliases[0]).map(|topic| topic.id.clone()),
        Some(topics[0].id.clone())
    );
    assert_eq!(ids(&topics), expected_ids("grouped"));
}

/// Різні замикання — різні потоки: злиття їх в одну тему приховало б, що
/// це різні сценарії домену.
#[test]
fn entries_with_distinct_closures_stay_separate_flows() {
    let mut source = graph("submitOrder");
    let second = "code-unit:npm:@fixture/orders:js:src/orders.mjs#cancelOrder";
    let nodes = source["nodes"].as_array_mut().expect("nodes");
    nodes.push(
        json!({"id": second, "kind": "code-unit", "name": "cancelOrder", "visibility": "public", "domainId": DOMAIN}),
    );
    nodes.push(
        json!({"id": "outcome:order-cancelled", "kind": "outcome", "name": "Order cancelled", "visibility": "public", "domainId": DOMAIN}),
    );
    source["edges"].as_array_mut().expect("edges").push(
        json!({"id": "edge:cancelled", "fromId": second, "toId": "outcome:order-cancelled", "evidenceIds": ["e:cancelled"]}),
    );

    let topics = discover_topics(&source, &json!({}));
    assert_eq!(
        topics
            .iter()
            .filter(|topic| topic.kind == "process")
            .count(),
        2
    );
    assert_eq!(ids(&topics), expected_ids("distinct"));
}

#[test]
fn the_reachable_closure_matches_the_js_traversal() {
    let expected: Vec<String> = fixtures()["reachable"]
        .as_array()
        .expect("замикання у фікстурі")
        .iter()
        .map(|item| item.as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(
        collect_reachable_node_ids(&graph("submitOrder"), &[SUBMIT.to_string()]),
        expected
    );
}
