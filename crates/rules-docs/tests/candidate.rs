//! Дзеркало `npm/rules/doc-files/package_knowledge/tests/candidate.test.mjs`
//! — сценарій у сценарій, плюс випадки, яких JS-набір не має, бо в JS вони
//! неможливі або невиразні (конфлікт розширень, небезпечний шлях, dotfile).

use std::cell::RefCell;

use rules_docs::candidate::{
    build_knowledge_candidate, CandidateInput, CandidateOutcome, ExtractorFile, KnowledgeExtractor,
    ParserProvenance,
};
use rules_docs::expected_sources::{Diagnostic as ExpectedDiagnostic, Scenario, TestFile};
use rules_docs::graph::Domain;
use rules_docs::sources::SourceFile;
use serde_json::{json, Value};

fn domain() -> Domain {
    Domain {
        id: "npm:@fixture/orders".to_string(),
        ecosystem: Some("npm".to_string()),
        name: Some("@fixture/orders".to_string()),
        root_manifest: Some("package.json".to_string()),
        source_fingerprint: Some("sha256:domain".to_string()),
    }
}

/// Екстрактор із повним покриттям — дзеркало JS-фікстури `extractor()`.
///
/// Записує шляхи в порядку викликів: саме цей порядок перевіряє перший
/// сценарій JS-набору (`mock.calls.map(...)`).
struct Fixture {
    calls: RefCell<Vec<String>>,
    /// Що робити замість штатного розбору.
    behavior: Behavior,
}

enum Behavior {
    Complete,
    /// `coverage.complete = false` — дефект ловить фінальний гейт.
    IncompleteCoverage,
    /// Падіння екстрактора — гілка `catch` у JS.
    Throws,
    /// Структурована невдача без жодної діагностики.
    FailsSilently,
    /// Не обʼєкт.
    NotAnObject,
}

impl Fixture {
    fn new(behavior: Behavior) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            behavior,
        }
    }
}

impl KnowledgeExtractor for Fixture {
    fn extensions(&self) -> Vec<String> {
        vec![".mjs".to_string()]
    }

    fn parser(&self) -> ParserProvenance {
        ParserProvenance {
            id: "fixture".to_string(),
            grammar_version: "1".to_string(),
            runtime_version: "1".to_string(),
        }
    }

    fn collect_test_scenarios(
        &self,
        _file: &TestFile,
    ) -> Result<Vec<Scenario>, Vec<ExpectedDiagnostic>> {
        Ok(Vec::new())
    }

    fn analyze_file(&self, _domain: &Domain, file: &ExtractorFile) -> Result<Value, String> {
        self.calls.borrow_mut().push(file.path.clone());
        match self.behavior {
            Behavior::Throws => return Err("parse crash".to_string()),
            Behavior::NotAnObject => return Ok(Value::String("fragment".to_string())),
            Behavior::FailsSilently => return Ok(json!({ "ok": false })),
            _ => {}
        }
        let complete = !matches!(self.behavior, Behavior::IncompleteCoverage);
        Ok(json!({
            "ok": true,
            "file": { "path": file.path, "language": "js", "contentHash": file.content_hash },
            "units": [{
                "localId": "submit",
                "qualifiedPath": format!("{}#submit", file.path),
                "kind": "function",
                "name": "submit",
                "visibility": "public",
                "span": { "startByte": 0, "endByte": 6 }
            }],
            "edges": [],
            "coverage": {
                "requiredUnits": 1,
                "coveredUnits": 1,
                "requiredEdges": 0,
                "coveredEdges": 0,
                "complete": complete
            }
        }))
    }
}

fn source(path: &str) -> SourceFile {
    SourceFile {
        path: path.to_string(),
        content: "export function submit() {}".to_string(),
    }
}

/// Вхід із типовими значеннями всіх необовʼязкових полів — рівно ті, що їх
/// JS задає в деструктуризації.
fn input<'a>(
    domain: &'a Domain,
    sources: &'a [SourceFile],
    extractors: &'a [&'a dyn KnowledgeExtractor],
    empty: &'a Value,
) -> CandidateInput<'a> {
    CandidateInput {
        domain,
        sources,
        extractors,
        structured_fragments: &[],
        expected_overlay: empty,
        gap_mappings: &[],
        aliases_by_topic_id: empty,
        previous_manifest: None,
        protected_zones_by_topic_id: None,
        minimum_gap_confidence: 1.0,
    }
}

