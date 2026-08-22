//! Виявлення тем package knowledge — порт `topic-discovery.mjs`.
//!
//! Первинні seeds — ПУБЛІЧНІ точки входу. Outcome та зовнішня інтеграція
//! стають окремими seeds лише тоді, коли їх не накриває жоден публічний
//! потік. Завдяки цьому теми лишаються компактними, не залежать від
//! LLM-заголовка і не змушують показувати приватну реалізацію в наступних
//! проєкціях.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::deterministic::js_locale_cmp;

/// Тема — стабільна одиниця навігації по домену.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Topic {
    pub id: String,
    /// `process` або `contract`.
    pub kind: String,
    pub title: String,
    pub domain_id: String,
    pub anchor_ids: Vec<String>,
    /// Історичні ID, під якими тема вже публікувалась.
    pub aliases: Vec<String>,
}

/// Короткий стабільний digest ідентичності теми — порт `digest`.
///
/// Хеш береться від JSON У ПОРЯДКУ ВСТАВКИ, а не від канонічного: JS тут
/// свідомо не канонізує, і сортування ключів дало б інші ID для всіх уже
/// опублікованих тем.
fn digest(json: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(json.as_bytes());
    let mut hex = String::with_capacity(24);
    for byte in digest.iter().take(12) {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// `JSON.stringify(string[])`.
fn json_array(ids: &[String]) -> String {
    let items: Vec<String> = ids
        .iter()
        .map(|id| Value::String(id.clone()).to_string())
        .collect();
    format!("[{}]", items.join(","))
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn domain_id_of(graph: &Value) -> Option<&str> {
    graph
        .get("domain")
        .and_then(|domain| domain.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
}

/// Вузли ЛИШЕ свого домену, у стабільному порядку — порт `domainNodes`.
fn domain_nodes(graph: &Value) -> Vec<&Value> {
    let Some(domain_id) = domain_id_of(graph) else {
        return Vec::new();
    };
    let Some(nodes) = graph.get("nodes").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut selected: Vec<&Value> = nodes
        .iter()
        .filter(|node| {
            string_field(node, "domainId") == Some(domain_id) && string_field(node, "id").is_some()
        })
        .collect();
    selected.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left, "id").unwrap_or_default(),
            string_field(right, "id").unwrap_or_default(),
        )
    });
    selected
}

/// Суміжність лише з evidence-backed ребер свого домену — порт `adjacency`.
///
/// Ребро без evidence не створює звʼязку: досяжність, побудована на
/// непідтверджених ребрах, тягла б у тему код, якого ніхто не бачив.
fn adjacency(graph: &Value) -> BTreeMap<String, Vec<String>> {
    let nodes = domain_nodes(graph);
    let ids: BTreeSet<&str> = nodes
        .iter()
        .filter_map(|node| string_field(node, "id"))
        .collect();
    let mut targets: BTreeMap<String, BTreeSet<String>> = nodes
        .iter()
        .filter_map(|node| string_field(node, "id"))
        .map(|id| (id.to_string(), BTreeSet::new()))
        .collect();
    if let Some(edges) = graph.get("edges").and_then(Value::as_array) {
        for edge in edges {
            let from = string_field(edge, "fromId");
            let to = string_field(edge, "toId");
            let has_evidence = edge
                .get("evidenceIds")
                .and_then(Value::as_array)
                .is_some_and(|ids| !ids.is_empty());
            let (Some(from), Some(to)) = (from, to) else {
                continue;
            };
            if !ids.contains(from) || !ids.contains(to) || !has_evidence {
                continue;
            }
            targets
                .entry(from.to_string())
                .or_default()
                .insert(to.to_string());
        }
    }
    targets
        .into_iter()
        .map(|(id, set)| {
            let mut list: Vec<String> = set.into_iter().collect();
            list.sort_by(|left, right| js_locale_cmp(left, right));
            (id, list)
        })
        .collect()
}

/// Спрямоване замикання досяжності — порт `collectReachableNodeIds`.
///
/// Цикл потрапляє В ЦІЛОМУ: обхід іде до нерухомої точки, тож взаємна
/// рекурсія не ріже тему навпіл.
#[must_use]
pub fn collect_reachable_node_ids(graph: &Value, anchors: &[String]) -> Vec<String> {
    let links = adjacency(graph);
    let mut pending: Vec<String> = {
        let unique: BTreeSet<&String> = anchors
            .iter()
            .filter(|id| links.contains_key(*id))
            .collect();
        unique.into_iter().cloned().collect()
    };
    pending.sort_by(|left, right| js_locale_cmp(left, right));
    let mut visited: BTreeSet<String> = BTreeSet::new();
    while !pending.is_empty() {
        let id = pending.remove(0);
        if !visited.insert(id.clone()) {
            continue;
        }
        if let Some(targets) = links.get(&id) {
            for target in targets {
                if !visited.contains(target) {
                    pending.push(target.clone());
                }
            }
        }
        pending.sort_by(|left, right| js_locale_cmp(left, right));
    }
    let mut result: Vec<String> = visited.into_iter().collect();
    result.sort_by(|left, right| js_locale_cmp(left, right));
    result
}

