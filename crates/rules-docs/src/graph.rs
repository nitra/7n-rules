//! Побудова нормалізованого knowledge-графа — порт `normalized-graph.mjs`.
//!
//! Канонічними ідентифікаторами, непрозорими межами доменів і provenance
//! володіє ЯДРО, а не мовний адаптер. Будь-який провал екстрактора чи
//! порушення контракту блокує ВЕСЬ граф: часткового результату не буває, і
//! опублікувати його неможливо — половина графа виглядала б як повне знання
//! про домен.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::deterministic::{canonical_json, canonical_json_pretty, canonical_value, js_locale_cmp};

/// Дозволені види ребер — усе інше блокує граф.
const EDGE_KINDS: [&str; 17] = [
    "contains",
    "triggers",
    "invokes",
    "validates",
    "decides",
    "transitions",
    "reads",
    "mutates",
    "persists",
    "emits",
    "consumes",
    "integrates",
    "implements",
    "verifies",
    "expects",
    "recovers",
    "produces",
];

/// Дозволені ролі provenance.
const EVIDENCE_ROLES: [&str; 3] = ["syntax", "doc", "attribute"];

/// Блокувальна діагностика побудови.
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
        format!(
            "{}:{}:{}",
            self.path.as_deref().unwrap_or(""),
            self.code,
            self.detail
        )
    }
}

fn sort_diagnostics(mut diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    diagnostics.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
    diagnostics
}

/// Опис домену.
#[derive(Debug, Clone)]
pub struct Domain {
    pub id: String,
    pub ecosystem: Option<String>,
    pub name: Option<String>,
    pub root_manifest: Option<String>,
    pub source_fingerprint: Option<String>,
}

/// Результат побудови.
#[derive(Debug, Clone)]
pub enum GraphOutcome {
    Built(Box<Value>),
    Blocked(Vec<Diagnostic>),
}

