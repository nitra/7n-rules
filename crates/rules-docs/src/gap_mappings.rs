//! Comparator expected↔implemented claims — порт `gap-mappings.mjs`.
//!
//! Точні канонічні збіги вирішуються локально й моделі не коштують; до неї
//! йдуть лише non-exact кандидати ТОГО САМОГО субʼєкта. Невизначеність
//! лишається явним `unresolved`, а не тихо стає «missing» — інакше gap-engine
//! рапортував би прогалину там, де просто забракло доказів.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

use llm_lib::tiers::Tier;
use serde_json::{json, Value};

use crate::deterministic::{
    canonical_hash, canonical_json, js_locale_cmp, load_versioned_cache, save_versioned_cache,
    VersionedCache,
};
use crate::wave::{submit_wave, tier_name, ChainRef, SubmitBatchFn, WaveItem, WaveResult};

/// Версія strict comparator response schema і cache-записів.
pub const GAP_MAPPING_SCHEMA_VERSION: &str = "package-knowledge-gap-mappings-v1";
/// Версія prompt-контракту comparator-а.
pub const GAP_MAPPING_PROMPT_VERSION: &str = "package-knowledge-gap-mappings-v1";

const CACHE_VERSION: u64 = 1;
/// Єдині дві семантичні звʼязки, які comparator має право повернути.
const RELATIONS: [&str; 2] = ["equivalent", "contradicts"];

/// Блокувальна діагностика comparator-а.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub expected_claim_id: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, message: &str, expected_claim_id: Option<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            expected_claim_id,
        }
    }
}

/// Evidence-backed звʼязка між expected і implemented claim-ами — вхід
/// gap-engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mapping {
    pub expected_claim_id: String,
    pub implemented_claim_id: String,
    pub relation: String,
    pub evidence_ids: Vec<String>,
}

impl Mapping {
    fn sort_key(&self) -> String {
        format!(
            "{}:{}:{}",
            self.expected_claim_id, self.implemented_claim_id, self.relation
        )
    }
}

/// Результат comparator-а.
#[derive(Debug, Clone)]
pub enum GapMappingOutcome {
    Compared {
        mappings: Vec<Mapping>,
        unresolved_expected_claim_ids: Vec<String>,
        cache: Value,
    },
    Blocked {
        diagnostics: Vec<Diagnostic>,
        cache: Value,
    },
}

/// Вхід comparator-а.
pub struct GapMappingInput<'a> {
    pub graph: &'a Value,
    pub cache: Option<VersionedCache>,
    pub cache_path: Option<&'a Path>,
    pub model_policy: Vec<Tier>,
    pub prompt_version: String,
    pub schema_version: String,
    pub submit: SubmitBatchFn,
    pub chain: ChainRef,
}

/// Прийнята comparator-ом звʼязка одного кандидата.
#[derive(Debug, Clone)]
pub struct Comparison {
    pub implemented_claim_id: String,
    pub relation: String,
}

/// Розібрана відповідь comparator-а.
#[derive(Debug, Clone)]
pub struct ParsedComparison {
    pub comparisons: Vec<Comparison>,
    pub unresolved: bool,
}

/// Робота по одному expected claim-у.
struct Work {
    expected: Value,
    candidates: Vec<Value>,
    cache_key: String,
    prompt: String,
}

impl Work {
    fn expected_id(&self) -> String {
        self.expected
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    }

    fn candidates_by_id(&self) -> HashMap<String, Value> {
        self.candidates
            .iter()
            .filter_map(|candidate| {
                candidate
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| (id.to_string(), candidate.clone()))
            })
            .collect()
    }
}

/// Рівність точного канонічного твердження, незалежно від походження
/// evidence — порт `isExactEquivalent`.
fn is_exact_equivalent(expected: &Value, implemented: &Value) -> bool {
    expected.get("subjectId") == implemented.get("subjectId")
        && expected.get("predicate") == implemented.get("predicate")
        && canonical_json(expected.get("value").unwrap_or(&Value::Null))
            == canonical_json(implemented.get("value").unwrap_or(&Value::Null))
}