fn built(outcome: CandidateOutcome) -> rules_docs::candidate::Candidate {
    match outcome {
        CandidateOutcome::Built(candidate) => *candidate,
        CandidateOutcome::Blocked(diagnostics) => {
            panic!("очікували кандидат, отримали блокери: {diagnostics:#?}")
        }
    }
}

fn blocked(outcome: CandidateOutcome) -> Vec<Value> {
    match outcome {
        CandidateOutcome::Blocked(diagnostics) => diagnostics,
        CandidateOutcome::Built(_) => panic!("очікували блокери, отримали кандидат"),
    }
}

fn codes(diagnostics: &[Value]) -> Vec<&str> {
    diagnostics
        .iter()
        .filter_map(|item| item.get("code").and_then(Value::as_str))
        .collect()
}

#[test]
fn builds_a_complete_graph_in_stable_source_order() {
    let domain = domain();
    let empty = json!({});
    let extractor = Fixture::new(Behavior::Complete);
    let sources = [source("src/z.mjs"), source("src/a.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let candidate = built(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));

    assert_eq!(
        extractor.calls.borrow().as_slice(),
        ["src/a.mjs", "src/z.mjs"],
        "порядок викликів екстрактора стабільний і НЕ залежить від порядку входу"
    );
    assert_eq!(candidate.graph["topics"].as_array().map(Vec::len), Some(2));
    assert_eq!(candidate.graph["gaps"], json!([]));
}

#[test]
fn applies_explicit_expectations_and_deterministic_gaps() {
    let domain = domain();
    let empty = json!({});
    let overlay = json!({
        "evidence": [{
            "id": "evidence:expected",
            "kind": "spec",
            "path": "docs/spec.md",
            "contentHash": "sha256:expected"
        }],
        "claims": [{
            "id": "claim:expected-submit",
            "subjectId": "code-unit:npm:@fixture/orders:js:src/order.mjs#submit",
            "predicate": "produces",
            "value": "order",
            "evidenceIds": ["evidence:expected"],
            "confidence": 1,
            "sourceFingerprint": "sha256:expected"
        }]
    });
    let extractor = Fixture::new(Behavior::Complete);
    let sources = [source("src/order.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let candidate = built(build_knowledge_candidate(CandidateInput {
        expected_overlay: &overlay,
        ..input(&domain, &sources, &extractors, &empty)
    }));

    let gaps = candidate.graph["gaps"].as_array().expect("gaps — масив");
    assert_eq!(gaps.len(), 1);
    assert_eq!(gaps[0]["expectedClaimId"], json!("claim:expected-submit"));
    assert_eq!(
        gaps[0]["status"],
        json!("missing"),
        "очікування без жодного звʼязку — саме прогалина, а не невизначеність"
    );
}

#[test]
fn merges_injected_structured_fragments_before_graph_validation() {
    use rules_docs::structured_sources::Fragment;

    let domain = domain();
    let empty = json!({});
    let config_id = "config:npm:@fixture/orders:package";
    let schema_id = "schema:npm:@fixture/orders:openapi";
    let contract_id = "contract:npm:@fixture/orders:openapi";
    let evidence_id = "evidence:openapi";
    let claim_id = rules_docs::claims::create_implemented_claim_id(
        &domain.id,
        schema_id,
        "declares-artifact",
        &json!({ "artifact": "openapi", "format": "yaml" }),
        &[evidence_id.to_string()],
    );
    let fragments = [Fragment {
        path: "contracts/openapi.yaml".to_string(),
        content_hash: "sha256:openapi".to_string(),
        nodes: vec![
            json!({
                "id": config_id,
                "kind": "config",
                "name": "package.json",
                "visibility": "package",
                "domainId": domain.id,
                "attributes": { "sourcePath": "package.json" },
                "sourceFingerprint": "sha256:package"
            }),
            json!({
                "id": schema_id,
                "kind": "config",
                "name": "Orders schema",
                "visibility": "public",
                "domainId": domain.id,
                "attributes": { "sourcePath": "contracts/openapi.yaml", "artifact": "schema" },
                "sourceFingerprint": "sha256:openapi"
            }),
            json!({
                "id": contract_id,
                "kind": "integration",
                "name": "Orders API",
                "visibility": "external",
                "domainId": domain.id,
                "attributes": { "sourcePath": "contracts/openapi.yaml", "boundary": "contract" },
                "sourceFingerprint": "sha256:openapi"
            }),
        ],
        edges: vec![json!({
            "id": "edge:openapi",
            "kind": "implements",
            "fromId": schema_id,
            "toId": contract_id,
            "evidenceIds": [evidence_id]
        })],
        evidence: vec![json!({
            "id": evidence_id,
            "kind": "schema",
            "path": "contracts/openapi.yaml",
            "symbolId": schema_id,
            "contentHash": "sha256:openapi"
        })],
        claims: vec![json!({
            "id": claim_id,
            "subjectId": schema_id,
            "layer": "implemented",
            "predicate": "declares-artifact",
            "value": { "artifact": "openapi", "format": "yaml" },
            "evidenceIds": [evidence_id],
            "confidence": 1,
            "sourceFingerprint": "sha256:openapi"
        })],
    }];
    let extractor = Fixture::new(Behavior::Complete);
    let sources = [source("src/order.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let candidate = built(build_knowledge_candidate(CandidateInput {
        structured_fragments: &fragments,
        ..input(&domain, &sources, &extractors, &empty)
    }));

    let node_ids: Vec<&str> = candidate.graph["nodes"]
        .as_array()
        .expect("nodes — масив")
        .iter()
        .filter_map(|node| node["id"].as_str())
        .collect();
    assert!(node_ids.contains(&config_id));
    assert!(node_ids.contains(&schema_id));
    assert!(node_ids.contains(&contract_id));
    assert!(candidate.graph["evidence"]
        .as_array()
        .expect("evidence — масив")
        .iter()
        .any(|item| item["id"] == json!(evidence_id)));
    assert!(candidate.graph["claims"]
        .as_array()
        .expect("claims — масив")
        .iter()
        .any(|item| item["id"] == json!(claim_id) && item["layer"] == json!("implemented")));
    assert!(
        candidate.graph["topics"]
            .as_array()
            .expect("topics — масив")
            .iter()
            .any(|topic| topic["kind"] == json!("contract")
                && topic["anchorIds"] == json!([contract_id])),
        "контрактний вузол дає власну тему, а не розчиняється в процесній"
    );
}

