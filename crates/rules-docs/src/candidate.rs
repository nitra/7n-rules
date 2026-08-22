//! Детермінований кандидат package-knowledge — Rust-порт `candidate.mjs`.
//!
//! Оркестратор НЕ синтезує нічого моделлю і НЕ публікує артефакти. Він
//! fail-closed зшиває мовні екстрактори, нормалізований граф, явний
//! expected-шар, двигун прогалин, виявлення тем і фінальні quality gates в
//! одну атомарну операцію: або повний валідний граф, або самі лише
//! блокери — часткового графа не буває.
//!
//! # Три речі, які цей порт беріг
//!
//! 1. **Порядок джерел стабільний до виклику екстрактора.** Сортування
//!    відбувається ДО обходу, тож послідовність викликів `analyze_file`
//!    відтворювана — від неї залежать усі похідні ідентичності.
//! 2. **Перший же дефект стадії зупиняє конвеєр.** Кожна стадія повертає
//!    або результат, або блокери; наступна не бачить напівфабрикату.
//! 3. **Екстрактори лишаються ззовні.** У JS їх матеріалізує plugin-slot
//!    loader (`load-adapters.mjs`, поза цим портом — див. §5.0.15
//!    реєстру); тут вони приходять через [`KnowledgeExtractor`], як
//!    batch-фасад приходить через [`crate::wave::SubmitBatchFn`].
//!
//! # Чому блокери — це `Value`, а не типова структура
//!
//! JS повертає результат стадії ДОСЛІВНО (`return normalizedGraph`), а
//! стадії мають різні форми діагностик: `{code, detail, path}` у графа й
//! структурованих джерел, `{code, message, claimId}` в overlay,
//! `{code, message}` у двигуна прогалин, `{code, detail, previousTopicIds,
//! nextTopicIds}` у міграції ідентичностей, `{code, message, id}` у
//! валідатора. Звести їх в одну структуру можна лише або вигадавши поля,
//! або відкинувши наявні. Викликач (runner) трактує діагностики як
//! непрозорі й лише друкує їх — тож JSON тут чесний спільний тип, а не
//! втеча від типізації.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::deterministic::js_locale_cmp;
use crate::expected::{apply_expected_overlay, OverlayOutcome};
use crate::gaps::{evaluate_gaps, Gap, GapInput, GapOutcome, GateState, Validation};
use crate::graph::{build_normalized_graph, Domain, GraphOutcome};
use crate::identity::{reconcile_topic_identities, MigrationOutcome, MigrationPlan};
use crate::sources::SourceFile;
use crate::structured_sources::{merge_structured_fragments, Fragment};
use crate::topics::{discover_topics, Topic};
use crate::validator::{validate_knowledge_graph, ValidationInput};

/// Точний відбиток вмісту — той, що йде екстрактору у `file.contentHash`.
fn content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest.iter() {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256:{hex}")
}

/// Діагностика самого оркестратора — форма `{code, detail, path}`.
fn diagnostic(code: &str, detail: &str, path: Option<&str>) -> Value {
    json!({ "code": code, "detail": detail, "path": path })
}

/// Файл у тій формі, в якій його бачить екстрактор.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractorFile {
    /// POSIX-шлях відносно кореня домену.
    pub path: String,
    pub content: String,
    /// `sha256:`-відбиток `content`, обчислений оркестратором.
    pub content_hash: String,
}

/// Мовний екстрактор — Rust-подоба контракту `knowledge.extractor@1`.
///
/// # Чому синхронний
///
/// У JS `analyzeFile` асинхронний лише тому, що адаптер — динамічно
/// імпортований модуль; жодна стадія конвеєра не робить I/O, і `signal`,
/// який JS проносить крізь усю сигнатуру, не читає ЖОДЕН споживач у
/// `runner.mjs`. Синхронний метод не втрачає нічого з наявної поведінки й
/// не заражає `async`-ом викликача.
pub trait KnowledgeExtractor {
    /// Розширення, якими володіє екстрактор (`".mjs"`), з крапкою.
    fn extensions(&self) -> Vec<String>;

    /// Розбирає один файл.
    ///
    /// `Ok` — фрагмент у формі `{ok, ...}`: саме поле `ok` вирішує, чи
    /// фрагмент придатний, тож структурована невдача повертається як
    /// `Ok({"ok": false, "diagnostics": [...]})`.
    ///
    /// # Errors
    /// `Err` — порт гілки `catch`: екстрактор впав і не має що сказати
    /// структуровано; текст стає деталлю діагностики `extractor-threw`.
    fn analyze_file(&self, domain: &Domain, file: &ExtractorFile) -> Result<Value, String>;
}

