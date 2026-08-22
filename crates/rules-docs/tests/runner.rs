//! Набір самодостатніх деталей оркестратора.
//!
//! JS-набір (`tests/runner.test.mjs`) перевіряє ці функції лише крізь увесь
//! конвеєр — вони не експортуються. Тому фікстура `fixtures/js-runner.json`
//! знята ІНАКШЕ: живий `buildPackageKnowledge` прогнано в Node із
//! перехоплювальними інʼєкціями, і з нього збережено рівно те, що
//! оркестратор передає далі — відбиток джерел, chunk-и claims разом із
//! їхніми промптами, приватний індекс evidence і реєстр захищених зон.
//! Тобто звіряється не переказ JS-логіки, а її фактичний вихід.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use rules_docs::canonical_json;
use rules_docs::gap_mappings::Mapping;
use rules_docs::planner::{plan_semantic_chunks, PlanOutcome, PlannerInput, SourceText};
use rules_docs::runner::{
    claims_chunks, domain_fingerprint, entailment_evidence_content_by_id, merge_gap_mappings,
    parser_version, protected_zones_from_pages, read_existing_markdown, read_previous_manifest,
    source_evidence_content_by_id, source_fingerprint, write_shadow_candidate, ParserProvenance,
};
use rules_docs::sources::SourceFile;
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("fixtures/js-runner.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("фікстура — валідний JSON")
}

fn sources_from(value: &Value) -> Vec<SourceFile> {
    value
        .as_array()
        .expect("джерела — масив")
        .iter()
        .map(|source| SourceFile {
            path: source["path"].as_str().expect("шлях").to_string(),
            content: source["content"].as_str().expect("вміст").to_string(),
        })
        .collect()
}

fn map_from(value: &Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .expect("індекс — обʼєкт")
        .iter()
        .map(|(id, content)| {
            (
                id.clone(),
                content.as_str().expect("вміст — рядок").to_string(),
            )
        })
        .collect()
}

/// Тимчасовий корінь домену для одного сценарію.
fn temp_root(label: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "rules-docs-runner-{}-{label}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("корінь створюється");
    root
}

/// Відбиток домену формує КАТАЛОГ кешу: розбіжність тут знецінила б кеш
/// усіх уже зібраних доменів, нічого при цьому не зламавши помітно.
#[test]
fn domain_fingerprint_matches_live_js() {
    let fixture = fixture();
    assert_eq!(
        domain_fingerprint(fixture["domainId"].as_str().expect("ідентичність")),
        fixture["domainFingerprint"].as_str().expect("відбиток"),
        "хешується `JSON.stringify(id)` — РАЗОМ із лапками"
    );
}

/// Відбиток джерел іде в `domain.sourceFingerprint`, а звідти — в маніфест
/// і в кожен вузол графа.
#[test]
fn source_fingerprint_matches_live_js() {
    let fixture = fixture();
    let sources = sources_from(&fixture["sources"]);
    assert_eq!(
        source_fingerprint(&sources),
        fixture["sourceFingerprint"].as_str().expect("відбиток")
    );
}

/// Порядок джерел на вхід не впливає: відбиток береться з упорядкованого
/// за шляхом списку.
#[test]
fn source_fingerprint_ignores_input_order() {
    let fixture = fixture();
    let mut sources = sources_from(&fixture["sources"]);
    sources.reverse();
    assert_eq!(
        source_fingerprint(&sources),
        fixture["sourceFingerprint"].as_str().expect("відбиток")
    );
}

#[test]
fn parser_version_matches_live_js() {
    let fixture = fixture();
    assert_eq!(
        parser_version(&[ParserProvenance {
            id: "fixture".to_string(),
            grammar_version: "1".to_string(),
            runtime_version: "1".to_string(),
        }]),
        fixture["parserVersion"].as_str().expect("версія")
    );
}

/// Кілька екстракторів дають ВІДСОРТОВАНИЙ перелік через кому — порядок
/// адаптерів не має міняти ключ кешу.
#[test]
fn parser_version_is_sorted_and_joined() {
    let provenance = |id: &str| ParserProvenance {
        id: id.to_string(),
        grammar_version: "1".to_string(),
        runtime_version: "2".to_string(),
    };
    assert_eq!(
        parser_version(&[provenance("zeta"), provenance("alpha")]),
        "alpha@1/2,zeta@1/2"
    );
}

