//! Побудова evidence-backed implemented claims — порт `claims.mjs`.
//!
//! LLM тут добирає лише СТРУКТУРОВАНІ твердження для вже відомих
//! детермінованих посилань. Канонічні `claim:`-ідентифікатори, cache-ключі,
//! покриття і фінальний порядок належать цьому модулю — саме тому неповний
//! чи невалідний результат моделі ніколи не стає candidate-графом.
//!
//! Виконання — map/reduce: map-chunk-и йдуть хвилями залежностей (пізніший
//! chunk фізично не потрапляє в batch, поки всі його залежності не дали
//! успішний результат), далі — ієрархічний reduce із обмеженим fan-in, поки
//! не лишиться один вузол.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use llm_lib::tiers::Tier;
use serde_json::{json, Map, Value};

use crate::deterministic::{
    canonical_hash, canonical_json, js_locale_cmp, load_versioned_cache, save_versioned_cache,
    VersionedCache,
};
use crate::wave::{submit_wave, tier_name, ChainRef, SubmitBatchFn, WaveItem, WaveResult};

/// Версія schema structured claims (кеш і валідація).
pub const CLAIM_SCHEMA_VERSION: &str = "package-knowledge-claims-v2";
/// Версія prompt-контракту map/reduce-конвеєра.
pub const CLAIM_PROMPT_VERSION: &str = "package-knowledge-claims-v2";

/// Стабільна таксономія поведінкових предикатів — ЄДИНЕ, що модель має право
/// покласти в `predicate`.
///
/// Довільні предикати блокуються навмисно: claim із вигаданим відношенням
/// неможливо ні порівняти з expected-шаром, ні перевірити entailment-ом —
/// він виглядав би як знання, не будучи ним.
pub const BEHAVIORAL_CLAIM_TAXONOMY: [&str; 14] = [
    "purpose",
    "actor",
    "trigger",
    "precondition",
    "step",
    "business-rule",
    "state-change",
    "integration",
    "outcome",
    "alternative-flow",
    "error-flow",
    "responsibility",
    "config",
    "persistence",
];

const CACHE_VERSION: u64 = 1;

/// Блокер конвеєра — стабільна форма `{code, chunkId, detail}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blocker {
    pub code: String,
    pub chunk_id: String,
    pub detail: String,
}

impl Blocker {
    fn new(code: &str, chunk_id: &str, detail: &str) -> Self {
        Self {
            code: code.to_string(),
            chunk_id: chunk_id.to_string(),
            detail: detail.to_string(),
        }
    }
}

/// Покриття фінального результату.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coverage {
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
}

/// Результат конвеєра.
#[derive(Debug, Clone)]
pub enum ClaimsOutcome {
    Built {
        claims: Vec<Value>,
        coverage: Coverage,
        cache: Value,
    },
    Blocked {
        blockers: Vec<Blocker>,
        cache: Value,
    },
}

/// Вхід конвеєра.
pub struct ClaimsInput<'a> {
    /// Нормалізований граф пакета; читаються `domain.id`, `nodes`, `edges`,
    /// `evidence`.
    pub graph: &'a Value,
    /// Map-chunk-и (з планера); їхня форма валідується тут, не приймається
    /// на віру.
    pub chunks: &'a [Value],
    /// Версія парсера — частина cache-ключа, обовʼязкова й непорожня.
    pub parser_version: String,
    pub prompt_version: String,
    pub schema_version: String,
    /// Драбина тирів; будь-яка непорожня підмножина універсальної драбини.
    pub model_policy: Vec<Tier>,
    /// Fan-in reduce-дерева, не менше 2.
    pub reduce_fan_in: usize,
    pub cache: Option<VersionedCache>,
    pub cache_path: Option<&'a Path>,
    pub submit: SubmitBatchFn,
    pub chain: ChainRef,
}

/// Нормалізований map-chunk.
#[derive(Debug, Clone)]
struct Chunk {
    id: String,
    prompt: String,
    required_node_ids: Vec<String>,
    required_edge_ids: Vec<String>,
    allowed_evidence_ids: Vec<String>,
    depends_on_chunk_ids: Vec<String>,
    wave: u64,
    content_hash: String,
}

/// Одиниця роботи (map або reduce) — те, що реально їде в batch.
#[derive(Debug, Clone)]
struct Work {
    id: String,
    prompt: String,
    required_node_ids: Vec<String>,
    required_edge_ids: Vec<String>,
    allowed_evidence_ids: Vec<String>,
    cache_key: String,
}

/// Прийнятий результат однієї одиниці роботи.
#[derive(Debug, Clone)]
struct WorkResult {
    claims: Vec<Value>,
    covered_node_ids: Vec<String>,
    covered_edge_ids: Vec<String>,
}

