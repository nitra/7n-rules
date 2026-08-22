//! Планувальник bounded semantic chunks і хвиль залежностей — порт
//! `chunk-planner.mjs`.
//!
//! Планер не викликає модель і нічого не публікує: його результат —
//! ДЕТЕРМІНОВАНИЙ план виконання для map/reduce ([`crate::claims`]). Він
//! працює лише з уже нормалізованим графом і ТОЧНИМИ UTF-8 byte-span-ами, і
//! радше блокує прогін, ніж обрізає джерело під бюджет: обрізаний контекст
//! дав би claim, який неможливо звірити з кодом.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::Serialize;
use serde_json::{json, Value};

use crate::deterministic::{canonical_hash, canonical_json, js_locale_cmp};

/// Типовий бюджет одного chunk-а в токенах.
pub const DEFAULT_MAX_TOKENS: u64 = 1200;
/// Типовий fan-in reduce-дерева.
pub const DEFAULT_REDUCE_INPUTS: usize = 8;
/// Версія формату плану — входить у `cacheFingerprint`.
const PLANNER_VERSION: u64 = 1;

/// Блокувальна діагностика планера.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub detail: String,
    pub path: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, detail: &str, path: Option<String>) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.to_string(),
            path,
        }
    }

    /// Ключ упорядкування — дослівно `` `${path ?? ''}:${code}:${detail}` ``.
    fn sort_key(&self) -> String {
        format!(
            "{}:{}:{}",
            self.path.as_deref().unwrap_or(""),
            self.code,
            self.detail
        )
    }
}

/// Сортує діагностики для детермінованого виводу — порт `sortDiagnostics`.
fn sort_diagnostics(mut diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    diagnostics.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
    diagnostics
}

/// Текст одного джерела.
#[derive(Debug, Clone)]
pub struct SourceText {
    pub path: String,
    pub content: String,
}

/// Половинно-відкритий UTF-8 byte-span.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start_byte: usize,
    pub end_byte: usize,
}

/// Зріз джерела під один вузол.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitSlice {
    pub node_id: String,
    pub path: String,
    pub span: Span,
    pub text: String,
    pub content_hash: String,
}

/// Зріз джерела під одне evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSlice {
    pub id: String,
    pub path: String,
    pub span: Span,
    pub text: String,
    pub content_hash: String,
}

/// Provenance одного ребра.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeEvidence {
    pub edge_id: String,
    pub evidence: Vec<EvidenceSlice>,
}

/// Один map-chunk плану.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub id: String,
    pub wave: usize,
    pub component_ids: Vec<String>,
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
    pub unit_slices: Vec<UnitSlice>,
    pub edge_evidence: Vec<EdgeEvidence>,
    pub estimated_tokens: u64,
    pub depends_on_chunk_ids: Vec<String>,
    pub cache_fingerprint: String,
}

/// Одна хвиля плану.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanWave {
    pub index: usize,
    pub chunk_ids: Vec<String>,
    pub component_ids: Vec<String>,
}

/// Покриття плану.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub required_node_ids: Vec<String>,
    pub required_edge_ids: Vec<String>,
    pub covered_node_ids: Vec<String>,
    pub covered_edge_ids: Vec<String>,
    pub complete: bool,
}

/// Група одного рівня reduce-дерева.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReduceGroup {
    pub id: String,
    pub child_ids: Vec<String>,
}

/// Рівень reduce-дерева.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReduceLevel {
    pub level: usize,
    pub groups: Vec<ReduceGroup>,
}

/// Reduce-дерево плану.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReducePlan {
    pub levels: Vec<ReduceLevel>,
    pub root_ids: Vec<String>,
}

/// Політика, від якої залежить кеш map-стадії.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachePolicy {
    pub parser: Value,
    pub schema: Value,
    pub prompt: Value,
    pub model_policy: Value,
}

/// Готовий план виконання.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub planner_version: u64,
    pub max_tokens: u64,
    pub chunks: Vec<Chunk>,
    pub waves: Vec<PlanWave>,
    pub coverage: Coverage,
    pub reduce: ReducePlan,
    pub cache_policy: CachePolicy,
}

/// Результат планування.
#[derive(Debug, Clone)]
pub enum PlanOutcome {
    Planned(Box<Plan>),
    Blocked(Vec<Diagnostic>),
}