/// Головна звірка зрізу: chunk-и claims разом із ПРОМПТАМИ.
///
/// План будує справжній Rust-планер на тому самому графі — тобто
/// порівнюється весь ланцюжок «граф → план → контракт claims», а не лише
/// остання функція. Промпт входить у ключ кешу, тож його байти — контракт.
#[test]
fn claims_chunks_match_live_js() {
    let fixture = fixture();
    let graph = &fixture["candidateGraph"];
    let sources: Vec<SourceText> = sources_from(&fixture["sources"])
        .into_iter()
        .map(|source| SourceText {
            path: source.path,
            content: source.content,
        })
        .collect();
    let planner_input = &fixture["plannerInput"];
    let plan = match plan_semantic_chunks(PlannerInput {
        graph,
        sources: &sources,
        max_tokens: rules_docs::planner::DEFAULT_MAX_TOKENS,
        max_reduce_inputs: rules_docs::planner::DEFAULT_REDUCE_INPUTS,
        required_node_ids: None,
        required_edge_ids: None,
        parser: planner_input["parser"].clone(),
        schema: planner_input["schema"].clone(),
        prompt: planner_input["prompt"].clone(),
        model_policy: planner_input["modelPolicy"].clone(),
    }) {
        PlanOutcome::Planned(plan) => *plan,
        PlanOutcome::Blocked(diagnostics) => panic!("план не побудувався: {diagnostics:#?}"),
    };
    assert_eq!(
        canonical_json(&serde_json::to_value(&plan.chunks).expect("план серіалізується")),
        canonical_json(&fixture["planChunks"]),
        "план розійшовся з JS ще до адаптера"
    );
    assert_eq!(
        canonical_json(&Value::Array(claims_chunks(&plan.chunks, graph))),
        canonical_json(&fixture["claimsChunks"])
    );
}

/// Приватний індекс evidence: рівно ті тексти, які побачить гейт
/// entailment, і жодного зайвого.
#[test]
fn entailment_evidence_index_matches_live_js() {
    let fixture = fixture();
    let sources = sources_from(&fixture["sources"]);
    let structured = map_from(&fixture["structuredEvidenceContentById"]);
    let expected: Vec<(String, String)> = fixture["expectedSources"]
        .as_array()
        .expect("очікування — масив")
        .iter()
        .map(|source| {
            (
                source["id"].as_str().expect("id").to_string(),
                source["content"].as_str().expect("вміст").to_string(),
            )
        })
        .collect();
    let indexed = entailment_evidence_content_by_id(
        &fixture["entailmentGraph"],
        &sources,
        &structured,
        &expected,
    );
    let actual: Value = indexed
        .into_iter()
        .map(|(id, content)| (id, Value::String(content)))
        .collect::<serde_json::Map<String, Value>>()
        .into();
    assert_eq!(
        canonical_json(&actual),
        canonical_json(&fixture["entailmentEvidenceContentById"])
    );
}

/// Реєстр захищених зон: сторінка знаходиться за токеном рендерера, а
/// AUTOGEN-зони до реєстру не потрапляють.
#[test]
fn protected_zones_match_live_js() {
    let fixture = fixture();
    let files = map_from(&fixture["existingFiles"]);
    let registry = protected_zones_from_pages(&files, Some(&fixture["previousManifest"]))
        .expect("зони розбираються");
    let actual: Value = registry
        .into_iter()
        .map(|(id, zones)| (id, Value::Array(zones)))
        .collect::<serde_json::Map<String, Value>>()
        .into();
    assert_eq!(
        canonical_json(&actual),
        canonical_json(&fixture["protectedZonesByTopicId"])
    );
}

/// Тема, чиєї сторінки на диску немає, просто не має зон — це перший
/// прогін теми, а не помилка.
#[test]
fn protected_zones_skip_topics_without_pages() {
    let manifest = json!({"topics": [{"id": "process:x:missing", "kind": "process"}]});
    let registry = protected_zones_from_pages(&BTreeMap::new(), Some(&manifest))
        .expect("відсутня сторінка не блокує");
    assert!(registry.is_empty());
}

