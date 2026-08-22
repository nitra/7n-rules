//! Детерміновані quality gates графа — порт `validator.mjs`.
//!
//! Валідатор нічого не виправляє й нічого не публікує: будь-яка діагностика
//! лишає рішення про атомарну публікацію зовнішньому викликачу. Порядок
//! гейтів контрактний — схема ПЕРША, і при її провалі семантичний обхід не
//! виконується взагалі: ходити по графу, форма якого невідома, означає
//! отримувати помилки про наслідок замість причини.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use serde_json::Value;

use crate::deterministic::js_locale_cmp;

/// Схема v1, вендорена в крейт. Джерело правди лишається в
/// `npm/rules/doc-files/package_knowledge/schema/` — за побайтовим збігом
/// стежить anti-drift тест.
const SCHEMA: &str = include_str!("../schema/knowledge-graph-v1.schema.json");

/// Скомпільована схема — один раз на процес.
///
/// JS компілює її на КОЖЕН виклик (`await schemaValidator()`); поведінково це
/// те саме, бо схема незмінна, і різниця лише у витраченому часі.
static VALIDATOR: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    let schema: Value = serde_json::from_str(SCHEMA).expect("вендорена схема — валідний JSON");
    jsonschema::validator_for(&schema).expect("вендорена схема компілюється")
});

/// Діагностика валідації.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    /// Пояснення. Для `schema-invalid` це МАШИННІ поля — `<instancePath>
    /// <keyword>` — а не людська фраза: текст Ajv не відтворюється свідомо
    /// (див. доккоментар [`schema_diagnostic`]).
    pub message: String,
    /// Причетна ідентичність графа, якщо вона є.
    pub id: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, message: &str, id: Option<&str>) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            id: id.map(str::to_string),
        }
    }
}

/// Звіт валідації — форма дзеркальна до JS (`{ok, diagnostics}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationReport {
    pub ok: bool,
    pub diagnostics: Vec<Diagnostic>,
}

/// Вхід валідації.
pub struct ValidationInput<'a> {
    pub graph: &'a Value,
    /// Результати екстракторів — для coverage-гейта.
    pub fragments: &'a [Value],
    /// Очікувана ідентичність домену, якщо викликач її знає.
    pub expected_domain_id: Option<&'a str>,
    /// Згенерований людський Markdown — для перевірки на витік приватних імен.
    pub human_projection: Option<&'a str>,
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn string_list(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn ids_of(graph: &Value, collection: &str) -> BTreeSet<String> {
    graph
        .get(collection)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| string_field(item, "id"))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Діагностика порушення схеми — МАШИННА, без людської фрази.
///
/// JS підставляв сюди текст Ajv (`"/nodes must be array"`). Порт цього не
/// відтворює, і це свідоме рішення, а не спрощення: без `allErrors` Ajv
/// віддає РІВНО ОДНУ помилку — першу за порядком обходу, — а порядок обходу
/// специфікацією не заданий, тож «той самий текст» від іншої реалізації
/// недосяжний у принципі. Натомість тут стабільна машинна пара: шлях у
/// документі і порушене ключове слово (останній сегмент `schema_path`, тобто
/// канонічний `keywordLocation`).
fn schema_diagnostic(error: &jsonschema::ValidationError<'_>) -> Diagnostic {
    let instance_path = error.instance_path().to_string();
    let instance_path = if instance_path.is_empty() {
        "/".to_string()
    } else {
        instance_path
    };
    let schema_path = error.schema_path().to_string();
    let keyword = schema_path
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or("schema");
    Diagnostic::new(
        "schema-invalid",
        &format!("{instance_path} {keyword}"),
        None,
    )
}

/// Посилання ребер на вузли та evidence.
fn edge_reference_diagnostics(
    graph: &Value,
    node_ids: &BTreeSet<String>,
    evidence_ids: &BTreeSet<String>,
) -> Vec<Diagnostic> {
    let empty = Vec::new();
    let mut diagnostics = Vec::new();
    for edge in graph
        .get("edges")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let id = string_field(edge, "id").unwrap_or_default();
        for (key, code) in [
            ("fromId", "edge-source-missing"),
            ("toId", "edge-target-missing"),
        ] {
            let target = string_field(edge, key).unwrap_or_default();
            if !node_ids.contains(target) {
                let field = if key == "fromId" { "fromId" } else { "toId" };
                diagnostics.push(Diagnostic::new(
                    code,
                    &format!("Edge {id} має невідомий {field} {target}."),
                    Some(id),
                ));
            }
        }
        for evidence_id in string_list(edge, "evidenceIds") {
            if !evidence_ids.contains(&evidence_id) {
                diagnostics.push(Diagnostic::new(
                    "edge-evidence-missing",
                    &format!("Edge {id} має невідомий evidenceId {evidence_id}."),
                    Some(id),
                ));
            }
        }
    }
    diagnostics
}

