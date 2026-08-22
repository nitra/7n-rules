//! Детерміновані вердикти по expected-шару — порт `gap-engine.mjs`.
//!
//! Двигун приймає ЛИШЕ явні структуровані звʼязки: він не виводить
//! відповідність із прози, а низьку впевненість чи суперечливі звʼязки чесно
//! лишає в статусі `unresolved`. Це головна властивість модуля — прогалина
//! («цього не реалізовано») і невизначеність («ми не знаємо») не злипаються
//! в один статус.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::deterministic::js_locale_cmp;
use crate::gap_mappings::Mapping;

/// Дозволені звʼязки — ті самі, що приймає comparator.
const RELATIONS: [&str; 2] = ["equivalent", "contradicts"];

/// Блокувальна діагностика двигуна.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

/// Вердикт по одному очікуванню.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gap {
    pub id: String,
    /// `satisfied` | `missing` | `diverged` | `unresolved`.
    pub status: String,
    pub expected_claim_id: String,
    pub implemented_claim_ids: Vec<String>,
    pub evidence_ids: Vec<String>,
}

/// Стан одного gate публікації.
#[derive(Debug, Clone, Default)]
pub struct GateState {
    pub ok: bool,
    pub message: Option<String>,
}

/// Стан gate-ів, що передують вердиктам.
#[derive(Debug, Clone, Default)]
pub struct Validation {
    pub parser: Option<GateState>,
    pub coverage: Option<GateState>,
}

/// Результат обчислення.
#[derive(Debug, Clone)]
pub enum GapOutcome {
    Evaluated(Vec<Gap>),
    Blocked(Vec<Diagnostic>),
}

/// Вхід двигуна.
pub struct GapInput<'a> {
    /// Граф із накладеним expected-шаром ([`crate::expected`]).
    pub graph: &'a Value,
    /// Звʼязки від comparator-а ([`crate::gap_mappings`]).
    pub mappings: &'a [Mapping],
    /// Очікування, які comparator ЯВНО лишив невизначеними.
    pub unresolved_expected_claim_ids: &'a [String],
    pub validation: Validation,
    /// Поріг впевненості; типово 1 — вимагаємо повної.
    pub minimum_confidence: f64,
}

/// Блокери gate-ів — порт `validationBlockers`.
///
/// Провалений parser чи coverage віддається ЯК Є, а не перетворюється на
/// купу `unresolved`-прогалин: причина в іншому місці, і показати треба саме
/// її.
fn validation_blockers(validation: &Validation) -> Vec<Diagnostic> {
    let mut blockers = Vec::new();
    for (state, code, gate) in [
        (&validation.parser, "parser-blocked", "parser"),
        (&validation.coverage, "coverage-blocked", "coverage"),
    ] {
        if let Some(state) = state {
            if !state.ok {
                blockers.push(Diagnostic::new(
                    code,
                    state
                        .message
                        .clone()
                        .unwrap_or_else(|| format!("{gate} gate не пройдено."))
                        .as_str(),
                ));
            }
        }
    }
    blockers.sort_by(|left, right| js_locale_cmp(&left.code, &right.code));
    blockers
}

/// Список рядків із поля claim-а.
fn string_list(claim: &Value, key: &str) -> Vec<String> {
    claim
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

/// Чи повністю підтверджений claim — порт `hasStrongEvidence`.
fn has_strong_evidence(
    claim: &Value,
    evidence_ids: &BTreeSet<String>,
    minimum_confidence: f64,
) -> bool {
    let ids = claim.get("evidenceIds").and_then(Value::as_array);
    let Some(ids) = ids.filter(|ids| !ids.is_empty()) else {
        return false;
    };
    let known = ids
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| evidence_ids.contains(*id))
        .count()
        == ids.len();
    let confident = claim
        .get("confidence")
        .and_then(Value::as_f64)
        .is_some_and(|confidence| confidence >= minimum_confidence);
    known && confident
}