/// Вхід планера.
pub struct PlannerInput<'a> {
    pub graph: &'a Value,
    pub sources: &'a [SourceText],
    pub max_tokens: u64,
    pub max_reduce_inputs: usize,
    /// `None` — усі вузли `kind: "code-unit"`; `Some` дозволяє планувати інші
    /// види вузлів, але лише за наявності у них span-ів.
    pub required_node_ids: Option<Vec<String>>,
    /// `None` — усі ребра, чиє джерело серед запланованих вузлів.
    pub required_edge_ids: Option<Vec<String>>,
    pub parser: Value,
    pub schema: Value,
    pub prompt: Value,
    pub model_policy: Value,
}

/// Проіндексоване джерело.
struct IndexedSource {
    content_hash: String,
    bytes: Vec<u8>,
}

/// Матеріалізований вузол.
struct Unit {
    slice: UnitSlice,
    cost: u64,
}

/// Матеріалізоване ребро.
struct PlannedEdge {
    id: String,
    from_id: String,
    to_id: Option<String>,
    evidence_slices: Vec<EvidenceSlice>,
    cost: u64,
}

type RequiredNodes<'a> = (Vec<String>, HashMap<String, &'a Value>);
type MaterializedInputs = (BTreeMap<String, Unit>, Vec<PlannedEdge>);

/// SCC-компонента.
#[derive(Debug, Clone)]
struct Component {
    id: String,
    node_ids: Vec<String>,
    edge_ids: Vec<String>,
    dependency_component_ids: Vec<String>,
    cost: u64,
}

/// Чи не розрізає byte-offset UTF-8 continuation-байт — порт
/// `isUtf8Boundary`.
fn is_utf8_boundary(bytes: &[u8], offset: usize) -> bool {
    if offset == 0 || offset == bytes.len() {
        return true;
    }
    match bytes.get(offset) {
        Some(byte) => *byte < 128 || *byte > 191,
        None => false,
    }
}

/// Оцінка вартості промпта без прив'язки до конкретного токенізатора — порт
/// `estimateTokens`.
///
/// Свідомо груба (байти/4 + структурний overhead): точний токенізатор
/// прив'язав би план до однієї моделі, а план мусить пережити зміну тиру.
fn estimate_tokens(byte_length: usize, overhead: u64) -> u64 {
    let estimate = byte_length.div_ceil(4) as u64 + overhead;
    estimate.max(1)
}

/// Скорочений хеш для ідентифікаторів — `sha256:` (7 символів) плюс 24 hex.
fn short_hash(value: &Value) -> String {
    canonical_hash(value)[7..31].to_string()
}

/// Індексує джерела за шляхом — порт `indexSources`.
fn index_sources(
    sources: &[SourceText],
) -> Result<HashMap<String, IndexedSource>, Vec<Diagnostic>> {
    let mut by_path: HashMap<String, IndexedSource> = HashMap::new();
    let mut diagnostics = Vec::new();
    for source in sources {
        if source.path.is_empty() {
            diagnostics.push(Diagnostic::new(
                "invalid-source",
                "Кожен source мусить мати непорожній path і string content.",
                None,
            ));
            continue;
        }
        if by_path.contains_key(&source.path) {
            diagnostics.push(Diagnostic::new(
                "duplicate-source",
                &format!("Повторний source path \"{}\".", source.path),
                Some(source.path.clone()),
            ));
            continue;
        }
        by_path.insert(
            source.path.clone(),
            IndexedSource {
                content_hash: canonical_hash(
                    &json!({"path": source.path, "content": source.content}),
                ),
                bytes: source.content.clone().into_bytes(),
            },
        );
    }
    if diagnostics.is_empty() {
        Ok(by_path)
    } else {
        Err(sort_diagnostics(diagnostics))
    }
}

/// Точний зріз джерела — порт `sourceSlice`. Відсутній шлях, вихід за межі
/// чи розріз UTF-8 code point — блокер, а не мовчазне звуження.
fn source_slice(
    sources: &HashMap<String, IndexedSource>,
    path: Option<&str>,
    span: Option<&Value>,
    owner: &str,
) -> Result<(String, Span, String, String), Diagnostic> {
    let Some(path) = path.filter(|path| !path.is_empty() && sources.contains_key(*path)) else {
        return Err(Diagnostic::new(
            "source-missing",
            &format!("Не знайдено source для {owner}."),
            path.map(str::to_string),
        ));
    };
    let start = span
        .and_then(|span| span.get("startByte"))
        .and_then(Value::as_u64);
    let end = span
        .and_then(|span| span.get("endByte"))
        .and_then(Value::as_u64);
    let (Some(start), Some(end)) = (start, end) else {
        return Err(Diagnostic::new(
            "span-invalid",
            &format!("{owner} не має валідного UTF-8 byte span."),
            Some(path.to_string()),
        ));
    };
    if end < start {
        return Err(Diagnostic::new(
            "span-invalid",
            &format!("{owner} не має валідного UTF-8 byte span."),
            Some(path.to_string()),
        ));
    }
    let (start, end) = (start as usize, end as usize);
    let source = &sources[path];
    if end > source.bytes.len()
        || !is_utf8_boundary(&source.bytes, start)
        || !is_utf8_boundary(&source.bytes, end)
    {
        return Err(Diagnostic::new(
            "span-invalid",
            &format!("{owner} span виходить за межі або розрізає UTF-8 code point."),
            Some(path.to_string()),
        ));
    }
    let text = String::from_utf8_lossy(&source.bytes[start..end]).into_owned();
    Ok((
        path.to_string(),
        Span {
            start_byte: start,
            end_byte: end,
        },
        text,
        source.content_hash.clone(),
    ))
}