/// Посилання claims на вузли та evidence.
fn claim_reference_diagnostics(
    graph: &Value,
    node_ids: &BTreeSet<String>,
    evidence_ids: &BTreeSet<String>,
) -> Vec<Diagnostic> {
    let empty = Vec::new();
    let mut diagnostics = Vec::new();
    for claim in graph
        .get("claims")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let id = string_field(claim, "id").unwrap_or_default();
        let subject = string_field(claim, "subjectId").unwrap_or_default();
        if !node_ids.contains(subject) {
            diagnostics.push(Diagnostic::new(
                "claim-subject-missing",
                &format!("Claim {id} має невідомий subjectId {subject}."),
                Some(id),
            ));
        }
        for evidence_id in string_list(claim, "evidenceIds") {
            if !evidence_ids.contains(&evidence_id) {
                diagnostics.push(Diagnostic::new(
                    "claim-evidence-missing",
                    &format!("Claim {id} має невідомий evidenceId {evidence_id}."),
                    Some(id),
                ));
            }
        }
    }
    diagnostics
}

/// Якорі тем.
fn topic_reference_diagnostics(graph: &Value, node_ids: &BTreeSet<String>) -> Vec<Diagnostic> {
    let empty = Vec::new();
    let mut diagnostics = Vec::new();
    for topic in graph
        .get("topics")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let id = string_field(topic, "id").unwrap_or_default();
        for anchor_id in string_list(topic, "anchorIds") {
            if !node_ids.contains(&anchor_id) {
                diagnostics.push(Diagnostic::new(
                    "topic-anchor-missing",
                    &format!("Topic {id} має невідомий anchorId {anchor_id}."),
                    Some(id),
                ));
            }
        }
    }
    diagnostics
}

/// Посилання прогалин на claims.
fn gap_reference_diagnostics(graph: &Value, claim_ids: &BTreeSet<String>) -> Vec<Diagnostic> {
    let empty = Vec::new();
    let mut diagnostics = Vec::new();
    for gap in graph
        .get("gaps")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let id = string_field(gap, "id").unwrap_or_default();
        let expected = string_field(gap, "expectedClaimId").unwrap_or_default();
        if !claim_ids.contains(expected) {
            diagnostics.push(Diagnostic::new(
                "gap-expected-claim-missing",
                &format!("Gap {id} має невідомий expectedClaimId {expected}."),
                Some(id),
            ));
        }
        for implemented_id in string_list(gap, "implementedClaimIds") {
            if !claim_ids.contains(&implemented_id) {
                diagnostics.push(Diagnostic::new(
                    "gap-implemented-claim-missing",
                    &format!("Gap {id} має невідомий claim {implemented_id}."),
                    Some(id),
                ));
            }
        }
    }
    diagnostics
}

