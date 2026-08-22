//! Узгодження ідентичностей тем між прогонами — порт
//! `identity-migration.mjs`.
//!
//! Перейменування символу чи переміщення файла не має втрачати стабільний ID
//! теми і привʼязаний до нього авторський текст. Але й ВИБИРАТИ за нас
//! модуль не має права: неоднозначний split/merge повертає ПЛАН і блокує
//! candidate, замість тихо взяти перший-ліпший варіант за порядком обходу.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::deterministic::js_locale_cmp;

/// Поріг, нижче якого збіг не вважається перейменуванням.
const MINIMUM_MATCH_SCORE: f64 = 0.75;

/// Ідентифікатори в підписі — усе, що парсер міг назвати. ASCII-класи явно:
/// `\w` у Rust-регулярках Unicode-обізнаний, а JS-оригінал (навіть із
/// прапорцем `u`) тут лишається ASCII.
static IDENTIFIER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z_$][A-Za-z0-9_$]*").expect("регулярка коректна"));

/// Прийняте зіставлення старої теми з новою.
#[derive(Debug, Clone, PartialEq)]
pub struct Mapping {
    pub from_topic_id: String,
    pub to_topic_id: String,
    pub score: f64,
    /// `stable-id` або `semantic-rename`.
    pub reason: String,
}

/// Блокувальна діагностика міграції.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub detail: String,
    pub previous_topic_ids: Vec<String>,
    pub next_topic_ids: Vec<String>,
}

/// План міграції — повертається В ОБОХ гілках: навіть заблокований прогін
/// має показати, що саме вдалось зіставити.
#[derive(Debug, Clone, PartialEq)]
pub struct MigrationPlan {
    /// `resolved` або `blocked`.
    pub status: String,
    pub mappings: Vec<Mapping>,
}

/// Результат узгодження.
#[derive(Debug, Clone, PartialEq)]
pub enum MigrationOutcome {
    Resolved {
        topics: Vec<Value>,
        protected_zones_by_topic_id: BTreeMap<String, Vec<Value>>,
        plan: MigrationPlan,
    },
    Blocked {
        diagnostics: Vec<Diagnostic>,
        plan: MigrationPlan,
    },
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Унікальні непорожні рядки в канонічному порядку.
fn sorted_strings<I: IntoIterator<Item = String>>(values: I) -> Vec<String> {
    let unique: BTreeSet<String> = values
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect();
    let mut result: Vec<String> = unique.into_iter().collect();
    result.sort_by(|left, right| js_locale_cmp(left, right));
    result
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
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

/// Підпис без імен символів — саме тому перейменування функції його НЕ
/// змінює.
fn semantic_signature(value: Option<&str>) -> String {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return String::new();
    };
    IDENTIFIER_RE.replace_all(value, "<id>").into_owned()
}

/// Частка спільних елементів двох колекцій (Жаккар).
fn overlap(left: &[String], right: &[String]) -> f64 {
    let union: BTreeSet<&String> = left.iter().chain(right.iter()).collect();
    if union.is_empty() {
        return 0.0;
    }
    let right_set: BTreeSet<&String> = right.iter().collect();
    let shared = left
        .iter()
        .filter(|value| right_set.contains(value))
        .count();
    shared as f64 / union.len() as f64
}

/// Реєстр захищених зон із маніфеста або явно переданий.
fn protected_registry(manifest: &Value, supplied: Option<&Value>) -> BTreeMap<String, Vec<Value>> {
    let source = supplied
        .or_else(|| manifest.get("protectedZonesByTopicId"))
        .or_else(|| manifest.get("zoneRegistry"));
    let Some(source) = source.and_then(Value::as_object) else {
        return BTreeMap::new();
    };
    source
        .iter()
        .filter(|(topic_id, _)| !topic_id.is_empty())
        .filter_map(|(topic_id, zones)| {
            zones
                .as_array()
                .map(|zones| (topic_id.clone(), zones.clone()))
        })
        .collect()
}

/// Дескриптор вузла БЕЗ шляху й назви: у відбиток входить поведінка, а не
/// фізичне розташування чи презентаційний заголовок.
fn node_semantic_key(node: &Value) -> String {
    let attributes = node.get("attributes");
    let attribute = |key: &str| {
        attributes
            .and_then(|attributes| string_field(attributes, key))
            .unwrap_or_default()
    };
    crate::deterministic::canonical_json(&serde_json::json!({
        "kind": string_field(node, "kind").unwrap_or_default(),
        "visibility": string_field(node, "visibility").unwrap_or_default(),
        "unitKind": attribute("unitKind"),
        "signature": semantic_signature(
            attributes.and_then(|attributes| string_field(attributes, "signature")),
        ),
    }))
}

/// Мітки суміжності, незалежні від нестабільних ID одиниць коду.
fn neighborhoods(graph: &Value) -> BTreeMap<String, Vec<String>> {
    let empty = Vec::new();
    let nodes = graph
        .get("nodes")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let node_by_id: BTreeMap<&str, &Value> = nodes
        .iter()
        .filter_map(|node| string_field(node, "id").map(|id| (id, node)))
        .collect();
    let mut values: BTreeMap<String, Vec<String>> = node_by_id
        .keys()
        .map(|id| ((*id).to_string(), Vec::new()))
        .collect();

    for edge in graph
        .get("edges")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let (Some(from_id), Some(to_id), Some(kind)) = (
            string_field(edge, "fromId"),
            string_field(edge, "toId"),
            string_field(edge, "kind"),
        ) else {
            continue;
        };
        let (Some(from), Some(to)) = (node_by_id.get(from_id), node_by_id.get(to_id)) else {
            continue;
        };
        if let Some(labels) = values.get_mut(from_id) {
            labels.push(format!("out:{kind}:{}", node_semantic_key(to)));
        }
        if let Some(labels) = values.get_mut(to_id) {
            labels.push(format!("in:{kind}:{}", node_semantic_key(from)));
        }
    }
    values
        .into_iter()
        .map(|(id, labels)| (id, sorted_strings(labels)))
        .collect()
}

