//! Дзеркальний набір рендерера — сценарії з `tests/render.test.mjs` плюс
//! ПОБАЙТОВА звірка всіх згенерованих файлів із живим JS
//! (`fixtures/js-render.json`).
//!
//! Побайтова звірка тут не примха: сторінки — це довгі шаблони українською,
//! і будь-яка розбіжність (пропущений абзац, інший fallback, зайвий перенос)
//! мовчки змінила б опубліковану документацію, а не впала б тестом.

use std::collections::BTreeMap;

use rules_docs::render::{render_knowledge_artifacts, RenderOutcome};
use rules_docs::zones::zone_hash;
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("fixtures/js-render.json");
const DOMAIN: &str = "npm:@fixture/orders";
const PUBLIC_ID: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#submitOrder";
const PRIVATE_ID: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#persistOrder";
const OUTCOME_ID: &str = "outcome:created";
const CONTRACT_ID: &str = "contract:payments";

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON")
}

fn graph(with_gap: bool) -> Value {
    json!({
        "schemaVersion": 1,
        "domain": {"id": DOMAIN, "ecosystem": "npm", "name": "@fixture/orders",
                   "rootManifest": "package.json", "sourceFingerprint": "sha256:domain"},
        "nodes": [
            {"id": PUBLIC_ID, "kind": "code-unit", "name": "submitOrder", "visibility": "public",
             "domainId": DOMAIN, "attributes": {"sourcePath": "src/orders.mjs"}, "sourceFingerprint": "sha256:public"},
            {"id": PRIVATE_ID, "kind": "code-unit", "name": "persistOrder", "visibility": "private",
             "domainId": DOMAIN, "attributes": {"sourcePath": "src/persistence.mjs"}, "sourceFingerprint": "sha256:private"},
            {"id": OUTCOME_ID, "kind": "outcome", "name": "Order created", "visibility": "public",
             "domainId": DOMAIN, "attributes": {}, "sourceFingerprint": "sha256:outcome"},
            {"id": CONTRACT_ID, "kind": "integration", "name": "payments", "visibility": "external",
             "domainId": DOMAIN, "attributes": {}, "sourceFingerprint": "sha256:contract"}
        ],
        "edges": [{"id": "edge:public", "fromId": PUBLIC_ID, "toId": OUTCOME_ID, "kind": "produces",
                   "evidenceIds": ["e:public"]}],
        "claims": [
            {"id": "claim:implemented", "subjectId": PUBLIC_ID, "layer": "implemented", "predicate": "creates-order",
             "value": true, "evidenceIds": ["e:public"], "confidence": 1, "sourceFingerprint": "sha256:claim"},
            {"id": "claim:expected", "subjectId": PUBLIC_ID, "layer": "expected", "predicate": "creates-order",
             "value": true, "evidenceIds": ["e:public"], "confidence": 1, "sourceFingerprint": "sha256:expected"}
        ],
        "topics": [
            {"id": "process:orders", "kind": "process", "title": "submitOrder", "domainId": DOMAIN, "anchorIds": [PUBLIC_ID]},
            {"id": "contract:orders", "kind": "contract", "title": "payments", "domainId": DOMAIN, "anchorIds": [CONTRACT_ID]}
        ],
        "gaps": if with_gap {
            json!([{"id": "gap:expected", "status": "missing", "expectedClaimId": "claim:expected",
                    "implementedClaimIds": [], "evidenceIds": ["e:public"]}])
        } else {
            json!([])
        },
        "evidence": [{"id": "e:public", "kind": "code", "path": "src/orders.mjs", "symbolId": PUBLIC_ID,
                      "contentHash": "sha256:evidence"}]
    })
}

fn rendered(outcome: RenderOutcome) -> BTreeMap<String, String> {
    match outcome {
        RenderOutcome::Rendered(files) => files,
        RenderOutcome::Blocked(diagnostics) => panic!("несподівані блокери: {diagnostics:?}"),
    }
}

fn codes(outcome: RenderOutcome) -> Vec<String> {
    match outcome {
        RenderOutcome::Blocked(diagnostics) => {
            diagnostics.into_iter().map(|item| item.code).collect()
        }
        RenderOutcome::Rendered(files) => {
            panic!("очікувався блокер, отримано {:?}", files.keys())
        }
    }
}

fn empty_existing() -> BTreeMap<String, String> {
    BTreeMap::new()
}

#[test]
fn only_meaningful_views_plus_an_actionable_gaps_page_are_rendered() {
    let files = rendered(render_knowledge_artifacts(&graph(true), &empty_existing()));
    let paths: Vec<&String> = files.keys().collect();
    assert_eq!(
        paths,
        vec![
            "docs/.docgen/manifest.json",
            "docs/explanation/architecture.md",
            "docs/explanation/processes/dcfd264583ed8d3acfe0e103.md",
            "docs/implementation-gaps.md",
            "docs/index.md",
            "docs/reference/contracts/2e0b0c95a18292880dfd62a0.md"
        ]
    );
    assert!(files["docs/index.md"].contains("# Package knowledge: @fixture/orders"));
    assert!(files["docs/implementation-gaps.md"].contains("Status: missing"));
}

