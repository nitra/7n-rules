//! Накладання шару expected-claims — порт `expected-overlay.mjs`.
//!
//! Модуль НЕ інтерпретує прозу і нічого не зіставляє: він лише додає явно
//! задані очікування окремим шаром, щоб [`crate::gaps`] мав що порівнювати з
//! AS-IS. Кожне очікування лишається evidence-backed і вказує на вузол
//! ПОТОЧНОГО домену — інакше публікація блокується.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::deterministic::{canonical_value, js_locale_cmp};

/// Блокувальна діагностика overlay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub claim_id: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, message: &str, claim_id: Option<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            claim_id,
        }
    }

    /// Ключ упорядкування — дослівно `` `${claimId ?? ''}:${code}:${message}` ``.
    fn sort_key(&self) -> String {
        format!(
            "{}:{}:{}",
            self.claim_id.as_deref().unwrap_or(""),
            self.code,
            self.message
        )
    }
}

/// Результат накладання.
#[derive(Debug, Clone)]
pub enum OverlayOutcome {
    /// Новий граф; вхідний НЕ мутується (у JS це властивість, яку перевіряє
    /// окремий тест, тут — властивість типів).
    Merged(Box<Value>),
    Blocked(Vec<Diagnostic>),
}

fn blocked(diagnostics: Vec<Diagnostic>) -> OverlayOutcome {
    let mut diagnostics = diagnostics;
    diagnostics.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
    OverlayOutcome::Blocked(diagnostics)
}

/// Непорожній рядок за ключем.
fn non_empty(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// Перевіряє форму очікування — порт `claimFailure`.
///
/// Повертає КОД відмови, а не просто `false`: різні дефекти лікуються
/// по-різному, і злиття їх в один «невалідний claim» позбавило б викликача
/// діагностики.
fn claim_failure(claim: &Value) -> Option<&'static str> {
    if !claim.is_object() {
        return Some("invalid-expected-claim");
    }
    for key in ["id", "subjectId", "predicate", "sourceFingerprint"] {
        if non_empty(claim, key).is_none() {
            return Some("invalid-expected-claim");
        }
    }
    let evidence_ids = claim.get("evidenceIds").and_then(Value::as_array);
    let Some(evidence_ids) = evidence_ids.filter(|ids| !ids.is_empty()) else {
        return Some("expected-without-evidence");
    };
    let ids: Vec<&str> = evidence_ids.iter().filter_map(Value::as_str).collect();
    let all_non_empty = ids.len() == evidence_ids.len() && ids.iter().all(|id| !id.is_empty());
    let unique = ids.iter().collect::<BTreeSet<_>>().len() == ids.len();
    if !all_non_empty || !unique {
        return Some("invalid-expected-evidence");
    }
    let confidence = claim.get("confidence").and_then(Value::as_f64);
    if !confidence.is_some_and(|value| (0.0..=1.0).contains(&value)) {
        return Some("invalid-expected-confidence");
    }
    None
}

/// Збирає непорожні `id` колекції графа.
fn ids_of(graph: &Value, collection: &str) -> BTreeSet<String> {
    graph
        .get(collection)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| non_empty(item, "id"))
                .collect()
        })
        .unwrap_or_default()
}

