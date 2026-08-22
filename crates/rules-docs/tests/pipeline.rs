//! Дзеркальний набір конвеєра `docs build` — сценарій-у-сценарій із
//! `tests/runner.test.mjs`.
//!
//! Одна принципова різниця з JS-набором. Там кожна стадія підмінялась
//! інʼєкцією (`renderImpl`, `verifyEntailmentImpl`, `compareGapMappingsImpl`,
//! …), тож перевірялась ПРОВОДКА між заглушками. Тут заглушка одна —
//! транспорт; домен лежить на диску, а всі стадії справжні. Тому ці тести
//! кажуть більше: «стадія не викликалась» стає «жодного виклику моделі не
//! було», а «render не викликався» — «дерево доків не змінилось».

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use llm_lib::attempt::BoxFuture;
use llm_lib::tiers::Tier;
use rules_docs::candidate::{ExtractorFile, KnowledgeExtractor, ParserProvenance};
use rules_docs::expected_sources::{Diagnostic as ExpectedDiagnostic, Scenario, TestFile};
use rules_docs::graph::Domain;
use rules_docs::runner::{build_package_knowledge, BuildInput, BuildMode, BuildOutcome};
use rules_docs::wave::{new_chain, SubmitBatchFn, WaveItem, WaveResult};
use serde_json::{json, Value};

const DOMAIN_ID: &str = "npm:@fixture/orders";
const SUBJECT: &str = "code-unit:npm:@fixture/orders:js:src/orders.mjs#submit";

/// Тимчасовий корінь репозиторію для одного сценарію.
fn temp_repo(label: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "rules-docs-pipeline-{}-{label}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("корінь створюється");
    write(
        &root,
        "package.json",
        r#"{"name":"@fixture/orders","version":"1.0.0"}"#,
    );
    root
}

/// Код домену, УНІКАЛЬНИЙ для сценарію.
///
/// Тека викладки ключується доменом і відбитком джерел, тож два сценарії з
/// побайтово однаковим кодом писали б в одне місце й читали чужий вихід.
fn code(label: &str) -> String {
    format!("// {label}\nexport function submit() {{}}")
}

fn write(root: &Path, path: &str, content: &str) {
    let target = root.join(path);
    std::fs::create_dir_all(target.parent().expect("є батько")).expect("тека");
    std::fs::write(target, content).expect("запис");
}

fn read(root: &Path, path: &str) -> Option<String> {
    std::fs::read_to_string(root.join(path)).ok()
}

/// Що робить фікстурний екстрактор із файлом.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Behavior {
    Complete,
    Throws,
}

struct Fixture {
    behavior: Behavior,
}

impl Fixture {
    /// Готовий до інʼєкції екстрактор — саме в тій формі, якої чекає
    /// [`BuildInput`].
    fn boxed(behavior: Behavior) -> Arc<dyn KnowledgeExtractor + Send + Sync> {
        Arc::new(Self { behavior })
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
        if self.behavior == Behavior::Throws {
            return Err("fixture parser failed".to_string());
        }
        let end = file.content.len();
        Ok(json!({
            "ok": true,
            "file": { "path": file.path, "language": "js", "contentHash": file.content_hash },
            "units": [{
                "localId": "submit",
                "qualifiedPath": format!("{}#submit", file.path),
                "kind": "function",
                "name": "submit",
                "visibility": "public",
                "span": { "startByte": 0, "endByte": end }
            }],
            "edges": [{
                "kind": "invokes",
                "fromLocalId": "submit",
                "to": { "unresolvedSpecifier": "fixture-transport", "opaque": true },
                "evidence": [{ "span": { "startByte": 0, "endByte": end }, "role": "syntax" }]
            }],
            "coverage": {
                "requiredUnits": 1, "coveredUnits": 1,
                "requiredEdges": 1, "coveredEdges": 1, "complete": true
            }
        }))
    }
}

