//! Дзеркальний набір зрізу впливу — сценарій-у-сценарій із
//! `tests/impact.test.mjs`, плюс звірка всього зрізу з живим JS.

use rules_docs::impact::create_impact_slice;
use rules_docs::topics::{discover_topics, Topic};
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("fixtures/js-topics.json");
const DOMAIN: &str = "npm:@fixture/orders";
const SUBMIT: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#submitOrder";
const PRIVATE: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#persistOrder";
const CONTRACT: &str = "contract:payments";

fn graph() -> Value {
    json!({
        "domain": {"id": DOMAIN},
        "nodes": [
            {"id": SUBMIT, "kind": "code-unit", "name": "submitOrder", "visibility": "public",
             "domainId": DOMAIN, "attributes": {"sourcePath": "src/orders.mjs"}},
            {"id": PRIVATE, "kind": "code-unit", "name": "persistOrder", "visibility": "private",
             "domainId": DOMAIN, "attributes": {"sourcePath": "src/persistence.mjs"}},
            {"id": CONTRACT, "kind": "integration", "name": "payments", "visibility": "external",
             "domainId": DOMAIN, "attributes": {}},
            {"id": "config:orders", "kind": "config", "name": "orders config", "visibility": "private",
             "domainId": DOMAIN, "attributes": {"sourcePath": "config/orders.json"}},
            {"id": "code-unit:foreign:js:outside", "kind": "code-unit", "name": "outside", "visibility": "public",
             "domainId": "npm:foreign", "attributes": {"sourcePath": "../outside.mjs"}}
        ],
        "edges": [
            {"id": "edge:submit-private", "fromId": SUBMIT, "toId": PRIVATE, "evidenceIds": ["e:code"]},
            {"id": "edge:private-contract", "fromId": PRIVATE, "toId": CONTRACT, "evidenceIds": ["e:contract"]},
            {"id": "edge:private-config", "fromId": PRIVATE, "toId": "config:orders", "evidenceIds": ["e:config"]}
        ],
        "evidence": [
            {"id": "e:code", "kind": "code", "path": "src/orders.mjs", "symbolId": SUBMIT},
            {"id": "e:contract", "kind": "code", "path": "src/persistence.mjs", "symbolId": PRIVATE},
            {"id": "e:config", "kind": "config", "path": "config/orders.json", "symbolId": PRIVATE},
            {"id": "e:test", "kind": "test", "path": "tests/orders.test.mjs", "symbolId": PRIVATE},
            {"id": "e:outside", "kind": "test", "path": "../outside.test.mjs", "symbolId": PRIVATE}
        ]
    })
}

/// Приватний helper впливає на публічний потік — і мусить бути врахований
/// як ФАЙЛ, але ніде не зʼявитись як імʼя символу.
#[test]
fn the_slice_stays_domain_contained_and_leaks_no_private_symbol_names() {
    let source = graph();
    let topics = discover_topics(&source, &json!({}));
    let topic = topics[0].clone();
    let slice = create_impact_slice(&source, &topics, &topic.id).expect("зріз будується");

    assert_eq!(slice.domain_id, DOMAIN);
    assert_eq!(slice.topics.len(), 1);
    assert_eq!(slice.topics[0].title, "submitOrder");
    assert!(slice.topics[0].aliases.is_empty());
    assert_eq!(
        slice.files,
        vec![
            "src/orders.mjs".to_string(),
            "src/persistence.mjs".to_string()
        ]
    );
    assert_eq!(slice.tests, vec!["tests/orders.test.mjs".to_string()]);
    assert_eq!(slice.configs, vec!["config/orders.json".to_string()]);
    assert_eq!(slice.contracts.len(), 1);
    assert_eq!(slice.contracts[0].id, CONTRACT);
    assert_eq!(slice.contracts[0].name, "payments");

    let rendered = format!("{slice:?}");
    assert!(
        !rendered.contains("persistOrder"),
        "приватний символ — лише вершина обходу, а не частина виводу"
    );
    assert!(
        !rendered.contains("outside"),
        "чужий домен і шляхи з `..` до зрізу не потрапляють"
    );
}

#[test]
fn an_alias_is_accepted_and_a_topic_from_another_domain_is_rejected() {
    let source = graph();
    let discovered = discover_topics(&source, &json!({}));
    let aliased = Topic {
        aliases: vec!["process:legacy-order".to_string()],
        ..discovered[0].clone()
    };
    assert!(create_impact_slice(
        &source,
        std::slice::from_ref(&aliased),
        "process:legacy-order"
    )
    .is_ok());

    let foreign = Topic {
        domain_id: "npm:foreign".to_string(),
        ..aliased.clone()
    };
    let failure = create_impact_slice(&source, std::slice::from_ref(&foreign), &foreign.id)
        .expect_err("тема з іншого домену");
    assert_eq!(failure.code, "topic-outside-domain");

    let missing =
        create_impact_slice(&source, &discovered, "process:unknown").expect_err("невідома тема");
    assert_eq!(
        missing.code, "topic-not-found",
        "«не знайдено» і «чужий домен» — різні коди: друге означає спробу перетнути межу"
    );
}

/// Звірка всього зрізу з живим JS — поле в поле.
#[test]
fn the_slice_matches_the_js_projection() {
    let fixtures: Value = serde_json::from_str(FIXTURES).expect("фікстура — JSON");
    let expected = &fixtures["impact"]["slice"];
    let source = graph();
    let topics = discover_topics(&source, &json!({}));
    let slice = create_impact_slice(&source, &topics, &topics[0].id).expect("зріз будується");

    let actual = json!({
        "domain": {"id": slice.domain_id},
        "topics": slice.topics.iter().map(|topic| json!({
            "id": topic.id, "kind": topic.kind, "title": topic.title, "aliases": topic.aliases
        })).collect::<Vec<_>>(),
        "files": slice.files,
        "tests": slice.tests,
        "contracts": slice.contracts.iter().map(|contract| json!({
            "id": contract.id, "name": contract.name
        })).collect::<Vec<_>>(),
        "configs": slice.configs,
    });
    assert_eq!(actual, *expected);
}