/// Зламані маркери в наявній сторінці БЛОКУЮТЬ: інакше публікація
/// перезаписала б авторський текст, який не вдалося прочитати.
#[test]
fn protected_zones_block_on_broken_markers() {
    let topic_id = "process:npm:@fixture/orders:seed";
    let path = rules_docs::topic_page_path("process", topic_id).expect("вид має сторінку");
    let files: BTreeMap<String, String> = [(
        path,
        "<!-- MANUAL:start id=\"intro\" -->\nбез закриття\n".to_string(),
    )]
    .into_iter()
    .collect();
    let manifest = json!({"topics": [{"id": topic_id, "kind": "process"}]});
    let diagnostics =
        protected_zones_from_pages(&files, Some(&manifest)).expect_err("непарний маркер — блокер");
    assert!(!diagnostics.is_empty());
}

/// Evidence без span бере файл цілком, з невалідним span-ом — не
/// індексується взагалі. Мовчазний фолбек на весь файл підсунув би гейту
/// текст, якого доказ не називав.
#[test]
fn evidence_without_span_takes_the_file_and_broken_span_is_dropped() {
    let sources = vec![SourceFile {
        path: "src/a.mjs".to_string(),
        content: "abcdef".to_string(),
    }];
    let graph = json!({"evidence": [
        {"id": "evidence:whole", "path": "src/a.mjs"},
        {"id": "evidence:null-span", "path": "src/a.mjs", "span": null},
        {"id": "evidence:part", "path": "src/a.mjs", "span": {"startByte": 1, "endByte": 3}},
        {"id": "evidence:past-end", "path": "src/a.mjs", "span": {"startByte": 0, "endByte": 99}},
        {"id": "evidence:reversed", "path": "src/a.mjs", "span": {"startByte": 3, "endByte": 1}},
        {"id": "evidence:no-source", "path": "src/missing.mjs"}
    ]});
    let indexed = source_evidence_content_by_id(&graph, &sources);
    assert_eq!(
        indexed.get("evidence:whole").map(String::as_str),
        Some("abcdef")
    );
    assert_eq!(
        indexed.get("evidence:null-span").map(String::as_str),
        Some("abcdef"),
        "`span: null` — це відсутній span, а не зламаний"
    );
    assert_eq!(indexed.get("evidence:part").map(String::as_str), Some("bc"));
    assert!(!indexed.contains_key("evidence:past-end"));
    assert!(!indexed.contains_key("evidence:reversed"));
    assert!(!indexed.contains_key("evidence:no-source"));
}

/// Span, що ріже посеред символу, не індексується: у JS це доводить
/// зворотне кодування, у Rust — `str::from_utf8`.
#[test]
fn span_splitting_a_character_is_dropped() {
    let sources = vec![SourceFile {
        path: "src/a.mjs".to_string(),
        content: "їжак".to_string(),
    }];
    let graph = json!({"evidence": [
        {"id": "evidence:half", "path": "src/a.mjs", "span": {"startByte": 0, "endByte": 1}},
        {"id": "evidence:whole-char", "path": "src/a.mjs", "span": {"startByte": 0, "endByte": 2}}
    ]});
    let indexed = source_evidence_content_by_id(&graph, &sources);
    assert!(!indexed.contains_key("evidence:half"));
    assert_eq!(
        indexed.get("evidence:whole-char").map(String::as_str),
        Some("ї")
    );
}

fn mapping(expected: &str, implemented: &str, relation: &str, evidence: &[&str]) -> Mapping {
    Mapping {
        expected_claim_id: expected.to_string(),
        implemented_claim_id: implemented.to_string(),
        relation: relation.to_string(),
        evidence_ids: evidence.iter().map(|id| (*id).to_string()).collect(),
    }
}

#[test]
fn merges_and_orders_distinct_mappings() {
    let merged = merge_gap_mappings(
        &[mapping(
            "claim:e2",
            "claim:i2",
            "equivalent",
            &["evidence:b"],
        )],
        &[mapping(
            "claim:e1",
            "claim:i1",
            "contradicts",
            &["evidence:a"],
        )],
    )
    .expect("різні пари зливаються");
    let ids: Vec<&str> = merged
        .iter()
        .map(|mapping| mapping.expected_claim_id.as_str())
        .collect();
    assert_eq!(
        ids,
        ["claim:e1", "claim:e2"],
        "порядок стабільний, не вхідний"
    );
}