/// Валідний непорожній рядковий ID зі значення.
fn string_id(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

/// Резолвить обовʼязкові вузли — порт `resolveRequiredNodes`.
fn resolve_required_nodes<'a>(
    graph: &'a Value,
    required_node_ids: Option<&[String]>,
) -> Result<RequiredNodes<'a>, Vec<Diagnostic>> {
    let Some(nodes) = graph.get("nodes").and_then(Value::as_array) else {
        return Err(vec![Diagnostic::new(
            "invalid-graph",
            "graph.nodes мусить бути масивом.",
            None,
        )]);
    };
    let mut node_by_id: HashMap<String, &Value> = HashMap::new();
    let mut diagnostics = Vec::new();
    for node in nodes {
        let Some(id) = string_id(node.get("id")) else {
            diagnostics.push(Diagnostic::new(
                "node-invalid",
                "Кожен graph node мусить мати stable id.",
                None,
            ));
            continue;
        };
        if node_by_id.contains_key(id) {
            diagnostics.push(Diagnostic::new(
                "node-duplicate",
                &format!("Повторний node ID \"{id}\"."),
                None,
            ));
        }
        node_by_id.insert(id.to_string(), node);
    }
    let requested: Vec<String> = match required_node_ids {
        Some(ids) => {
            if ids.iter().any(String::is_empty) {
                diagnostics.push(Diagnostic::new(
                    "required-nodes-invalid",
                    "requiredNodeIds мусить бути масивом непорожніх IDs.",
                    None,
                ));
            }
            ids.to_vec()
        }
        None => nodes
            .iter()
            .filter(|node| node.get("kind").and_then(Value::as_str) == Some("code-unit"))
            .filter_map(|node| string_id(node.get("id")).map(str::to_string))
            .collect(),
    };
    let ids: Vec<String> = {
        let unique: BTreeSet<String> = requested.into_iter().collect();
        unique.into_iter().collect()
    };
    for id in &ids {
        if !node_by_id.contains_key(id) {
            diagnostics.push(Diagnostic::new(
                "required-node-missing",
                &format!("Required node \"{id}\" відсутній у graph."),
                None,
            ));
        }
    }
    if diagnostics.is_empty() {
        Ok((ids, node_by_id))
    } else {
        Err(sort_diagnostics(diagnostics))
    }
}

/// Резолвить обовʼязкові ребра — порт `resolveRequiredEdges`. Ребро, чиє
/// джерело поза планом, блокує: його evidence нікому було б покрити.
fn resolve_required_edges<'a>(
    graph: &'a Value,
    required_nodes: &HashSet<String>,
    required_edge_ids: Option<&[String]>,
) -> Result<Vec<&'a Value>, Vec<Diagnostic>> {
    let Some(edges) = graph.get("edges").and_then(Value::as_array) else {
        return Err(vec![Diagnostic::new(
            "invalid-graph",
            "graph.edges мусить бути масивом.",
            None,
        )]);
    };
    let mut edge_by_id: HashMap<String, &Value> = HashMap::new();
    let mut diagnostics = Vec::new();
    for edge in edges {
        let Some(id) = string_id(edge.get("id")) else {
            diagnostics.push(Diagnostic::new(
                "edge-invalid",
                "Кожен graph edge мусить мати stable id.",
                None,
            ));
            continue;
        };
        if edge_by_id.contains_key(id) {
            diagnostics.push(Diagnostic::new(
                "edge-duplicate",
                &format!("Повторний edge ID \"{id}\"."),
                None,
            ));
        }
        edge_by_id.insert(id.to_string(), edge);
    }
    let requested: Vec<String> = match required_edge_ids {
        Some(ids) => {
            if ids.iter().any(String::is_empty) {
                diagnostics.push(Diagnostic::new(
                    "required-edges-invalid",
                    "requiredEdgeIds мусить бути масивом непорожніх IDs.",
                    None,
                ));
            }
            ids.to_vec()
        }
        None => edges
            .iter()
            .filter(|edge| {
                string_id(edge.get("fromId")).is_some_and(|from| required_nodes.contains(from))
            })
            .filter_map(|edge| string_id(edge.get("id")).map(str::to_string))
            .collect(),
    };
    let mut selected = Vec::new();
    let unique: BTreeSet<String> = requested.into_iter().collect();
    for id in unique {
        let Some(edge) = edge_by_id.get(&id) else {
            diagnostics.push(Diagnostic::new(
                "required-edge-missing",
                &format!("Required edge \"{id}\" відсутній у graph."),
                None,
            ));
            continue;
        };
        match string_id(edge.get("fromId")) {
            Some(from) if required_nodes.contains(from) => selected.push(*edge),
            _ => diagnostics.push(Diagnostic::new(
                "edge-source-not-planned",
                &format!("Edge \"{id}\" має source поза required nodes."),
                None,
            )),
        }
    }
    if diagnostics.is_empty() {
        Ok(selected)
    } else {
        Err(sort_diagnostics(diagnostics))
    }
}