#[test]
fn integrates_previous_manifest_identity_migration() {
    let domain = domain();
    let empty = json!({});
    let first_extractor = Fixture::new(Behavior::Complete);
    let first_sources = [source("src/orders.mjs")];
    let first_extractors: [&dyn KnowledgeExtractor; 1] = [&first_extractor];
    let previous = built(build_knowledge_candidate(input(
        &domain,
        &first_sources,
        &first_extractors,
        &empty,
    )));

    let extractor = Fixture::new(Behavior::Complete);
    let sources = [source("src/flows/orders.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let candidate = built(build_knowledge_candidate(CandidateInput {
        previous_manifest: Some(&previous.graph),
        ..input(&domain, &sources, &extractors, &empty)
    }));

    let topics = candidate.graph["topics"].as_array().expect("topics");
    assert_eq!(topics.len(), 1);
    assert_eq!(
        topics[0]["id"], previous.graph["topics"][0]["id"],
        "переміщення файла не має міняти канонічний ID теми"
    );
    assert_eq!(candidate.migration_plan.status, "resolved");
}

#[test]
fn blocks_missing_extractor_and_thrown_parser_without_partial_graph() {
    let domain = domain();
    let empty = json!({});
    let extractor = Fixture::new(Behavior::Complete);
    let sources = [source("src/order.py")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let missing = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert_eq!(codes(&missing), ["extractor-missing"]);
    assert_eq!(missing[0]["path"], json!("src/order.py"));

    let thrower = Fixture::new(Behavior::Throws);
    let sources = [source("src/order.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&thrower];
    let thrown = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert_eq!(codes(&thrown), ["extractor-threw"]);
    assert_eq!(thrown[0]["path"], json!("src/order.mjs"));
    assert_eq!(thrown[0]["detail"], json!("parse crash"));
}

#[test]
fn blocks_incomplete_extractor_coverage_at_the_final_gate() {
    let domain = domain();
    let empty = json!({});
    let extractor = Fixture::new(Behavior::IncompleteCoverage);
    let sources = [source("src/order.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let diagnostics = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert!(
        codes(&diagnostics).contains(&"coverage-incomplete"),
        "неповне покриття ловить ФІНАЛЬНИЙ гейт, а не сам екстрактор: {diagnostics:#?}"
    );
}

#[test]
fn structured_failure_without_diagnostics_still_blocks() {
    let domain = domain();
    let empty = json!({});
    let extractor = Fixture::new(Behavior::FailsSilently);
    let sources = [source("src/order.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let diagnostics = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert_eq!(codes(&diagnostics), ["extractor-failed"]);
}

#[test]
fn non_object_fragment_blocks() {
    let domain = domain();
    let empty = json!({});
    let extractor = Fixture::new(Behavior::NotAnObject);
    let sources = [source("src/order.mjs")];
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let diagnostics = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert_eq!(codes(&diagnostics), ["extractor-result-invalid"]);
}

#[test]
fn unsafe_and_duplicate_source_paths_block_before_any_extraction() {
    let domain = domain();
    let empty = json!({});
    let extractor = Fixture::new(Behavior::Complete);
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let sources = [
        source("/abs/order.mjs"),
        source("src/../order.mjs"),
        source("src/order.mjs"),
        source("src/order.mjs"),
    ];
    let diagnostics = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert_eq!(
        codes(&diagnostics),
        ["invalid-source", "invalid-source", "duplicate-source-path"]
    );
    assert!(
        extractor.calls.borrow().is_empty(),
        "жоден екстрактор не запускається, поки вхід не визнано безпечним"
    );
}

/// Два екстрактори на одне розширення — власника не обирає ніхто.
#[test]
fn duplicate_extension_ownership_blocks() {
    let domain = domain();
    let empty = json!({});
    let first = Fixture::new(Behavior::Complete);
    let second = Fixture::new(Behavior::Complete);
    let extractors: [&dyn KnowledgeExtractor; 2] = [&first, &second];
    let sources = [source("src/order.mjs")];
    let diagnostics = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert_eq!(codes(&diagnostics), ["duplicate-extractor-extension"]);
}

/// Dotfile не має розширення — діагностика називає ШЛЯХ, а не порожній
/// рядок (`extname('.bashrc') === ''` у Node).
#[test]
fn dotfile_reports_the_path_not_an_empty_extension() {
    let domain = domain();
    let empty = json!({});
    let extractor = Fixture::new(Behavior::Complete);
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let sources = [SourceFile {
        path: "src/.bashrc".to_string(),
        content: "export PS1=x".to_string(),
    }];
    let diagnostics = blocked(build_knowledge_candidate(input(
        &domain,
        &sources,
        &extractors,
        &empty,
    )));
    assert_eq!(codes(&diagnostics), ["extractor-missing"]);
    assert_eq!(
        diagnostics[0]["detail"],
        json!("Немає knowledge extractor для src/.bashrc.")
    );
}

#[test]
fn empty_domain_id_blocks() {
    let domain = Domain {
        id: String::new(),
        ..domain()
    };
    let empty = json!({});
    let extractor = Fixture::new(Behavior::Complete);
    let extractors: [&dyn KnowledgeExtractor; 1] = [&extractor];
    let diagnostics = blocked(build_knowledge_candidate(input(
        &domain,
        &[],
        &extractors,
        &empty,
    )));
    assert_eq!(codes(&diagnostics), ["invalid-domain"]);
}

// ─── Диференційна звірка з живим JS ──────────────────────────────────────
//
// `fixtures/js-candidate.json` — дослівний вихід `buildKnowledgeCandidate`
// на тих самих тринадцятьох входах, знятий із Node. Порівнюється ВЕСЬ зріз
// результату: граф, фрагменти екстрактора, план міграції — або повний
// список діагностик разом із їхніми полями. Порівняння через канонічний
// JSON, а не через `Value`: інакше `1` проти `1.0` дало б хибний розбіг
// там, де JS обидва друкує однаково.

const FIXTURES: &str = include_str!("fixtures/js-candidate.json");

/// План міграції у формі JS.
fn plan_to_value(plan: &rules_docs::identity::MigrationPlan) -> Value {
    json!({
        "status": plan.status,
        "mappings": plan.mappings.iter().map(|mapping| json!({
            "fromTopicId": mapping.from_topic_id,
            "toTopicId": mapping.to_topic_id,
            "score": mapping.score,
            "reason": mapping.reason,
        })).collect::<Vec<Value>>(),
    })
}

/// Той самий зріз результату, що його знімає генератор фікстури.
fn shape(outcome: CandidateOutcome) -> Value {
    match outcome {
        CandidateOutcome::Built(candidate) => json!({
            "ok": true,
            "graph": candidate.graph,
            "fragments": candidate.fragments,
            "migrationPlan": plan_to_value(&candidate.migration_plan),
        }),
        CandidateOutcome::Blocked(diagnostics) => {
            json!({ "ok": false, "diagnostics": diagnostics })
        }
    }
}

/// Прогін одного іменованого сценарію — імена ті самі, що ключі фікстури.
fn scenario(name: &str) -> Value {
    let domain = domain();
    let empty = json!({});
    let complete = Fixture::new(Behavior::Complete);
    let single = [source("src/order.mjs")];
    let one: [&dyn KnowledgeExtractor; 1] = [&complete];
    match name {
        "stable-order" => {
            let sources = [source("src/z.mjs"), source("src/a.mjs")];
            shape(build_knowledge_candidate(input(
                &domain, &sources, &one, &empty,
            )))
        }
        "expected-overlay" => {
            let overlay = json!({
                "evidence": [{
                    "id": "evidence:expected", "kind": "spec",
                    "path": "docs/spec.md", "contentHash": "sha256:expected"
                }],
                "claims": [{
                    "id": "claim:expected-submit",
                    "subjectId": "code-unit:npm:@fixture/orders:js:src/order.mjs#submit",
                    "predicate": "produces", "value": "order",
                    "evidenceIds": ["evidence:expected"], "confidence": 1,
                    "sourceFingerprint": "sha256:expected"
                }]
            });
            shape(build_knowledge_candidate(CandidateInput {
                expected_overlay: &overlay,
                ..input(&domain, &single, &one, &empty)
            }))
        }
        "structured-fragments" => {
            let fragments = [structured_fragment(&domain.id)];
            shape(build_knowledge_candidate(CandidateInput {
                structured_fragments: &fragments,
                ..input(&domain, &single, &one, &empty)
            }))
        }
        "previous-manifest" => {
            let first = Fixture::new(Behavior::Complete);
            let first_extractors: [&dyn KnowledgeExtractor; 1] = [&first];
            let first_sources = [source("src/orders.mjs")];
            let previous = built(build_knowledge_candidate(input(
                &domain,
                &first_sources,
                &first_extractors,
                &empty,
            )));
            let sources = [source("src/flows/orders.mjs")];
            shape(build_knowledge_candidate(CandidateInput {
                previous_manifest: Some(&previous.graph),
                ..input(&domain, &sources, &one, &empty)
            }))
        }
        "extractor-missing" => {
            let sources = [SourceFile {
                path: "src/order.py".to_string(),
                content: "def submit(): pass".to_string(),
            }];
            shape(build_knowledge_candidate(input(
                &domain, &sources, &one, &empty,
            )))
        }
        "extractor-threw"
        | "extractor-failed"
        | "extractor-result-invalid"
        | "incomplete-coverage" => {
            let behavior = match name {
                "extractor-threw" => Behavior::Throws,
                "extractor-failed" => Behavior::FailsSilently,
                "extractor-result-invalid" => Behavior::NotAnObject,
                _ => Behavior::IncompleteCoverage,
            };
            let broken = Fixture::new(behavior);
            let extractors: [&dyn KnowledgeExtractor; 1] = [&broken];
            shape(build_knowledge_candidate(input(
                &domain,
                &single,
                &extractors,
                &empty,
            )))
        }
        "unsafe-sources" => {
            let sources = [
                source("/abs/order.mjs"),
                source("src/../order.mjs"),
                source("src/order.mjs"),
                source("src/order.mjs"),
            ];
            shape(build_knowledge_candidate(input(
                &domain, &sources, &one, &empty,
            )))
        }
        "duplicate-extension" => {
            let second = Fixture::new(Behavior::Complete);
            let extractors: [&dyn KnowledgeExtractor; 2] = [&complete, &second];
            shape(build_knowledge_candidate(input(
                &domain,
                &single,
                &extractors,
                &empty,
            )))
        }
        "dotfile" => {
            let sources = [SourceFile {
                path: "src/.bashrc".to_string(),
                content: "export PS1=x".to_string(),
            }];
            shape(build_knowledge_candidate(input(
                &domain, &sources, &one, &empty,
            )))
        }
        "invalid-domain" => {
            let domain = Domain {
                id: String::new(),
                ..domain
            };
            shape(build_knowledge_candidate(input(&domain, &[], &one, &empty)))
        }
        other => panic!("невідомий сценарій {other}"),
    }
}

/// Фрагмент структурованого джерела — той самий, що в генераторі фікстури.
fn structured_fragment(domain_id: &str) -> rules_docs::structured_sources::Fragment {
    let schema_id = "schema:npm:@fixture/orders:openapi";
    let contract_id = "contract:npm:@fixture/orders:openapi";
    let evidence_id = "evidence:openapi";
    let value = json!({ "artifact": "openapi", "format": "yaml" });
    let claim_id = rules_docs::claims::create_implemented_claim_id(
        domain_id,
        schema_id,
        "declares-artifact",
        &value,
        &[evidence_id.to_string()],
    );
    rules_docs::structured_sources::Fragment {
        path: "contracts/openapi.yaml".to_string(),
        content_hash: "sha256:openapi".to_string(),
        nodes: vec![
            json!({
                "id": "config:npm:@fixture/orders:package", "kind": "config",
                "name": "package.json", "visibility": "package", "domainId": domain_id,
                "attributes": { "sourcePath": "package.json" },
                "sourceFingerprint": "sha256:package"
            }),
            json!({
                "id": schema_id, "kind": "config", "name": "Orders schema",
                "visibility": "public", "domainId": domain_id,
                "attributes": { "sourcePath": "contracts/openapi.yaml", "artifact": "schema" },
                "sourceFingerprint": "sha256:openapi"
            }),
            json!({
                "id": contract_id, "kind": "integration", "name": "Orders API",
                "visibility": "external", "domainId": domain_id,
                "attributes": { "sourcePath": "contracts/openapi.yaml", "boundary": "contract" },
                "sourceFingerprint": "sha256:openapi"
            }),
        ],
        edges: vec![json!({
            "id": "edge:openapi", "kind": "implements",
            "fromId": schema_id, "toId": contract_id, "evidenceIds": [evidence_id]
        })],
        evidence: vec![json!({
            "id": evidence_id, "kind": "schema", "path": "contracts/openapi.yaml",
            "symbolId": schema_id, "contentHash": "sha256:openapi"
        })],
        claims: vec![json!({
            "id": claim_id, "subjectId": schema_id, "layer": "implemented",
            "predicate": "declares-artifact", "value": value,
            "evidenceIds": [evidence_id], "confidence": 1,
            "sourceFingerprint": "sha256:openapi"
        })],
    }
}

#[test]
fn matches_live_js_on_every_scenario() {
    let fixtures: Value = serde_json::from_str(FIXTURES).expect("фікстура — валідний JSON");
    let names: Vec<String> = fixtures
        .as_object()
        .expect("фікстура — обʼєкт")
        .keys()
        .cloned()
        .collect();
    assert_eq!(names.len(), 13, "звіряються ВСІ зняті сценарії");
    for name in names {
        let expected = rules_docs::canonical_json(&fixtures[&name]);
        let actual = rules_docs::canonical_json(&scenario(&name));
        assert_eq!(actual, expected, "сценарій {name} розійшовся з JS");
    }
}
