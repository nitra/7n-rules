//! Пошук і мапінг ЯВНИХ джерел очікувань — порт `expected-sources.mjs`.
//!
//! Модуль збирає рівно те, що людина написала явно: `EXPECTED`-зони власної
//! документації, ADR/специфікації з машинним маркером домену і сценарії
//! тестів від парсера. Модель бачить лише текст джерела і канонічні ID
//! графа — malformed чи неоднозначний результат БЛОКУЄ candidate, а не стає
//! припущенням про намір.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;
use std::sync::LazyLock;

use llm_lib::tiers::Tier;
use regex::Regex;
use serde_json::{json, Value};

use crate::claims::BEHAVIORAL_CLAIM_TAXONOMY;
use crate::deterministic::{
    canonical_hash, canonical_json, js_locale_cmp, load_versioned_cache, save_versioned_cache,
    VersionedCache,
};
use crate::wave::{submit_wave, ChainRef, SubmitBatchFn, WaveItem, WaveResult};

const CACHE_VERSION: u64 = 1;

/// Машинний маркер приналежності ADR/специфікації до домену.
static SOURCE_SCOPE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<!--\s*PACKAGE-KNOWLEDGE:domain\s+id="([^"]*)"\s*-->"#)
        .expect("регулярка коректна")
});

/// Будь-що, СХОЖЕ на маркер: зламаний маркер мусить стати діагностикою, а не
/// тихо лишитись коментарем.
static SOURCE_SCOPE_LIKE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!--\s*PACKAGE-KNOWLEDGE:domain\b").expect("регулярка коректна"));

/// Статус ADR, за якого він взагалі стає джерелом очікування.
static ACCEPTED_ADR_STATUS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^(?:\*\*)Status:(?:\*\*)\s+Accepted\s*$").expect("регулярка коректна")
});

/// Дерева, які ніколи не є джерелами очікувань.
const IGNORED_PATHS: [&str; 9] = [
    "**/.git/**",
    "**/.worktrees/**",
    "**/node_modules/**",
    "**/vendor/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.venv/**",
    "**/venv/**",
];

/// Блокувальна діагностика.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub detail: String,
    pub path: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, detail: &str, path: Option<&str>) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.to_string(),
            path: path.map(str::to_string),
        }
    }

    fn sort_key(&self) -> String {
        format!("{}:{}", self.path.as_deref().unwrap_or(""), self.code)
    }
}

fn sort_diagnostics(mut diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    diagnostics.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
    diagnostics
}

/// Байтовий span у джерелі.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start_byte: usize,
    pub end_byte: usize,
}

/// Сценарій тесту від парсера мови.
#[derive(Debug, Clone)]
pub struct Scenario {
    pub content: String,
    pub span: Span,
    pub anchor: String,
}

/// Файл тесту, поданий викликачем.
#[derive(Debug, Clone)]
pub struct TestFile {
    pub path: String,
    pub content: String,
}

/// Збирач сценаріїв одного мовного парсера.
///
/// Інверсія тут не для тестів: у JS це `knowledge.extractor@1` зі слот-шини
/// плагінів, тобто ЖИВІ збирачі — JS-модулі (див. §5.0.15 реєстру про
/// `load-adapters`). Порт лишає точку підключення, а самі збирачі прийдуть
/// разом зі slot-dispatch-ем.
pub type ScenarioCollector =
    Arc<dyn Fn(&TestFile) -> Result<Vec<Scenario>, Vec<Diagnostic>> + Send + Sync>;

/// Мовний екстрактор: розширення, які він читає, і його збирач.
#[derive(Clone)]
pub struct Extractor {
    pub extensions: Vec<String>,
    pub collect: ScenarioCollector,
}

/// Знайдене джерело очікування.
#[derive(Debug, Clone, PartialEq)]
pub struct ExpectedSource {
    pub id: String,
    pub evidence: Evidence,
    pub content: String,
    pub anchor: String,
}

/// Provenance джерела.
#[derive(Debug, Clone, PartialEq)]
pub struct Evidence {
    pub id: String,
    /// `manual` | `adr` | `spec` | `test`.
    pub kind: String,
    pub path: String,
    /// Опційний свідомо: `normalizeSources` у JS span НЕ вимагає, і джерело,
    /// подане викликачем без нього, проходить далі як є. Обовʼязкове поле
    /// тут додавало б у overlay `span`, якого в оригіналі немає.
    pub span: Option<Span>,
    pub content_hash: String,
}