/// Додає явно задані expected-claims і їхнє evidence — порт
/// `applyExpectedOverlay`.
///
/// Наявне evidence графа можна згадувати напряму; нове — необовʼязкове, але
/// мусить мати унікальні ID. Прохід fail-closed і ОДИН: діагностики
/// збираються з усіх колекцій разом, щоб викликач бачив повну картину, а не
/// перший дефект.
#[must_use]
pub fn apply_expected_overlay(graph: &Value, overlay: &Value) -> OverlayOutcome {
    if !graph.is_object() {
        return blocked(vec![Diagnostic::new(
            "invalid-graph",
            "Graph має бути обʼєктом.",
            None,
        )]);
    }
    let collections = ["nodes", "claims", "evidence"];
    if collections
        .iter()
        .any(|key| graph.get(key).and_then(Value::as_array).is_none())
    {
        return blocked(vec![Diagnostic::new(
            "invalid-graph",
            "Graph має містити nodes[], claims[] та evidence[].",
            None,
        )]);
    }
    let empty = Value::Array(Vec::new());
    let claims = overlay.get("claims").unwrap_or(&empty);
    let evidence = overlay.get("evidence").unwrap_or(&empty);
    let (Some(claims), Some(evidence)) = (claims.as_array(), evidence.as_array()) else {
        return blocked(vec![Diagnostic::new(
            "invalid-expected-overlay",
            "Overlay має містити масиви claims[] та evidence[].",
            None,
        )]);
    };

    let node_ids = ids_of(graph, "nodes");
    let graph_claim_ids = ids_of(graph, "claims");
    let evidence_ids = ids_of(graph, "evidence");
    let mut diagnostics = Vec::new();
    let mut new_evidence_ids: BTreeSet<String> = BTreeSet::new();

    for item in evidence {
        let Some(id) = non_empty(item, "id").filter(|_| item.is_object()) else {
            diagnostics.push(Diagnostic::new(
                "invalid-expected-evidence",
                "Overlay evidence мусить мати непорожній id.",
                None,
            ));
            continue;
        };
        if evidence_ids.contains(&id) || new_evidence_ids.contains(&id) {
            diagnostics.push(Diagnostic::new(
                "duplicate-evidence-id",
                &format!("Evidence ID \"{id}\" вже існує."),
                None,
            ));
            continue;
        }
        new_evidence_ids.insert(id);
    }
    let available_evidence_ids: BTreeSet<&String> =
        evidence_ids.iter().chain(new_evidence_ids.iter()).collect();
    let mut new_claim_ids: BTreeSet<String> = BTreeSet::new();

    for raw_claim in claims {
        let claim_id = non_empty(raw_claim, "id");
        if let Some(failure) = claim_failure(raw_claim) {
            diagnostics.push(Diagnostic::new(
                failure,
                "Expected claim не має повного evidence-backed contract.",
                claim_id,
            ));
            continue;
        }
        let claim_id = claim_id.unwrap_or_default();
        let layer = raw_claim.get("layer");
        if layer.is_some_and(|layer| layer != &Value::String("expected".to_string())) {
            diagnostics.push(Diagnostic::new(
                "invalid-expected-layer",
                "Overlay приймає лише claims layer=expected.",
                Some(claim_id),
            ));
            continue;
        }
        if graph_claim_ids.contains(&claim_id) || new_claim_ids.contains(&claim_id) {
            diagnostics.push(Diagnostic::new(
                "duplicate-claim-id",
                &format!("Claim ID \"{claim_id}\" вже існує."),
                Some(claim_id),
            ));
            continue;
        }
        let subject_id = non_empty(raw_claim, "subjectId").unwrap_or_default();
        if !node_ids.contains(&subject_id) {
            diagnostics.push(Diagnostic::new(
                "unknown-expected-subject",
                &format!("Subject \"{subject_id}\" відсутній у graph."),
                Some(claim_id),
            ));
            continue;
        }
        let unknown_evidence = raw_claim
            .get("evidenceIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .any(|id| !available_evidence_ids.contains(&id.to_string()))
            });
        if unknown_evidence {
            diagnostics.push(Diagnostic::new(
                "unknown-expected-evidence",
                "Expected claim посилається на відсутнє evidence.",
                Some(claim_id),
            ));
            continue;
        }
        new_claim_ids.insert(claim_id);
    }

    if !diagnostics.is_empty() {
        return blocked(diagnostics);
    }

    let expected_claims: Vec<Value> = claims
        .iter()
        .map(|raw_claim| {
            let mut claim = Map::new();
            claim.insert(
                "id".to_string(),
                raw_claim.get("id").cloned().unwrap_or(Value::Null),
            );
            claim.insert(
                "subjectId".to_string(),
                raw_claim.get("subjectId").cloned().unwrap_or(Value::Null),
            );
            claim.insert("layer".to_string(), Value::String("expected".to_string()));
            claim.insert(
                "predicate".to_string(),
                raw_claim.get("predicate").cloned().unwrap_or(Value::Null),
            );
            // `value` кладемо ЛИШЕ якщо воно є: у JS `value: undefined` зникає
            // при серіалізації, а `null` — ні, і це була б інша форма.
            if let Some(value) = raw_claim.get("value") {
                claim.insert("value".to_string(), value.clone());
            }
            let mut evidence_ids: Vec<String> = raw_claim
                .get("evidenceIds")
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            evidence_ids.sort_unstable();
            claim.insert("evidenceIds".to_string(), Value::from(evidence_ids));
            claim.insert(
                "confidence".to_string(),
                raw_claim.get("confidence").cloned().unwrap_or(Value::Null),
            );
            claim.insert(
                "sourceFingerprint".to_string(),
                raw_claim
                    .get("sourceFingerprint")
                    .cloned()
                    .unwrap_or(Value::Null),
            );
            canonical_value(&Value::Object(claim))
        })
        .collect();

    let sort_by_id = |items: &mut Vec<Value>| {
        items.sort_by(|left, right| {
            js_locale_cmp(
                left.get("id").and_then(Value::as_str).unwrap_or_default(),
                right.get("id").and_then(Value::as_str).unwrap_or_default(),
            )
        });
    };
    let mut merged_claims: Vec<Value> = graph
        .get("claims")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(canonical_value).collect())
        .unwrap_or_default();
    merged_claims.extend(expected_claims);
    sort_by_id(&mut merged_claims);

    let mut merged_evidence: Vec<Value> = graph
        .get("evidence")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(canonical_value).collect())
        .unwrap_or_default();
    merged_evidence.extend(evidence.iter().map(canonical_value));
    sort_by_id(&mut merged_evidence);

    let Value::Object(mut merged) = canonical_value(graph) else {
        return blocked(vec![Diagnostic::new(
            "invalid-graph",
            "Graph має бути обʼєктом.",
            None,
        )]);
    };
    merged.insert("claims".to_string(), Value::Array(merged_claims));
    merged.insert("evidence".to_string(), Value::Array(merged_evidence));
    OverlayOutcome::Merged(Box::new(Value::Object(merged)))
}