/// Профіль теми для порівняння, стійкого до перейменувань.
struct TopicProfile {
    semantic: Vec<String>,
    fingerprints: Vec<String>,
    neighborhood: Vec<String>,
}

fn topic_profile(
    graph: &Value,
    topic: &Value,
    graph_neighborhoods: &BTreeMap<String, Vec<String>>,
) -> TopicProfile {
    let empty = Vec::new();
    let node_by_id: BTreeMap<&str, &Value> = graph
        .get("nodes")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter_map(|node| string_field(node, "id").map(|id| (id, node)))
        .collect();
    let anchors = sorted_strings(string_list(topic.get("anchorIds")));
    let nodes: Vec<&Value> = anchors
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()).copied())
        .collect();

    TopicProfile {
        semantic: sorted_strings(nodes.iter().map(|node| node_semantic_key(node))),
        fingerprints: sorted_strings(
            nodes
                .iter()
                .filter_map(|node| string_field(node, "sourceFingerprint"))
                .map(str::to_string),
        ),
        neighborhood: sorted_strings(nodes.iter().flat_map(|node| {
            string_field(node, "id")
                .and_then(|id| graph_neighborhoods.get(id))
                .cloned()
                .unwrap_or_default()
        })),
    }
}

/// Зважена схожість тем.
///
/// Ваги не рівні свідомо: підпис і околиця переживають перейменування
/// символу, точні відбитки реалізації — переміщення файла. Разом вони
/// відрізняють «та сама тема під новим іменем» від «інша тема».
fn similarity(
    previous_graph: &Value,
    next_graph: &Value,
    previous_topic: &Value,
    next_topic: &Value,
    previous_neighborhoods: &BTreeMap<String, Vec<String>>,
    next_neighborhoods: &BTreeMap<String, Vec<String>>,
) -> f64 {
    let left = topic_profile(previous_graph, previous_topic, previous_neighborhoods);
    let right = topic_profile(next_graph, next_topic, next_neighborhoods);
    let score = overlap(&left.semantic, &right.semantic) * 0.4
        + overlap(&left.fingerprints, &right.fingerprints) * 0.35
        + overlap(&left.neighborhood, &right.neighborhood) * 0.25;
    // Округлення до 6 знаків — порт `Number(x.toFixed(6))`: без нього
    // порівняння з порогом залежало б від похибки останнього біта.
    (score * 1e6).round() / 1e6
}

fn diagnostic(
    code: &str,
    detail: &str,
    previous_topic_ids: Vec<String>,
    next_topic_ids: Vec<String>,
) -> Diagnostic {
    Diagnostic {
        code: code.to_string(),
        detail: detail.to_string(),
        previous_topic_ids: sorted_strings(previous_topic_ids),
        next_topic_ids: sorted_strings(next_topic_ids),
    }
}

/// Теми з маніфеста чи виявлення — у стабільному порядку ID.
fn valid_topics(value: Option<&Value>) -> Vec<Value> {
    let mut topics: Vec<Value> = value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|topic| string_field(topic, "id").is_some())
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    topics.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left, "id").unwrap_or_default(),
            string_field(right, "id").unwrap_or_default(),
        )
    });
    topics
}

fn topic_id(topic: &Value) -> String {
    string_field(topic, "id").unwrap_or_default().to_string()
}

