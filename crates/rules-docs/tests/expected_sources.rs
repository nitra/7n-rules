//! Дзеркальний набір джерел очікувань — сценарії з
//! `tests/expected-sources.test.mjs`, які належать САМЕ цьому модулю, плюс
//! диференційна звірка ідентичностей із живим JS.
//!
//! Чотири сценарії JS-набору сюди не переносяться: вони перевіряють мовні
//! екстрактори (`collectTestScenarios` для JS/Rust/PHP/Python), тобто
//! заблоковану слот-поверхню (§5.0.15 реєстру), а не цей модуль. Точка їх
//! підключення тут перевіряється інʼєкцією.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use llm_lib::attempt::BoxFuture;
use llm_lib::tiers::Tier;
use rules_docs::deterministic::{canonical_json, VersionedCache};
use rules_docs::expected_sources::{
    discover_expected_sources, map_expected_sources, DomainScope, Evidence, ExpectedSource,
    Extractor, MappingInput, MappingOutcome, Scenario, Span, TestFile,
};
use rules_docs::wave::{
    default_model_policy, new_chain, ChainRef, SubmitBatchFn, WaveItem, WaveResult,
};
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("fixtures/js-expected-sources.json");
const DOMAIN: &str = "npm:@fixture/orders";
const SUBJECT: &str = "code-unit:npm:@fixture/orders:js:submit";

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON")
}

fn temp_root(label: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "rules-docs-expected-{}-{label}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("корінь створюється");
    std::fs::canonicalize(&root).expect("корінь канонізується")
}

fn write(root: &Path, relative: &str, content: &str) {
    let target = root.join(relative);
    std::fs::create_dir_all(target.parent().expect("є батьківська тека")).expect("тека");
    std::fs::write(target, content).expect("запис фікстури");
}

/// Той самий набір документів, що в JS-фікстурі парності.
fn seed_docs(root: &Path) {
    write(
        root,
        "docs/index.md",
        "<!-- EXPECTED:start id=\"accept-order\" -->Order must be accepted.<!-- EXPECTED:end id=\"accept-order\" -->",
    );
    write(
        root,
        "docs/adr/accepted.md",
        &format!("<!-- PACKAGE-KNOWLEDGE:domain id=\"{DOMAIN}\" -->\n**Status:** Accepted\n\nUse accepted orders.\n"),
    );
    write(
        root,
        "docs/adr/draft.md",
        &format!("<!-- PACKAGE-KNOWLEDGE:domain id=\"{DOMAIN}\" -->\n**Status:** Proposed\n"),
    );
    write(
        root,
        "docs/specs/orders.md",
        &format!(
            "<!-- PACKAGE-KNOWLEDGE:domain id=\"{DOMAIN}\" -->\n# Orders\n\nOrders need review.\n"
        ),
    );
}

fn scope<'a>(root: &'a Path, excluded: &'a [String]) -> DomainScope<'a> {
    DomainScope {
        id: DOMAIN,
        root,
        excluded_source_roots: excluded,
    }
}

/// Джерело-фікстура мапінгу — те саме, що в JS.
fn source() -> ExpectedSource {
    ExpectedSource {
        id: "source:spec:orders".to_string(),
        evidence: Evidence {
            id: "evidence:expected:spec".to_string(),
            kind: "spec".to_string(),
            path: "docs/specs/orders.md".to_string(),
            // Без span — рівно як у JS-фікстурі: джерело, подане викликачем,
            // не зобовʼязане його мати.
            span: None,
            content_hash: "sha256:spec".to_string(),
        },
        content: "Orders must be accepted.".to_string(),
        anchor: "spec:orders".to_string(),
    }
}

fn graph() -> Value {
    json!({
        "domain": {"id": DOMAIN},
        "nodes": [{"id": SUBJECT}],
        "evidence": [{"id": "evidence:code"}]
    })
}

type Waves = Arc<Mutex<Vec<(Tier, Vec<String>)>>>;

/// Транспорт-двійник: відповідь будує колбек за `custom_id`.
fn fake_submit(
    respond: impl Fn(&str) -> Option<Result<String, String>> + Send + Sync + 'static,
) -> (SubmitBatchFn, Waves) {
    let waves: Waves = Arc::new(Mutex::new(Vec::new()));
    let waves_out = Arc::clone(&waves);
    let respond = Arc::new(respond);
    let submit: SubmitBatchFn = Arc::new(move |tier: Tier, items: Vec<WaveItem>, _chain| {
        waves.lock().unwrap().push((
            tier,
            items.iter().map(|item| item.custom_id.clone()).collect(),
        ));
        let respond = Arc::clone(&respond);
        let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            Ok(items
                .into_iter()
                .filter_map(|item| {
                    respond(&item.custom_id).map(|outcome| WaveResult {
                        custom_id: item.custom_id,
                        outcome,
                    })
                })
                .collect())
        });
        fut
    });
    (submit, waves_out)
}