/// Детерміновані посилання графа, доступні структурованому виходу.
struct Refs {
    domain_id: String,
    node_ids: HashSet<String>,
    edge_ids: HashSet<String>,
    evidence_ids: HashSet<String>,
}

/// Перевіряє список рядкових ID і повертає відсортовану унікальну копію —
/// порт `normalizedIds`.
///
/// `None` означає «форма зламана» (не масив, порожній чи не-рядковий
/// елемент, дублікат), і це блокер, а не привід почистити вхід.
fn normalized_ids(value: Option<&Value>) -> Option<Vec<String>> {
    let items = value?.as_array()?;
    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        let id = item.as_str()?;
        if id.is_empty() {
            return None;
        }
        ids.push(id.to_string());
    }
    if ids.iter().collect::<HashSet<_>>().len() != ids.len() {
        return None;
    }
    // `.toSorted()` без компаратора — побайтово.
    ids.sort_unstable();
    Some(ids)
}

/// Канонічний ідентифікатор claim-а — порт `createImplementedClaimId`.
///
/// Модель НІКОЛИ не передає цей ID у контракті: він обчислюється з полів, і
/// саме тому два однакові твердження з різних chunk-ів злипаються в одне.
#[must_use]
pub fn create_implemented_claim_id(
    domain_id: &str,
    subject_id: &str,
    predicate: &str,
    value: &Value,
    evidence_ids: &[String],
) -> String {
    let mut sorted = evidence_ids.to_vec();
    sorted.sort_unstable();
    format!(
        "claim:{}",
        canonical_hash(&json!({
            "domainId": domain_id,
            "subjectId": subject_id,
            "predicate": predicate,
            "value": value,
            "evidenceIds": sorted,
        }))
    )
}

/// Cache-ключ одиниці роботи — порт `createClaimsCacheKey`.
#[must_use]
pub fn create_claims_cache_key(
    kind: &str,
    parser_version: &str,
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
    content_hash: &str,
) -> String {
    canonical_hash(&json!({
        "kind": kind,
        "parserVersion": parser_version,
        "promptVersion": prompt_version,
        "schemaVersion": schema_version,
        "modelPolicy": model_policy.iter().map(|tier| tier_name(*tier)).collect::<Vec<_>>(),
        "contentHash": content_hash,
    }))
}

/// Нормалізує map-chunk — порт `normalizeMapChunk`.
fn normalize_map_chunk(raw: &Value, index: usize) -> Result<Chunk, Blocker> {
    let chunk_id = raw
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map_or_else(|| format!("map:{index}"), str::to_string);
    if !raw.is_object() {
        return Err(Blocker::new(
            "invalid-chunk",
            &chunk_id,
            "Chunk мусить бути object.",
        ));
    }
    let empty = Value::Array(Vec::new());
    let required_node_ids = normalized_ids(raw.get("requiredNodeIds"));
    let required_edge_ids = normalized_ids(Some(raw.get("requiredEdgeIds").unwrap_or(&empty)));
    let allowed_evidence_ids = normalized_ids(raw.get("allowedEvidenceIds"));
    let depends_on_chunk_ids = normalized_ids(Some(raw.get("dependsOnChunkIds").unwrap_or(&empty)));
    let wave = raw.get("wave").and_then(Value::as_u64);
    let prompt = raw
        .get("prompt")
        .and_then(Value::as_str)
        .filter(|prompt| !prompt.is_empty());

    let invalid = Blocker::new(
        "invalid-chunk",
        &chunk_id,
        "Chunk потребує id, prompt, wave, requiredNodeIds[], allowedEvidenceIds[] і dependsOnChunkIds[].",
    );
    let (
        Some(required_node_ids),
        Some(required_edge_ids),
        Some(allowed_evidence_ids),
        Some(depends_on_chunk_ids),
        Some(wave),
        Some(prompt),
    ) = (
        required_node_ids,
        required_edge_ids,
        allowed_evidence_ids,
        depends_on_chunk_ids,
        wave,
        prompt,
    )
    else {
        return Err(invalid);
    };
    if allowed_evidence_ids.is_empty() {
        return Err(invalid);
    }
    Ok(Chunk {
        id: chunk_id,
        prompt: prompt.to_string(),
        required_node_ids,
        required_edge_ids,
        allowed_evidence_ids,
        depends_on_chunk_ids,
        wave,
        content_hash: raw
            .get("contentHash")
            .and_then(Value::as_str)
            .filter(|hash| !hash.is_empty())
            .map_or_else(|| canonical_hash(raw), str::to_string),
    })
}