/// Матеріалізує вузли й ребра — порт `materializeInputs`. Часткових
/// prompt-входів не буває: або весь evidence ребра на місці, або блокер.
fn materialize_inputs(
    node_by_id: &HashMap<String, &Value>,
    node_ids: &[String],
    edges: &[&Value],
    graph: &Value,
    sources: &HashMap<String, IndexedSource>,
) -> Result<MaterializedInputs, Vec<Diagnostic>> {
    let mut units = BTreeMap::new();
    let mut diagnostics = Vec::new();
    for node_id in node_ids {
        let node = node_by_id.get(node_id);
        let attributes = node.and_then(|node| node.get("attributes"));
        let slice = source_slice(
            sources,
            attributes
                .and_then(|attributes| attributes.get("sourcePath"))
                .and_then(Value::as_str),
            attributes.and_then(|attributes| attributes.get("span")),
            &format!("node \"{node_id}\""),
        );
        match slice {
            Ok((path, span, text, content_hash)) => {
                let cost = estimate_tokens(text.len(), 12);
                units.insert(
                    node_id.clone(),
                    Unit {
                        slice: UnitSlice {
                            node_id: node_id.clone(),
                            path,
                            span,
                            text,
                            content_hash,
                        },
                        cost,
                    },
                );
            }
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    let evidence_by_id: HashMap<&str, &Value> = graph
        .get("evidence")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str).map(|id| (id, item)))
                .collect()
        })
        .unwrap_or_default();

    let mut planned_edges = Vec::new();
    for edge in edges {
        let edge_id = string_id(edge.get("id")).unwrap_or_default().to_string();
        let evidence_ids = edge.get("evidenceIds").and_then(Value::as_array);
        let Some(evidence_ids) = evidence_ids.filter(|ids| !ids.is_empty()) else {
            diagnostics.push(Diagnostic::new(
                "edge-evidence-missing",
                &format!("Edge \"{edge_id}\" не має evidence IDs."),
                None,
            ));
            continue;
        };
        let unique: BTreeSet<&str> = evidence_ids.iter().filter_map(Value::as_str).collect();
        let mut evidence_slices = Vec::new();
        let mut edge_diagnostics = Vec::new();
        for evidence_id in unique {
            match evidence_by_id.get(evidence_id) {
                Some(evidence) => {
                    match source_slice(
                        sources,
                        evidence.get("path").and_then(Value::as_str),
                        evidence.get("span"),
                        &format!("evidence \"{evidence_id}\""),
                    ) {
                        Ok((path, span, text, content_hash)) => {
                            evidence_slices.push(EvidenceSlice {
                                id: evidence_id.to_string(),
                                path,
                                span,
                                text,
                                content_hash,
                            });
                        }
                        Err(diagnostic) => edge_diagnostics.push(diagnostic),
                    }
                }
                None => edge_diagnostics.push(Diagnostic::new(
                    "edge-evidence-missing",
                    &format!(
                        "Edge \"{edge_id}\" посилається на відсутнє evidence \"{evidence_id}\"."
                    ),
                    None,
                )),
            }
        }
        if !edge_diagnostics.is_empty() {
            diagnostics.extend(edge_diagnostics);
            continue;
        }
        let cost = 16
            + evidence_slices
                .iter()
                .map(|slice| estimate_tokens(slice.text.len(), 0))
                .sum::<u64>();
        planned_edges.push(PlannedEdge {
            id: edge_id,
            from_id: string_id(edge.get("fromId"))
                .unwrap_or_default()
                .to_string(),
            to_id: string_id(edge.get("toId")).map(str::to_string),
            evidence_slices,
            cost,
        });
    }
    if diagnostics.is_empty() {
        Ok((units, planned_edges))
    } else {
        Err(sort_diagnostics(diagnostics))
    }
}