/// Вхід конвеєра.
pub struct CandidateInput<'a> {
    pub domain: &'a Domain,
    pub sources: &'a [SourceFile],
    pub extractors: &'a [&'a dyn KnowledgeExtractor],
    /// Фрагменти структурованих джерел ([`crate::structured_sources`]).
    pub structured_fragments: &'a [Fragment],
    /// Явний expected-шар — `{claims, evidence}`.
    pub expected_overlay: &'a Value,
    /// Звʼязки від comparator-а ([`crate::gap_mappings`]).
    pub gap_mappings: &'a [crate::gap_mappings::Mapping],
    /// Історичні ID тем — `{topicId: [alias]}`.
    pub aliases_by_topic_id: &'a Value,
    /// Опублікований маніфест попереднього прогону, якщо він є.
    pub previous_manifest: Option<&'a Value>,
    /// Захищені зони попереднього прогону — `{topicId: [zone]}`.
    pub protected_zones_by_topic_id: Option<&'a Value>,
    /// Поріг впевненості вердиктів; JS-типове значення — `1`.
    pub minimum_gap_confidence: f64,
}

/// Готовий кандидат.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// Повний валідований граф.
    pub graph: Value,
    /// Фрагменти екстракторів — саме ті, що дали граф.
    pub fragments: Vec<Value>,
    pub migration_plan: MigrationPlan,
    pub protected_zones_by_topic_id: BTreeMap<String, Vec<Value>>,
}

/// Результат побудови кандидата.
#[derive(Debug, Clone, PartialEq)]
pub enum CandidateOutcome {
    Built(Box<Candidate>),
    /// Блокери СТАДІЇ, на якій конвеєр зупинився, у її власній формі —
    /// див. доккоментар модуля.
    Blocked(Vec<Value>),
}

/// `path.extname(...).toLowerCase()`.
///
/// Крапка на початку basename — не розширення (`.bashrc` → `""`), і це не
/// дрібниця: інакше dotfile отримав би екстрактор чужої мови.
fn extname(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    match base.rfind('.') {
        None | Some(0) => String::new(),
        Some(index) => base[index..].to_lowercase(),
    }
}

/// Будує індекс `розширення → екстрактор` і відхиляє неоднозначне володіння.
///
/// Гілок `invalid-extractors`/`invalid-extractor` тут немає свідомо: у JS
/// вони перевіряють ФОРМУ переданого обʼєкта (чи є `analyzeFile`, чи масив
/// `extensions`), а тут цю форму тримає [`KnowledgeExtractor`]. Лишається
/// рівно те, чого тип не ловить, — конфлікт двох екстракторів за одне
/// розширення.
fn index_extractors<'a>(
    extractors: &'a [&'a dyn KnowledgeExtractor],
) -> Result<BTreeMap<String, &'a dyn KnowledgeExtractor>, Vec<Value>> {
    let mut by_extension: BTreeMap<String, &dyn KnowledgeExtractor> = BTreeMap::new();
    let mut diagnostics = Vec::new();
    for extractor in extractors {
        for extension in extractor.extensions() {
            match by_extension.entry(extension) {
                Entry::Occupied(entry) => diagnostics.push(diagnostic(
                    "duplicate-extractor-extension",
                    &format!(
                        "Розширення {} належить кільком knowledge extractors.",
                        entry.key()
                    ),
                    None,
                )),
                Entry::Vacant(entry) => {
                    entry.insert(*extractor);
                }
            }
        }
    }
    if diagnostics.is_empty() {
        Ok(by_extension)
    } else {
        Err(diagnostics)
    }
}

/// Перевіряє й стабільно впорядковує вхідні джерела.
///
/// Небезпечний шлях (абсолютний, з `..` чи порожнім сегментом) — блокер, а
/// не нормалізація: «полагодити» шлях означало б мовчки перепризначити
/// власника файла.
fn normalize_sources(sources: &[SourceFile]) -> Result<Vec<SourceFile>, Vec<Value>> {
    let mut diagnostics = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for source in sources {
        let unsafe_path = source.path.is_empty()
            || source.path.starts_with('/')
            || source
                .path
                .split('/')
                .any(|segment| segment == ".." || segment.is_empty());
        if unsafe_path {
            diagnostics.push(diagnostic(
                "invalid-source",
                "Source мусить мати safe relative path і string content.",
                None,
            ));
            continue;
        }
        if seen.contains(&source.path.as_str()) {
            diagnostics.push(diagnostic(
                "duplicate-source-path",
                &source.path,
                Some(&source.path),
            ));
        }
        seen.push(&source.path);
    }
    if !diagnostics.is_empty() {
        return Err(diagnostics);
    }
    let mut sorted = sources.to_vec();
    sorted.sort_by(|left, right| js_locale_cmp(&left.path, &right.path));
    Ok(sorted)
}