/// Валідує граф залежностей map-chunk-ів ДО будь-якого виклику моделі — порт
/// `validateMapPlan`: кожна залежність існує, лежить у ПОПЕРЕДНІЙ хвилі й не
/// утворює циклу.
fn validate_map_plan(
    chunks: &[Chunk],
    graph_evidence_ids: &HashSet<String>,
) -> Result<BTreeMap<u64, Vec<Chunk>>, Vec<Blocker>> {
    let mut by_id: HashMap<&str, &Chunk> = HashMap::new();
    let mut blockers = Vec::new();
    for chunk in chunks {
        if by_id.contains_key(chunk.id.as_str()) {
            blockers.push(Blocker::new(
                "duplicate-chunk-id",
                &chunk.id,
                "Chunk ID має бути унікальним.",
            ));
        }
        by_id.insert(&chunk.id, chunk);
        if chunk
            .allowed_evidence_ids
            .iter()
            .any(|id| !graph_evidence_ids.contains(id))
        {
            blockers.push(Blocker::new(
                "unknown-chunk-evidence",
                &chunk.id,
                "Chunk посилається на evidence поза graph.",
            ));
        }
    }
    for chunk in chunks {
        for dependency_id in &chunk.depends_on_chunk_ids {
            match by_id.get(dependency_id.as_str()) {
                None => blockers.push(Blocker::new(
                    "unknown-chunk-dependency",
                    &chunk.id,
                    &format!("Не знайдено dependency {dependency_id}."),
                )),
                Some(dependency) if dependency.wave >= chunk.wave => blockers.push(Blocker::new(
                    "invalid-chunk-dependency-wave",
                    &chunk.id,
                    &format!("Dependency {dependency_id} мусить бути у попередній wave."),
                )),
                Some(_) => {}
            }
        }
    }

    // Пошук циклу — той самий обхід, що в JS (`visiting`/`visited`), лише
    // ітеративний: рекурсія по чужому графу — це стек, розмір якого задає
    // вхідні дані.
    let mut visiting: HashSet<&str> = HashSet::new();
    let mut visited: HashSet<&str> = HashSet::new();
    for chunk in chunks {
        let mut stack: Vec<(&str, bool)> = vec![(chunk.id.as_str(), false)];
        while let Some((id, leaving)) = stack.pop() {
            if leaving {
                visiting.remove(id);
                visited.insert(id);
                continue;
            }
            if visiting.contains(id) {
                blockers.push(Blocker::new(
                    "cyclic-chunk-dependency",
                    id,
                    "Chunk dependency graph містить цикл.",
                ));
                continue;
            }
            if visited.contains(id) {
                continue;
            }
            visiting.insert(id);
            stack.push((id, true));
            if let Some(current) = by_id.get(id) {
                for dependency_id in current.depends_on_chunk_ids.iter().rev() {
                    if by_id.contains_key(dependency_id.as_str()) {
                        stack.push((dependency_id.as_str(), false));
                    }
                }
            }
        }
    }

    if !blockers.is_empty() {
        blockers.sort_by(|left, right| {
            js_locale_cmp(
                &format!("{}:{}", left.code, left.chunk_id),
                &format!("{}:{}", right.code, right.chunk_id),
            )
        });
        return Err(blockers);
    }

    let mut by_wave: BTreeMap<u64, Vec<Chunk>> = BTreeMap::new();
    for chunk in chunks {
        by_wave.entry(chunk.wave).or_default().push(chunk.clone());
    }
    for wave in by_wave.values_mut() {
        wave.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));
    }
    Ok(by_wave)
}

/// Посилання графа — порт `graphReferences`.
fn graph_references(graph: &Value) -> Result<Refs, Vec<Blocker>> {
    let domain_id = graph
        .get("domain")
        .and_then(|domain| domain.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let Some(domain_id) = domain_id else {
        return Err(vec![Blocker::new(
            "invalid-graph",
            "graph",
            "Graph мусить мати domain.id.",
        )]);
    };
    let mut collected = Vec::new();
    for collection in ["nodes", "edges", "evidence"] {
        let items = graph.get(collection).and_then(Value::as_array);
        let Some(items) = items else {
            return Err(vec![Blocker::new(
                "invalid-graph",
                "graph",
                &format!("Graph має містити {collection} з IDs."),
            )]);
        };
        let mut ids = HashSet::new();
        for item in items {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty());
            let Some(id) = id else {
                return Err(vec![Blocker::new(
                    "invalid-graph",
                    "graph",
                    &format!("Graph має містити {collection} з IDs."),
                )]);
            };
            ids.insert(id.to_string());
        }
        collected.push(ids);
    }
    let mut collected = collected.into_iter();
    Ok(Refs {
        domain_id: domain_id.to_string(),
        node_ids: collected.next().unwrap_or_default(),
        edge_ids: collected.next().unwrap_or_default(),
        evidence_ids: collected.next().unwrap_or_default(),
    })
}