type Prompts = Arc<Mutex<Vec<String>>>;

/// Транспорт-двійник: колбек вирішує долю кожного item-а за промптом.
fn fake_submit(
    respond: impl Fn(&str, &str) -> Result<String, String> + Send + Sync + 'static,
) -> (SubmitBatchFn, Prompts) {
    let prompts: Prompts = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&prompts);
    let respond = Arc::new(respond);
    let submit: SubmitBatchFn = Arc::new(move |_tier: Tier, items: Vec<WaveItem>, _chain| {
        seen.lock()
            .expect("мʼютекс живий")
            .extend(items.iter().map(|item| item.prompt.clone()));
        let respond = Arc::clone(&respond);
        let future: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            Ok(items
                .into_iter()
                .map(|item| WaveResult {
                    outcome: respond(&item.custom_id, &item.prompt),
                    custom_id: item.custom_id,
                })
                .collect())
        });
        future
    });
    (submit, prompts)
}

fn ids_from_prompt(prompt: &str, label: &str) -> Vec<String> {
    let marker = format!("{label}: ");
    let Some(start) = prompt.find(&marker) else {
        return Vec::new();
    };
    let tail = &prompt[start + marker.len()..];
    let end = tail.find("].").map_or(tail.len(), |index| index + 1);
    serde_json::from_str(&tail[..end]).unwrap_or_default()
}

/// Відповідає на всі чотири види промптів конвеєра.
fn answer(custom_id: &str, prompt: &str, relation: Relation) -> Result<String, String> {
    if prompt.contains("Required node IDs") {
        let nodes = ids_from_prompt(prompt, "Required node IDs");
        let edges = ids_from_prompt(prompt, "Required edge IDs");
        let evidence = ids_from_prompt(prompt, "Allowed evidence IDs");
        let claims: Vec<Value> = nodes
            .iter()
            .map(|subject| {
                json!({
                    "subjectId": subject,
                    "predicate": "outcome",
                    "value": true,
                    "evidenceIds": [evidence.first().cloned().unwrap_or_default()],
                    "confidence": 1
                })
            })
            .collect();
        return Ok(json!({
            "claims": claims,
            "coveredNodeIds": nodes,
            "coveredEdgeIds": edges
        })
        .to_string());
    }
    if prompt.contains("implementedCandidates") {
        let candidates: Vec<String> = prompt
            .rsplit_once("\"implementedCandidates\":")
            .map(|(_, tail)| tail)
            .and_then(|tail| serde_json::from_str::<Value>(tail.trim_end_matches('}')).ok())
            .map(|value| {
                value
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.get("id").and_then(Value::as_str))
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        let comparisons = match relation {
            Relation::Unresolved => Vec::new(),
            Relation::Equivalent | Relation::Contradicts => candidates
                .iter()
                .take(1)
                .map(|id| json!({ "implementedClaimId": id, "relation": relation.as_str() }))
                .collect(),
        };
        return Ok(json!({
            "expectedClaimId": custom_id,
            "comparisons": comparisons,
            "unresolved": relation == Relation::Unresolved
        })
        .to_string());
    }
    if prompt.contains("Explicit expected source") {
        return Ok(json!({ "claims": [] }).to_string());
    }
    Ok(json!({ "claimId": custom_id, "entails": true, "unsupportedFields": [] }).to_string())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Relation {
    Equivalent,
    Contradicts,
    Unresolved,
}

impl Relation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Equivalent => "equivalent",
            Self::Contradicts => "contradicts",
            Self::Unresolved => "unresolved",
        }
    }
}

fn successful_batch(relation: Relation) -> (SubmitBatchFn, Prompts) {
    fake_submit(move |id, prompt| answer(id, prompt, relation))
}

struct Options<'a> {
    publish: bool,
    extractors: &'a [Arc<dyn KnowledgeExtractor + Send + Sync>],
    expected_overlay: Value,
    gap_mappings: Vec<rules_docs::gap_mappings::Mapping>,
    cache_root: PathBuf,
}