/// Ітеративний Тарʼян — сильно звʼязні компоненти у стабільному порядку.
///
/// Ітеративний свідомо: рекурсія тут мала б глибину, яку задає ВХІДНИЙ граф,
/// тобто чужі дані керували б стеком процесу.
fn strongly_connected_components(
    node_ids: &[String],
    adjacency: &HashMap<String, Vec<String>>,
) -> Vec<Vec<String>> {
    let mut indices: HashMap<&str, usize> = HashMap::new();
    let mut low_links: HashMap<&str, usize> = HashMap::new();
    let mut on_stack: HashSet<&str> = HashSet::new();
    let mut stack: Vec<&str> = Vec::new();
    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut index = 0usize;

    let mut sorted: Vec<&str> = node_ids.iter().map(String::as_str).collect();
    sorted.sort_unstable();

    for root in sorted {
        if indices.contains_key(root) {
            continue;
        }
        // Кадр обходу: вузол і скільки його сусідів уже пройдено.
        let mut frames: Vec<(&str, usize)> = vec![(root, 0)];
        indices.insert(root, index);
        low_links.insert(root, index);
        index += 1;
        stack.push(root);
        on_stack.insert(root);

        while let Some((node_id, position)) = frames.pop() {
            let neighbours = adjacency
                .get(node_id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            if position < neighbours.len() {
                let target = neighbours[position].as_str();
                frames.push((node_id, position + 1));
                if !indices.contains_key(target) {
                    indices.insert(target, index);
                    low_links.insert(target, index);
                    index += 1;
                    stack.push(target);
                    on_stack.insert(target);
                    frames.push((target, 0));
                } else if on_stack.contains(target) {
                    let candidate = indices[target];
                    let current = low_links[node_id];
                    low_links.insert(node_id, current.min(candidate));
                }
                continue;
            }
            // Усіх сусідів пройдено — піднімаємо low-link у батька і, якщо це
            // корінь компоненти, знімаємо її зі стека.
            if let Some((parent, _)) = frames.last() {
                let child = low_links[node_id];
                let current = low_links[*parent];
                low_links.insert(parent, current.min(child));
            }
            if low_links[node_id] == indices[node_id] {
                let mut members = Vec::new();
                while let Some(member) = stack.pop() {
                    on_stack.remove(member);
                    members.push(member.to_string());
                    if member == node_id {
                        break;
                    }
                }
                members.sort_unstable();
                groups.push(members);
            }
        }
    }
    groups
}

/// Будує SCC-компоненти з призначеними ребрами — порт `createComponents`.
fn create_components(node_ids: &[String], edges: &[PlannedEdge]) -> Vec<Component> {
    let planned: HashSet<&str> = node_ids.iter().map(String::as_str).collect();
    let mut adjacency: HashMap<String, Vec<String>> =
        node_ids.iter().map(|id| (id.clone(), Vec::new())).collect();
    for edge in edges {
        if let Some(to_id) = edge.to_id.as_deref() {
            if planned.contains(edge.from_id.as_str()) && planned.contains(to_id) {
                adjacency
                    .entry(edge.from_id.clone())
                    .or_default()
                    .push(to_id.to_string());
            }
        }
    }
    for targets in adjacency.values_mut() {
        targets.sort_by(|left, right| js_locale_cmp(left, right));
    }

    let groups = strongly_connected_components(node_ids, &adjacency);
    let mut by_node_id: HashMap<String, String> = HashMap::new();
    let mut components: Vec<Component> = groups
        .into_iter()
        .map(|members| {
            let id = format!("scc:{}", short_hash(&json!(members)));
            for member in &members {
                by_node_id.insert(member.clone(), id.clone());
            }
            Component {
                id,
                node_ids: members,
                edge_ids: Vec::new(),
                dependency_component_ids: Vec::new(),
                cost: 0,
            }
        })
        .collect();

    let mut index_by_id: HashMap<String, usize> = components
        .iter()
        .enumerate()
        .map(|(index, component)| (component.id.clone(), index))
        .collect();
    for edge in edges {
        let Some(source_id) = by_node_id.get(&edge.from_id) else {
            continue;
        };
        let Some(&position) = index_by_id.get(source_id) else {
            continue;
        };
        components[position].edge_ids.push(edge.id.clone());
        let target = edge.to_id.as_deref().and_then(|to| by_node_id.get(to));
        if let Some(target_id) = target {
            if target_id != source_id {
                components[position]
                    .dependency_component_ids
                    .push(target_id.clone());
            }
        }
    }
    index_by_id.clear();

    for component in &mut components {
        component.edge_ids.sort_unstable();
        let unique: BTreeSet<String> = component.dependency_component_ids.drain(..).collect();
        component.dependency_component_ids = unique.into_iter().collect();
    }
    components.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));
    components
}