/// Будує строгий конверт промпта — порт `buildPrompt`. Модель бачить лише
/// відомі ID і вміст свого chunk-а.
fn build_prompt(
    kind: &str,
    work: &Work,
    allowed_evidence_ids: &[String],
    analysis: &str,
) -> String {
    let contract = json!({
        "claims": [{
            "subjectId": "<known node ID>",
            "predicate": "<non-empty relation>",
            "value": "<JSON value>",
            "evidenceIds": ["<known evidence ID>"],
            "confidence": 1
        }],
        "coveredNodeIds": ["<all required node IDs covered by this result>"],
        "coveredEdgeIds": ["<all required edge IDs covered by this result>"]
    });
    let mut sorted_evidence = allowed_evidence_ids.to_vec();
    sorted_evidence.sort_unstable();
    [
        "Return exactly one JSON object, without Markdown or prose.".to_string(),
        "Do not return claim IDs, topic IDs, node IDs, edge IDs, or evidence IDs that are not supplied.".to_string(),
        "Every claim needs at least one supplied evidence ID. Do not infer missing behavior.".to_string(),
        format!(
            "Use only the evidence-supported subset of this stable behavioral taxonomy: {}.",
            BEHAVIORAL_CLAIM_TAXONOMY.join(", ")
        ),
        "Each required node must have at least one claim; do not return a coverage-only or non-behavioral bypass marker.".to_string(),
        "Private source symbols may support a claim, but describe their role and effect; never copy a private symbol name into a human-facing claim value.".to_string(),
        format!("Stage: {kind}."),
        format!("Required node IDs: {}.", json_array(&work.required_node_ids)),
        format!("Required edge IDs: {}.", json_array(&work.required_edge_ids)),
        format!("Allowed evidence IDs: {}.", json_array(&sorted_evidence)),
        format!("JSON schema example (keys and types are exact): {}.", canonical_json(&contract)),
        format!("Analysis input: {analysis}"),
    ]
    .join("\n")
}

/// `JSON.stringify(string[])` — окремо, щоб порядок ключів канонічного
/// писемника не плутався з порядком елементів масиву (він змістовний).
fn json_array(ids: &[String]) -> String {
    canonical_json(&Value::Array(
        ids.iter().map(|id| Value::String(id.clone())).collect(),
    ))
}

/// Точна відповідність набору ключів — порт `hasExactKeys` (порівняння
/// множинне, порядок ключів у відповіді значення не має).
fn has_exact_keys(value: &Map<String, Value>, expected: &[&str]) -> bool {
    let mut keys: Vec<&str> = value.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut expected = expected.to_vec();
    expected.sort_unstable();
    keys == expected
}