impl<'a> Options<'a> {
    fn new(root: &Path, extractors: &'a [Arc<dyn KnowledgeExtractor + Send + Sync>]) -> Self {
        Self {
            publish: false,
            extractors,
            expected_overlay: json!({}),
            gap_mappings: Vec::new(),
            cache_root: root.join(".cache"),
        }
    }
}

async fn build(root: &Path, options: &Options<'_>, submit: SubmitBatchFn) -> BuildOutcome {
    build_package_knowledge(BuildInput {
        repo_root: root,
        domain_id: DOMAIN_ID,
        publish: options.publish,
        extractors: options.extractors,
        expected_overlay: &options.expected_overlay,
        gap_mappings: &options.gap_mappings,
        aliases_by_topic_id: &json!({}),
        cache_root: Some(&options.cache_root),
        minimum_gap_confidence: 1.0,
        submit,
        chain: new_chain("test", "pipeline"),
    })
    .await
}

fn report(outcome: BuildOutcome) -> rules_docs::runner::BuildReport {
    match outcome {
        BuildOutcome::Built(report) => report,
        BuildOutcome::Blocked {
            stage, diagnostics, ..
        } => panic!("несподіваний блокер на {stage}: {diagnostics:#?}"),
    }
}

fn blocker(outcome: BuildOutcome) -> (String, Vec<Value>) {
    match outcome {
        BuildOutcome::Built(report) => panic!("очікувався блокер, а не {report:?}"),
        BuildOutcome::Blocked {
            stage, diagnostics, ..
        } => (stage, diagnostics),
    }
}

fn staged(report: &rules_docs::runner::BuildReport, path: &str) -> Option<String> {
    std::fs::read_to_string(report.staging_path.join(path)).ok()
}

/// Типовий SHADOW: кандидат валідується й лягає ПОЗА репозиторієм, а
/// повторний прогін на незмінному кеші не коштує жодного виклику моделі.
#[tokio::test]
async fn shadow_stages_the_candidate_and_repeats_without_llm_calls() {
    let root = temp_repo("shadow");
    write(&root, "src/orders.mjs", &code("shadow"));
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let options = Options::new(&root, &extractors);

    let (first, first_prompts) = successful_batch(Relation::Equivalent);
    let first = report(build(&root, &options, first).await);
    assert_eq!(first.mode, BuildMode::Shadow);
    assert_eq!(first.domain_id, DOMAIN_ID);
    assert!(!first_prompts.lock().expect("мʼютекс").is_empty());
    let manifest = staged(&first, "docs/.docgen/manifest.json").expect("маніфест викладено");
    assert!(manifest.contains(DOMAIN_ID));
    assert!(
        read(&root, "docs/index.md").is_none(),
        "SHADOW не має писати в дерево домену"
    );

    let (second, second_prompts) = successful_batch(Relation::Equivalent);
    let second = report(build(&root, &options, second).await);
    assert_eq!(second.mode, BuildMode::Shadow);
    assert!(
        second_prompts.lock().expect("мʼютекс").is_empty(),
        "незмінний кеш мусить дати НУЛЬ викликів"
    );
}