fn valid_response() -> String {
    json!({"claims": [{
        "subjectId": SUBJECT,
        "predicate": "outcome",
        "value": "accepted",
        "evidenceIds": ["evidence:expected:spec"],
        "confidence": 1
    }]})
    .to_string()
}

fn input<'a>(
    graph: &'a Value,
    sources: &'a [ExpectedSource],
    submit: SubmitBatchFn,
    chain: &ChainRef,
) -> MappingInput<'a> {
    MappingInput {
        graph,
        sources,
        cache: None,
        cache_path: None,
        model_policy: default_model_policy(),
        submit,
        chain: Arc::clone(chain),
    }
}

fn mapped(outcome: MappingOutcome) -> (Vec<Value>, Vec<Value>, Value) {
    match outcome {
        MappingOutcome::Mapped { overlay, cache } => (overlay.claims, overlay.evidence, cache),
        MappingOutcome::Blocked { diagnostics, .. } => {
            panic!("несподівані блокери: {diagnostics:?}")
        }
    }
}

fn codes(outcome: MappingOutcome) -> Vec<String> {
    match outcome {
        MappingOutcome::Blocked { diagnostics, .. } => {
            diagnostics.into_iter().map(|item| item.code).collect()
        }
        MappingOutcome::Mapped { overlay, .. } => {
            panic!("очікувався блокер, отримано {:?}", overlay.claims)
        }
    }
}