/// Парсить і валідує одну строгу відповідь моделі проти детермінованих
/// посилань — порт `parseClaimsResult`.
///
/// Кожна перевірка тут fail-closed: невідомий ID, предикат поза таксономією,
/// неповне покриття або вузол без жодного claim-а — усе це відмова, а не
/// «частковий успіх». Інакше в граф потрапило б знання, якого ніхто не
/// стверджував.
///
/// Причина відмови — машинний код, який стає кодом блокера.
fn parse_claims_result(text: &str, refs: &Refs, work: &Work) -> Result<WorkResult, String> {
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return Err("invalid-json".to_string());
    };
    let Some(object) = parsed.as_object() else {
        return Err("invalid-json-shape".to_string());
    };
    if !has_exact_keys(object, &["claims", "coveredNodeIds", "coveredEdgeIds"]) {
        return Err("invalid-json-shape".to_string());
    }
    let covered_node_ids = normalized_ids(object.get("coveredNodeIds"));
    let covered_edge_ids = normalized_ids(object.get("coveredEdgeIds"));
    let (Some(covered_node_ids), Some(covered_edge_ids)) = (covered_node_ids, covered_edge_ids)
    else {
        return Err("invalid-coverage-refs".to_string());
    };
    if covered_node_ids
        .iter()
        .any(|id| !refs.node_ids.contains(id))
        || covered_edge_ids
            .iter()
            .any(|id| !refs.edge_ids.contains(id))
        || work
            .required_node_ids
            .iter()
            .any(|id| !covered_node_ids.contains(id))
        || work
            .required_edge_ids
            .iter()
            .any(|id| !covered_edge_ids.contains(id))
    {
        return Err("coverage-incomplete".to_string());
    }
    let Some(raw_claims) = object.get("claims").and_then(Value::as_array) else {
        return Err("invalid-claims".to_string());
    };

    let mut claims = Vec::with_capacity(raw_claims.len());
    for raw_claim in raw_claims {
        let Some(claim) = raw_claim.as_object() else {
            return Err("invalid-claim".to_string());
        };
        if !has_exact_keys(
            claim,
            &[
                "subjectId",
                "predicate",
                "value",
                "evidenceIds",
                "confidence",
            ],
        ) {
            return Err("invalid-claim-shape".to_string());
        }
        let evidence_ids = normalized_ids(claim.get("evidenceIds"));
        let subject_id = claim.get("subjectId").and_then(Value::as_str);
        let predicate = claim.get("predicate").and_then(Value::as_str);
        let confidence = claim.get("confidence").and_then(Value::as_f64);
        let known_subject = subject_id.is_some_and(|id| {
            refs.node_ids.contains(id) && work.required_node_ids.iter().any(|node| node == id)
        });
        let known_predicate =
            predicate.is_some_and(|value| BEHAVIORAL_CLAIM_TAXONOMY.contains(&value));
        let known_evidence = evidence_ids.as_ref().is_some_and(|ids| {
            !ids.is_empty()
                && ids.iter().all(|id| {
                    refs.evidence_ids.contains(id) && work.allowed_evidence_ids.contains(id)
                })
        });
        let valid_confidence = confidence.is_some_and(|value| (0.0..=1.0).contains(&value));
        if !known_subject || !known_predicate || !known_evidence || !valid_confidence {
            return Err("invalid-claim-refs".to_string());
        }
        let (subject_id, predicate, evidence_ids) = (
            subject_id.unwrap_or_default(),
            predicate.unwrap_or_default(),
            evidence_ids.unwrap_or_default(),
        );
        let value = claim.get("value").cloned().unwrap_or(Value::Null);
        claims.push(json!({
            "id": create_implemented_claim_id(&refs.domain_id, subject_id, predicate, &value, &evidence_ids),
            "subjectId": subject_id,
            "layer": "implemented",
            "predicate": predicate,
            "value": value,
            "evidenceIds": evidence_ids,
            "confidence": confidence.unwrap_or_default(),
            "sourceFingerprint": canonical_hash(&json!({"chunkId": work.id, "claim": raw_claim})),
        }));
    }

    // Покриття може бути «повним» формально, але без жодного твердження про
    // вузол — це і є bypass, який контракт промпта забороняє прямо.
    let claimed: HashSet<&str> = claims
        .iter()
        .filter_map(|claim| claim.get("subjectId").and_then(Value::as_str))
        .collect();
    if work
        .required_node_ids
        .iter()
        .any(|id| !claimed.contains(id.as_str()))
    {
        return Err("behavioral-coverage-incomplete".to_string());
    }
    claims.sort_by(|left, right| {
        js_locale_cmp(
            left.get("id").and_then(Value::as_str).unwrap_or_default(),
            right.get("id").and_then(Value::as_str).unwrap_or_default(),
        )
    });
    Ok(WorkResult {
        claims,
        covered_node_ids,
        covered_edge_ids,
    })
}

/// Відокремлює одиниці роботи без валідного кешованого результату — порт
/// `selectCachedWork`.
fn select_cached_work<'a>(
    work: &'a [Work],
    cache: &VersionedCache,
    refs: &Refs,
) -> (HashMap<String, WorkResult>, Vec<&'a Work>) {
    let mut accepted = HashMap::new();
    let mut pending = Vec::new();
    for item in work {
        let cached = cache
            .entries
            .get(&item.cache_key)
            .and_then(Value::as_str)
            .and_then(|text| parse_claims_result(text, refs, item).ok());
        match cached {
            Some(result) => {
                accepted.insert(item.id.clone(), result);
            }
            None => pending.push(item),
        }
    }
    (accepted, pending)
}