/// Короткий digest — перші 24 hex-символи SHA-256 ВІД РЯДКА.
///
/// Як і в `topics`, аргумент тут — уже готовий рядок: подекуди це канонічний
/// JSON, а подекуди (opaque-специфікатор) сирий текст, і плутати ці два
/// випадки не можна.
fn digest(value: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(value.as_bytes());
    let mut hex = String::with_capacity(24);
    for byte in digest.iter().take(12) {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// Половинно-відкритий byte-span придатний для traceability.
fn is_valid_byte_span(span: Option<&Value>) -> bool {
    let Some(span) = span.filter(|span| span.is_object()) else {
        return false;
    };
    let start = span.get("startByte").and_then(Value::as_u64);
    let end = span.get("endByte").and_then(Value::as_u64);
    matches!((start, end), (Some(start), Some(end)) if end >= start)
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Мінімальний контракт успішного фрагмента — порт `validateFragment`.
fn validate_fragment(raw: &Value) -> Result<&Value, Vec<Diagnostic>> {
    if !raw.is_object() {
        return Err(vec![Diagnostic::new(
            "invalid-fragment",
            "Extractor result не є обʼєктом.",
            None,
        )]);
    }
    if raw.get("ok") == Some(&Value::Bool(false)) {
        // Провал екстрактора несе СВОЇ діагностики — саме вони пояснюють
        // причину; підміняти їх власною було б втратою інформації.
        let reported = raw
            .get("diagnostics")
            .and_then(Value::as_array)
            .filter(|items| !items.is_empty());
        return Err(match reported {
            Some(items) => items
                .iter()
                .map(|item| Diagnostic {
                    code: string_field(item, "code").unwrap_or_default().to_string(),
                    detail: string_field(item, "detail").unwrap_or_default().to_string(),
                    path: string_field(item, "path").map(str::to_string),
                })
                .collect(),
            None => vec![Diagnostic::new(
                "extractor-failed",
                "Extractor завершився без structured diagnostic.",
                None,
            )],
        });
    }
    let file = raw.get("file");
    let path = file.and_then(|file| string_field(file, "path"));
    let language = file.and_then(|file| string_field(file, "language"));
    let content_hash = file
        .and_then(|file| string_field(file, "contentHash"))
        .filter(|hash| !hash.is_empty());
    if raw.get("ok") != Some(&Value::Bool(true))
        || path.is_none()
        || language.is_none()
        || content_hash.is_none()
    {
        return Err(vec![Diagnostic::new(
            "invalid-fragment",
            "Успішний fragment мусить мати ok=true і непорожні file.path/file.language/file.contentHash.",
            path,
        )]);
    }
    if raw.get("units").and_then(Value::as_array).is_none()
        || raw.get("edges").and_then(Value::as_array).is_none()
    {
        return Err(vec![Diagnostic::new(
            "invalid-fragment",
            "Успішний fragment мусить містити units[] та edges[].",
            path,
        )]);
    }
    Ok(raw)
}

/// Канонічний ID одиниці коду — НЕ залежить від фізичного шляху файла.
///
/// Саме тому переміщення файла не «створює» новий вузол: ідентичність несе
/// кваліфікований шлях символу, а не тека.
#[must_use]
pub fn create_code_unit_id(domain_id: &str, language: &str, qualified_path: &str) -> String {
    format!("code-unit:{domain_id}:{language}:{qualified_path}")
}

/// Накопичувач графа.
#[derive(Default)]
struct GraphState {
    nodes: Vec<Value>,
    edges: Vec<Value>,
    evidence: Vec<Value>,
    node_ids: BTreeSet<String>,
    evidence_ids: BTreeSet<String>,
    diagnostics: Vec<Diagnostic>,
    local_ids_by_file: BTreeMap<String, BTreeMap<String, String>>,
    opaque_nodes: BTreeMap<String, Value>,
}

/// Додає provenance оголошення рівно один раз — порт
/// `appendDeclarationEvidence`.
fn append_declaration_evidence(
    state: &mut GraphState,
    file_key: &str,
    span: &Value,
    id: &str,
    content_hash: Option<&str>,
) {
    let evidence_input = json!({
        "path": file_key,
        "role": "syntax",
        "span": span,
        "symbolId": id,
    });
    let evidence_id = format!("evidence:{}", digest(&canonical_json(&evidence_input)));
    if !state.evidence_ids.insert(evidence_id.clone()) {
        return;
    }
    state.evidence.push(json!({
        "id": evidence_id,
        "kind": "code",
        "path": file_key,
        "symbolId": id,
        "span": canonical_value(span),
        "contentHash": content_hash,
        "role": "syntax",
    }));
}

/// Збирає вузли всіх успішних фрагментів — порт `collectUnits`.
fn collect_units(fragments: &[&Value], domain_id: &str, state: &mut GraphState) {
    for fragment in fragments {
        let file = fragment.get("file").expect("фрагмент уже валідований");
        let file_key = string_field(file, "path").unwrap_or_default();
        let language = string_field(file, "language").unwrap_or_default();
        let content_hash = string_field(file, "contentHash");
        let mut local_map: BTreeMap<String, String> = BTreeMap::new();

        for unit in fragment
            .get("units")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
        {
            let local_id = string_field(unit, "localId");
            let qualified_path = string_field(unit, "qualifiedPath");
            let kind = string_field(unit, "kind");
            let name = string_field(unit, "name");
            let span_ok = is_valid_byte_span(unit.get("span"));
            let (Some(local_id), Some(qualified_path), Some(kind), Some(name)) =
                (local_id, qualified_path, kind, name)
            else {
                state.diagnostics.push(Diagnostic::new(
                    "invalid-unit",
                    "Unit має містити localId, qualifiedPath, kind, name і валідний UTF-8 byte span.",
                    Some(file_key),
                ));
                continue;
            };
            if !span_ok {
                state.diagnostics.push(Diagnostic::new(
                    "invalid-unit",
                    "Unit має містити localId, qualifiedPath, kind, name і валідний UTF-8 byte span.",
                    Some(file_key),
                ));
                continue;
            }
            if local_map.contains_key(local_id) {
                state.diagnostics.push(Diagnostic::new(
                    "duplicate-local-id",
                    &format!("Повторний localId \"{local_id}\"."),
                    Some(file_key),
                ));
                continue;
            }
            let id = create_code_unit_id(domain_id, language, qualified_path);
            if state.node_ids.contains(&id) {
                state.diagnostics.push(Diagnostic::new(
                    "duplicate-node-id",
                    &format!("Canonical node ID \"{id}\" не унікальний."),
                    Some(file_key),
                ));
                continue;
            }
            local_map.insert(local_id.to_string(), id.clone());
            state.node_ids.insert(id.clone());

            let span = unit.get("span").cloned().unwrap_or(Value::Null);
            let mut attributes = Map::new();
            attributes.insert("language".to_string(), json!(language));
            attributes.insert("unitKind".to_string(), json!(kind));
            attributes.insert(
                "signature".to_string(),
                unit.get("signature").cloned().unwrap_or(Value::Null),
            );
            attributes.insert("qualifiedPath".to_string(), json!(qualified_path));
            attributes.insert("sourcePath".to_string(), json!(file_key));
            attributes.insert("span".to_string(), span.clone());
            // Розсип `...unit.attributes` іде ПІСЛЯ базових полів — тобто
            // адаптер має право перекрити будь-яке з них.
            if let Some(extra) = unit.get("attributes").and_then(Value::as_object) {
                for (key, value) in extra {
                    attributes.insert(key.clone(), value.clone());
                }
            }
            state.nodes.push(json!({
                "id": id,
                "kind": "code-unit",
                "name": name,
                "visibility": string_field(unit, "visibility").unwrap_or("private"),
                "domainId": domain_id,
                "attributes": canonical_value(&Value::Object(attributes)),
                "sourceFingerprint": content_hash,
            }));
            append_declaration_evidence(state, file_key, &span, &id, content_hash);
        }
        state
            .local_ids_by_file
            .insert(file_key.to_string(), local_map);
    }
}

/// Матеріалізує непрозорий вузол для зовнішнього специфікатора — порт
/// `opaqueTarget`.
fn opaque_target(state: &mut GraphState, domain_id: &str, specifier: &str) -> String {
    let id = format!("contract:{domain_id}:{}", digest(specifier));
    state.opaque_nodes.entry(id.clone()).or_insert_with(|| {
        json!({
            "id": id,
            "kind": "integration",
            "name": specifier,
            "visibility": "external",
            "domainId": domain_id,
            "attributes": {"opaque": true, "specifier": specifier},
            "sourceFingerprint": digest(specifier),
        })
    });
    id
}

/// Додає provenance ребра — порт `appendEdgeEvidence`.
fn append_edge_evidence(
    state: &mut GraphState,
    items: &[Value],
    file_key: &str,
    from_id: &str,
    content_hash: Option<&str>,
) -> Vec<String> {
    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        let path = string_field(item, "path").unwrap_or(file_key);
        let role = string_field(item, "role").unwrap_or("syntax");
        let span = item.get("span").cloned().unwrap_or(Value::Null);
        let evidence_input = json!({"path": path, "role": role, "span": span});
        let id = format!("evidence:{}", digest(&canonical_json(&evidence_input)));
        ids.push(id.clone());
        if !state.evidence_ids.insert(id.clone()) {
            continue;
        }
        state.evidence.push(json!({
            "id": id,
            "kind": "code",
            "path": path,
            "symbolId": from_id,
            "span": canonical_value(&span),
            "contentHash": content_hash,
            "role": role,
        }));
    }
    ids.sort_unstable();
    ids
}

/// Кінці ребра: локальні або непрозорі — порт `resolveEdgeEndpoints`.
fn resolve_edge_endpoints(
    edge: &Value,
    local_map: &BTreeMap<String, String>,
    state: &mut GraphState,
    domain_id: &str,
    file_key: &str,
) -> Result<(String, String), Diagnostic> {
    let from_local = string_field(edge, "fromLocalId").unwrap_or_default();
    let Some(from_id) = local_map.get(from_local) else {
        return Err(Diagnostic::new(
            "unknown-edge-source",
            &format!("Edge посилається на невідомий localId \"{from_local}\"."),
            Some(file_key),
        ));
    };
    let to = edge.get("to");
    let to_local = to.and_then(|to| string_field(to, "localId"));
    let mut to_id = to_local.and_then(|local| local_map.get(local).cloned());
    if let Some(local) = to_local {
        if to_id.is_none() {
            return Err(Diagnostic::new(
                "unknown-edge-target",
                &format!("Edge посилається на невідомий localId \"{local}\"."),
                Some(file_key),
            ));
        }
    }
    if to_id.is_none() {
        let specifier = to.and_then(|to| string_field(to, "unresolvedSpecifier"));
        let opaque = to.and_then(|to| to.get("opaque")) == Some(&Value::Bool(true));
        if let (Some(specifier), true) = (specifier, opaque) {
            to_id = Some(opaque_target(state, domain_id, specifier));
        }
    }
    let Some(to_id) = to_id else {
        return Err(Diagnostic::new(
            "invalid-edge-target",
            "Edge target має бути localId або opaque specifier.",
            Some(file_key),
        ));
    };
    Ok((from_id.clone(), to_id))
}

/// Повнота provenance ребра — порт `edgeEvidenceDiagnostic`.
///
/// Ребро без evidence — це припущення, а не факт; опублікувати його означало
/// б видати здогад за знання про код.
fn edge_evidence_diagnostic(edge: &Value, file_key: &str) -> Option<Diagnostic> {
    let kind = string_field(edge, "kind").unwrap_or_default();
    let evidence = edge.get("evidence").and_then(Value::as_array);
    let Some(evidence) = evidence.filter(|items| !items.is_empty()) else {
        return Some(Diagnostic::new(
            "edge-without-evidence",
            &format!("{kind} edge не має provenance."),
            Some(file_key),
        ));
    };
    let invalid = evidence.iter().any(|item| {
        let role_ok = match item.get("role") {
            None => true,
            Some(Value::String(role)) => EVIDENCE_ROLES.contains(&role.as_str()),
            Some(_) => false,
        };
        !is_valid_byte_span(item.get("span")) || !role_ok
    });
    invalid.then(|| {
        Diagnostic::new(
            "invalid-edge-evidence",
            &format!("{kind} edge має evidence без валідного UTF-8 byte span або provenance role."),
            Some(file_key),
        )
    })
}

/// Збирає ребра всіх успішних фрагментів — порт `collectEdges`.
fn collect_edges(fragments: &[&Value], domain_id: &str, state: &mut GraphState) {
    for fragment in fragments {
        let file = fragment.get("file").expect("фрагмент уже валідований");
        let file_key = string_field(file, "path").unwrap_or_default().to_string();
        let content_hash = string_field(file, "contentHash").map(str::to_string);
        let local_map = state
            .local_ids_by_file
            .get(&file_key)
            .cloned()
            .unwrap_or_default();

        for edge in fragment
            .get("edges")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
        {
            let kind = string_field(edge, "kind");
            if !kind.is_some_and(|kind| EDGE_KINDS.contains(&kind)) {
                let reported = kind.map_or_else(|| "undefined".to_string(), str::to_string);
                state.diagnostics.push(Diagnostic::new(
                    "invalid-edge-kind",
                    &format!("Невідомий edge kind \"{reported}\"."),
                    Some(&file_key),
                ));
                continue;
            }
            let endpoints =
                match resolve_edge_endpoints(edge, &local_map, state, domain_id, &file_key) {
                    Ok(endpoints) => endpoints,
                    Err(diagnostic) => {
                        state.diagnostics.push(diagnostic);
                        continue;
                    }
                };
            if let Some(diagnostic) = edge_evidence_diagnostic(edge, &file_key) {
                state.diagnostics.push(diagnostic);
                continue;
            }
            let evidence = edge
                .get("evidence")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let evidence_ids = append_edge_evidence(
                state,
                &evidence,
                &file_key,
                &endpoints.0,
                content_hash.as_deref(),
            );
            // Ідентичність ребра — МАСИВ, не обʼєкт: порядок елементів тут
            // змістовний, і канонізація ключів до нього не застосовна.
            let identity = json!([
                kind.unwrap_or_default(),
                endpoints.0,
                endpoints.1,
                evidence_ids
            ]);
            state.edges.push(json!({
                "id": format!("edge:{}", digest(&canonical_json(&identity))),
                "kind": kind.unwrap_or_default(),
                "fromId": endpoints.0,
                "toId": endpoints.1,
                "evidenceIds": evidence_ids,
            }));
        }
    }
}

/// Незмінна проєкція успішного графа — порт `finalizeGraph`.
fn finalize_graph(domain: &Domain, mut state: GraphState) -> Value {
    state.nodes.extend(state.opaque_nodes.values().cloned());
    let sort_by_id = |items: &mut Vec<Value>| {
        items.sort_by(|left, right| {
            js_locale_cmp(
                string_field(left, "id").unwrap_or_default(),
                string_field(right, "id").unwrap_or_default(),
            )
        });
    };
    sort_by_id(&mut state.nodes);
    sort_by_id(&mut state.edges);
    sort_by_id(&mut state.evidence);

    let mut domain_object = Map::new();
    domain_object.insert("id".to_string(), json!(domain.id));
    // Відсутнє поле домену НЕ стає `null`: у JS `undefined`-ключ зникає при
    // серіалізації, і граф із `null`-ом мав би іншу форму.
    for (key, value) in [
        ("ecosystem", &domain.ecosystem),
        ("name", &domain.name),
        ("rootManifest", &domain.root_manifest),
        ("sourceFingerprint", &domain.source_fingerprint),
    ] {
        if let Some(value) = value {
            domain_object.insert(key.to_string(), json!(value));
        }
    }
    json!({
        "schemaVersion": 1,
        "domain": canonical_value(&Value::Object(domain_object)),
        "nodes": state.nodes,
        "edges": state.edges,
        "claims": [],
        "topics": [],
        "gaps": [],
        "evidence": state.evidence,
    })
}

/// Будує нормалізований граф — порт `buildNormalizedGraph`.
///
/// Фрагменти можуть надходити в будь-якому порядку: і результат, і
/// діагностики завжди стабільно відсортовані.
#[must_use]
pub fn build_normalized_graph(domain: &Domain, fragments: &[Value]) -> GraphOutcome {
    if domain.id.is_empty() {
        return GraphOutcome::Blocked(vec![Diagnostic::new(
            "invalid-domain",
            "Domain мусить мати непорожній id.",
            None,
        )]);
    }
    let mut failures = Vec::new();
    let mut successful: Vec<&Value> = Vec::new();
    for fragment in fragments {
        match validate_fragment(fragment) {
            Ok(value) => successful.push(value),
            Err(diagnostics) => failures.extend(diagnostics),
        }
    }
    if !failures.is_empty() {
        return GraphOutcome::Blocked(sort_diagnostics(failures));
    }
    successful.sort_by(|left, right| {
        let path = |fragment: &Value| {
            fragment
                .get("file")
                .and_then(|file| string_field(file, "path"))
                .unwrap_or_default()
                .to_string()
        };
        js_locale_cmp(&path(left), &path(right))
    });

    let mut state = GraphState::default();
    collect_units(&successful, &domain.id, &mut state);
    collect_edges(&successful, &domain.id, &mut state);
    if !state.diagnostics.is_empty() {
        return GraphOutcome::Blocked(sort_diagnostics(state.diagnostics));
    }
    GraphOutcome::Built(Box::new(finalize_graph(domain, state)))
}

/// Байт-стабільна серіалізація графа — порт `serializeKnowledgeGraph`.
#[must_use]
pub fn serialize_knowledge_graph(graph: &Value) -> String {
    format!("{}\n", canonical_json_pretty(graph))
}