/// Запускає один екстрактор і зводить будь-який його провал до діагностик.
fn extract_source(
    extractor: &dyn KnowledgeExtractor,
    domain: &Domain,
    source: &SourceFile,
) -> Result<Value, Vec<Value>> {
    let file = ExtractorFile {
        path: source.path.clone(),
        content: source.content.clone(),
        content_hash: content_hash(&source.content),
    };
    let fragment = match extractor.analyze_file(domain, &file) {
        Ok(fragment) => fragment,
        Err(error) => {
            return Err(vec![diagnostic(
                "extractor-threw",
                &error,
                Some(&source.path),
            )])
        }
    };
    if !fragment.is_object() {
        return Err(vec![diagnostic(
            "extractor-result-invalid",
            "Extractor не повернув structured result.",
            Some(&source.path),
        )]);
    }
    if fragment.get("ok") != Some(&Value::Bool(true)) {
        // Порожній список діагностик — теж провал контракту: екстрактор
        // мусить сказати, ЧОМУ не зміг.
        let own = fragment
            .get("diagnostics")
            .and_then(Value::as_array)
            .filter(|items| !items.is_empty())
            .cloned();
        return Err(own.unwrap_or_else(|| {
            vec![diagnostic(
                "extractor-failed",
                "Extractor завершився без diagnostic.",
                Some(&source.path),
            )]
        }));
    }
    Ok(fragment)
}

/// Тема у формі графа — поля й порядок дзеркальні до `topic-discovery.mjs`.
fn topic_to_value(topic: &Topic) -> Value {
    json!({
        "id": topic.id,
        "kind": topic.kind,
        "title": topic.title,
        "domainId": topic.domain_id,
        "anchorIds": topic.anchor_ids,
        "aliases": topic.aliases,
    })
}

/// Вердикт прогалини у формі графа — порт хвоста `evaluateGaps`.
fn gap_to_value(gap: &Gap) -> Value {
    json!({
        "id": gap.id,
        "status": gap.status,
        "expectedClaimId": gap.expected_claim_id,
        "implementedClaimIds": gap.implemented_claim_ids,
        "evidenceIds": gap.evidence_ids,
    })
}

fn graph_diagnostics(diagnostics: &[crate::graph::Diagnostic]) -> Vec<Value> {
    diagnostics
        .iter()
        .map(|item| diagnostic(&item.code, &item.detail, item.path.as_deref()))
        .collect()
}

fn structured_diagnostics(diagnostics: &[crate::structured_sources::Diagnostic]) -> Vec<Value> {
    diagnostics
        .iter()
        .map(|item| diagnostic(&item.code, &item.detail, item.path.as_deref()))
        .collect()
}

fn overlay_diagnostics(diagnostics: &[crate::expected::Diagnostic]) -> Vec<Value> {
    diagnostics
        .iter()
        .map(|item| json!({ "code": item.code, "message": item.message, "claimId": item.claim_id }))
        .collect()
}

fn gap_diagnostics(diagnostics: &[crate::gaps::Diagnostic]) -> Vec<Value> {
    diagnostics
        .iter()
        .map(|item| json!({ "code": item.code, "message": item.message }))
        .collect()
}

fn migration_diagnostics(diagnostics: &[crate::identity::Diagnostic]) -> Vec<Value> {
    diagnostics
        .iter()
        .map(|item| {
            json!({
                "code": item.code,
                "detail": item.detail,
                "previousTopicIds": item.previous_topic_ids,
                "nextTopicIds": item.next_topic_ids,
            })
        })
        .collect()
}

fn validation_diagnostics(diagnostics: &[crate::validator::Diagnostic]) -> Vec<Value> {
    diagnostics
        .iter()
        .map(|item| json!({ "code": item.code, "message": item.message, "id": item.id }))
        .collect()
}

/// Замінює `topics` і `gaps` у графі, не чіпаючи решти.
fn with_topics_and_gaps(graph: &Value, topics: Vec<Value>, gaps: Vec<Value>) -> Value {
    let mut object: Map<String, Value> = graph
        .as_object()
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    object.insert("topics".to_string(), Value::Array(topics));
    object.insert("gaps".to_string(), Value::Array(gaps));
    Value::Object(object)
}