/// Уже однакові ID — безумовні зіставлення.
fn stable_mappings(previous_topics: &[Value], next_topics: &[Value]) -> Vec<Mapping> {
    let next_ids: BTreeSet<String> = next_topics.iter().map(topic_id).collect();
    previous_topics
        .iter()
        .map(topic_id)
        .filter(|id| next_ids.contains(id))
        .map(|id| Mapping {
            from_topic_id: id.clone(),
            to_topic_id: id,
            score: 1.0,
            reason: "stable-id".to_string(),
        })
        .collect()
}

/// Усі достатньо сильні кандидати на перейменування — БЕЗ вибору
/// переможця. Вибір робиться (або не робиться) пізніше, коли видно всю
/// картину неоднозначності.
fn migration_candidates(
    previous_manifest: &Value,
    graph: &Value,
    previous_topics: &[Value],
    next_topics: &[Value],
    resolved_previous: &BTreeSet<String>,
    resolved_next: &BTreeSet<String>,
) -> Vec<Mapping> {
    let previous_neighborhoods = neighborhoods(previous_manifest);
    let next_neighborhoods = neighborhoods(graph);
    let mut candidates = Vec::new();
    for previous_topic in previous_topics {
        let from_id = topic_id(previous_topic);
        if resolved_previous.contains(&from_id) {
            continue;
        }
        for next_topic in next_topics {
            let to_id = topic_id(next_topic);
            if resolved_next.contains(&to_id)
                || previous_topic.get("kind") != next_topic.get("kind")
            {
                continue;
            }
            let score = similarity(
                previous_manifest,
                graph,
                previous_topic,
                next_topic,
                &previous_neighborhoods,
                &next_neighborhoods,
            );
            if score >= MINIMUM_MATCH_SCORE {
                candidates.push(Mapping {
                    from_topic_id: from_id.clone(),
                    to_topic_id: to_id,
                    score,
                    reason: String::new(),
                });
            }
        }
    }
    candidates.sort_by(|left, right| {
        js_locale_cmp(&left.from_topic_id, &right.from_topic_id)
            .then_with(|| js_locale_cmp(&left.to_topic_id, &right.to_topic_id))
            .then_with(|| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    candidates
}

/// Блокувальні діагностики split/merge, незалежні від порядку входу.
fn ambiguity_diagnostics(candidates: &[Mapping]) -> Vec<Diagnostic> {
    let mut by_previous: BTreeMap<&str, Vec<&Mapping>> = BTreeMap::new();
    let mut by_next: BTreeMap<&str, Vec<&Mapping>> = BTreeMap::new();
    for candidate in candidates {
        by_previous
            .entry(candidate.from_topic_id.as_str())
            .or_default()
            .push(candidate);
        by_next
            .entry(candidate.to_topic_id.as_str())
            .or_default()
            .push(candidate);
    }
    let mut diagnostics = Vec::new();
    for (topic_id, matches) in &by_previous {
        if matches.len() > 1 {
            diagnostics.push(diagnostic(
                "ambiguous-topic-split",
                &format!("Topic {topic_id} має кілька однаково придатних successor topics; потрібен explicit migration plan."),
                vec![(*topic_id).to_string()],
                matches.iter().map(|item| item.to_topic_id.clone()).collect(),
            ));
        }
    }
    for (topic_id, matches) in &by_next {
        if matches.len() > 1 {
            diagnostics.push(diagnostic(
                "ambiguous-topic-merge",
                &format!("Topic {topic_id} має кілька predecessor topics; потрібен explicit migration plan."),
                matches
                    .iter()
                    .map(|item| item.from_topic_id.clone())
                    .collect(),
                vec![(*topic_id).to_string()],
            ));
        }
    }
    diagnostics
}

/// Захищений реєстр не має лишитись без канонічного власника.
///
/// Це і є причина, чому неоднозначність блокує: авторський текст, привʼязаний
/// до теми, після мовчазного вибору просто зник би.
fn protected_zone_diagnostics(
    registry: &BTreeMap<String, Vec<Value>>,
    mappings: &[Mapping],
) -> Vec<Diagnostic> {
    let mapped: BTreeSet<&str> = mappings
        .iter()
        .map(|mapping| mapping.from_topic_id.as_str())
        .collect();
    registry
        .iter()
        .filter(|(topic_id, zones)| !zones.is_empty() && !mapped.contains(topic_id.as_str()))
        .map(|(topic_id, _)| {
            diagnostic(
                "protected-zone-migration-unresolved",
                &format!("Protected MANUAL/EXPECTED zones topic {topic_id} не мають однозначного topic mapping."),
                vec![topic_id.clone()],
                Vec::new(),
            )
        })
        .collect()
}

/// Свіжі теми зі старими канонічними ID та обʼєднаними aliases.
fn apply_mappings(
    next_topics: &[Value],
    previous_by_id: &BTreeMap<String, &Value>,
    mappings: &[Mapping],
) -> Vec<Value> {
    let mut canonical: BTreeMap<String, Value> = next_topics
        .iter()
        .map(|topic| {
            let mut copy = topic.clone();
            copy["aliases"] = Value::from(sorted_strings(string_list(topic.get("aliases"))));
            (topic_id(topic), copy)
        })
        .collect();

    for mapping in mappings {
        let Some(previous_topic) = previous_by_id.get(&mapping.from_topic_id) else {
            continue;
        };
        let Some(next_topic) = canonical.remove(&mapping.to_topic_id) else {
            continue;
        };
        let mut merged = next_topic.clone();
        merged["id"] = Value::String(mapping.from_topic_id.clone());
        // Старий ID зникає з поля зору — але не з aliases: посилання на нього
        // вже опубліковані.
        merged["aliases"] = Value::from(sorted_strings(
            string_list(previous_topic.get("aliases"))
                .into_iter()
                .chain(string_list(next_topic.get("aliases"))),
        ));
        canonical.insert(mapping.from_topic_id.clone(), merged);
    }

    let mut topics: Vec<Value> = canonical.into_values().collect();
    topics.sort_by(|left, right| js_locale_cmp(&topic_id(left), &topic_id(right)));
    topics
}

fn sorted_mappings(mut mappings: Vec<Mapping>) -> Vec<Mapping> {
    mappings.sort_by(|left, right| js_locale_cmp(&left.from_topic_id, &right.from_topic_id));
    mappings
}

/// Узгоджує свіжовиявлені теми з закоміченим маніфестом — порт
/// `reconcileTopicIdentities`.
///
/// Однакові ID лишаються незмінними; УНІКАЛЬНЕ впевнене перейменування
/// отримує старий канонічний ID і зберігає свої aliases. Split/merge і
/// невизначеність захищених зон повертають явний план — без мовчазного
/// вибору теми.
#[must_use]
pub fn reconcile_topic_identities(
    previous_manifest: Option<&Value>,
    graph: &Value,
    topics: &[Value],
    protected_zones_by_topic_id: Option<&Value>,
) -> MigrationOutcome {
    let next_topics = valid_topics(Some(&Value::Array(topics.to_vec())));
    let Some(previous_manifest) = previous_manifest else {
        // Першого прогону нема з чим узгоджувати — і це не помилка.
        return MigrationOutcome::Resolved {
            topics: next_topics,
            protected_zones_by_topic_id: BTreeMap::new(),
            plan: MigrationPlan {
                status: "resolved".to_string(),
                mappings: Vec::new(),
            },
        };
    };

    let previous_topics = valid_topics(previous_manifest.get("topics"));
    let registry = protected_registry(previous_manifest, protected_zones_by_topic_id);
    let previous_by_id: BTreeMap<String, &Value> = previous_topics
        .iter()
        .map(|topic| (topic_id(topic), topic))
        .collect();

    let stable = stable_mappings(&previous_topics, &next_topics);
    let resolved_previous: BTreeSet<String> = stable
        .iter()
        .map(|mapping| mapping.from_topic_id.clone())
        .collect();
    let resolved_next: BTreeSet<String> = stable
        .iter()
        .map(|mapping| mapping.to_topic_id.clone())
        .collect();
    let candidates = migration_candidates(
        previous_manifest,
        graph,
        &previous_topics,
        &next_topics,
        &resolved_previous,
        &resolved_next,
    );

    let ambiguity = ambiguity_diagnostics(&candidates);
    let mappings: Vec<Mapping> = if ambiguity.is_empty() {
        stable
            .iter()
            .cloned()
            .chain(candidates.into_iter().map(|candidate| Mapping {
                reason: "semantic-rename".to_string(),
                ..candidate
            }))
            .collect()
    } else {
        stable.clone()
    };

    let mut diagnostics = ambiguity;
    diagnostics.extend(protected_zone_diagnostics(&registry, &mappings));
    if !diagnostics.is_empty() {
        diagnostics.sort_by(|left, right| {
            js_locale_cmp(
                &format!("{}:{}", left.code, left.previous_topic_ids.join(",")),
                &format!("{}:{}", right.code, right.previous_topic_ids.join(",")),
            )
        });
        return MigrationOutcome::Blocked {
            diagnostics,
            plan: MigrationPlan {
                status: "blocked".to_string(),
                mappings: sorted_mappings(mappings),
            },
        };
    }

    MigrationOutcome::Resolved {
        topics: apply_mappings(&next_topics, &previous_by_id, &mappings),
        protected_zones_by_topic_id: registry,
        plan: MigrationPlan {
            status: "resolved".to_string(),
            mappings: sorted_mappings(mappings),
        },
    }
}