/// Пакет без коду документується самими лише структурованими джерелами:
/// ні джерел, ні планування, ні жодного твердження від моделі.
///
/// JS-набір тут стверджує «нуль викликів узагалі», але лише тому, що в
/// ньому гейт entailment підмінений заглушкою. Насправді твердження
/// контракту теж проходять entailment — і мусять, бо доказ у них є. Тому
/// перевіряється те, що справді відрізняє цей шлях: жодного промпта
/// тверджень.
#[tokio::test]
async fn contract_only_package_builds_without_extractors_or_llm() {
    let root = temp_repo("contract-only");
    write(
        &root,
        "contracts/openapi.yaml",
        "openapi: 3.1.0\ninfo:\n  title: Orders API\n  version: 1.0.0\npaths:\n  /orders:\n    post:\n      summary: submit\n",
    );
    let options = Options::new(&root, &[]);
    let (submit, prompts) = successful_batch(Relation::Equivalent);
    let built = report(build(&root, &options, submit).await);

    assert_eq!(built.mode, BuildMode::Shadow);
    assert!(
        !prompts
            .lock()
            .expect("мʼютекс")
            .iter()
            .any(|prompt| prompt.contains("Required node IDs")),
        "контрактний пакет не має коштувати ЖОДНОГО промпта тверджень"
    );
    let manifest = staged(&built, "docs/.docgen/manifest.json").expect("маніфест");
    assert!(
        manifest.contains("Orders API"),
        "контракт мусить бути в маніфесті"
    );
}

/// Код є, а екстракторів немає — конвеєр стає на стадії адаптерів, ДО
/// завантаження джерел і будь-якої моделі.
#[tokio::test]
async fn code_without_extractors_blocks_at_adapters() {
    let root = temp_repo("no-extractors");
    write(&root, "src/orders.mjs", &code("no-extractors"));
    let options = Options::new(&root, &[]);
    let (submit, prompts) = successful_batch(Relation::Equivalent);
    let (stage, diagnostics) = blocker(build(&root, &options, submit).await);

    assert_eq!(stage, "adapters");
    assert_eq!(diagnostics[0]["code"], json!("missing-extractors"));
    assert!(prompts.lock().expect("мʼютекс").is_empty());
}

/// Падіння парсера fail-closed: закомічені доки лишаються побайтово тими
/// самими, і жодного виклику моделі не відбувається.
#[tokio::test]
async fn parser_failure_is_fail_closed_and_keeps_committed_docs() {
    let root = temp_repo("parser-failure");
    write(&root, "src/orders.mjs", &code("parser-failure"));
    write(&root, "docs/index.md", "legacy document\n");
    let extractors = [Fixture::boxed(Behavior::Throws)];
    let options = Options::new(&root, &extractors);
    let (submit, prompts) = successful_batch(Relation::Equivalent);
    let (stage, diagnostics) = blocker(build(&root, &options, submit).await);

    assert_eq!(stage, "candidate");
    assert_eq!(diagnostics[0]["code"], json!("extractor-threw"));
    assert!(prompts.lock().expect("мʼютекс").is_empty());
    assert_eq!(
        read(&root, "docs/index.md").as_deref(),
        Some("legacy document\n")
    );
}

/// Зламаний контракт блокує ДО роботи кандидата — і теж не чіпає дерева.
#[tokio::test]
async fn malformed_structured_source_blocks_before_candidate_work() {
    let root = temp_repo("malformed-structured");
    write(&root, "src/orders.mjs", &code("malformed-structured"));
    write(&root, "docs/index.md", "legacy document\n");
    write(
        &root,
        "contracts/openapi.yaml",
        "openapi: 3.1.0\npaths: [ця частина зламана\n",
    );
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let options = Options::new(&root, &extractors);
    let (submit, prompts) = successful_batch(Relation::Equivalent);
    let (stage, _) = blocker(build(&root, &options, submit).await);

    assert_eq!(stage, "structured-sources");
    assert!(prompts.lock().expect("мʼютекс").is_empty());
    assert_eq!(
        read(&root, "docs/index.md").as_deref(),
        Some("legacy document\n")
    );
}