/// Будує повний валідований кандидат графа без публікації — порт
/// `buildKnowledgeCandidate`.
///
/// Порядок стадій не переставний: overlay накладається на вже нормалізований
/// граф зі злитими структурованими фрагментами, прогалини рахуються по
/// графу З overlay-ем, теми виявляються на тому ж графі, а валідатор бачить
/// граф уже з темами й прогалинами — тобто рівно те, що пішло б у
/// публікацію.
#[must_use]
pub fn build_knowledge_candidate(input: CandidateInput<'_>) -> CandidateOutcome {
    if input.domain.id.is_empty() {
        return CandidateOutcome::Blocked(vec![diagnostic(
            "invalid-domain",
            "Domain мусить мати stable id.",
            None,
        )]);
    }
    let sources = match normalize_sources(input.sources) {
        Ok(sources) => sources,
        Err(diagnostics) => return CandidateOutcome::Blocked(diagnostics),
    };
    let by_extension = match index_extractors(input.extractors) {
        Ok(index) => index,
        Err(diagnostics) => return CandidateOutcome::Blocked(diagnostics),
    };

    let mut fragments = Vec::new();
    let mut diagnostics = Vec::new();
    for source in &sources {
        let extension = extname(&source.path);
        let Some(extractor) = by_extension.get(&extension) else {
            let subject = if extension.is_empty() {
                source.path.as_str()
            } else {
                extension.as_str()
            };
            diagnostics.push(diagnostic(
                "extractor-missing",
                &format!("Немає knowledge extractor для {subject}."),
                Some(&source.path),
            ));
            continue;
        };
        match extract_source(*extractor, input.domain, source) {
            Ok(fragment) => fragments.push(fragment),
            Err(own) => diagnostics.extend(own),
        }
    }
    if !diagnostics.is_empty() {
        return CandidateOutcome::Blocked(diagnostics);
    }

    let normalized = match build_normalized_graph(input.domain, &fragments) {
        GraphOutcome::Built(graph) => *graph,
        GraphOutcome::Blocked(diagnostics) => {
            return CandidateOutcome::Blocked(graph_diagnostics(&diagnostics))
        }
    };
    let structured =
        match merge_structured_fragments(&normalized, &input.domain.id, input.structured_fragments)
        {
            Ok(graph) => graph,
            Err(diagnostics) => {
                return CandidateOutcome::Blocked(structured_diagnostics(&diagnostics))
            }
        };
    let overlaid = match apply_expected_overlay(&structured, input.expected_overlay) {
        OverlayOutcome::Merged(graph) => *graph,
        OverlayOutcome::Blocked(diagnostics) => {
            return CandidateOutcome::Blocked(overlay_diagnostics(&diagnostics))
        }
    };
    let gates = Validation {
        parser: Some(GateState {
            ok: true,
            message: None,
        }),
        coverage: Some(GateState {
            ok: true,
            message: None,
        }),
    };
    let gaps = match evaluate_gaps(GapInput {
        graph: &overlaid,
        mappings: input.gap_mappings,
        unresolved_expected_claim_ids: &[],
        validation: gates,
        minimum_confidence: input.minimum_gap_confidence,
    }) {
        GapOutcome::Evaluated(gaps) => gaps,
        GapOutcome::Blocked(diagnostics) => {
            return CandidateOutcome::Blocked(gap_diagnostics(&diagnostics))
        }
    };

    let discovered: Vec<Value> = discover_topics(&overlaid, input.aliases_by_topic_id)
        .iter()
        .map(topic_to_value)
        .collect();
    let migration = reconcile_topic_identities(
        input.previous_manifest,
        &overlaid,
        &discovered,
        input.protected_zones_by_topic_id,
    );
    let (topics, protected_zones_by_topic_id, migration_plan) = match migration {
        MigrationOutcome::Resolved {
            topics,
            protected_zones_by_topic_id,
            plan,
        } => (topics, protected_zones_by_topic_id, plan),
        MigrationOutcome::Blocked { diagnostics, .. } => {
            return CandidateOutcome::Blocked(migration_diagnostics(&diagnostics))
        }
    };

    let graph = with_topics_and_gaps(&overlaid, topics, gaps.iter().map(gap_to_value).collect());
    let report = validate_knowledge_graph(ValidationInput {
        graph: &graph,
        fragments: &fragments,
        expected_domain_id: Some(&input.domain.id),
        human_projection: None,
    });
    if !report.ok {
        return CandidateOutcome::Blocked(validation_diagnostics(&report.diagnostics));
    }
    CandidateOutcome::Built(Box::new(Candidate {
        graph,
        fragments,
        migration_plan,
        protected_zones_by_topic_id,
    }))
}
