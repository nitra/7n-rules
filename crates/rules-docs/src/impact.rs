//! Privacy-safe зріз впливу для однієї теми — порт `impact.mjs`.
//!
//! Зріз використовує приватні одиниці ЛИШЕ як внутрішні вершини обходу:
//! їхні імена й ідентифікатори назовні не повертаються. Натомість зачеплені
//! файли, тести, конфіги та зовнішні контракти лишаються доступними — саме
//! вони потрібні для плану змін.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::deterministic::js_locale_cmp;
use crate::topics::{collect_reachable_node_ids, resolve_topic, Topic};

/// Структурована відмова.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub code: String,
    pub detail: String,
}

/// Безпечна проєкція теми — без symbol-level якорів.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicTopic {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub aliases: Vec<String>,
}

/// Зовнішній контракт, зачеплений темою.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Contract {
    pub id: String,
    pub name: String,
}

/// Зріз впливу.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImpactSlice {
    pub domain_id: String,
    pub topics: Vec<PublicTopic>,
    pub files: Vec<String>,
    pub tests: Vec<String>,
    pub contracts: Vec<Contract>,
    pub configs: Vec<String>,
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Чи шлях лишається в межах кореня домену — порт `isDomainPath`.
///
/// Абсолютний шлях і `..` відкидаються: зріз впливу читають як перелік
/// файлів, які можна безпечно чіпати, тож вихід за корінь домену тут — не
/// косметична вада.
fn is_domain_path(path: Option<&str>) -> bool {
    path.is_some_and(|path| {
        !path.is_empty()
            && !path.starts_with('/')
            && path
                .split('/')
                .all(|segment| segment != ".." && !segment.is_empty())
    })
}

/// Шлях із `attributes.sourcePath`, якщо він домашній.
fn source_path(node: &Value) -> Option<String> {
    let path = node
        .get("attributes")
        .and_then(|attributes| attributes.get("sourcePath"))
        .and_then(Value::as_str);
    is_domain_path(path).then(|| path.unwrap_or_default().to_string())
}

/// Evidence, що належить замиканню теми — порт `reachableEvidence`.
fn reachable_evidence<'a>(graph: &'a Value, reachable: &BTreeSet<String>) -> Vec<&'a Value> {
    let edge_evidence_ids: BTreeSet<&str> = graph
        .get("edges")
        .and_then(Value::as_array)
        .map(|edges| {
            edges
                .iter()
                .filter(|edge| {
                    let inside = |key: &str| {
                        string_field(edge, key).is_some_and(|id| reachable.contains(id))
                    };
                    inside("fromId") && inside("toId")
                })
                .filter_map(|edge| edge.get("evidenceIds").and_then(Value::as_array))
                .flatten()
                .filter_map(Value::as_str)
                .collect()
        })
        .unwrap_or_default();

    let mut selected: Vec<&Value> = graph
        .get("evidence")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    let by_symbol =
                        string_field(item, "symbolId").is_some_and(|id| reachable.contains(id));
                    let by_edge =
                        string_field(item, "id").is_some_and(|id| edge_evidence_ids.contains(id));
                    (by_symbol || by_edge) && is_domain_path(string_field(item, "path"))
                })
                .collect()
        })
        .unwrap_or_default();
    selected.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left, "id").unwrap_or_default(),
            string_field(right, "id").unwrap_or_default(),
        )
    });
    selected
}

fn sorted(values: BTreeSet<String>) -> Vec<String> {
    let mut result: Vec<String> = values.into_iter().collect();
    result.sort_by(|left, right| js_locale_cmp(left, right));
    result
}

/// Повертає зріз впливу домену за ID теми або її alias — порт
/// `createImpactSlice`.
///
/// # Errors
/// Граф без домену, невідома тема або тема з ІНШОГО домену: останнє —
/// окремий код, бо це не «не знайдено», а спроба перетнути межу домену.
pub fn create_impact_slice(
    graph: &Value,
    topics: &[Topic],
    topic_id: &str,
) -> Result<ImpactSlice, Failure> {
    let domain_id = graph
        .get("domain")
        .and_then(|domain| domain.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let Some(domain_id) = domain_id else {
        return Err(Failure {
            code: "invalid-domain".to_string(),
            detail: "Graph не має owning domain ID.".to_string(),
        });
    };
    let Some(topic) = resolve_topic(topics, topic_id) else {
        return Err(Failure {
            code: "topic-not-found".to_string(),
            detail: format!("Topic \"{topic_id}\" не знайдено."),
        });
    };
    if topic.domain_id != domain_id {
        return Err(Failure {
            code: "topic-outside-domain".to_string(),
            detail: format!("Topic \"{}\" не належить domain \"{domain_id}\".", topic.id),
        });
    }

    let nodes: Vec<&Value> = graph
        .get("nodes")
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .filter(|node| string_field(node, "domainId") == Some(domain_id))
                .collect()
        })
        .unwrap_or_default();
    let reachable: BTreeSet<String> = collect_reachable_node_ids(graph, &topic.anchor_ids)
        .into_iter()
        .collect();
    let evidence = reachable_evidence(graph, &reachable);

    let mut files: BTreeSet<String> = BTreeSet::new();
    let mut configs: BTreeSet<String> = BTreeSet::new();
    let mut tests: BTreeSet<String> = evidence
        .iter()
        .filter(|item| string_field(item, "kind") == Some("test"))
        .filter_map(|item| string_field(item, "path").map(str::to_string))
        .collect();
    let mut contracts: Vec<Contract> = Vec::new();

    for id in &reachable {
        let Some(node) = nodes
            .iter()
            .find(|node| string_field(node, "id") == Some(id.as_str()))
        else {
            continue;
        };
        if let Some(path) = source_path(node) {
            match string_field(node, "kind") {
                Some("code-unit") => {
                    files.insert(path);
                }
                Some("config") => {
                    configs.insert(path);
                }
                Some("test") => {
                    tests.insert(path);
                }
                _ => {}
            }
        }
        if string_field(node, "kind") == Some("integration")
            && string_field(node, "visibility") == Some("external")
        {
            // Імʼя контракту — публічне за визначенням (зовнішня межа), тож
            // тут воно лишається; фолбек на id тримає зріз повним навіть для
            // безіменного вузла.
            contracts.push(Contract {
                id: id.clone(),
                name: string_field(node, "name")
                    .unwrap_or(id.as_str())
                    .to_string(),
            });
        }
    }
    for item in &evidence {
        let Some(path) = string_field(item, "path") else {
            continue;
        };
        match string_field(item, "kind") {
            Some("code") => {
                files.insert(path.to_string());
            }
            Some("config") => {
                configs.insert(path.to_string());
            }
            _ => {}
        }
    }

    let mut seen: BTreeSet<String> = BTreeSet::new();
    contracts.retain(|contract| seen.insert(contract.id.clone()));
    contracts.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));

    let mut aliases: Vec<String> = {
        let unique: BTreeSet<&String> = topic.aliases.iter().collect();
        unique.into_iter().cloned().collect()
    };
    aliases.sort_by(|left, right| js_locale_cmp(left, right));

    Ok(ImpactSlice {
        domain_id: domain_id.to_string(),
        topics: vec![PublicTopic {
            id: topic.id.clone(),
            kind: topic.kind.clone(),
            title: topic.title.clone(),
            aliases,
        }],
        files: sorted(files),
        tests: sorted(tests),
        contracts,
        configs: sorted(configs),
    })
}