/// Перевіряє один звʼязок проти графа — порт `validateMapping`.
///
/// Форму (наявність полів) у Rust гарантує тип [`Mapping`], тож тут лишились
/// саме перехресні перевірки: невідома звʼязка, невідомий claim, evidence
/// поза графом чи з дублікатами.
fn validate_mapping(
    mapping: &Mapping,
    expected_by_id: &BTreeMap<String, &Value>,
    implemented_by_id: &BTreeMap<String, &Value>,
    evidence_ids: &BTreeSet<String>,
) -> Result<(), Diagnostic> {
    if !RELATIONS.contains(&mapping.relation.as_str()) || mapping.evidence_ids.is_empty() {
        return Err(Diagnostic::new(
            "invalid-gap-mapping",
            "Mapping має exact expected/implemented IDs, relation і evidenceIds[].",
        ));
    }
    if !expected_by_id.contains_key(&mapping.expected_claim_id)
        || !implemented_by_id.contains_key(&mapping.implemented_claim_id)
    {
        return Err(Diagnostic::new(
            "unknown-gap-claim",
            "Mapping посилається на відсутній expected або implemented claim.",
        ));
    }
    let unique: BTreeSet<&String> = mapping.evidence_ids.iter().collect();
    if unique.len() != mapping.evidence_ids.len()
        || mapping
            .evidence_ids
            .iter()
            .any(|id| !evidence_ids.contains(id))
    {
        return Err(Diagnostic::new(
            "invalid-gap-evidence",
            "Mapping не має валідного evidence provenance.",
        ));
    }
    Ok(())
}