/// Виконує одну логічну хвилю з локальною ескалацією по тирах — порт
/// `resolveWave`. Кешуються лише УСПІШНІ відповіді.
async fn resolve_wave(
    work: &[Work],
    cache: &mut VersionedCache,
    refs: &Refs,
    model_policy: &[Tier],
    submit: &SubmitBatchFn,
    chain: &ChainRef,
) -> (HashMap<String, WorkResult>, Vec<Blocker>) {
    let (mut results, mut pending) = select_cached_work(work, cache, refs);
    let mut failures: HashMap<String, String> = HashMap::new();
    for tier in model_policy {
        if pending.is_empty() {
            break;
        }
        let items = pending
            .iter()
            .map(|item| WaveItem {
                custom_id: item.id.clone(),
                prompt: item.prompt.clone(),
            })
            .collect();
        let responses = submit_wave(items, *tier, submit, chain).await;
        let mut retry = Vec::new();
        for item in pending {
            let response: Option<&WaveResult> = responses.get(&item.id);
            let text = response.and_then(|result| result.outcome.as_ref().ok());
            let Some(text) = text else {
                // «виклик не відбувся» і «відповіді на цей item немає» —
                // різні коди: перше лікується повтором, друге вказує на
                // транспорт, що загубив item.
                let code = match response {
                    Some(_) => "batch-item-error",
                    None => "missing-result",
                };
                failures.insert(item.id.clone(), code.to_string());
                retry.push(item);
                continue;
            };
            match parse_claims_result(text, refs, item) {
                Ok(result) => {
                    results.insert(item.id.clone(), result);
                    cache
                        .entries
                        .insert(item.cache_key.clone(), Value::String(text.clone()));
                    failures.remove(&item.id);
                }
                Err(reason) => {
                    failures.insert(item.id.clone(), reason);
                    retry.push(item);
                }
            }
        }
        pending = retry;
    }
    let blockers = pending
        .iter()
        .map(|item| {
            Blocker::new(
                failures
                    .get(&item.id)
                    .map_or("unresolved-chunk", String::as_str),
                &item.id,
                "LLM result не пройшов local model ladder.",
            )
        })
        .collect();
    (results, blockers)
}

/// Готує map-одиницю після завершення ВСІХ її залежностей — порт
/// `createMapWork`.
///
/// Claims залежностей стають єдиним додатковим evidence-контекстом: глобальні
/// evidence графа за межі scope цього chunk-а не відкриваються.
fn create_map_work(
    chunk: &Chunk,
    completed: &HashMap<String, WorkResult>,
    parser_version: &str,
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
) -> Work {
    let dependencies: Vec<(&String, Option<&WorkResult>)> = chunk
        .depends_on_chunk_ids
        .iter()
        .map(|id| (id, completed.get(id)))
        .collect();
    let dependency_claims: Vec<&Value> = dependencies
        .iter()
        .filter_map(|(_, result)| *result)
        .flat_map(|result| result.claims.iter())
        .collect();
    let mut allowed: BTreeSet<String> = chunk.allowed_evidence_ids.iter().cloned().collect();
    for claim in &dependency_claims {
        if let Some(ids) = claim.get("evidenceIds").and_then(Value::as_array) {
            allowed.extend(ids.iter().filter_map(Value::as_str).map(str::to_string));
        }
    }
    let allowed_evidence_ids: Vec<String> = allowed.into_iter().collect();

    let dependency_summaries = Value::Array(
        dependencies
            .iter()
            .filter_map(|(id, result)| {
                result.map(|result| {
                    json!({
                        "id": id,
                        "claims": result.claims,
                        "coveredNodeIds": result.covered_node_ids,
                        "coveredEdgeIds": result.covered_edge_ids,
                    })
                })
            })
            .collect(),
    );
    let content_hash = canonical_hash(&json!({
        "contentHash": chunk.content_hash,
        "wave": chunk.wave,
        "dependsOnChunkIds": chunk.depends_on_chunk_ids,
        "allowedEvidenceIds": allowed_evidence_ids,
        "dependencySummaries": dependency_summaries,
    }));
    let analysis = canonical_json(&json!({
        "source": chunk.prompt,
        "dependencySummaries": dependency_summaries,
    }));
    let work = Work {
        id: chunk.id.clone(),
        prompt: String::new(),
        required_node_ids: chunk.required_node_ids.clone(),
        required_edge_ids: chunk.required_edge_ids.clone(),
        allowed_evidence_ids: allowed_evidence_ids.clone(),
        cache_key: create_claims_cache_key(
            "map",
            parser_version,
            prompt_version,
            schema_version,
            model_policy,
            &content_hash,
        ),
    };
    Work {
        prompt: build_prompt("map", &work, &allowed_evidence_ids, &analysis),
        ..work
    }
}

/// Групує завершені дочірні одиниці для наступного рівня reduce — порт
/// `reduceGroups`.
fn reduce_groups(children: &[Work], fan_in: usize) -> Vec<Vec<Work>> {
    let mut sorted = children.to_vec();
    sorted.sort_by(|left, right| js_locale_cmp(&left.id, &right.id));
    sorted
        .chunks(fan_in)
        .map(<[Work]>::to_vec)
        .collect::<Vec<_>>()
}