/// Усі посилання графа ведуть до наявних ідентичностей.
fn reference_diagnostics(graph: &Value) -> Vec<Diagnostic> {
    let node_ids = ids_of(graph, "nodes");
    let evidence_ids = ids_of(graph, "evidence");
    let claim_ids = ids_of(graph, "claims");
    let mut diagnostics = edge_reference_diagnostics(graph, &node_ids, &evidence_ids);
    diagnostics.extend(claim_reference_diagnostics(graph, &node_ids, &evidence_ids));
    diagnostics.extend(topic_reference_diagnostics(graph, &node_ids));
    diagnostics.extend(gap_reference_diagnostics(graph, &claim_ids));
    diagnostics
}

/// Coverage-книги всіх фрагментів екстракторів.
///
/// Неповне покриття — це БЛОКЕР, а не прогалина: прогалина означає «ми
/// подивились і не знайшли», а тут ми просто не подивились.
fn coverage_diagnostics(fragments: &[Value]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for fragment in fragments {
        if fragment.get("ok") != Some(&Value::Bool(true)) {
            diagnostics.push(Diagnostic::new(
                "extractor-fragment-failed",
                "Coverage gate отримав failed extractor fragment.",
                None,
            ));
            continue;
        }
        let path = fragment
            .get("file")
            .and_then(|file| string_field(file, "path"));
        let coverage = fragment.get("coverage");
        let complete = coverage
            .map(|coverage| {
                coverage.get("complete") == Some(&Value::Bool(true))
                    && coverage.get("requiredUnits") == coverage.get("coveredUnits")
                    && coverage.get("requiredEdges") == coverage.get("coveredEdges")
            })
            .unwrap_or(false);
        if !complete {
            diagnostics.push(Diagnostic::new(
                "coverage-incomplete",
                &format!(
                    "Extractor coverage неповне для {}.",
                    path.unwrap_or("unknown source")
                ),
                path,
            ));
        }
    }
    diagnostics
}

/// Приватні імена в людській проєкції.
fn privacy_diagnostics(graph: &Value, human_projection: Option<&str>) -> Vec<Diagnostic> {
    let Some(projection) = human_projection else {
        return Vec::new();
    };
    let empty = Vec::new();
    graph
        .get("nodes")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|node| string_field(node, "visibility") == Some("private"))
        .filter_map(|node| {
            let name = string_field(node, "name")?;
            projection.contains(name).then(|| {
                Diagnostic::new(
                    "private-symbol-leak",
                    &format!("Human projection містить private symbol name \"{name}\"."),
                    string_field(node, "id"),
                )
            })
        })
        .collect()
}

/// Запускає гейти схеми, ідентичності, посилань, покриття і приватності —
/// порт `validateKnowledgeGraph`.
#[must_use]
pub fn validate_knowledge_graph(input: ValidationInput<'_>) -> ValidationReport {
    // Одна помилка схеми, не всі: JS створює Ajv без `allErrors`, тобто
    // зупиняється на першій. Видавати тут повний список означало б інший
    // контракт, а не «кращу діагностику».
    if let Err(error) = VALIDATOR.validate(input.graph) {
        return ValidationReport {
            ok: false,
            diagnostics: vec![schema_diagnostic(&error)],
        };
    }

    let mut diagnostics = Vec::new();
    let domain_id = input
        .graph
        .get("domain")
        .and_then(|domain| string_field(domain, "id"))
        .unwrap_or_default();
    if let Some(expected) = input.expected_domain_id.filter(|id| !id.is_empty()) {
        if domain_id != expected {
            diagnostics.push(Diagnostic::new(
                "domain-identity-mismatch",
                &format!("Candidate domain {domain_id} не збігається з expected {expected}."),
                Some(domain_id),
            ));
        }
    }
    diagnostics.extend(reference_diagnostics(input.graph));
    diagnostics.extend(coverage_diagnostics(input.fragments));
    diagnostics.extend(privacy_diagnostics(input.graph, input.human_projection));

    diagnostics.sort_by(|left, right| {
        js_locale_cmp(&left.code, &right.code).then_with(|| {
            js_locale_cmp(
                left.id.as_deref().unwrap_or(""),
                right.id.as_deref().unwrap_or(""),
            )
        })
    });
    ValidationReport {
        ok: diagnostics.is_empty(),
        diagnostics,
    }
}