/// Явна публікація атомарно додає згенеровані сторінки й лишає сторонні
/// закомічені доки недоторканими.
#[tokio::test]
async fn publish_adds_generated_views_and_preserves_legacy_docs() {
    let root = temp_repo("publish");
    write(&root, "src/orders.mjs", &code("publish"));
    write(&root, "docs/legacy.md", "keep legacy file documentation\n");
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let mut options = Options::new(&root, &extractors);
    options.publish = true;
    let (submit, _) = successful_batch(Relation::Equivalent);
    let built = report(build(&root, &options, submit).await);

    assert_eq!(built.mode, BuildMode::Published);
    assert_eq!(
        read(&root, "docs/legacy.md").as_deref(),
        Some("keep legacy file documentation\n")
    );
    assert!(
        read(&root, "docs/index.md").is_some(),
        "згенерований індекс опубліковано"
    );
    assert!(read(&root, "docs/.docgen/manifest.json")
        .is_some_and(|manifest| manifest.contains(DOMAIN_ID)));
}

/// Очікування з доказом, текст якого лежить у джерелах домену.
fn expected_overlay(id: &str) -> Value {
    json!({
        "claims": [{
            "id": id,
            "subjectId": SUBJECT,
            "predicate": "outcome",
            "value": false,
            "evidenceIds": ["evidence:expected"],
            "confidence": 1,
            "sourceFingerprint": "sha256:expected"
        }],
        "evidence": [{
            "id": "evidence:expected",
            "kind": "spec",
            "path": "src/orders.mjs",
            "contentHash": "sha256:expected"
        }]
    })
}

/// Семантична суперечність comparator-а доходить до сторінки прогалин як
/// `diverged`.
#[tokio::test]
async fn comparator_contradiction_renders_as_diverged() {
    let root = temp_repo("diverged");
    write(&root, "src/orders.mjs", &code("diverged"));
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let mut options = Options::new(&root, &extractors);
    options.expected_overlay = expected_overlay("claim:expected:diverged");
    let (submit, _) = successful_batch(Relation::Contradicts);
    let built = report(build(&root, &options, submit).await);

    let gaps = staged(&built, "docs/implementation-gaps.md").expect("сторінка прогалин");
    assert!(
        gaps.contains("diverged"),
        "очікувався diverged, а сторінка каже:\n{gaps}"
    );
}

/// Явно неоднозначне порівняння лишається `unresolved`, а не стає
/// «відсутнім»: різниця між «не знаю» і «немає» тут змістовна.
#[tokio::test]
async fn ambiguous_comparison_renders_as_unresolved() {
    let root = temp_repo("unresolved");
    write(&root, "src/orders.mjs", &code("unresolved"));
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let mut options = Options::new(&root, &extractors);
    options.expected_overlay = expected_overlay("claim:expected:ambiguous");
    let (submit, _) = successful_batch(Relation::Unresolved);
    let built = report(build(&root, &options, submit).await);

    let gaps = staged(&built, "docs/implementation-gaps.md").expect("сторінка прогалин");
    assert!(
        gaps.contains("unresolved"),
        "очікувався unresolved, а сторінка каже:\n{gaps}"
    );
}

/// Повтор того самого звʼязку від викликача БЛОКУЄ, а не тихо перекриває
/// автоматичний вердикт — і зупиняє конвеєр до рендеру й публікації.
#[tokio::test]
async fn duplicate_explicit_mapping_blocks_before_render() {
    let root = temp_repo("duplicate-mapping");
    write(&root, "src/orders.mjs", &code("duplicate-mapping"));
    write(&root, "docs/index.md", "legacy document\n");
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let mut options = Options::new(&root, &extractors);
    options.publish = true;
    options.expected_overlay = expected_overlay("claim:expected:duplicate");
    // Двічі той самий звʼязок. Пара «автоматичний проти явного» вже
    // покрита юніт-тестом злиття; тут важливо, ЩО РОБИТЬ КОНВЕЄР, коли
    // злиття блокує, — а йому байдуже, з якого боку прийшов повтор.
    let mapping = rules_docs::gap_mappings::Mapping {
        expected_claim_id: "claim:expected:duplicate".to_string(),
        implemented_claim_id: "claim:implemented:fixture".to_string(),
        relation: "equivalent".to_string(),
        evidence_ids: Vec::new(),
    };
    options.gap_mappings = vec![mapping.clone(), mapping];
    let (submit, _) = successful_batch(Relation::Equivalent);
    let (stage, diagnostics) = blocker(build(&root, &options, submit).await);

    assert_eq!(stage, "gap-mappings");
    assert!(
        diagnostics
            .iter()
            .any(|item| item["code"] == json!("duplicate-gap-mapping")
                || item["code"] == json!("conflicting-gap-mapping")),
        "очікувався блокер повтору, а не {diagnostics:#?}"
    );
    assert_eq!(
        read(&root, "docs/index.md").as_deref(),
        Some("legacy document\n")
    );
}