/// Створює роботу наступного рівня reduce із ПЕРЕВІРЕНИХ дочірніх
/// результатів — порт `createReduceWork`. Джерельний текст сюди не
/// повертається: reduce працює з твердженнями, а не з кодом.
fn create_reduce_work(
    groups: &[Vec<Work>],
    results: &HashMap<String, WorkResult>,
    parser_version: &str,
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
    level: usize,
) -> Vec<Work> {
    groups
        .iter()
        .enumerate()
        .map(|(index, group)| {
            let child_results: Vec<&WorkResult> = group
                .iter()
                .filter_map(|child| results.get(&child.id))
                .collect();
            let unique = |extract: fn(&WorkResult) -> &Vec<String>| -> Vec<String> {
                let set: BTreeSet<String> = child_results
                    .iter()
                    .flat_map(|result| extract(result).iter().cloned())
                    .collect();
                set.into_iter().collect()
            };
            let required_node_ids = unique(|result| &result.covered_node_ids);
            let required_edge_ids = unique(|result| &result.covered_edge_ids);
            let claims: Vec<Value> = child_results
                .iter()
                .flat_map(|result| result.claims.iter().cloned())
                .collect();
            let allowed: BTreeSet<String> = claims
                .iter()
                .filter_map(|claim| claim.get("evidenceIds").and_then(Value::as_array))
                .flat_map(|ids| ids.iter().filter_map(Value::as_str).map(str::to_string))
                .collect();
            let allowed_evidence_ids: Vec<String> = allowed.into_iter().collect();
            let content = json!({
                "childIds": group.iter().map(|child| child.id.clone()).collect::<Vec<_>>(),
                "claims": claims,
                "requiredNodeIds": required_node_ids,
                "requiredEdgeIds": required_edge_ids,
            });
            let content_hash = canonical_hash(&content);
            let work = Work {
                id: format!("reduce:{level}:{index}"),
                prompt: String::new(),
                required_node_ids,
                required_edge_ids,
                allowed_evidence_ids: allowed_evidence_ids.clone(),
                cache_key: create_claims_cache_key(
                    "reduce",
                    parser_version,
                    prompt_version,
                    schema_version,
                    model_policy,
                    &content_hash,
                ),
            };
            Work {
                prompt: build_prompt(
                    "reduce",
                    &work,
                    &allowed_evidence_ids,
                    &canonical_json(&content),
                ),
                ..work
            }
        })
        .collect()
}

/// Дедуплікує claims за детермінованим ID — порт `collectClaims`.
fn collect_claims(results: &[WorkResult]) -> Vec<Value> {
    let mut by_id: HashMap<String, Value> = HashMap::new();
    for result in results {
        for claim in &result.claims {
            if let Some(id) = claim.get("id").and_then(Value::as_str) {
                by_id.insert(id.to_string(), claim.clone());
            }
        }
    }
    let mut claims: Vec<Value> = by_id.into_values().collect();
    claims.sort_by(|left, right| {
        js_locale_cmp(
            left.get("id").and_then(Value::as_str).unwrap_or_default(),
            right.get("id").and_then(Value::as_str).unwrap_or_default(),
        )
    });
    claims
}