/// Звʼязка з обʼєднаним evidence обох сторін — порт `mapping`.
fn mapping(expected: &Value, implemented: &Value, relation: &str) -> Mapping {
    let ids = |claim: &Value| -> Vec<String> {
        claim
            .get("evidenceIds")
            .and_then(Value::as_array)
            .map(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut union: Vec<String> = ids(expected);
    union.extend(ids(implemented));
    let mut seen = HashSet::new();
    union.retain(|id| seen.insert(id.clone()));
    // `.toSorted()` без компаратора — побайтово, не `localeCompare`.
    union.sort_unstable();
    Mapping {
        expected_claim_id: expected
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        implemented_claim_id: implemented
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        relation: relation.to_string(),
        evidence_ids: union,
    }
}

/// Claims, придатні до порівняння — порт `comparisonClaims`. Malformed граф
/// відкидається ДО моделі.
fn comparison_claims(graph: &Value) -> Result<(Vec<Value>, Vec<Value>), Vec<Diagnostic>> {
    let Some(claims) = graph.get("claims").and_then(Value::as_array) else {
        return Err(vec![Diagnostic::new(
            "invalid-gap-mapping-graph",
            "Graph мусить містити claims[].",
            None,
        )]);
    };
    let is_comparable_layer = |claim: &Value| {
        matches!(
            claim.get("layer").and_then(Value::as_str),
            Some("expected") | Some("implemented")
        )
    };
    let has_contract = |claim: &Value| {
        let non_empty = |key: &str| {
            claim
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
        };
        non_empty("id")
            && non_empty("subjectId")
            && non_empty("predicate")
            && claim
                .get("evidenceIds")
                .and_then(Value::as_array)
                .is_some_and(|ids| !ids.is_empty())
    };
    let invalid: Vec<&Value> = claims
        .iter()
        .filter(|claim| is_comparable_layer(claim) && !has_contract(claim))
        .collect();
    if !invalid.is_empty() {
        return Err(invalid
            .into_iter()
            .map(|claim| {
                Diagnostic::new(
                    "invalid-gap-mapping-claim",
                    "Claim не має comparison contract.",
                    claim.get("id").and_then(Value::as_str).map(str::to_string),
                )
            })
            .collect());
    }
    let by_layer = |layer: &str| -> Vec<Value> {
        let mut selected: Vec<Value> = claims
            .iter()
            .filter(|claim| claim.get("layer").and_then(Value::as_str) == Some(layer))
            .cloned()
            .collect();
        selected.sort_by(|left, right| {
            js_locale_cmp(
                left.get("id").and_then(Value::as_str).unwrap_or_default(),
                right.get("id").and_then(Value::as_str).unwrap_or_default(),
            )
        });
        selected
    };
    Ok((by_layer("expected"), by_layer("implemented")))
}

/// Cache-ключ порівняння — порт `createGapMappingCacheKey`.
#[must_use]
pub fn create_gap_mapping_cache_key(
    expected: &Value,
    candidates: &[Value],
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
) -> String {
    canonical_hash(&json!({
        "expected": expected,
        "candidates": candidates,
        "promptVersion": prompt_version,
        "schemaVersion": schema_version,
        "modelPolicy": model_policy.iter().map(|tier| tier_name(*tier)).collect::<Vec<_>>(),
    }))
}

/// Парсить строгу відповідь comparator-а — порт `parseGapMappingResult`.
///
/// Чужий `implementedClaimId`, невідома звʼязка чи два різні relation в
/// одній відповіді — не «часткова правда», а відмова: перші два блокують,
/// останнє стає явним `unresolved`.
///
/// # Errors
/// Машинний код причини — він же йде в діагностику.
pub fn parse_gap_mapping_result(
    text: Option<&Value>,
    expected: &Value,
    candidates: &HashMap<String, Value>,
) -> Result<ParsedComparison, String> {
    let Some(Value::String(text)) = text else {
        return Err("invalid-comparison-json".to_string());
    };
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return Err("invalid-comparison-json".to_string());
    };
    let Some(object) = parsed.as_object() else {
        return Err("invalid-comparison-shape".to_string());
    };
    // Відсортовано — див. доккоментар-близнюк у `entailment`: порядок ключів
    // у відповіді моделі довільний, а `preserve_order` віддає документний.
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != ["comparisons", "expectedClaimId", "unresolved"] {
        return Err("invalid-comparison-shape".to_string());
    }
    let matching_id =
        object.get("expectedClaimId") == expected.get("id") && expected.get("id").is_some();
    let Some(unresolved) = object.get("unresolved").and_then(Value::as_bool) else {
        return Err("invalid-comparison-shape".to_string());
    };
    let Some(raw_comparisons) = object.get("comparisons").and_then(Value::as_array) else {
        return Err("invalid-comparison-shape".to_string());
    };
    if !matching_id {
        return Err("invalid-comparison-shape".to_string());
    }

    let mut comparisons = Vec::with_capacity(raw_comparisons.len());
    for raw in raw_comparisons {
        let Some(entry) = raw.as_object() else {
            return Err("invalid-comparison-shape".to_string());
        };
        let mut entry_keys: Vec<&str> = entry.keys().map(String::as_str).collect();
        entry_keys.sort_unstable();
        if entry_keys != ["implementedClaimId", "relation"] {
            return Err("invalid-comparison-shape".to_string());
        }
        let implemented_claim_id = entry.get("implementedClaimId").and_then(Value::as_str);
        let relation = entry.get("relation").and_then(Value::as_str);
        let known_candidate = implemented_claim_id.is_some_and(|id| candidates.contains_key(id));
        let known_relation = relation.is_some_and(|value| RELATIONS.contains(&value));
        if !known_candidate || !known_relation {
            return Err("unknown-comparison-claim".to_string());
        }
        comparisons.push(Comparison {
            implemented_claim_id: implemented_claim_id.unwrap_or_default().to_string(),
            relation: relation.unwrap_or_default().to_string(),
        });
    }
    let distinct_candidates: HashSet<&str> = comparisons
        .iter()
        .map(|comparison| comparison.implemented_claim_id.as_str())
        .collect();
    if distinct_candidates.len() != comparisons.len() {
        return Err("ambiguous-comparison".to_string());
    }
    let distinct_relations: HashSet<&str> = comparisons
        .iter()
        .map(|comparison| comparison.relation.as_str())
        .collect();
    if unresolved || distinct_relations.len() > 1 {
        return Ok(ParsedComparison {
            comparisons: Vec::new(),
            unresolved: true,
        });
    }
    Ok(ParsedComparison {
        comparisons,
        unresolved: false,
    })
}

/// Робота для non-exact групи кандидатів — порт `createWork`.
fn create_work(
    expected: &Value,
    candidates: Vec<Value>,
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
) -> Work {
    let cache_key = create_gap_mapping_cache_key(
        expected,
        &candidates,
        prompt_version,
        schema_version,
        model_policy,
    );
    // МЕЖА порту: JS кладе в payload сирі claim-и, тобто в порядку ключів
    // ДОКУМЕНТА, а `serde_json::Value` цей порядок не зберігає (обʼєкт —
    // `BTreeMap`). Тут payload канонічний. На cache-ключ це не впливає (він
    // і в JS канонізує), на семантику для моделі — теж; побайтова рівність
    // саме цього рядка з JS не досяжна без власного ordered-типу.
    let payload = format!(
        "{{\"expectedClaim\":{},\"implementedCandidates\":{}}}",
        canonical_json(expected),
        canonical_json(&Value::Array(candidates.clone()))
    );
    let prompt = [
        "Compare one expected claim only with the supplied same-subject implemented candidates.",
        "Do not invent IDs or rewrite claims. Return exactly JSON with expectedClaimId, comparisons, unresolved.",
        "Use unresolved:true when evidence is ambiguous or insufficient. Return unresolved:false and [] only when no candidate implements or contradicts the expectation.",
        &payload,
    ]
    .join("\n");
    Work {
        expected: expected.clone(),
        candidates,
        cache_key,
        prompt,
    }
}

/// Накопичені факти порівняння.
struct State {
    mappings: Vec<Mapping>,
    unresolved: BTreeSet<String>,
}

/// Розкладає точні збіги локально, лишаючи моделі лише non-exact — порт
/// `planComparison`.
fn plan_comparison(
    expected_claims: &[Value],
    implemented_claims: &[Value],
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
) -> (Vec<Mapping>, Vec<Work>) {
    let mut mappings = Vec::new();
    let mut work = Vec::new();
    for expected in expected_claims {
        let same_subject: Vec<Value> = implemented_claims
            .iter()
            .filter(|implemented| implemented.get("subjectId") == expected.get("subjectId"))
            .cloned()
            .collect();
        let exact: Vec<&Value> = same_subject
            .iter()
            .filter(|implemented| is_exact_equivalent(expected, implemented))
            .collect();
        if !exact.is_empty() {
            mappings.extend(
                exact
                    .into_iter()
                    .map(|implemented| mapping(expected, implemented, "equivalent")),
            );
        } else if !same_subject.is_empty() {
            work.push(create_work(
                expected,
                same_subject,
                prompt_version,
                schema_version,
                model_policy,
            ));
        }
    }
    (mappings, work)
}

/// Переносить прийняте порівняння у факти — порт `acceptComparison`.
fn accept_comparison(state: &mut State, item: &Work, checked: &ParsedComparison) {
    if checked.unresolved {
        state.unresolved.insert(item.expected_id());
        return;
    }
    let candidates = item.candidates_by_id();
    for comparison in &checked.comparisons {
        if let Some(implemented) = candidates.get(&comparison.implemented_claim_id) {
            state
                .mappings
                .push(mapping(&item.expected, implemented, &comparison.relation));
        }
    }
}

/// Відбирає промахи, застосовуючи валідні кешовані порівняння — порт
/// `selectPendingWork`.
fn select_pending<'a>(
    work: &'a [Work],
    cache: &VersionedCache,
    state: &mut State,
) -> Vec<&'a Work> {
    let mut pending = Vec::new();
    for item in work {
        let candidates = item.candidates_by_id();
        match parse_gap_mapping_result(
            cache.entries.get(&item.cache_key),
            &item.expected,
            &candidates,
        ) {
            Ok(checked) => accept_comparison(state, item, &checked),
            Err(_) => pending.push(item),
        }
    }
    pending
}