/// Додає вартість вузлів і призначених ребер — порт `costComponents`.
fn cost_components(
    components: &mut [Component],
    units: &BTreeMap<String, Unit>,
    edges: &[PlannedEdge],
) {
    let edge_cost: HashMap<&str, u64> = edges
        .iter()
        .map(|edge| (edge.id.as_str(), edge.cost))
        .collect();
    for component in components.iter_mut() {
        let nodes: u64 = component
            .node_ids
            .iter()
            .filter_map(|id| units.get(id))
            .map(|unit| unit.cost)
            .sum();
        let assigned: u64 = component
            .edge_ids
            .iter()
            .filter_map(|id| edge_cost.get(id.as_str()))
            .sum();
        component.cost = nodes + assigned;
    }
}

/// Формує хвилі «залежності спершу» — порт `createWaves`.
///
/// Граф конденсації SCC — завжди DAG, тож цикл тут структурно неможливий.
/// JS у цьому місці кидає виняток; порт повертає блокер: паніка на ВХІДНИХ
/// даних гірша за діагностику, навіть коли гілка недосяжна.
fn create_waves(components: &[Component]) -> Result<Vec<Vec<Component>>, Diagnostic> {
    let mut remaining: BTreeMap<String, BTreeSet<String>> = components
        .iter()
        .map(|component| {
            (
                component.id.clone(),
                component.dependency_component_ids.iter().cloned().collect(),
            )
        })
        .collect();
    let by_id: HashMap<&str, &Component> = components
        .iter()
        .map(|component| (component.id.as_str(), component))
        .collect();
    let mut waves = Vec::new();
    while !remaining.is_empty() {
        let mut ready: Vec<Component> = remaining
            .iter()
            .filter(|(_, dependencies)| dependencies.is_empty())
            .filter_map(|(id, _)| by_id.get(id.as_str()).map(|component| (*component).clone()))
            .collect();
        if ready.is_empty() {
            return Err(Diagnostic::new(
                "condensation-cycle",
                "SCC condensation graph unexpectedly contains a cycle.",
                None,
            ));
        }
        ready.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));
        for component in &ready {
            remaining.remove(&component.id);
        }
        for dependencies in remaining.values_mut() {
            for component in &ready {
                dependencies.remove(&component.id);
            }
        }
        waves.push(ready);
    }
    Ok(waves)
}