/// Виконує map/reduce структурованих claims — порт `buildStructuredClaims`.
///
/// Одна хвиля = один `submitBatch` на тир, і на сильніший тир їдуть ЛИШЕ
/// невдалі items. Відсутній, невалідний чи непокритий результат — блокер;
/// ні повторного прогону всього домену, ні fallback-claim-а не буває.
///
/// # Errors
/// Помилка вводу-виводу кешу — fail-closed.
pub async fn build_structured_claims(input: ClaimsInput<'_>) -> Result<ClaimsOutcome, String> {
    let mut cache = load_versioned_cache(input.cache_path, input.cache, CACHE_VERSION)?;
    let blocked = |blockers: Vec<Blocker>, cache: &VersionedCache| {
        Ok(ClaimsOutcome::Blocked {
            blockers,
            cache: cache.to_value(),
        })
    };

    let refs = match graph_references(input.graph) {
        Ok(refs) => refs,
        Err(blockers) => return blocked(blockers, &cache),
    };
    if input.parser_version.is_empty() {
        return blocked(
            vec![Blocker::new(
                "invalid-parser-version",
                "graph",
                "parserVersion мусить бути непорожнім.",
            )],
            &cache,
        );
    }
    if input.chunks.is_empty() {
        return blocked(
            vec![Blocker::new(
                "missing-required-chunks",
                "map",
                "Потрібен непорожній chunks[].",
            )],
            &cache,
        );
    }
    let universal = crate::wave::default_model_policy();
    if input.model_policy.is_empty()
        || input
            .model_policy
            .iter()
            .any(|tier| !universal.contains(tier))
    {
        return blocked(
            vec![Blocker::new(
                "invalid-model-policy",
                "map",
                "modelPolicy має містити universal tiers min/avg/max.",
            )],
            &cache,
        );
    }
    if input.reduce_fan_in < 2 {
        return blocked(
            vec![Blocker::new(
                "invalid-reduce-fan-in",
                "reduce",
                "reduceFanIn мусить бути integer >= 2.",
            )],
            &cache,
        );
    }

    let mut normalized = Vec::with_capacity(input.chunks.len());
    let mut invalid = Vec::new();
    for (index, raw) in input.chunks.iter().enumerate() {
        match normalize_map_chunk(raw, index) {
            Ok(chunk) => normalized.push(chunk),
            Err(blocker) => invalid.push(blocker),
        }
    }
    if !invalid.is_empty() {
        invalid.sort_by(|left, right| js_locale_cmp(&left.chunk_id, &right.chunk_id));
        return blocked(invalid, &cache);
    }
    let by_wave = match validate_map_plan(&normalized, &refs.evidence_ids) {
        Ok(by_wave) => by_wave,
        Err(blockers) => return blocked(blockers, &cache),
    };

    let (parser_version, prompt_version, schema_version) = (
        input.parser_version.as_str(),
        input.prompt_version.as_str(),
        input.schema_version.as_str(),
    );
    let mut results: HashMap<String, WorkResult> = HashMap::new();
    let mut all_results: Vec<WorkResult> = Vec::new();
    let mut map_work: Vec<Work> = Vec::new();
    for (_wave, chunks) in by_wave {
        let wave_work: Vec<Work> = chunks
            .iter()
            .map(|chunk| {
                create_map_work(
                    chunk,
                    &results,
                    parser_version,
                    prompt_version,
                    schema_version,
                    &input.model_policy,
                )
            })
            .collect();
        let (wave_results, blockers) = resolve_wave(
            &wave_work,
            &mut cache,
            &refs,
            &input.model_policy,
            &input.submit,
            &input.chain,
        )
        .await;
        if !blockers.is_empty() {
            save_versioned_cache(input.cache_path, &cache)?;
            let mut blockers = blockers;
            blockers.sort_by(|left, right| js_locale_cmp(&left.chunk_id, &right.chunk_id));
            return blocked(blockers, &cache);
        }
        for item in &wave_work {
            if let Some(result) = wave_results.get(&item.id) {
                results.insert(item.id.clone(), result.clone());
                all_results.push(result.clone());
            }
        }
        map_work.extend(wave_work);
    }

    // Reduce-дерево: поки рівень має більше одного вузла, згортаємо його
    // групами по `reduce_fan_in`. Один вузол — це вже фінал, і саме його
    // покриття стає покриттям домену.
    let mut work = map_work;
    let mut level_results = results.clone();
    let mut level = 0usize;
    loop {
        if work.is_empty() {
            return blocked(
                vec![Blocker::new(
                    "missing-results",
                    "reduce",
                    "Reduce не повернув final result.",
                )],
                &cache,
            );
        }
        if work.len() == 1 {
            let final_result = level_results.get(&work[0].id).cloned();
            save_versioned_cache(input.cache_path, &cache)?;
            let Some(final_result) = final_result else {
                return blocked(
                    vec![Blocker::new(
                        "missing-results",
                        "reduce",
                        "Reduce не повернув final result.",
                    )],
                    &cache,
                );
            };
            return Ok(ClaimsOutcome::Built {
                claims: collect_claims(&all_results),
                coverage: Coverage {
                    node_ids: final_result.covered_node_ids.clone(),
                    edge_ids: final_result.covered_edge_ids.clone(),
                },
                cache: cache.to_value(),
            });
        }
        let groups = reduce_groups(&work, input.reduce_fan_in);
        work = create_reduce_work(
            &groups,
            &level_results,
            parser_version,
            prompt_version,
            schema_version,
            &input.model_policy,
            level,
        );
        level += 1;
        let (resolved, blockers) = resolve_wave(
            &work,
            &mut cache,
            &refs,
            &input.model_policy,
            &input.submit,
            &input.chain,
        )
        .await;
        if !blockers.is_empty() {
            save_versioned_cache(input.cache_path, &cache)?;
            let mut blockers = blockers;
            blockers.sort_by(|left, right| js_locale_cmp(&left.chunk_id, &right.chunk_id));
            return blocked(blockers, &cache);
        }
        for item in &work {
            if let Some(result) = resolved.get(&item.id) {
                all_results.push(result.clone());
            }
        }
        level_results = resolved;
    }
}