/// Чи вузол — зовнішня межа контракту.
fn is_external_integration(node: &Value) -> bool {
    string_field(node, "kind") == Some("integration")
        && string_field(node, "visibility") == Some("external")
}

/// Безпечний заголовок теми — порт `titleForSeed`.
///
/// Приватне імʼя сюди не потрапляє НІКОЛИ: заголовок теми — це
/// людиноорієнтована проєкція, і витік приватного символу через неї
/// однаково поганий, як через текст документа.
fn title_for_seed(seed: &Value) -> String {
    let name = string_field(seed, "name").filter(|name| !name.is_empty());
    let visibility = string_field(seed, "visibility");
    if let Some(name) = name {
        if visibility == Some("public")
            || is_external_integration(seed)
            || (string_field(seed, "kind") == Some("outcome") && visibility != Some("private"))
        {
            return name.to_string();
        }
    }
    "Domain outcome".to_string()
}

/// Історичні aliases теми — порт `aliasesForTopic`.
fn aliases_for_topic(topic_id: &str, aliases_by_topic_id: &Value) -> Vec<String> {
    let Some(aliases) = aliases_by_topic_id.get(topic_id).and_then(Value::as_array) else {
        return Vec::new();
    };
    let unique: BTreeSet<&str> = aliases
        .iter()
        .filter_map(Value::as_str)
        .filter(|alias| !alias.is_empty() && *alias != topic_id)
        .collect();
    let mut result: Vec<String> = unique.into_iter().map(str::to_string).collect();
    result.sort_by(|left, right| js_locale_cmp(left, right));
    result
}

/// Legacy-ідентичність теми з однією точкою входу — порт
/// `singleEntryTopicId`. Порядок ключів у хешованому JSON контрактний.
fn single_entry_topic_id(
    domain_id: &str,
    seed_id: &str,
    outcome_ids: &[String],
    contract_ids: &[String],
) -> String {
    let json = format!(
        "{{\"seedId\":{},\"outcomeIds\":{},\"contractIds\":{}}}",
        Value::String(seed_id.to_string()),
        json_array(outcome_ids),
        json_array(contract_ids)
    );
    format!("process:{domain_id}:{}", digest(&json))
}

/// Група публічних точок входу зі спільним замиканням.
struct FlowGroup<'a> {
    seeds: Vec<&'a Value>,
    outcome_ids: Vec<String>,
    contract_ids: Vec<String>,
}

/// Групує точки входу з ОДНАКОВИМ непорожнім замиканням — порт
/// `publicFlowGroups`.
fn public_flow_groups<'a>(
    graph: &Value,
    public_seeds: &[&'a Value],
    node_by_id: &BTreeMap<&str, &Value>,
) -> Vec<FlowGroup<'a>> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: BTreeMap<String, FlowGroup<'a>> = BTreeMap::new();
    for seed in public_seeds {
        let seed_id = string_field(seed, "id").unwrap_or_default().to_string();
        let closure = collect_reachable_node_ids(graph, std::slice::from_ref(&seed_id));
        let outcome_ids: Vec<String> = closure
            .iter()
            .filter(|id| {
                node_by_id
                    .get(id.as_str())
                    .is_some_and(|node| string_field(node, "kind") == Some("outcome"))
            })
            .cloned()
            .collect();
        let contract_ids: Vec<String> = closure
            .iter()
            .filter(|id| {
                node_by_id
                    .get(id.as_str())
                    .is_some_and(|node| is_external_integration(node))
            })
            .cloned()
            .collect();
        // Ключ групування: спільне замикання. Порожнє замикання НЕ обʼєднує —
        // інакше всі точки входу без outcome злиплися б в одну тему.
        let key = if outcome_ids.len() + contract_ids.len() > 0 {
            format!(
                "{{\"outcomeIds\":{},\"contractIds\":{}}}",
                json_array(&outcome_ids),
                json_array(&contract_ids)
            )
        } else {
            format!("seed:{seed_id}")
        };
        let group = groups.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            FlowGroup {
                seeds: Vec::new(),
                outcome_ids,
                contract_ids,
            }
        });
        group.seeds.push(seed);
    }
    let mut result: Vec<FlowGroup<'a>> = order
        .into_iter()
        .filter_map(|key| groups.remove(&key))
        .collect();
    result.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left.seeds[0], "id").unwrap_or_default(),
            string_field(right.seeds[0], "id").unwrap_or_default(),
        )
    });
    result
}

/// Унікальні ID у стабільному порядку.
fn unique_sorted(ids: Vec<String>) -> Vec<String> {
    let unique: BTreeSet<String> = ids.into_iter().collect();
    let mut result: Vec<String> = unique.into_iter().collect();
    result.sort_by(|left, right| js_locale_cmp(left, right));
    result
}

