//! Детерміновані Markdown- і manifest-проєкції графа — порт `render.mjs`.
//!
//! Модуль не аналізує джерела, не викликає модель і НЕ публікує файли: він
//! будує повну мапу файлів-кандидатів, а публікація лишається за
//! `publish.mjs` після окремої валідації.
//!
//! Людські AS-IS сторінки групують лише evidence-backed claims, а імена
//! приватних символів лишаються ТІЛЬКИ в машинному manifest — і це
//! перевіряється в кінці ще раз, по всьому згенерованому Markdown.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::deterministic::{canonical_json, canonical_value, js_locale_cmp};
use crate::graph::serialize_knowledge_graph;
use crate::impact::create_impact_slice;
use crate::topics::{collect_reachable_node_ids, Topic};

/// Шлях машинного manifest.
const MANIFEST_PATH: &str = "docs/.docgen/manifest.json";

/// Теки сторінок за видом теми.
const PAGE_KIND_PATHS: [(&str, &str); 3] = [
    ("capability", "docs/explanation/capabilities"),
    ("contract", "docs/reference/contracts"),
    ("process", "docs/explanation/processes"),
];

/// Людські підписи видів.
const PAGE_KIND_LABELS: [(&str, &str); 3] = [
    ("capability", "Можливість"),
    ("contract", "Контракт"),
    ("process", "Процес"),
];

/// Заголовки секцій за предикатом. Порядок КОНТРАКТНИЙ: він задає порядок
/// секцій на сторінці (`Object.keys` у JS), а не лише набір назв.
const CLAIM_SECTION_TITLES: [(&str, &str); 14] = [
    ("purpose", "Призначення"),
    ("actor", "Actors"),
    ("trigger", "Trigger"),
    ("precondition", "Передумови"),
    ("step", "Основний потік"),
    ("business-rule", "Business rules"),
    ("state-change", "Зміни стану"),
    ("integration", "Integration boundaries"),
    ("outcome", "Результати"),
    ("alternative-flow", "Alternative flows"),
    ("error-flow", "Error flows"),
    ("responsibility", "Відповідальності"),
    ("config", "Configuration"),
    ("persistence", "Persistence"),
];

/// Діагностика рендерера.
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
}

/// Результат рендерингу: мапа `шлях → вміст`.
#[derive(Debug, Clone)]
pub enum RenderOutcome {
    Rendered(BTreeMap<String, String>),
    Blocked(Vec<Diagnostic>),
}

fn lookup<'a>(table: &[(&str, &'a str)], key: &str) -> Option<&'a str> {
    table
        .iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, value)| *value)
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Значення поля так, як його побачив би JS-шаблон: рядок або літеральне
/// `undefined`. Порт свідомо не «покращує» відсутнє поле — інакше вихід
/// розійшовся б із JS саме там, де граф неповний.
fn as_template_text(value: Option<&str>) -> &str {
    value.unwrap_or("undefined")
}