impl Evidence {
    fn to_value(&self) -> Value {
        let mut value = serde_json::Map::new();
        value.insert("id".to_string(), json!(self.id));
        value.insert("kind".to_string(), json!(self.kind));
        value.insert("path".to_string(), json!(self.path));
        if let Some(span) = self.span {
            value.insert(
                "span".to_string(),
                json!({"startByte": span.start_byte, "endByte": span.end_byte}),
            );
        }
        value.insert("contentHash".to_string(), json!(self.content_hash));
        Value::Object(value)
    }
}

impl ExpectedSource {
    fn to_value(&self) -> Value {
        json!({
            "id": self.id,
            "evidence": self.evidence.to_value(),
            "content": self.content,
            "anchor": self.anchor,
        })
    }
}

/// Домен у частині, потрібній цьому модулю.
pub struct DomainScope<'a> {
    pub id: &'a str,
    pub root: &'a Path,
    pub excluded_source_roots: &'a [String],
}

/// Короткий хеш ідентифікатора — `sha256:` (7 символів) плюс 24 hex.
fn short_hash(value: &Value) -> String {
    canonical_hash(value)[7..31].to_string()
}

/// Рівно один scope домену зі строгого машинного маркера.
fn source_scope(markdown: &str, path: &str) -> Result<Option<String>, Vec<Diagnostic>> {
    let parsed: Vec<(String, usize)> = SOURCE_SCOPE_RE
        .captures_iter(markdown)
        .map(|capture| {
            (
                capture[1].to_string(),
                capture.get(0).expect("група 0").start(),
            )
        })
        .collect();
    let starts: BTreeSet<usize> = parsed.iter().map(|(_, start)| *start).collect();
    let mut diagnostics = Vec::new();
    for candidate in SOURCE_SCOPE_LIKE_RE.find_iter(markdown) {
        if !starts.contains(&candidate.start()) {
            diagnostics.push(Diagnostic::new(
                "invalid-expected-source-scope",
                "Domain scope marker має містити non-empty id=\"...\".",
                Some(path),
            ));
        }
    }
    if parsed.len() > 1 {
        // Два домени в одному документі — не «обидва», а невизначеність: ми
        // не знаємо, чиє це очікування.
        diagnostics.push(Diagnostic::new(
            "ambiguous-expected-source-scope",
            "ADR/spec мусить бути scoped рівно до одного domain.",
            Some(path),
        ));
    }
    if parsed.iter().any(|(id, _)| id.is_empty()) {
        diagnostics.push(Diagnostic::new(
            "invalid-expected-source-scope",
            "Domain scope marker має містити non-empty id=\"...\".",
            Some(path),
        ));
    }
    if diagnostics.is_empty() {
        Ok(parsed.first().map(|(id, _)| id.clone()))
    } else {
        Err(diagnostics)
    }
}

/// Ignore-патерни вкладених доменів ВІДНОСНО кореня цього домену.
fn nested_domain_ignores(repo_root: &Path, domain: &DomainScope<'_>) -> Vec<String> {
    let mut patterns: Vec<String> = domain
        .excluded_source_roots
        .iter()
        .filter_map(|root| {
            let absolute = repo_root.join(root);
            let relative = pathdiff(&absolute, domain.root)?;
            (!relative.is_empty() && relative != "." && !relative.starts_with("../"))
                .then_some(relative)
        })
        .flat_map(|path| [path.clone(), format!("{path}/**")])
        .collect();
    patterns.sort();
    patterns
}