/// Дослівний повтор і розбіжний повтор однаково блокують — різняться лише
/// кодом, і саме код показує авторові, що саме сталося.
#[test]
fn duplicate_and_conflicting_mappings_are_told_apart() {
    let duplicate = merge_gap_mappings(
        &[mapping(
            "claim:e",
            "claim:i",
            "equivalent",
            &["evidence:b", "evidence:a"],
        )],
        &[mapping(
            "claim:e",
            "claim:i",
            "equivalent",
            &["evidence:a", "evidence:b"],
        )],
    )
    .expect_err("повтор блокує");
    assert_eq!(duplicate[0].code, "duplicate-gap-mapping");

    let conflicting = merge_gap_mappings(
        &[mapping("claim:e", "claim:i", "equivalent", &["evidence:a"])],
        &[mapping(
            "claim:e",
            "claim:i",
            "contradicts",
            &["evidence:a"],
        )],
    )
    .expect_err("конфлікт блокує");
    assert_eq!(conflicting[0].code, "conflicting-gap-mapping");

    let other_evidence = merge_gap_mappings(
        &[mapping("claim:e", "claim:i", "equivalent", &["evidence:a"])],
        &[mapping("claim:e", "claim:i", "equivalent", &["evidence:c"])],
    )
    .expect_err("той самий звʼязок з іншим доказом — теж конфлікт");
    assert_eq!(other_evidence[0].code, "conflicting-gap-mapping");
}

#[test]
fn reads_existing_markdown_recursively_and_skips_other_files() {
    let root = temp_root("markdown");
    std::fs::create_dir_all(root.join("docs/explanation/processes")).expect("тека");
    std::fs::write(root.join("docs/index.md"), "корінь").expect("запис");
    std::fs::write(root.join("docs/explanation/processes/a.md"), "тема").expect("запис");
    std::fs::write(root.join("docs/.docgen-manifest.json"), "{}").expect("запис");
    let files = read_existing_markdown(&root).expect("читається");
    let keys: Vec<&str> = files.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        ["docs/explanation/processes/a.md", "docs/index.md"],
        "лише .md, і ключі — шляхи відносно кореня домену"
    );
}

/// Відсутня тека `docs/` — це перший прогін, а не помилка.
#[test]
fn missing_docs_directory_reads_as_empty() {
    let root = temp_root("no-docs");
    assert!(read_existing_markdown(&root)
        .expect("не помилка")
        .is_empty());
}

#[test]
fn previous_manifest_reads_missing_valid_and_broken() {
    let root = temp_root("manifest");
    assert_eq!(
        read_previous_manifest(&root).expect("відсутній — не помилка"),
        None
    );

    std::fs::create_dir_all(root.join("docs/.docgen")).expect("тека");
    let path = root.join("docs/.docgen/manifest.json");
    std::fs::write(&path, r#"{"topics": []}"#).expect("запис");
    assert_eq!(
        read_previous_manifest(&root).expect("валідний читається"),
        Some(json!({"topics": []}))
    );

    std::fs::write(&path, "[]").expect("запис");
    let diagnostics = read_previous_manifest(&root).expect_err("масив — не маніфест");
    assert_eq!(diagnostics[0]["code"], json!("manifest-invalid"));

    std::fs::write(&path, "{").expect("запис");
    let diagnostics = read_previous_manifest(&root).expect_err("зламаний JSON блокує");
    assert_eq!(diagnostics[0]["code"], json!("manifest-read-failed"));
}

#[test]
fn shadow_candidate_writes_outside_the_repository() {
    let staging = temp_root("shadow");
    let files: BTreeMap<String, String> = [
        ("docs/index.md".to_string(), "індекс".to_string()),
        ("docs/.docgen/manifest.json".to_string(), "{}".to_string()),
    ]
    .into_iter()
    .collect();
    write_shadow_candidate(&staging, &files).expect("запис проходить");
    assert_eq!(
        std::fs::read_to_string(staging.join("docs/index.md")).expect("читається"),
        "індекс"
    );
    assert_eq!(
        std::fs::read_to_string(staging.join("docs/.docgen/manifest.json")).expect("читається"),
        "{}"
    );
}