/// Короткий filesystem-safe токен теми.
fn topic_token(topic_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(topic_id.as_bytes());
    let mut hex = String::with_capacity(24);
    for byte in digest.iter().take(12) {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// Шлях сторінки теми — `<тека виду>/<токен>.md`.
///
/// Єдине джерело істини для ідентичності сторінки: реєстр захищених зон
/// ([`crate::runner::protected_zones_from_pages`]) мусить шукати рівно там,
/// куди рендерер пише. У JS ця відповідність тримається на тому, що дві
/// таблиці тек у різних файлах збігаються.
///
/// `None` — вид теми не має власної сторінки.
#[must_use]
pub fn topic_page_path(kind: &str, topic_id: &str) -> Option<String> {
    let directory = lookup(&PAGE_KIND_PATHS, kind)?;
    Some(format!("{directory}/{}.md", topic_token(topic_id)))
}

fn sorted_strings(mut values: Vec<String>) -> Vec<String> {
    values.sort_by(|left, right| js_locale_cmp(left, right));
    values
}

/// Граф, готовий до manifest: канонізований і з відсортованими колекціями.
fn canonical_graph(graph: &Value) -> Value {
    let mut output = canonical_value(graph);
    for key in ["nodes", "edges", "claims", "topics", "gaps", "evidence"] {
        if let Some(items) = output.get_mut(key).and_then(Value::as_array_mut) {
            items.sort_by(|left, right| {
                js_locale_cmp(
                    string_field(left, "id").unwrap_or_default(),
                    string_field(right, "id").unwrap_or_default(),
                )
            });
        }
    }
    output
}

/// Імена й ID приватних вузлів — те, чого не може бути в Markdown.
fn private_names(graph: &Value) -> BTreeSet<String> {
    graph
        .get("nodes")
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .filter(|node| string_field(node, "visibility") == Some("private"))
                .flat_map(|node| {
                    ["name", "id"]
                        .iter()
                        .filter_map(|key| string_field(node, key))
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Текст, лише якщо він не може винести приватне імʼя назовні.
fn safe_text(value: Option<&str>, hidden: &BTreeSet<String>, fallback: &str) -> String {
    match value {
        Some(text)
            if !text.is_empty() && !hidden.iter().any(|name| text.contains(name.as_str())) =>
        {
            text.to_string()
        }
        _ => fallback.to_string(),
    }
}

/// Значення claim-а у компактній безпечній формі.
fn safe_value(value: Option<&Value>, hidden: &BTreeSet<String>) -> String {
    let rendered = match value {
        Some(Value::String(text)) => text.clone(),
        Some(other) => canonical_json(other),
        None => return "підтверджене значення".to_string(),
    };
    safe_text(Some(&rendered), hidden, "підтверджене значення")
}

/// Обгортає згенерований вміст у AUTOGEN-зону зі стабільним хешем.
fn autogen_zone(id: &str, content: &str) -> String {
    format!(
        "<!-- AUTOGEN:start id=\"{id}\" hash=\"{}\" -->{content}<!-- AUTOGEN:end id=\"{id}\" -->",
        crate::zones::zone_hash(content)
    )
}

/// Оновлює наявну сторінку або створює нову — порт `renderPage`.
///
/// Наявна сторінка БЕЗ оголошеної AUTOGEN-зони — помилка, а не привід
/// перезаписати її цілком: авторський файл не можна мовчки замінити
/// згенерованим.
fn render_page(
    path: &str,
    zone_id: &str,
    content: &str,
    existing: Option<&String>,
) -> Result<String, Vec<Diagnostic>> {
    let Some(existing) = existing else {
        return Ok(autogen_zone(zone_id, content));
    };
    let parsed =
        crate::zones::parse_knowledge_zones(existing, Some(path)).map_err(|diagnostics| {
            diagnostics
                .into_iter()
                .map(|item| Diagnostic {
                    code: item.code,
                    detail: item.detail,
                    path: item.path,
                })
                .collect::<Vec<_>>()
        })?;
    let has_zone = parsed
        .zones
        .iter()
        .any(|zone| zone.kind == "AUTOGEN" && zone.id == zone_id);
    if !has_zone {
        return Err(vec![Diagnostic::new(
            "autogen-zone-required",
            &format!("Existing page має містити AUTOGEN {zone_id}."),
            Some(path),
        )]);
    }
    let updates = BTreeMap::from([(zone_id.to_string(), content.to_string())]);
    crate::zones::apply_autogen_updates(existing, &updates, Some(path)).map_err(|diagnostics| {
        diagnostics
            .into_iter()
            .map(|item| Diagnostic {
                code: item.code,
                detail: item.detail,
                path: item.path,
            })
            .collect()
    })
}

/// Теми, що мають власну сторінку.
fn page_topics(graph: &Value) -> Vec<Value> {
    let mut topics: Vec<Value> = graph
        .get("topics")
        .and_then(Value::as_array)
        .map(|topics| {
            topics
                .iter()
                .filter(|topic| {
                    string_field(topic, "kind")
                        .is_some_and(|kind| lookup(&PAGE_KIND_PATHS, kind).is_some())
                        && string_field(topic, "id").is_some()
                })
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

/// Чи має сенс окрема сторінка архітектури.
fn needs_architecture(graph: &Value) -> bool {
    let domain_id = graph
        .get("domain")
        .and_then(|domain| string_field(domain, "id"))
        .unwrap_or_default();
    let nodes = graph
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let own = |node: &Value| string_field(node, "domainId") == Some(domain_id);
    let responsibilities = nodes
        .iter()
        .filter(|node| own(node) && string_field(node, "kind") == Some("component"))
        .count();
    let boundaries = nodes
        .iter()
        .filter(|node| {
            own(node)
                && string_field(node, "kind") == Some("integration")
                && string_field(node, "visibility") == Some("external")
        })
        .count();
    responsibilities > 1 || boundaries > 0
}

/// Компактний список фактів або явне твердження про їх відсутність.
fn fact_list(facts: &[String], fallback: &str) -> String {
    if facts.is_empty() {
        return fallback.to_string();
    }
    facts
        .iter()
        .map(|fact| format!("- {fact}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Рендерить лише ПРИСУТНІ категорії claim-ів у стабільному порядку — порт
/// `claimSections`.
fn claim_sections(claims: &[&Value], hidden: &BTreeSet<String>, fallback: &str) -> String {
    let mut by_predicate: Vec<(String, Vec<String>)> = Vec::new();
    for claim in claims {
        let predicate = safe_text(
            string_field(claim, "predicate"),
            hidden,
            "evidence-backed behavior",
        );
        let value = safe_value(claim.get("value"), hidden);
        match by_predicate
            .iter_mut()
            .find(|(candidate, _)| candidate == &predicate)
        {
            Some((_, values)) => values.push(value),
            None => by_predicate.push((predicate, vec![value])),
        }
    }
    let known: Vec<String> = CLAIM_SECTION_TITLES
        .iter()
        .map(|(predicate, _)| (*predicate).to_string())
        .filter(|predicate| {
            by_predicate
                .iter()
                .any(|(candidate, _)| candidate == predicate)
        })
        .collect();
    let unknown = sorted_strings(
        by_predicate
            .iter()
            .map(|(predicate, _)| predicate.clone())
            .filter(|predicate| lookup(&CLAIM_SECTION_TITLES, predicate).is_none())
            .collect(),
    );

    let sections: Vec<String> = known
        .into_iter()
        .chain(unknown)
        .map(|predicate| {
            let title =
                lookup(&CLAIM_SECTION_TITLES, &predicate).unwrap_or("Інші підтверджені факти");
            let values = by_predicate
                .iter()
                .find(|(candidate, _)| candidate == &predicate)
                .map(|(_, values)| values.clone())
                .unwrap_or_default();
            // Дедуплікація зберігає ПЕРШУ появу, як `new Set` у JS; сортування
            // йде вже після неї.
            let mut seen: BTreeSet<String> = BTreeSet::new();
            let unique: Vec<String> = values
                .into_iter()
                .filter(|value| seen.insert(value.clone()))
                .map(|value| {
                    if lookup(&CLAIM_SECTION_TITLES, &predicate).is_some() {
                        value
                    } else {
                        format!("{predicate}: {value}.")
                    }
                })
                .collect();
            format!(
                "## {title}\n\n{}",
                fact_list(&sorted_strings(unique), fallback)
            )
        })
        .collect();
    if sections.is_empty() {
        fallback.to_string()
    } else {
        sections.join("\n\n")
    }
}

/// Публічні факти теми та шляхи зворотного впливу.
struct TopicFacts {
    implemented_claims: Vec<Value>,
    expected_claims: Vec<Value>,
    implemented: Vec<String>,
    expected: Vec<String>,
    outcomes: Vec<String>,
    contracts: Vec<String>,
    gaps: Vec<String>,
    paths: Vec<String>,
}

fn topic_facts(graph: &Value, topic: &Value, hidden: &BTreeSet<String>) -> TopicFacts {
    let anchors: Vec<String> = topic
        .get("anchorIds")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let reachable: BTreeSet<String> = collect_reachable_node_ids(graph, &anchors)
        .into_iter()
        .collect();
    let empty = Vec::new();
    let claims: Vec<&Value> = graph
        .get("claims")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|claim| string_field(claim, "subjectId").is_some_and(|id| reachable.contains(id)))
        .collect();
    let public_nodes: Vec<&Value> = graph
        .get("nodes")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|node| {
            string_field(node, "id").is_some_and(|id| reachable.contains(id))
                && string_field(node, "visibility") != Some("private")
        })
        .collect();
    let names_for = |kind: &str| -> Vec<String> {
        let fallback = if kind == "outcome" {
            "Confirmed outcome"
        } else {
            "External contract"
        };
        sorted_strings(
            public_nodes
                .iter()
                .filter(|node| string_field(node, "kind") == Some(kind))
                .map(|node| safe_text(string_field(node, "name"), hidden, fallback))
                .collect(),
        )
    };

    let local_claim_ids: BTreeSet<&str> = claims
        .iter()
        .filter_map(|claim| string_field(claim, "id"))
        .collect();
    let gaps = sorted_strings(
        graph
            .get("gaps")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .iter()
            .filter(|gap| {
                let expected = string_field(gap, "expectedClaimId")
                    .is_some_and(|id| local_claim_ids.contains(id));
                let implemented = gap
                    .get("implementedClaimIds")
                    .and_then(Value::as_array)
                    .is_some_and(|ids| {
                        ids.iter()
                            .filter_map(Value::as_str)
                            .any(|id| local_claim_ids.contains(id))
                    });
                expected || implemented
            })
            .map(|gap| format!("Status: {}.", as_template_text(string_field(gap, "status"))))
            .collect(),
    );

    let topics: Vec<Topic> = graph
        .get("topics")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .map(|item| Topic {
            id: string_field(item, "id").unwrap_or_default().to_string(),
            kind: string_field(item, "kind").unwrap_or_default().to_string(),
            title: string_field(item, "title").unwrap_or_default().to_string(),
            domain_id: string_field(item, "domainId")
                .unwrap_or_default()
                .to_string(),
            anchor_ids: item
                .get("anchorIds")
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            aliases: item
                .get("aliases")
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect();
    let paths = create_impact_slice(
        graph,
        &topics,
        string_field(topic, "id").unwrap_or_default(),
    )
    .map(|slice| {
        let mut all = slice.files;
        all.extend(slice.tests);
        all.extend(slice.configs);
        sorted_strings(all)
    })
    .unwrap_or_default();

    let by_layer = |layer: &str| -> Vec<Value> {
        let mut selected: Vec<Value> = claims
            .iter()
            .filter(|claim| string_field(claim, "layer") == Some(layer))
            .map(|claim| (*claim).clone())
            .collect();
        selected.sort_by(|left, right| {
            js_locale_cmp(
                string_field(left, "id").unwrap_or_default(),
                string_field(right, "id").unwrap_or_default(),
            )
        });
        selected
    };
    let sentences = |layer: &str| -> Vec<String> {
        sorted_strings(
            claims
                .iter()
                .filter(|claim| string_field(claim, "layer") == Some(layer))
                .map(|claim| {
                    format!(
                        "{}: {}.",
                        safe_text(
                            string_field(claim, "predicate"),
                            hidden,
                            "evidence-backed behavior"
                        ),
                        safe_value(claim.get("value"), hidden)
                    )
                })
                .collect(),
        )
    };

    TopicFacts {
        implemented_claims: by_layer("implemented"),
        expected_claims: by_layer("expected"),
        implemented: sentences("implemented"),
        expected: sentences("expected"),
        outcomes: names_for("outcome"),
        contracts: names_for("integration"),
        gaps,
        paths,
    }
}

/// Самодостатній AS-IS фрагмент однієї теми — порт `renderTopic`.
fn render_topic(graph: &Value, topic: &Value, hidden: &BTreeSet<String>) -> String {
    let kind = string_field(topic, "kind").unwrap_or_default();
    let label = lookup(&PAGE_KIND_LABELS, kind).unwrap_or("undefined");
    let title = safe_text(
        string_field(topic, "title"),
        hidden,
        &format!("{label} домену"),
    );
    let facts = topic_facts(graph, topic, hidden);
    let aliases = topic
        .get("aliases")
        .and_then(Value::as_array)
        .filter(|aliases| !aliases.is_empty())
        .map_or_else(String::new, |aliases| {
            format!("\n\nПопередні stable aliases: {}.", aliases.len())
        });
    let quoted_paths: Vec<String> = facts.paths.iter().map(|path| format!("`{path}`")).collect();
    let domain_name = as_template_text(
        graph
            .get("domain")
            .and_then(|domain| string_field(domain, "name")),
    );

    if !facts.implemented_claims.is_empty() || !facts.expected_claims.is_empty() {
        let implemented: Vec<&Value> = facts.implemented_claims.iter().collect();
        let expected: Vec<&Value> = facts.expected_claims.iter().collect();
        return format!(
            "# {label}: {title}\n\n## Implemented AS-IS\n\n{}\n\n## Outcomes і contracts\n\nOutcomes:\n{}\n\nContracts:\n{}\n\n## Affected paths\n\n{}\n\n## Expected behavior\n\n{}\n\n## Local implementation gaps\n\n{}{aliases}\n",
            claim_sections(&implemented, hidden, "Немає evidence-backed implemented behavioral claims для цього topic."),
            fact_list(&facts.outcomes, "Немає підтвердженого public outcome."),
            fact_list(&facts.contracts, "Немає підтвердженого external contract."),
            fact_list(&quoted_paths, "Reverse impact paths відсутні у поточній graph projection."),
            claim_sections(&expected, hidden, "Для topic немає explicit expected claim."),
            fact_list(&facts.gaps, "Для topic немає actionable implementation gaps."),
        );
    }
    format!(
        "# {label}: {title}\n\n## Implemented AS-IS\n\nЦей self-contained fragment описує підтверджену поточну поведінку {} у domain `{domain_name}`. Він не припускає intent поза evidence graph.\n\n## Призначення\n\n{title} надає evidence-backed boundary для зміни та перевірки поведінки domain.\n\n## Actors і trigger\n\nПотік починається з підтвердженого topic anchor і завершується зафіксованим результатом або external contract boundary.\n\n## Передумови\n\nВхід до {} доступний у межах owning domain, а потрібні integration boundaries представлені у traceability manifest.\n\n## Implemented facts\n\n{}\n\n## Outcomes і contracts\n\nOutcomes:\n{}\n\nContracts:\n{}\n\n## Affected paths\n\n{}\n\n## Alternative flows і rules\n\nAlternative та error-flow details відображаються лише тоді, коли їх представляють graph edges і claims; цей fragment не додає непідтверджених сценаріїв.\n\n## Expected behavior\n\n{}\n\n## Local implementation gaps\n\n{}{aliases}\n",
        label.to_lowercase(),
        label.to_lowercase(),
        fact_list(&facts.implemented, "Для topic немає окремого implemented claim; AS-IS обмежений evidence-backed graph boundary."),
        fact_list(&facts.outcomes, "Немає окремо названого public outcome."),
        fact_list(&facts.contracts, "Немає external contract у reachable graph."),
        fact_list(&quoted_paths, "Reverse impact paths відсутні у поточній graph projection."),
        fact_list(&facts.expected, "Для topic немає explicit expected claim. Відсутність expectation не створює implementation gap."),
        fact_list(&facts.gaps, "Для topic немає actionable implementation gaps."),
    )
}

/// Сторінка архітектури без приватної реалізації — порт `renderArchitecture`.
fn render_architecture(graph: &Value, hidden: &BTreeSet<String>) -> String {
    let domain_id = graph
        .get("domain")
        .and_then(|domain| string_field(domain, "id"))
        .unwrap_or_default();
    let empty = Vec::new();
    let boundaries = sorted_strings(
        graph
            .get("nodes")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .iter()
            .filter(|node| {
                string_field(node, "domainId") == Some(domain_id)
                    && string_field(node, "kind") == Some("integration")
                    && string_field(node, "visibility") == Some("external")
            })
            .map(|node| safe_text(string_field(node, "name"), hidden, "External contract"))
            .collect(),
    );
    let lines = if boundaries.is_empty() {
        "- Evidence-backed domain responsibility.".to_string()
    } else {
        boundaries
            .iter()
            .map(|name| format!("- External boundary: {name}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    const ARCHITECTURE_PREDICATES: [&str; 5] = [
        "responsibility",
        "config",
        "persistence",
        "integration",
        "state-change",
    ];
    let mut architecture_claims: Vec<&Value> = graph
        .get("claims")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|claim| {
            string_field(claim, "layer") == Some("implemented")
                && string_field(claim, "predicate")
                    .is_some_and(|predicate| ARCHITECTURE_PREDICATES.contains(&predicate))
        })
        .collect();
    architecture_claims.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left, "id").unwrap_or_default(),
            string_field(right, "id").unwrap_or_default(),
        )
    });
    let domain_title = safe_text(
        graph
            .get("domain")
            .and_then(|domain| string_field(domain, "name")),
        hidden,
        "Package domain",
    );

    if architecture_claims.is_empty() {
        return format!(
            "# Architecture: {domain_title}\n\n## Implemented AS-IS\n\nDomain architecture describes confirmed responsibilities and external boundaries without naming private implementation symbols.\n\n## Boundaries\n\n{lines}\n\n## Traceability\n\nThe manifest preserves reverse evidence links to files, tests, configuration and contracts.\n"
        );
    }
    format!(
        "# Architecture: {domain_title}\n\n## Implemented AS-IS\n\n{}\n\n## Boundaries\n\n{lines}\n\n## Traceability\n\nManifest зберігає reverse evidence links до files, tests, configuration і contracts.\n",
        claim_sections(&architecture_claims, hidden, "Немає evidence-backed architecture claims.")
    )
}

/// Mermaid лише для ребра, ОБИДВА кінці якого публічні.
fn render_mermaid(graph: &Value, hidden: &BTreeSet<String>) -> String {
    let domain_id = graph
        .get("domain")
        .and_then(|domain| string_field(domain, "id"))
        .unwrap_or_default();
    let empty = Vec::new();
    let nodes: Vec<&Value> = graph
        .get("nodes")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|node| {
            string_field(node, "domainId") == Some(domain_id)
                && string_field(node, "visibility") != Some("private")
        })
        .collect();
    let by_id = |id: Option<&str>| -> Option<&&Value> {
        id.and_then(|id| {
            nodes
                .iter()
                .find(|node| string_field(node, "id") == Some(id))
        })
    };
    let edge = graph
        .get("edges")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .find(|edge| {
            by_id(string_field(edge, "fromId")).is_some()
                && by_id(string_field(edge, "toId")).is_some()
        });
    let Some(edge) = edge else {
        return String::new();
    };
    let label = |id: Option<&str>, fallback: &str| -> String {
        let name = by_id(id).and_then(|node| string_field(node, "name"));
        safe_text(name, hidden, fallback).replace('"', "\\\"")
    };
    format!(
        "\n\n```mermaid\nflowchart LR\n  source[\"{}\"] --> target[\"{}\"]\n```",
        label(string_field(edge, "fromId"), "Source"),
        label(string_field(edge, "toId"), "Outcome")
    )
}

/// Обовʼязкова навігаційна сторінка — порт `renderIndex`.
fn render_index(
    graph: &Value,
    topics: &[Value],
    architecture: bool,
    hidden: &BTreeSet<String>,
) -> String {
    let mut sections: Vec<String> = Vec::new();
    if architecture {
        sections.push("- [Architecture](explanation/architecture.md)".to_string());
    }
    for kind in ["capability", "process", "contract"] {
        for topic in topics
            .iter()
            .filter(|topic| string_field(topic, "kind") == Some(kind))
        {
            let directory = lookup(&PAGE_KIND_PATHS, kind)
                .unwrap_or_default()
                .replacen("docs/", "", 1);
            let path = format!(
                "{directory}/{}.md",
                topic_token(string_field(topic, "id").unwrap_or_default())
            );
            let label = lookup(&PAGE_KIND_LABELS, kind).unwrap_or_default();
            sections.push(format!(
                "- [{}]({path})",
                safe_text(string_field(topic, "title"), hidden, label)
            ));
        }
    }
    let navigation = if sections.is_empty() {
        "- Наразі graph не має evidence-backed dedicated topics.".to_string()
    } else {
        sections.join("\n")
    };
    format!(
        "# Package knowledge: {}\n\n## Implemented AS-IS\n\nЦя навігація є deterministic projection одного documentation domain. Вона веде лише до meaningful pages і не розкриває private implementation symbols.\n\n## Views\n\n{navigation}\n\n## Traceability\n\n`docs/.docgen/manifest.json` містить stable topic identities, claims, evidence та reverse impact data.\n",
        safe_text(
            graph.get("domain").and_then(|domain| string_field(domain, "name")),
            hidden,
            "Package domain"
        )
    )
}

/// Лише actionable прогалини — задоволені очікування сторінки не потребують.
fn render_gaps(graph: &Value) -> String {
    let empty = Vec::new();
    let mut gaps: Vec<&Value> = graph
        .get("gaps")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|gap| string_field(gap, "status") != Some("satisfied"))
        .collect();
    gaps.sort_by(|left, right| {
        js_locale_cmp(
            string_field(left, "id").unwrap_or_default(),
            string_field(right, "id").unwrap_or_default(),
        )
    });
    let rows = gaps
        .iter()
        .map(|gap| {
            format!(
                "- Status: {}; explicit expectation requires review.",
                as_template_text(string_field(gap, "status"))
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# Implementation gaps\n\n## Explicit expectation comparison\n\n{rows}\n\nOnly explicit expected claims participate in this view; absent expectations are not defects.\n"
    )
}

/// Рендерить сторінки-кандидати і manifest — порт `renderKnowledgeArtifacts`.
///
/// Наприкінці ще раз перевіряє ВЕСЬ згенерований Markdown на приватні імена:
/// кожна окрема проєкція вже безпечна, але ця перевірка ловить те, що могло
/// просочитись через щойно доданий шлях.
#[must_use]
pub fn render_knowledge_artifacts(
    graph: &Value,
    existing_files: &BTreeMap<String, String>,
) -> RenderOutcome {
    let domain_id = graph
        .get("domain")
        .and_then(|domain| string_field(domain, "id"))
        .filter(|id| !id.is_empty());
    if domain_id.is_none() {
        return RenderOutcome::Blocked(vec![Diagnostic::new(
            "invalid-render-graph",
            "Graph має містити owning domain ID.",
            None,
        )]);
    }
    let manifest = canonical_graph(graph);
    let hidden = private_names(&manifest);
    let topics = page_topics(&manifest);
    let architecture = needs_architecture(&manifest);

    let mut pages: Vec<(String, String, String)> = vec![(
        "docs/index.md".to_string(),
        "package-index".to_string(),
        render_index(&manifest, &topics, architecture, &hidden),
    )];
    if architecture {
        pages.push((
            "docs/explanation/architecture.md".to_string(),
            "package-architecture".to_string(),
            format!(
                "{}{}\n",
                render_architecture(&manifest, &hidden),
                render_mermaid(&manifest, &hidden)
            ),
        ));
    }
    for topic in &topics {
        let kind = string_field(topic, "kind").unwrap_or_default();
        let token = topic_token(string_field(topic, "id").unwrap_or_default());
        pages.push((
            format!(
                "{}/{token}.md",
                lookup(&PAGE_KIND_PATHS, kind).unwrap_or_default()
            ),
            format!("{kind}-{token}"),
            render_topic(&manifest, topic, &hidden),
        ));
    }
    let has_actionable_gap = manifest
        .get("gaps")
        .and_then(Value::as_array)
        .is_some_and(|gaps| {
            gaps.iter()
                .any(|gap| string_field(gap, "status") != Some("satisfied"))
        });
    if has_actionable_gap {
        pages.push((
            "docs/implementation-gaps.md".to_string(),
            "implementation-gaps".to_string(),
            render_gaps(&manifest),
        ));
    }

    let mut files: Vec<(String, String)> = vec![(
        MANIFEST_PATH.to_string(),
        serialize_knowledge_graph(&manifest),
    )];
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    for (path, zone_id, content) in &pages {
        match render_page(path, zone_id, content, existing_files.get(path)) {
            Ok(markdown) => files.push((path.clone(), markdown)),
            Err(page_diagnostics) => diagnostics.extend(page_diagnostics),
        }
    }
    if !diagnostics.is_empty() {
        diagnostics.sort_by(|left, right| {
            js_locale_cmp(
                left.path.as_deref().unwrap_or(""),
                right.path.as_deref().unwrap_or(""),
            )
        });
        return RenderOutcome::Blocked(diagnostics);
    }

    let human_markdown = files
        .iter()
        .filter(|(path, _)| path.ends_with(".md"))
        .map(|(_, content)| content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    let leaked = sorted_strings(
        hidden
            .iter()
            .filter(|name| human_markdown.contains(name.as_str()))
            .cloned()
            .collect(),
    );
    if !leaked.is_empty() {
        return RenderOutcome::Blocked(
            leaked
                .into_iter()
                .map(|name| {
                    Diagnostic::new(
                        "private-symbol-leak",
                        &format!("Human Markdown містить private symbol name \"{name}\"."),
                        None,
                    )
                })
                .collect(),
        );
    }
    RenderOutcome::Rendered(files.into_iter().collect())
}