/// Збираються ЛИШЕ явні джерела: `EXPECTED`-зона, ADR зі статусом Accepted і
/// спека з маркером домену. Чернетка ADR очікуванням не стає.
#[test]
fn only_explicit_sources_are_collected_in_stable_order() {
    let root = temp_root("discovery");
    seed_docs(&root);
    let excluded: Vec<String> = Vec::new();

    let sources = discover_expected_sources(&root, &scope(&root, &excluded), &[], &[])
        .expect("пошук не падає");
    let kinds: Vec<&str> = sources
        .iter()
        .map(|source| source.evidence.kind.as_str())
        .collect();
    assert_eq!(
        kinds,
        vec!["adr", "spec", "manual"],
        "порядок стабільний за id джерела, не за теками"
    );
    assert!(
        !sources
            .iter()
            .any(|source| source.evidence.path.contains("draft")),
        "неприйнятий ADR — ще не рішення, тож і не очікування"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Точка підключення мовних парсерів перевіряється інʼєкцією: живі збирачі —
/// заблокована слот-поверхня.
#[test]
fn injected_scenario_collectors_produce_test_sources() {
    let root = temp_root("scenarios");
    let excluded: Vec<String> = Vec::new();
    let collector: rules_docs::expected_sources::ScenarioCollector = Arc::new(|file: &TestFile| {
        Ok(vec![Scenario {
            content: file.content.clone(),
            span: Span {
                start_byte: 0,
                end_byte: file.content.len(),
            },
            anchor: "test:accepts an order".to_string(),
        }])
    });
    let extractors = vec![Extractor {
        extensions: vec![".mjs".to_string()],
        collect: collector,
    }];
    let files = vec![TestFile {
        path: "tests/orders.test.mjs".to_string(),
        content: "test('accepts an order', () => {})".to_string(),
    }];

    let sources = discover_expected_sources(&root, &scope(&root, &excluded), &extractors, &files)
        .expect("пошук не падає");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].evidence.kind, "test");
    assert_eq!(sources[0].evidence.path, "tests/orders.test.mjs");

    // Тест без відповідного парсера — це прогалина в інструментах, а не
    // «нема очікувань».
    let orphan = vec![TestFile {
        path: "tests/orders.py".to_string(),
        content: "def test_x(): assert True".to_string(),
    }];
    let diagnostics = discover_expected_sources(&root, &scope(&root, &excluded), &[], &orphan)
        .expect_err("парсера немає");
    assert_eq!(
        diagnostics
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>(),
        vec!["expected-test-parser-missing"]
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_ambiguous_domain_scope_blocks_discovery() {
    let root = temp_root("ambiguous");
    write(
        &root,
        "docs/specs/two.md",
        &format!(
            "<!-- PACKAGE-KNOWLEDGE:domain id=\"{DOMAIN}\" -->\n<!-- PACKAGE-KNOWLEDGE:domain id=\"npm:other\" -->\n"
        ),
    );
    write(
        &root,
        "docs/specs/broken.md",
        "<!-- PACKAGE-KNOWLEDGE:domain -->\n",
    );
    let excluded: Vec<String> = Vec::new();

    let diagnostics = discover_expected_sources(&root, &scope(&root, &excluded), &[], &[])
        .expect_err("scope зламано");
    let reported: Vec<&str> = diagnostics.iter().map(|item| item.code.as_str()).collect();
    assert!(reported.contains(&"ambiguous-expected-source-scope"));
    assert!(reported.contains(&"invalid-expected-source-scope"));
    let _ = std::fs::remove_dir_all(&root);
}

/// Домен без явних очікувань не платить за прогін моделі.
#[tokio::test]
async fn no_sources_means_an_empty_overlay_and_no_model_call() {
    let graph = graph();
    let chain = new_chain("test", "expected");
    let (never, waves) = fake_submit(|_| panic!("транспорт не мав викликатись"));
    let outcome = map_expected_sources(input(&graph, &[], never, &chain))
        .await
        .expect("мапінг не падає");

    let (claims, evidence, _) = mapped(outcome);
    assert!(claims.is_empty());
    assert!(evidence.is_empty());
    assert!(waves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_source_maps_once_and_the_verdict_is_then_cached() {
    let graph = graph();
    let sources = vec![source()];
    let chain = new_chain("test", "expected");
    let (submit, waves) = fake_submit(|_| Some(Ok(valid_response())));

    let mut first = input(&graph, &sources, submit, &chain);
    first.cache = Some(VersionedCache::empty(1));
    let (claims, evidence, cache) =
        mapped(map_expected_sources(first).await.expect("перший прогін"));
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0]["subjectId"], json!(SUBJECT));
    assert_eq!(evidence.len(), 1);
    assert_eq!(evidence[0]["id"], json!("evidence:expected:spec"));
    assert_eq!(waves.lock().unwrap()[0].0, Tier::Local);

    let mut warmed = VersionedCache::empty(1);
    for (key, value) in cache["entries"].as_object().expect("кеш має entries") {
        warmed.entries.insert(key.clone(), value.clone());
    }
    let (never, never_waves) = fake_submit(|_| panic!("транспорт не мав викликатись"));
    let mut second = input(&graph, &sources, never, &chain);
    second.cache = Some(warmed);
    let (cached_claims, _, _) = mapped(map_expected_sources(second).await.expect("другий прогін"));
    assert_eq!(cached_claims, claims);
    assert!(never_waves.lock().unwrap().is_empty());
}

/// Невідомий вузол, чуже evidence або предикат поза таксономією — усе це
/// відмова: очікування без підстави в графі не має права існувати.
#[tokio::test]
async fn unknown_references_and_arbitrary_predicates_are_rejected() {
    let graph = graph();
    let sources = vec![source()];
    let chain = new_chain("test", "expected");

    let unknown_subject = json!({"claims": [{
        "subjectId": "code-unit:unknown", "predicate": "outcome", "value": true,
        "evidenceIds": ["evidence:expected:spec"], "confidence": 1
    }]})
    .to_string();
    let arbitrary_predicate = json!({"claims": [{
        "subjectId": SUBJECT, "predicate": "arbitrary-relation", "value": true,
        "evidenceIds": ["evidence:expected:spec"], "confidence": 1
    }]})
    .to_string();
    let without_source_evidence = json!({"claims": [{
        "subjectId": SUBJECT, "predicate": "outcome", "value": true,
        "evidenceIds": ["evidence:code"], "confidence": 1
    }]})
    .to_string();

    for (label, payload) in [
        ("невідомий вузол", unknown_subject),
        ("предикат поза таксономією", arbitrary_predicate),
        ("без evidence самого джерела", without_source_evidence),
    ] {
        let (submit, _) = fake_submit(move |_| Some(Ok(payload.clone())));
        let outcome = map_expected_sources(input(&graph, &sources, submit, &chain))
            .await
            .expect("мапінг не падає");
        assert_eq!(
            codes(outcome),
            vec!["unknown-expected-mapping-reference".to_string()],
            "сценарій «{label}» мав заблокувати"
        );
    }
}

#[tokio::test]
async fn an_invalid_graph_and_policy_are_rejected() {
    let sources = vec![source()];
    let chain = new_chain("test", "expected");
    let empty_graph = json!({});
    let (submit, _) = fake_submit(|_| Some(Ok(valid_response())));
    assert_eq!(
        codes(
            map_expected_sources(input(&empty_graph, &sources, Arc::clone(&submit), &chain))
                .await
                .expect("мапінг не падає")
        ),
        vec!["invalid-expected-source-graph".to_string()]
    );

    let graph = graph();
    let mut narrow = input(&graph, &sources, submit, &chain);
    narrow.model_policy = vec![Tier::Local];
    assert_eq!(
        codes(map_expected_sources(narrow).await.expect("мапінг не падає")),
        vec!["invalid-expected-model-policy".to_string()]
    );
}

/// Диференційна звірка ідентичностей із живим JS: `source:expected:*`,
/// `evidence:expected:*`, `claim:expected:*` і `sourceFingerprint` — усе це
/// хеші, тож дрейф формули тихо роздвоїв би очікування між прогонами.
#[tokio::test]
async fn identities_match_the_live_js_implementation() {
    let expected = fixtures();
    let root = temp_root("parity");
    seed_docs(&root);
    let excluded: Vec<String> = Vec::new();

    let discovered = discover_expected_sources(&root, &scope(&root, &excluded), &[], &[])
        .expect("пошук не падає");
    let reference = expected["discovered"]["sources"]
        .as_array()
        .expect("джерела у фікстурі");
    assert_eq!(discovered.len(), reference.len());
    for (source, expected_source) in discovered.iter().zip(reference) {
        assert_eq!(
            source.id,
            expected_source["id"].as_str().unwrap_or_default()
        );
        assert_eq!(
            source.evidence.id,
            expected_source["evidence"]["id"]
                .as_str()
                .unwrap_or_default()
        );
        assert_eq!(
            source.evidence.content_hash,
            expected_source["evidence"]["contentHash"]
                .as_str()
                .unwrap_or_default()
        );
        assert_eq!(
            source.evidence.span.map_or(Value::Null, |span| json!({
                "startByte": span.start_byte,
                "endByte": span.end_byte
            })),
            expected_source["evidence"]["span"],
            "байтовий span {} розійшовся",
            source.evidence.path
        );
    }
    let _ = std::fs::remove_dir_all(&root);

    let graph = graph();
    let sources = vec![source()];
    let chain = new_chain("test", "expected");
    let (submit, _) = fake_submit(|_| Some(Ok(valid_response())));
    let mut request = input(&graph, &sources, submit, &chain);
    request.cache = Some(VersionedCache::empty(1));
    let (claims, evidence, _) = mapped(map_expected_sources(request).await.expect("мапінг"));

    // Порівняння канонічним JSON, а не `Value`: `confidence` — f64, і
    // `serde_json` розрізняє `1.0` та `1`, тоді як `JSON.stringify` пише ціле
    // без дробової частини. Наш писемник цю семантику вже відтворює.
    let expected_overlay = &expected["mapped"]["overlay"];
    assert_eq!(
        canonical_json(&Value::Array(claims)),
        canonical_json(&expected_overlay["claims"])
    );
    assert_eq!(
        canonical_json(&Value::Array(evidence)),
        canonical_json(&expected_overlay["evidence"])
    );
}

/// Кеш-ключ не має залежати від порядку колекцій графа.
#[tokio::test]
async fn the_cache_key_is_stable_across_collection_order() {
    let chain = new_chain("test", "expected");
    let sources = vec![source()];
    let straight = json!({
        "domain": {"id": DOMAIN},
        "nodes": [{"id": SUBJECT}, {"id": "code-unit:other"}],
        "evidence": [{"id": "evidence:code"}, {"id": "evidence:more"}]
    });
    let reversed = json!({
        "domain": {"id": DOMAIN},
        "nodes": [{"id": "code-unit:other"}, {"id": SUBJECT}],
        "evidence": [{"id": "evidence:more"}, {"id": "evidence:code"}]
    });

    let run = |graph: Value| {
        let chain = Arc::clone(&chain);
        let sources = sources.clone();
        async move {
            let (submit, _) = fake_submit(|_| Some(Ok(valid_response())));
            let mut request = MappingInput {
                graph: &graph,
                sources: &sources,
                cache: Some(VersionedCache::empty(1)),
                cache_path: None,
                model_policy: default_model_policy(),
                submit,
                chain,
            };
            request.cache = Some(VersionedCache::empty(1));
            let (_, _, cache) = mapped(map_expected_sources(request).await.expect("мапінг"));
            cache["entries"]
                .as_object()
                .expect("кеш")
                .keys()
                .cloned()
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(run(straight).await, run(reversed).await);
}