/// Шлях `target` відносно `base` у POSIX-формі.
fn pathdiff(target: &Path, base: &Path) -> Option<String> {
    let split = |path: &Path| -> Vec<String> {
        path.components()
            .filter_map(|component| match component {
                std::path::Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect()
    };
    let (base_parts, target_parts) = (split(base), split(target));
    let common = base_parts
        .iter()
        .zip(target_parts.iter())
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts: Vec<String> = vec!["..".to_string(); base_parts.len() - common];
    parts.extend(target_parts[common..].iter().cloned());
    Some(parts.join("/"))
}

/// Створює запис джерела з власним evidence.
fn expected_source(
    kind: &str,
    path: &str,
    content: &str,
    span: Span,
    anchor: &str,
) -> ExpectedSource {
    let content_hash = canonical_hash(&json!(content));
    let span_value = json!({"startByte": span.start_byte, "endByte": span.end_byte});
    let evidence_id = format!(
        "evidence:expected:{}",
        short_hash(&json!({
            "kind": kind, "path": path, "contentHash": content_hash,
            "span": span_value, "anchor": anchor,
        }))
    );
    ExpectedSource {
        id: format!(
            "source:expected:{}",
            short_hash(&json!({"evidence": evidence_id, "anchor": anchor}))
        ),
        evidence: Evidence {
            id: evidence_id,
            kind: kind.to_string(),
            path: path.to_string(),
            span: Some(span),
            content_hash,
        },
        content: content.to_string(),
        anchor: anchor.to_string(),
    }
}

/// Markdown-файли під `prefix`, у стабільному порядку.
///
/// Symlink-и тут ПРОХОДЯТЬСЯ — на відміну від завантажувача джерел
/// (`sources`), де вони заборонені. Так само поводиться JS: `globby` у цьому
/// модулі викликається без `followSymbolicLinks: false`, і документація,
/// підключена симлінком, лишається видимою.
fn markdown_paths(root: &Path, prefixes: &[&str], ignores: &[String]) -> Vec<String> {
    use ignore::overrides::OverrideBuilder;
    use ignore::WalkBuilder;

    let mut overrides = OverrideBuilder::new(root);
    for pattern in ignores {
        let _ = overrides.add(&format!("!{pattern}"));
    }
    let Ok(overrides) = overrides.build() else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .follow_links(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .overrides(overrides)
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let path = relative.to_string_lossy().replace('\\', "/");
        if path.ends_with(".md") && prefixes.iter().any(|prefix| path.starts_with(prefix)) {
            paths.push(path);
        }
    }
    paths.sort_by(|left, right| js_locale_cmp(left, right));
    paths
}

/// Явні `EXPECTED`-зони власної документації домену.
fn collect_domain_expected_sources(
    domain_root: &Path,
    docs: &[String],
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<ExpectedSource> {
    let mut sources = Vec::new();
    for path in docs {
        let Ok(content) = std::fs::read_to_string(domain_root.join(path)) else {
            continue;
        };
        match crate::zones::parse_knowledge_zones(&content, Some(path)) {
            Err(zone_diagnostics) => {
                diagnostics.extend(zone_diagnostics.into_iter().map(|item| Diagnostic {
                    code: item.code,
                    detail: item.detail,
                    path: item.path,
                }))
            }
            Ok(parsed) => {
                for zone in parsed.zones {
                    if zone.kind != "EXPECTED" || zone.content.trim().is_empty() {
                        continue;
                    }
                    sources.push(expected_source(
                        "manual",
                        path,
                        &zone.content,
                        Span {
                            start_byte: zone.content_start,
                            end_byte: zone.content_end,
                        },
                        &format!("EXPECTED:{}", zone.id),
                    ));
                }
            }
        }
    }
    sources
}

/// ADR і специфікації, ЯВНО привʼязані до цього домену.
fn collect_scoped_repository_expected_sources(
    repo_root: &Path,
    domain: &DomainScope<'_>,
    docs: &[String],
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<ExpectedSource> {
    let mut sources = Vec::new();
    for path in docs {
        let absolute = repo_root.join(path);
        let Ok(content) = std::fs::read_to_string(&absolute) else {
            continue;
        };
        let scope = match source_scope(&content, path) {
            Ok(scope) => scope,
            Err(scope_diagnostics) => {
                diagnostics.extend(scope_diagnostics);
                continue;
            }
        };
        if scope.as_deref() != Some(domain.id) {
            continue;
        }
        let kind = if path.starts_with("docs/adr/") {
            "adr"
        } else {
            "spec"
        };
        // Неприйнятий ADR — ще не рішення, тож і не очікування.
        if kind == "adr" && !ACCEPTED_ADR_STATUS_RE.is_match(&content) {
            continue;
        }
        let relative = pathdiff(&absolute, domain.root).unwrap_or_else(|| path.clone());
        sources.push(expected_source(
            kind,
            &relative,
            &content,
            Span {
                start_byte: 0,
                end_byte: content.len(),
            },
            &format!("{kind}:{path}"),
        ));
    }
    sources
}

/// Сценарії тестів від мовних парсерів.
fn collect_test_expected_sources(
    test_files: &[TestFile],
    extractors: &[Extractor],
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<ExpectedSource> {
    let mut by_extension: BTreeMap<&str, &Extractor> = BTreeMap::new();
    for extractor in extractors {
        for extension in &extractor.extensions {
            by_extension.insert(extension.as_str(), extractor);
        }
    }
    let mut files: Vec<&TestFile> = test_files.iter().collect();
    files.sort_by(|left, right| js_locale_cmp(&left.path, &right.path));

    let mut sources = Vec::new();
    for file in files {
        let extension = file
            .path
            .rfind('.')
            .map(|index| file.path[index..].to_lowercase())
            .unwrap_or_default();
        let Some(extractor) = by_extension.get(extension.as_str()) else {
            // Тест, який нікому розібрати, — це не «нема очікувань», а
            // прогалина в інструментах: мовчазний пропуск сховав би її.
            diagnostics.push(Diagnostic::new(
                "expected-test-parser-missing",
                "knowledge.extractor@1 не надає full-parser test collector.",
                Some(&file.path),
            ));
            continue;
        };
        match (extractor.collect)(file) {
            Err(collector_diagnostics) => diagnostics.extend(collector_diagnostics),
            Ok(scenarios) => {
                for scenario in scenarios {
                    sources.push(expected_source(
                        "test",
                        &file.path,
                        &scenario.content,
                        scenario.span,
                        &scenario.anchor,
                    ));
                }
            }
        }
    }
    sources
}

/// Знаходить авторський Markdown і сценарії тестів, які є джерелами ЯВНОГО
/// очікування — порт `discoverExpectedSources`.
///
/// # Errors
/// Невалідні межі домену, зламані зони, неоднозначний scope або відсутній
/// парсер тестів.
pub fn discover_expected_sources(
    repo_root: &Path,
    domain: &DomainScope<'_>,
    extractors: &[Extractor],
    test_files: &[TestFile],
) -> Result<Vec<ExpectedSource>, Vec<Diagnostic>> {
    if !repo_root.is_absolute() || !domain.root.is_absolute() || domain.id.is_empty() {
        return Err(vec![Diagnostic::new(
            "invalid-expected-source-domain",
            "Потрібні absolute repoRoot/domain.root і domain.id.",
            None,
        )]);
    }
    let mut domain_ignores: Vec<String> = IGNORED_PATHS
        .iter()
        .map(|pattern| (*pattern).to_string())
        .collect();
    domain_ignores.extend(nested_domain_ignores(repo_root, domain));
    let repository_ignores: Vec<String> = IGNORED_PATHS
        .iter()
        .map(|pattern| (*pattern).to_string())
        .collect();

    let domain_docs = markdown_paths(domain.root, &["docs/"], &domain_ignores);
    let repository_docs = markdown_paths(
        repo_root,
        &["docs/adr/", "docs/specs/"],
        &repository_ignores,
    );

    let mut diagnostics = Vec::new();
    let mut sources = collect_domain_expected_sources(domain.root, &domain_docs, &mut diagnostics);
    sources.extend(collect_scoped_repository_expected_sources(
        repo_root,
        domain,
        &repository_docs,
        &mut diagnostics,
    ));
    sources.extend(collect_test_expected_sources(
        test_files,
        extractors,
        &mut diagnostics,
    ));
    if !diagnostics.is_empty() {
        return Err(sort_diagnostics(diagnostics));
    }
    sources.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));
    Ok(sources)
}

/// Посилання графа, доступні мапінгу.
struct Refs {
    domain_id: String,
    node_ids: BTreeSet<String>,
    evidence_ids: BTreeSet<String>,
}

fn graph_references(graph: &Value) -> Result<Refs, Vec<Diagnostic>> {
    let invalid = |detail: &str| {
        Err(vec![Diagnostic::new(
            "invalid-expected-source-graph",
            detail,
            None,
        )])
    };
    let domain_id = graph
        .get("domain")
        .and_then(|domain| domain.get("id"))
        .and_then(Value::as_str);
    let nodes = graph.get("nodes").and_then(Value::as_array);
    let evidence = graph.get("evidence").and_then(Value::as_array);
    let (Some(domain_id), Some(nodes), Some(evidence)) = (domain_id, nodes, evidence) else {
        return invalid("Graph мусить мати domain.id, nodes[] та evidence[].");
    };
    let collect = |items: &[Value]| -> Option<BTreeSet<String>> {
        items
            .iter()
            .map(|item| {
                item.get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map(str::to_string)
            })
            .collect()
    };
    let (Some(node_ids), Some(evidence_ids)) = (collect(nodes), collect(evidence)) else {
        return invalid("Graph IDs мусять бути непорожніми.");
    };
    Ok(Refs {
        domain_id: domain_id.to_string(),
        node_ids,
        evidence_ids,
    })
}

/// Точна відповідність набору ключів.
fn has_exact_keys(value: &serde_json::Map<String, Value>, expected: &[&str]) -> bool {
    let mut keys: Vec<&str> = value.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut expected = expected.to_vec();
    expected.sort_unstable();
    keys == expected
}

fn normalized_ids(value: Option<&Value>) -> Option<Vec<String>> {
    let items = value?.as_array()?;
    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        let id = item.as_str()?;
        if id.is_empty() {
            return None;
        }
        ids.push(id.to_string());
    }
    if ids.iter().collect::<BTreeSet<_>>().len() != ids.len() {
        return None;
    }
    ids.sort_unstable();
    Some(ids)
}

/// Строгий промпт мапінгу одного джерела.
fn mapping_prompt(source: &ExpectedSource, refs: &Refs) -> String {
    let contract = json!({
        "claims": [{
            "subjectId": "<known node ID>",
            "predicate": "<behavioral taxonomy value>",
            "value": "<JSON value>",
            "evidenceIds": ["<known evidence ID>"],
            "confidence": 1
        }]
    });
    let list = |ids: &BTreeSet<String>| {
        canonical_json(&Value::Array(
            ids.iter().map(|id| Value::String(id.clone())).collect(),
        ))
    };
    [
        "Return exactly one JSON object, without Markdown or prose.".to_string(),
        "Do not create an expectation when the supplied source is not explicit enough.".to_string(),
        "Do not invent node IDs or evidence IDs. Every claim must include this source evidence ID."
            .to_string(),
        format!(
            "Use only this stable behavioral taxonomy: {}.",
            BEHAVIORAL_CLAIM_TAXONOMY.join(", ")
        ),
        format!("Known node IDs: {}.", list(&refs.node_ids)),
        format!("Known evidence IDs: {}.", list(&refs.evidence_ids)),
        format!("Required source evidence ID: {}.", source.evidence.id),
        format!(
            "JSON schema example (keys and types are exact): {}.",
            canonical_json(&contract)
        ),
        format!(
            "Explicit expected source ({}, {}, {}):\n{}",
            source.evidence.kind, source.evidence.path, source.anchor, source.content
        ),
    ]
    .join("\n")
}

/// Прийнятий claim мапінгу.
#[derive(Debug, Clone, PartialEq)]
struct MappedClaim {
    subject_id: String,
    predicate: String,
    value: Value,
    evidence_ids: Vec<String>,
    confidence: f64,
    source_id: String,
}

impl MappedClaim {
    /// Ключ сортування — `JSON.stringify` у ПОРЯДКУ ВСТАВКИ, як у JS.
    fn sort_key(&self) -> String {
        format!(
            "{{\"subjectId\":{},\"predicate\":{},\"value\":{},\"evidenceIds\":{},\"confidence\":{},\"sourceId\":{}}}",
            Value::String(self.subject_id.clone()),
            Value::String(self.predicate.clone()),
            canonical_json(&self.value),
            canonical_json(&Value::from(self.evidence_ids.clone())),
            canonical_json(&json!(self.confidence)),
            Value::String(self.source_id.clone())
        )
    }
}

/// Перевіряє сирий результат моделі проти канонічних посилань графа — порт
/// `parseExpectedSourceResult`.
///
/// Кожен claim МУСИТЬ містити evidence самого джерела: очікування без
/// підстави в тексті, з якого його виведено, не має права існувати.
fn parse_expected_source_result(
    text: &str,
    refs: &Refs,
    source: &ExpectedSource,
) -> Result<Vec<MappedClaim>, String> {
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return Err("invalid-expected-source-json".to_string());
    };
    let Some(object) = parsed.as_object() else {
        return Err("invalid-expected-source-shape".to_string());
    };
    if !has_exact_keys(object, &["claims"]) {
        return Err("invalid-expected-source-shape".to_string());
    }
    let Some(raw_claims) = object.get("claims").and_then(Value::as_array) else {
        return Err("invalid-expected-source-shape".to_string());
    };

    let mut claims = Vec::with_capacity(raw_claims.len());
    for raw in raw_claims {
        let Some(claim) = raw.as_object() else {
            return Err("invalid-expected-claim-shape".to_string());
        };
        if !has_exact_keys(
            claim,
            &[
                "subjectId",
                "predicate",
                "value",
                "evidenceIds",
                "confidence",
            ],
        ) {
            return Err("invalid-expected-claim-shape".to_string());
        }
        let subject_id = claim.get("subjectId").and_then(Value::as_str);
        let predicate = claim.get("predicate").and_then(Value::as_str);
        let evidence_ids = normalized_ids(claim.get("evidenceIds"));
        let confidence = claim.get("confidence").and_then(Value::as_f64);
        let known_subject = subject_id.is_some_and(|id| refs.node_ids.contains(id));
        let known_predicate =
            predicate.is_some_and(|value| BEHAVIORAL_CLAIM_TAXONOMY.contains(&value));
        let evidence_ok = evidence_ids.as_ref().is_some_and(|ids| {
            !ids.is_empty()
                && ids.contains(&source.evidence.id)
                && ids.iter().all(|id| refs.evidence_ids.contains(id))
        });
        let confidence_ok = confidence.is_some_and(|value| (0.0..=1.0).contains(&value));
        if !known_subject || !known_predicate || !evidence_ok || !confidence_ok {
            return Err("unknown-expected-mapping-reference".to_string());
        }
        claims.push(MappedClaim {
            subject_id: subject_id.unwrap_or_default().to_string(),
            predicate: predicate.unwrap_or_default().to_string(),
            value: claim.get("value").cloned().unwrap_or(Value::Null),
            evidence_ids: evidence_ids.unwrap_or_default(),
            confidence: confidence.unwrap_or_default(),
            source_id: source.id.clone(),
        });
    }
    claims.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
    Ok(claims)
}

/// Overlay очікувань.
#[derive(Debug, Clone, PartialEq)]
pub struct Overlay {
    pub claims: Vec<Value>,
    pub evidence: Vec<Value>,
}

/// Результат мапінгу.
#[derive(Debug, Clone)]
pub enum MappingOutcome {
    Mapped {
        overlay: Overlay,
        cache: Value,
    },
    Blocked {
        diagnostics: Vec<Diagnostic>,
        cache: Value,
    },
}

/// Складає overlay, дедуплікуючи підтверджений намір — порт
/// `overlayFromMappings`.
///
/// Однакове твердження з кількох джерел — це ОДИН claim із обʼєднаним
/// evidence і МІНІМАЛЬНОЮ впевненістю: підтвердження додає підстав, але не
/// піднімає певності вище найслабшого джерела.
fn overlay_from_mappings(
    domain_id: &str,
    sources: &[ExpectedSource],
    mapped: &[MappedClaim],
) -> Overlay {
    struct Group {
        subject_id: String,
        predicate: String,
        value: Value,
        evidence_ids: BTreeSet<String>,
        source_ids: BTreeSet<String>,
        confidence: f64,
    }
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    for claim in mapped {
        let key = format!(
            "[{},{},{}]",
            Value::String(claim.subject_id.clone()),
            Value::String(claim.predicate.clone()),
            canonical_json(&claim.value)
        );
        let group = groups.entry(key).or_insert_with(|| Group {
            subject_id: claim.subject_id.clone(),
            predicate: claim.predicate.clone(),
            value: claim.value.clone(),
            evidence_ids: BTreeSet::new(),
            source_ids: BTreeSet::new(),
            confidence: 1.0,
        });
        group
            .evidence_ids
            .extend(claim.evidence_ids.iter().cloned());
        group.source_ids.insert(claim.source_id.clone());
        group.confidence = group.confidence.min(claim.confidence);
    }

    let mut claims: Vec<Value> = groups
        .into_values()
        .map(|group| {
            let evidence_ids: Vec<String> = group.evidence_ids.into_iter().collect();
            let source_ids: Vec<String> = group.source_ids.into_iter().collect();
            json!({
                "id": format!("claim:expected:{}", short_hash(&json!({
                    "domainId": domain_id,
                    "subjectId": group.subject_id,
                    "predicate": group.predicate,
                    "value": group.value,
                    "evidenceIds": evidence_ids,
                }))),
                "subjectId": group.subject_id,
                "predicate": group.predicate,
                "value": group.value,
                "evidenceIds": evidence_ids,
                "confidence": group.confidence,
                "sourceFingerprint": canonical_hash(&json!({
                    "sourceIds": source_ids,
                    "subjectId": group.subject_id,
                    "predicate": group.predicate,
                    "value": group.value,
                })),
            })
        })
        .collect();
    claims.sort_by(|left, right| {
        js_locale_cmp(
            left.get("id").and_then(Value::as_str).unwrap_or_default(),
            right.get("id").and_then(Value::as_str).unwrap_or_default(),
        )
    });

    let used: BTreeSet<String> = claims
        .iter()
        .filter_map(|claim| claim.get("evidenceIds").and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    let mut evidence: Vec<Value> = sources
        .iter()
        .filter(|source| used.contains(&source.evidence.id))
        .map(|source| source.evidence.to_value())
        .collect();
    evidence.sort_by(|left, right| {
        js_locale_cmp(
            left.get("id").and_then(Value::as_str).unwrap_or_default(),
            right.get("id").and_then(Value::as_str).unwrap_or_default(),
        )
    });
    Overlay { claims, evidence }
}

/// Вхід мапінгу.
pub struct MappingInput<'a> {
    pub graph: &'a Value,
    pub sources: &'a [ExpectedSource],
    pub cache: Option<VersionedCache>,
    pub cache_path: Option<&'a Path>,
    pub model_policy: Vec<Tier>,
    pub submit: SubmitBatchFn,
    pub chain: ChainRef,
}

/// Мапить знайдені джерела на канонічні ID графа — порт
/// `mapExpectedSources`.
///
/// Порожній вхід ОБХОДИТЬ транспорт цілком: домен без явних очікувань не має
/// платити за прогін моделі.
///
/// # Errors
/// Помилка вводу-виводу кешу — fail-closed.
pub async fn map_expected_sources(input: MappingInput<'_>) -> Result<MappingOutcome, String> {
    let mut cache = load_versioned_cache(input.cache_path, input.cache, CACHE_VERSION)?;
    let blocked = |diagnostics: Vec<Diagnostic>, cache: &VersionedCache| {
        Ok(MappingOutcome::Blocked {
            diagnostics,
            cache: cache.to_value(),
        })
    };

    let refs = match graph_references(input.graph) {
        Ok(refs) => refs,
        Err(diagnostics) => return blocked(diagnostics, &cache),
    };
    let mut ids: BTreeSet<&str> = BTreeSet::new();
    for source in input.sources {
        if source.id.is_empty()
            || source.content.trim().is_empty()
            || source.evidence.id.is_empty()
            || source.evidence.content_hash.is_empty()
        {
            return blocked(
                vec![Diagnostic::new(
                    "invalid-expected-source",
                    "Source мусить мати id, content і complete evidence.",
                    None,
                )],
                &cache,
            );
        }
        if !ids.insert(source.id.as_str()) || !ids.insert(source.evidence.id.as_str()) {
            return blocked(
                vec![Diagnostic::new(
                    "duplicate-expected-source",
                    &format!("Повторний source/evidence ID {}.", source.id),
                    Some(&source.evidence.path),
                )],
                &cache,
            );
        }
    }
    if input.sources.is_empty() {
        return Ok(MappingOutcome::Mapped {
            overlay: Overlay {
                claims: Vec::new(),
                evidence: Vec::new(),
            },
            cache: cache.to_value(),
        });
    }
    if input.model_policy != crate::wave::default_model_policy() {
        return blocked(
            vec![Diagnostic::new(
                "invalid-expected-model-policy",
                "Expected mapping використовує universal policy min -> avg -> max.",
                None,
            )],
            &cache,
        );
    }

    // Evidence самих джерел додається до відомих: claim мусить посилатись на
    // текст, з якого його виведено, а він у графі ще не існує.
    let mut mapping_refs = Refs {
        domain_id: refs.domain_id.clone(),
        node_ids: refs.node_ids.clone(),
        evidence_ids: refs.evidence_ids.clone(),
    };
    mapping_refs.evidence_ids.extend(
        input
            .sources
            .iter()
            .map(|source| source.evidence.id.clone()),
    );

    struct Work<'a> {
        source: &'a ExpectedSource,
        cache_key: String,
        prompt: String,
    }
    let policy_names: Vec<&str> = input
        .model_policy
        .iter()
        .map(|tier| crate::wave::tier_name(*tier))
        .collect();
    let work: Vec<Work<'_>> = input
        .sources
        .iter()
        .map(|source| Work {
            source,
            cache_key: canonical_hash(&json!({
                "schema": "package-knowledge-expected-v1",
                "policy": policy_names,
                "domainId": refs.domain_id,
                "nodeIds": refs.node_ids.iter().cloned().collect::<Vec<_>>(),
                "evidenceIds": mapping_refs.evidence_ids.iter().cloned().collect::<Vec<_>>(),
                "source": source.to_value(),
            })),
            prompt: mapping_prompt(source, &mapping_refs),
        })
        .collect();

    let mut mapped: Vec<MappedClaim> = Vec::new();
    let mut pending: Vec<&Work<'_>> = Vec::new();
    for item in &work {
        let cached = cache
            .entries
            .get(&item.cache_key)
            .and_then(Value::as_str)
            .and_then(|text| parse_expected_source_result(text, &mapping_refs, item.source).ok());
        match cached {
            Some(claims) => mapped.extend(claims),
            None => pending.push(item),
        }
    }

    let mut failures: BTreeMap<String, String> = BTreeMap::new();
    for tier in &input.model_policy {
        if pending.is_empty() {
            break;
        }
        let items = pending
            .iter()
            .map(|item| WaveItem {
                custom_id: item.source.id.clone(),
                prompt: item.prompt.clone(),
            })
            .collect();
        let responses = submit_wave(items, *tier, &input.submit, &input.chain).await;
        let mut retry = Vec::new();
        for item in pending {
            let response: Option<&WaveResult> = responses.get(&item.source.id);
            let text = response.and_then(|result| result.outcome.as_ref().ok());
            let Some(text) = text else {
                let code = match response {
                    Some(_) => "expected-source-batch-error",
                    None => "expected-source-missing-result",
                };
                failures.insert(item.source.id.clone(), code.to_string());
                retry.push(item);
                continue;
            };
            match parse_expected_source_result(text, &mapping_refs, item.source) {
                Ok(claims) => {
                    cache
                        .entries
                        .insert(item.cache_key.clone(), Value::String(text.clone()));
                    mapped.extend(claims);
                    failures.remove(&item.source.id);
                }
                Err(reason) => {
                    failures.insert(item.source.id.clone(), reason);
                    retry.push(item);
                }
            }
        }
        pending = retry;
    }
    save_versioned_cache(input.cache_path, &cache)?;

    if !pending.is_empty() {
        let diagnostics = pending
            .iter()
            .map(|item| {
                Diagnostic::new(
                    failures
                        .get(&item.source.id)
                        .map_or("unresolved-expected-source", String::as_str),
                    "Expected source не пройшов universal model ladder.",
                    Some(&item.source.evidence.path),
                )
            })
            .collect();
        return blocked(sort_diagnostics(diagnostics), &cache);
    }
    Ok(MappingOutcome::Mapped {
        overlay: overlay_from_mappings(&refs.domain_id, input.sources, &mapped),
        cache: cache.to_value(),
    })
}