/// Порівнює expected claims із AS-IS claims — порт `compareClaimMappings`.
///
/// Точка інтеграції runner-а: після entailment і перед `evaluateGaps`;
/// `mappings` та `unresolved_expected_claim_ids` йдуть у gate.
///
/// # Errors
/// Помилка вводу-виводу кешу — fail-closed.
pub async fn compare_claim_mappings(
    input: GapMappingInput<'_>,
) -> Result<GapMappingOutcome, String> {
    let mut cache = load_versioned_cache(input.cache_path, input.cache, CACHE_VERSION)?;
    let blocked = |diagnostics: Vec<Diagnostic>, cache: &VersionedCache| {
        Ok(GapMappingOutcome::Blocked {
            diagnostics,
            cache: cache.to_value(),
        })
    };

    let (expected_claims, implemented_claims) = match comparison_claims(input.graph) {
        Ok(claims) => claims,
        Err(diagnostics) => return blocked(diagnostics, &cache),
    };
    if expected_claims.is_empty() {
        return Ok(GapMappingOutcome::Compared {
            mappings: Vec::new(),
            unresolved_expected_claim_ids: Vec::new(),
            cache: cache.to_value(),
        });
    }
    if input.model_policy != crate::wave::default_model_policy() {
        return blocked(
            vec![Diagnostic::new(
                "invalid-gap-mapping-model-policy",
                "Comparator використовує universal policy min -> avg -> max.",
                None,
            )],
            &cache,
        );
    }

    let (exact_mappings, work) = plan_comparison(
        &expected_claims,
        &implemented_claims,
        &input.prompt_version,
        &input.schema_version,
        &input.model_policy,
    );
    let mut state = State {
        mappings: exact_mappings,
        unresolved: BTreeSet::new(),
    };
    let mut pending = select_pending(&work, &cache, &mut state);
    let mut failures: HashMap<String, String> = HashMap::new();

    for tier in &input.model_policy {
        if pending.is_empty() {
            break;
        }
        let items = pending
            .iter()
            .map(|item| WaveItem {
                custom_id: item.expected_id(),
                prompt: item.prompt.clone(),
            })
            .collect();
        let responses = submit_wave(items, *tier, &input.submit, &input.chain).await;
        let mut retry = Vec::new();
        for item in pending {
            let expected_id = item.expected_id();
            let response: Option<&WaveResult> = responses.get(&expected_id);
            let text = response.and_then(|result| result.outcome.as_ref().ok());
            let text_value = text.map(|text| Value::String(text.clone()));
            let candidates = item.candidates_by_id();
            match parse_gap_mapping_result(text_value.as_ref(), &item.expected, &candidates) {
                Ok(checked) => {
                    cache
                        .entries
                        .insert(item.cache_key.clone(), text_value.unwrap_or(Value::Null));
                    accept_comparison(&mut state, item, &checked);
                    failures.remove(&expected_id);
                }
                Err(reason) => {
                    let code = match response {
                        Some(result) if result.outcome.is_err() => "comparison-batch-error",
                        _ => reason.as_str(),
                    };
                    failures.insert(expected_id, code.to_string());
                    retry.push(item);
                }
            }
        }
        pending = retry;
    }
    save_versioned_cache(input.cache_path, &cache)?;

    if !pending.is_empty() {
        let mut diagnostics: Vec<Diagnostic> = pending
            .iter()
            .map(|item| {
                let expected_id = item.expected_id();
                Diagnostic::new(
                    failures
                        .get(&expected_id)
                        .map_or("unresolved-comparison", String::as_str),
                    "Expected claim не пройшов strict semantic comparator.",
                    Some(expected_id),
                )
            })
            .collect();
        diagnostics.sort_by(|left, right| {
            js_locale_cmp(
                left.expected_claim_id.as_deref().unwrap_or_default(),
                right.expected_claim_id.as_deref().unwrap_or_default(),
            )
        });
        return blocked(diagnostics, &cache);
    }

    state
        .mappings
        .sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
    Ok(GapMappingOutcome::Compared {
        mappings: state.mappings,
        unresolved_expected_claim_ids: state.unresolved.into_iter().collect(),
        cache: cache.to_value(),
    })
}