/// Невиведене твердження зупиняє конвеєр на гейті entailment — до рендеру,
/// до публікації, без жодного дотику до дерева.
#[tokio::test]
async fn unentailed_claim_blocks_before_render_and_publish() {
    let root = temp_repo("entailment-block");
    write(&root, "src/orders.mjs", &code("entailment-block"));
    write(&root, "docs/index.md", "legacy document\n");
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let mut options = Options::new(&root, &extractors);
    options.publish = true;
    let (submit, _) = fake_submit(|id, prompt| {
        if prompt.contains("Required node IDs") {
            return answer(id, prompt, Relation::Equivalent);
        }
        Ok(json!({ "claimId": id, "entails": false, "unsupportedFields": ["value"] }).to_string())
    });
    let (stage, diagnostics) = blocker(build(&root, &options, submit).await);

    assert_eq!(stage, "entailment");
    assert_eq!(diagnostics[0]["code"], json!("claim-not-entailed"));
    assert_eq!(
        read(&root, "docs/index.md").as_deref(),
        Some("legacy document\n")
    );
}

/// Домен, якого немає в репозиторії, — блокер резолвера, а не порожня
/// збірка.
#[tokio::test]
async fn unknown_domain_blocks_at_resolution() {
    let root = temp_repo("unknown-domain");
    let extractors = [Fixture::boxed(Behavior::Complete)];
    let options = Options::new(&root, &extractors);
    let (submit, prompts) = successful_batch(Relation::Equivalent);
    let outcome = build_package_knowledge(BuildInput {
        repo_root: &root,
        domain_id: "npm:@fixture/absent",
        publish: false,
        extractors: options.extractors,
        expected_overlay: &options.expected_overlay,
        gap_mappings: &options.gap_mappings,
        aliases_by_topic_id: &json!({}),
        cache_root: Some(&options.cache_root),
        minimum_gap_confidence: 1.0,
        submit,
        chain: new_chain("test", "pipeline"),
    })
    .await;
    let (stage, diagnostics) = blocker(outcome);

    assert_eq!(stage, "domain-resolution");
    assert_eq!(diagnostics[0]["code"], json!("domain-not-found"));
    assert!(prompts.lock().expect("мʼютекс").is_empty());
}

/// Порожня ідентичність домену — блокер входу, ще до будь-якого читання ФС.
#[tokio::test]
async fn empty_domain_id_blocks_at_input() {
    let root = temp_repo("empty-domain");
    let (submit, prompts) = successful_batch(Relation::Equivalent);
    let outcome = build_package_knowledge(BuildInput {
        repo_root: &root,
        domain_id: "",
        publish: false,
        extractors: &[],
        expected_overlay: &json!({}),
        gap_mappings: &[],
        aliases_by_topic_id: &json!({}),
        cache_root: None,
        minimum_gap_confidence: 1.0,
        submit,
        chain: new_chain("test", "pipeline"),
    })
    .await;
    let (stage, diagnostics) = blocker(outcome);

    assert_eq!(stage, "input");
    assert_eq!(diagnostics[0]["code"], json!("domain-required"));
    assert!(prompts.lock().expect("мʼютекс").is_empty());
}