/// Виявляє стабільні теми `process`/`contract` — порт `discoverTopics`.
///
/// Інтеграція чи outcome не дублюють тему публічної точки входу, якщо та вже
/// evidence-backed дістає відповідної межі. Інакше вони лишаються окремим
/// seed — це важливо для event-driven і contract-only доменів, де публічної
/// точки входу може не бути взагалі.
#[must_use]
pub fn discover_topics(graph: &Value, aliases_by_topic_id: &Value) -> Vec<Topic> {
    let Some(domain_id) = domain_id_of(graph) else {
        return Vec::new();
    };
    let nodes = domain_nodes(graph);
    let node_by_id: BTreeMap<&str, &Value> = nodes
        .iter()
        .filter_map(|node| string_field(node, "id").map(|id| (id, *node)))
        .collect();
    let public_seeds: Vec<&Value> = nodes
        .iter()
        .filter(|node| {
            string_field(node, "kind") == Some("code-unit")
                && string_field(node, "visibility") == Some("public")
        })
        .copied()
        .collect();
    let covered: BTreeSet<String> = public_seeds
        .iter()
        .flat_map(|seed| {
            collect_reachable_node_ids(
                graph,
                &[string_field(seed, "id").unwrap_or_default().to_string()],
            )
        })
        .collect();
    let boundary_seeds: Vec<&Value> = nodes
        .iter()
        .filter(|node| {
            let id = string_field(node, "id").unwrap_or_default();
            (string_field(node, "kind") == Some("outcome") || is_external_integration(node))
                && !covered.contains(id)
        })
        .copied()
        .collect();

    let mut topics: Vec<Topic> = Vec::new();
    for group in public_flow_groups(graph, &public_seeds, &node_by_id) {
        let mut seeds = group.seeds.clone();
        seeds.sort_by(|left, right| {
            js_locale_cmp(
                string_field(left, "id").unwrap_or_default(),
                string_field(right, "id").unwrap_or_default(),
            )
        });
        let seed_ids: Vec<String> = seeds
            .iter()
            .map(|seed| string_field(seed, "id").unwrap_or_default().to_string())
            .collect();
        let grouped = seeds.len() > 1;
        let legacy_ids: Vec<String> = seed_ids
            .iter()
            .map(|seed_id| {
                single_entry_topic_id(domain_id, seed_id, &group.outcome_ids, &group.contract_ids)
            })
            .collect();
        let id = if grouped {
            let json = format!(
                "{{\"entryIds\":{},\"outcomeIds\":{},\"contractIds\":{}}}",
                json_array(&seed_ids),
                json_array(&group.outcome_ids),
                json_array(&group.contract_ids)
            );
            format!("process:{domain_id}:{}", digest(&json))
        } else {
            legacy_ids[0].clone()
        };
        // Групування тем не має ламати вже опубліковані посилання: колишні
        // одиничні ID лишаються aliases.
        let mut alias_pool = aliases_for_topic(&id, aliases_by_topic_id);
        if grouped {
            alias_pool.extend(legacy_ids);
        }
        let aliases = unique_sorted(
            alias_pool
                .into_iter()
                .filter(|alias| alias != &id)
                .collect(),
        );
        let mut anchors = seed_ids;
        anchors.extend(group.outcome_ids.clone());
        anchors.extend(group.contract_ids.clone());
        topics.push(Topic {
            id,
            kind: "process".to_string(),
            title: title_for_seed(seeds[0]),
            domain_id: domain_id.to_string(),
            anchor_ids: unique_sorted(anchors),
            aliases,
        });
    }

    for seed in boundary_seeds {
        let seed_id = string_field(seed, "id").unwrap_or_default().to_string();
        let closure = collect_reachable_node_ids(graph, std::slice::from_ref(&seed_id));
        let outcome_ids: Vec<String> = closure
            .iter()
            .filter(|id| {
                node_by_id
                    .get(id.as_str())
                    .is_some_and(|node| string_field(node, "kind") == Some("outcome"))
            })
            .cloned()
            .collect();
        let contract_ids: Vec<String> = closure
            .iter()
            .filter(|id| {
                node_by_id
                    .get(id.as_str())
                    .is_some_and(|node| is_external_integration(node))
            })
            .cloned()
            .collect();
        let kind = if is_external_integration(seed) {
            "contract"
        } else {
            "process"
        };
        let json = format!(
            "{{\"seedId\":{},\"outcomeIds\":{},\"contractIds\":{}}}",
            Value::String(seed_id.clone()),
            json_array(&outcome_ids),
            json_array(&contract_ids)
        );
        let id = format!("{kind}:{domain_id}:{}", digest(&json));
        let mut anchors = vec![seed_id];
        anchors.extend(outcome_ids);
        anchors.extend(contract_ids);
        topics.push(Topic {
            aliases: aliases_for_topic(&id, aliases_by_topic_id),
            id,
            kind: kind.to_string(),
            title: title_for_seed(seed),
            domain_id: domain_id.to_string(),
            anchor_ids: unique_sorted(anchors),
        });
    }

    topics.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));
    topics
}

/// Знаходить тему за поточним ID або історичним alias — порт `resolveTopic`.
#[must_use]
pub fn resolve_topic<'a>(topics: &'a [Topic], id_or_alias: &str) -> Option<&'a Topic> {
    topics.iter().find(|topic| {
        topic.id == id_or_alias || topic.aliases.iter().any(|alias| alias == id_or_alias)
    })
}