/// Обчислює детерміновані статуси прогалин — порт `evaluateGaps`.
#[must_use]
pub fn evaluate_gaps(input: GapInput<'_>) -> GapOutcome {
    let blockers = validation_blockers(&input.validation);
    if !blockers.is_empty() {
        return GapOutcome::Blocked(blockers);
    }
    let claims = input.graph.get("claims").and_then(Value::as_array);
    let evidence = input.graph.get("evidence").and_then(Value::as_array);
    let (Some(claims), Some(evidence)) = (claims, evidence) else {
        return GapOutcome::Blocked(vec![Diagnostic::new(
            "invalid-gap-graph",
            "Graph має містити claims[] та evidence[].",
        )]);
    };
    if !(0.0..=1.0).contains(&input.minimum_confidence) {
        return GapOutcome::Blocked(vec![Diagnostic::new(
            "invalid-gap-input",
            "mappings та unresolvedExpectedClaimIds мають бути масивами, minimumConfidence — числом від 0 до 1.",
        )]);
    }

    let id_of = |claim: &Value| {
        claim
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let by_layer = |layer: &str| -> Vec<&Value> {
        claims
            .iter()
            .filter(|claim| claim.get("layer").and_then(Value::as_str) == Some(layer))
            .collect()
    };
    let mut expected_claims = by_layer("expected");
    expected_claims.sort_by(|left, right| js_locale_cmp(&id_of(left), &id_of(right)));
    if expected_claims.is_empty() {
        return GapOutcome::Evaluated(Vec::new());
    }
    let expected_by_id: BTreeMap<String, &Value> = expected_claims
        .iter()
        .map(|claim| (id_of(claim), *claim))
        .collect();

    let unique_unresolved: BTreeSet<&String> = input.unresolved_expected_claim_ids.iter().collect();
    if unique_unresolved.len() != input.unresolved_expected_claim_ids.len()
        || input
            .unresolved_expected_claim_ids
            .iter()
            .any(|id| !expected_by_id.contains_key(id))
    {
        return GapOutcome::Blocked(vec![Diagnostic::new(
            "invalid-unresolved-expected",
            "unresolvedExpectedClaimIds містить невідомий або дубльований expected claim.",
        )]);
    }
    let implemented_by_id: BTreeMap<String, &Value> = by_layer("implemented")
        .into_iter()
        .map(|claim| (id_of(claim), claim))
        .collect();
    let evidence_ids: BTreeSet<String> = evidence
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect();

    let mut mapping_diagnostics = Vec::new();
    for mapping in input.mappings {
        if let Err(diagnostic) =
            validate_mapping(mapping, &expected_by_id, &implemented_by_id, &evidence_ids)
        {
            mapping_diagnostics.push(diagnostic);
        }
    }
    if !mapping_diagnostics.is_empty() {
        mapping_diagnostics.sort_by(|left, right| {
            js_locale_cmp(
                &format!("{}:{}", left.code, left.message),
                &format!("{}:{}", right.code, right.message),
            )
        });
        return GapOutcome::Blocked(mapping_diagnostics);
    }

    let mut by_expected: BTreeMap<&str, Vec<&Mapping>> = BTreeMap::new();
    for mapping in input.mappings {
        by_expected
            .entry(mapping.expected_claim_id.as_str())
            .or_default()
            .push(mapping);
    }

    let mut gaps: Vec<Gap> = expected_claims
        .iter()
        .map(|expected_claim| {
            let expected_id = id_of(expected_claim);
            let mut claim_mappings: Vec<&Mapping> = by_expected
                .get(expected_id.as_str())
                .cloned()
                .unwrap_or_default();
            claim_mappings.sort_by(|left, right| {
                js_locale_cmp(
                    &format!("{}:{}", left.implemented_claim_id, left.relation),
                    &format!("{}:{}", right.implemented_claim_id, right.relation),
                )
            });
            let implementation_claims: Vec<&Value> = claim_mappings
                .iter()
                .filter_map(|mapping| {
                    implemented_by_id
                        .get(&mapping.implemented_claim_id)
                        .copied()
                })
                .collect();

            let strong_expected =
                has_strong_evidence(expected_claim, &evidence_ids, input.minimum_confidence);
            let strong_mappings = claim_mappings
                .iter()
                .all(|mapping| !mapping.evidence_ids.is_empty());
            let strong_implemented = implementation_claims
                .iter()
                .all(|claim| has_strong_evidence(claim, &evidence_ids, input.minimum_confidence));
            let relations: BTreeSet<&str> = claim_mappings
                .iter()
                .map(|mapping| mapping.relation.as_str())
                .collect();

            // Порядок перевірок дослівний, і він змістовний: невизначеність
            // ПЕРЕМАГАЄ над «нічого не знайдено». Слабке очікування без
            // жодного звʼязку — це `unresolved`, а не `missing`: ми не
            // довели, що чогось бракує, ми просто не змогли перевірити.
            let status = if input.unresolved_expected_claim_ids.contains(&expected_id)
                || !strong_expected
                || !strong_mappings
                || !strong_implemented
                || relations.len() > 1
            {
                "unresolved"
            } else if claim_mappings.is_empty() {
                "missing"
            } else if relations.contains("equivalent") {
                "satisfied"
            } else {
                "diverged"
            };

            let mut gap_evidence: BTreeSet<String> = string_list(expected_claim, "evidenceIds")
                .into_iter()
                .collect();
            for mapping in &claim_mappings {
                gap_evidence.extend(mapping.evidence_ids.iter().cloned());
            }
            for claim in &implementation_claims {
                gap_evidence.extend(string_list(claim, "evidenceIds"));
            }
            let implemented_claim_ids: BTreeSet<String> = claim_mappings
                .iter()
                .map(|mapping| mapping.implemented_claim_id.clone())
                .collect();

            Gap {
                id: format!("gap:{expected_id}"),
                status: status.to_string(),
                expected_claim_id: expected_id,
                implemented_claim_ids: implemented_claim_ids.into_iter().collect(),
                evidence_ids: gap_evidence.into_iter().collect(),
            }
        })
        .collect();
    gaps.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));
    GapOutcome::Evaluated(gaps)
}