/// Пакує незалежні SCC однієї хвилі, не розрізаючи ні вузол, ні компоненту —
/// порт `packWave`.
fn pack_wave(components: &[Component], max_tokens: u64) -> Vec<Vec<Component>> {
    let mut chunks = Vec::new();
    let mut current: Vec<Component> = Vec::new();
    let mut cost = 0u64;
    for component in components {
        if !current.is_empty() && cost + component.cost > max_tokens {
            chunks.push(std::mem::take(&mut current));
            cost = 0;
        }
        cost += component.cost;
        current.push(component.clone());
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Будує обмежене reduce-дерево — порт `createReducePlan`.
fn create_reduce_plan(chunks: &[Chunk], max_inputs: usize) -> ReducePlan {
    let mut input_ids: Vec<String> = chunks.iter().map(|chunk| chunk.id.clone()).collect();
    input_ids.sort_unstable();
    let mut levels = Vec::new();
    let mut level = 0usize;
    while input_ids.len() > 1 {
        let groups: Vec<ReduceGroup> = input_ids
            .chunks(max_inputs)
            .map(|child_ids| ReduceGroup {
                id: format!("reduce:{level}:{}", short_hash(&json!(child_ids))),
                child_ids: child_ids.to_vec(),
            })
            .collect();
        input_ids = groups.iter().map(|group| group.id.clone()).collect();
        levels.push(ReduceLevel { level, groups });
        level += 1;
    }
    ReducePlan {
        levels,
        root_ids: input_ids,
    }
}

/// Планує нормалізовані вузли й ребра у bounded map-chunk-и та хвилі
/// залежностей — порт `planSemanticChunks`.
///
/// Типово обовʼязкові вузли — усі `code-unit`. Непрозорі cross-domain цілі не
/// є AST-вузлами, але їхні вхідні ребра лишаються обовʼязковими і
/// покриваються evidence-зрізом свого локального викликача.
#[must_use]
pub fn plan_semantic_chunks(input: PlannerInput<'_>) -> PlanOutcome {
    if input.max_tokens < 1 {
        return PlanOutcome::Blocked(vec![Diagnostic::new(
            "budget-invalid",
            "maxTokens мусить бути додатним safe integer.",
            None,
        )]);
    }
    if input.max_reduce_inputs < 2 {
        return PlanOutcome::Blocked(vec![Diagnostic::new(
            "reduce-inputs-invalid",
            "maxReduceInputs мусить бути safe integer не менше 2.",
            None,
        )]);
    }

    let sources = match index_sources(input.sources) {
        Ok(sources) => sources,
        Err(diagnostics) => return PlanOutcome::Blocked(diagnostics),
    };
    let (node_ids, node_by_id) =
        match resolve_required_nodes(input.graph, input.required_node_ids.as_deref()) {
            Ok(resolved) => resolved,
            Err(diagnostics) => return PlanOutcome::Blocked(diagnostics),
        };
    let required_nodes: HashSet<String> = node_ids.iter().cloned().collect();
    let edges = match resolve_required_edges(
        input.graph,
        &required_nodes,
        input.required_edge_ids.as_deref(),
    ) {
        Ok(edges) => edges,
        Err(diagnostics) => return PlanOutcome::Blocked(diagnostics),
    };
    let (units, planned_edges) =
        match materialize_inputs(&node_by_id, &node_ids, &edges, input.graph, &sources) {
            Ok(materialized) => materialized,
            Err(diagnostics) => return PlanOutcome::Blocked(diagnostics),
        };

    let mut components = create_components(&node_ids, &planned_edges);
    cost_components(&mut components, &units, &planned_edges);
    let oversized: Vec<&Component> = components
        .iter()
        .filter(|component| component.cost > input.max_tokens)
        .collect();
    if !oversized.is_empty() {
        // Обрізати джерело під бюджет планер не має права: claim, зроблений
        // із половини функції, не спростує сам себе — він просто буде
        // неправдою з валідним підписом.
        return PlanOutcome::Blocked(
            oversized
                .into_iter()
                .map(|component| {
                    Diagnostic::new(
                        if component.node_ids.len() > 1 {
                            "oversized-scc"
                        } else {
                            "oversized-unit"
                        },
                        &format!(
                            "{} потребує {} tokens за budget {}; planner не обрізає source.",
                            component.id, component.cost, input.max_tokens
                        ),
                        component
                            .node_ids
                            .first()
                            .and_then(|id| units.get(id))
                            .map(|unit| unit.slice.path.clone()),
                    )
                })
                .collect(),
        );
    }

    let component_waves = match create_waves(&components) {
        Ok(waves) => waves,
        Err(diagnostic) => return PlanOutcome::Blocked(vec![diagnostic]),
    };
    let edge_by_id: HashMap<&str, &PlannedEdge> = planned_edges
        .iter()
        .map(|edge| (edge.id.as_str(), edge))
        .collect();
    let mut component_to_chunk: HashMap<String, String> = HashMap::new();
    let mut chunks: Vec<Chunk> = Vec::new();
    for (wave, components_in_wave) in component_waves.iter().enumerate() {
        for group in pack_wave(components_in_wave, input.max_tokens) {
            let mut component_ids: Vec<String> =
                group.iter().map(|component| component.id.clone()).collect();
            component_ids.sort_unstable();
            let mut node_ids: Vec<String> = group
                .iter()
                .flat_map(|component| component.node_ids.iter().cloned())
                .collect();
            node_ids.sort_unstable();
            let mut edge_ids: Vec<String> = group
                .iter()
                .flat_map(|component| component.edge_ids.iter().cloned())
                .collect();
            edge_ids.sort_unstable();
            let id = format!(
                "chunk:{}",
                short_hash(&json!({
                    "componentIds": component_ids,
                    "nodeIds": node_ids,
                    "edgeIds": edge_ids,
                }))
            );
            for component in &group {
                component_to_chunk.insert(component.id.clone(), id.clone());
            }
            let unit_slices: Vec<UnitSlice> = node_ids
                .iter()
                .filter_map(|node_id| units.get(node_id).map(|unit| unit.slice.clone()))
                .collect();
            let edge_evidence: Vec<EdgeEvidence> = edge_ids
                .iter()
                .filter_map(|edge_id| {
                    edge_by_id.get(edge_id.as_str()).map(|edge| EdgeEvidence {
                        edge_id: edge_id.clone(),
                        evidence: edge.evidence_slices.clone(),
                    })
                })
                .collect();
            chunks.push(Chunk {
                id,
                wave,
                component_ids,
                node_ids,
                edge_ids,
                unit_slices,
                edge_evidence,
                estimated_tokens: group.iter().map(|component| component.cost).sum(),
                depends_on_chunk_ids: Vec::new(),
                cache_fingerprint: String::new(),
            });
        }
    }

    let component_by_id: HashMap<&str, &Component> = components
        .iter()
        .map(|component| (component.id.as_str(), component))
        .collect();
    let graph_schema_version = input
        .graph
        .get("schemaVersion")
        .cloned()
        .unwrap_or(Value::Null);
    for chunk in &mut chunks {
        let mut dependencies: BTreeSet<String> = BTreeSet::new();
        for component_id in &chunk.component_ids {
            if let Some(component) = component_by_id.get(component_id.as_str()) {
                for dependency_id in &component.dependency_component_ids {
                    if let Some(chunk_id) = component_to_chunk.get(dependency_id) {
                        dependencies.insert(chunk_id.clone());
                    }
                }
            }
        }
        chunk.depends_on_chunk_ids = dependencies.into_iter().collect();
        chunk.cache_fingerprint = canonical_hash(&json!({
            "plannerVersion": PLANNER_VERSION,
            "parser": input.parser,
            "schema": input.schema,
            "prompt": input.prompt,
            "modelPolicy": input.model_policy,
            "graphSchemaVersion": graph_schema_version,
            "nodeIds": chunk.node_ids,
            "edgeIds": chunk.edge_ids,
            "unitSlices": chunk.unit_slices.iter().map(|slice| json!({
                "nodeId": slice.node_id,
                "path": slice.path,
                "span": slice.span,
                "contentHash": slice.content_hash,
            })).collect::<Vec<_>>(),
            "edgeEvidence": chunk.edge_evidence.iter().map(|edge| json!({
                "edgeId": edge.edge_id,
                "evidence": edge.evidence.iter().map(|item| json!({
                    "id": item.id,
                    "path": item.path,
                    "span": item.span,
                    "contentHash": item.content_hash,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }));
    }
    chunks.sort_by(|left, right| {
        left.wave
            .cmp(&right.wave)
            .then_with(|| js_locale_cmp(&left.id, &right.id))
    });

    let mut covered_node_ids: Vec<String> = chunks
        .iter()
        .flat_map(|chunk| chunk.node_ids.iter().cloned())
        .collect();
    covered_node_ids.sort_unstable();
    let mut covered_edge_ids: Vec<String> = chunks
        .iter()
        .flat_map(|chunk| chunk.edge_ids.iter().cloned())
        .collect();
    covered_edge_ids.sort_unstable();
    let mut required_edge_ids: Vec<String> =
        planned_edges.iter().map(|edge| edge.id.clone()).collect();
    required_edge_ids.sort_unstable();
    let coverage = Coverage {
        complete: node_ids == covered_node_ids && required_edge_ids == covered_edge_ids,
        required_node_ids: node_ids,
        required_edge_ids,
        covered_node_ids,
        covered_edge_ids,
    };
    if !coverage.complete {
        return PlanOutcome::Blocked(vec![Diagnostic::new(
            "coverage-incomplete",
            "Planner не покрив усі required nodes або edges.",
            None,
        )]);
    }

    let reduce = create_reduce_plan(&chunks, input.max_reduce_inputs);
    let waves = component_waves
        .iter()
        .enumerate()
        .map(|(index, components_in_wave)| PlanWave {
            index,
            chunk_ids: chunks
                .iter()
                .filter(|chunk| chunk.wave == index)
                .map(|chunk| chunk.id.clone())
                .collect(),
            component_ids: components_in_wave
                .iter()
                .map(|component| component.id.clone())
                .collect(),
        })
        .collect();
    PlanOutcome::Planned(Box::new(Plan {
        planner_version: PLANNER_VERSION,
        max_tokens: input.max_tokens,
        chunks,
        waves,
        coverage,
        reduce,
        cache_policy: CachePolicy {
            parser: canonical_value(&input.parser),
            schema: canonical_value(&input.schema),
            prompt: canonical_value(&input.prompt),
            model_policy: canonical_value(&input.model_policy),
        },
    }))
}

/// Канонічна копія значення — порт `canonicalize` для `cachePolicy`.
///
/// У Rust порядок ключів у `Value` не спостережний для споживача (його задає
/// серіалізація), тож канонізація тут — це нормалізація ЗМІСТУ через той
/// самий писемник, яким рахуються хеші: одна дорога, одні правила.
fn canonical_value(value: &Value) -> Value {
    serde_json::from_str(&canonical_json(value)).unwrap_or_else(|_| value.clone())
}