/// Порожніх дерев сторінок не буває: немає явної прогалини — немає й
/// сторінки прогалин.
#[test]
fn no_gaps_page_without_an_explicit_gap_and_the_output_is_deterministic() {
    let files = rendered(render_knowledge_artifacts(&graph(false), &empty_existing()));
    assert!(!files.contains_key("docs/implementation-gaps.md"));
    let expected: Vec<String> = fixtures()["noGapPaths"]
        .as_array()
        .expect("шляхи у фікстурі")
        .iter()
        .map(|item| item.as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(files.keys().cloned().collect::<Vec<_>>(), expected);

    let again = rendered(render_knowledge_artifacts(&graph(false), &empty_existing()));
    assert_eq!(files, again, "двічі той самий вхід — той самий байт");
}

/// Приватне імʼя не має зʼявитись у людському Markdown НІ В ЯКОМУ вигляді —
/// ні як назва символу, ні як ID.
#[test]
fn private_names_never_leak_into_human_markdown() {
    let files = rendered(render_knowledge_artifacts(&graph(true), &empty_existing()));
    for (path, content) in &files {
        if !path.ends_with(".md") {
            continue;
        }
        assert!(
            !content.contains("persistOrder"),
            "приватне імʼя просочилось у {path}"
        );
    }
    assert!(
        files["docs/.docgen/manifest.json"].contains("persistOrder"),
        "у машинному manifest воно, навпаки, МУСИТЬ бути — це traceability"
    );
}

/// Авторський файл оновлюється лише в оголошеній AUTOGEN-зоні; MANUAL і
/// текст поза зонами лишаються байт-у-байт.
#[test]
fn authored_pages_keep_their_manual_zones_and_only_autogen_is_updated() {
    let authored = format!(
        "# Authored\n\n<!-- MANUAL:start id=\"note\" -->keep me<!-- MANUAL:end id=\"note\" -->\n<!-- AUTOGEN:start id=\"package-index\" hash=\"{}\" -->old<!-- AUTOGEN:end id=\"package-index\" -->\n",
        zone_hash("old")
    );
    let existing = BTreeMap::from([("docs/index.md".to_string(), authored.clone())]);
    assert_eq!(
        authored,
        fixtures()["authoredInput"].as_str().unwrap_or_default(),
        "вхідний авторський файл той самий, що в JS-фікстурі"
    );

    let files = rendered(render_knowledge_artifacts(&graph(true), &existing));
    let index = &files["docs/index.md"];
    assert!(index.contains("# Authored"), "заголовок автора лишився");
    assert!(index.contains("keep me"), "MANUAL лишився недоторканим");
    assert!(!index.contains(">old<"), "AUTOGEN оновлено");
    assert_eq!(
        index,
        fixtures()["authoredIndex"].as_str().unwrap_or_default(),
        "оновлений авторський файл збігається з JS побайтово"
    );
}

/// Авторська сторінка БЕЗ оголошеної AUTOGEN-зони — це помилка, а не привід
/// перезаписати її цілком.
#[test]
fn an_authored_page_without_an_autogen_target_fails_closed() {
    let existing = BTreeMap::from([(
        "docs/index.md".to_string(),
        "# Authored without zone\n".to_string(),
    )]);
    assert_eq!(
        codes(render_knowledge_artifacts(&graph(true), &existing)),
        vec!["autogen-zone-required".to_string()]
    );
}

#[test]
fn a_graph_without_a_domain_is_rejected() {
    assert_eq!(
        codes(render_knowledge_artifacts(
            &json!({"nodes": []}),
            &empty_existing()
        )),
        vec!["invalid-render-graph".to_string()]
    );
}

/// Головна звірка: КОЖЕН згенерований файл побайтово дорівнює JS-виходу.
#[test]
fn every_rendered_file_matches_the_js_renderer_byte_for_byte() {
    let expected = fixtures();
    let expected_files = expected["base"].as_object().expect("файли у фікстурі");
    let files = rendered(render_knowledge_artifacts(&graph(true), &empty_existing()));

    assert_eq!(
        files.len(),
        expected_files.len(),
        "набір файлів: {:?} проти {:?}",
        files.keys().collect::<Vec<_>>(),
        expected_files.keys().collect::<Vec<_>>()
    );
    for (path, content) in &files {
        let reference = expected_files
            .get(path)
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("у JS-фікстурі немає файла {path}"));
        assert_eq!(content, reference, "вміст {path} розійшовся з JS");
    }
}

#[test]
fn the_blocking_diagnostics_match_the_js_renderer() {
    let existing = BTreeMap::from([(
        "docs/index.md".to_string(),
        "# Authored without zone\n".to_string(),
    )]);
    let reported = match render_knowledge_artifacts(&graph(true), &existing) {
        RenderOutcome::Blocked(diagnostics) => diagnostics
            .into_iter()
            .map(|item| json!({"code": item.code, "detail": item.detail, "path": item.path}))
            .collect::<Vec<_>>(),
        RenderOutcome::Rendered(_) => panic!("очікувався блокер"),
    };
    assert_eq!(Value::Array(reported), fixtures()["missingZone"]);
}
