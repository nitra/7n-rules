//! Верифікатор evidence-entailment — порт `entailment.mjs`.
//!
//! Гейт нічого не синтезує й не переписує: він або пропускає канонічний граф
//! далі, або повертає блокувальні діагностики. Кожен claim шару
//! `implemented`/`expected` мусить випливати з ТОЧНОГО локального тексту
//! свого evidence; усе, що модель не підтвердила однозначно, лишається
//! блокером, а не «майже пройшло».

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use llm_lib::tiers::Tier;
use serde_json::{json, Value};

use crate::deterministic::{
    canonical_hash, canonical_json, js_locale_cmp, load_versioned_cache, save_versioned_cache,
    VersionedCache,
};
use crate::wave::{submit_wave, tier_name, ChainRef, SubmitBatchFn, WaveItem, WaveResult};

/// Версія strict entailment response schema і cache-записів.
pub const ENTAILMENT_SCHEMA_VERSION: &str = "package-knowledge-entailment-v1";
/// Версія prompt-контракту верифікатора.
pub const ENTAILMENT_PROMPT_VERSION: &str = "package-knowledge-entailment-v1";

const CACHE_VERSION: u64 = 1;

/// Блокувальна діагностика гейта — стабільна форма `{code, message, claimId}`.
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

    /// Ключ упорядкування діагностик — дослівно JS-івський
    /// `` `${claimId}:${code}` ``, включно з `"null"` для відсутнього id
    /// (у JS туди підставляється саме рядок `null`).
    fn sort_key(&self) -> String {
        format!(
            "{}:{}",
            self.claim_id.as_deref().unwrap_or("null"),
            self.code
        )
    }
}

/// Результат гейта: або незмінені claims, або блокери. Кеш повертається в
/// обох гілках — його наповнення корисне навіть коли прогін заблоковано.
#[derive(Debug, Clone)]
pub enum EntailmentOutcome {
    Verified {
        claims: Value,
        cache: Value,
    },
    Blocked {
        diagnostics: Vec<Diagnostic>,
        cache: Value,
    },
}

/// Вхід верифікатора.
pub struct EntailmentInput<'a> {
    /// Knowledge-граф; читаються лише `claims[]`.
    pub graph: &'a Value,
    /// Точні локальні зрізи джерела за ідентифікатором evidence.
    pub evidence_content_by_id: &'a BTreeMap<String, String>,
    /// Інʼєктований кеш (перемагає файловий) — шлях тестів.
    pub cache: Option<VersionedCache>,
    /// Довговічний кеш на диску.
    pub cache_path: Option<&'a Path>,
    /// Драбина тирів; мусить збігатися з [`crate::wave::default_model_policy`].
    pub model_policy: Vec<Tier>,
    pub prompt_version: String,
    pub schema_version: String,
    pub submit: SubmitBatchFn,
    pub chain: ChainRef,
}

/// Готова до відправлення робота по одному claim.
struct Work {
    id: String,
    prompt: String,
    cache_key: String,
}

/// Текст evidence із мапи; порожній рядок — те саме, що відсутній (JS
/// перевіряє `value !== ''`).
fn evidence_content(map: &BTreeMap<String, String>, id: &str) -> Option<String> {
    map.get(id).filter(|text| !text.is_empty()).cloned()
}

/// Перевіряє контракт claim-а і збирає його локальний evidence-текст — порт
/// `prepareClaim`. Помилка тут блокує ДО будь-якого виклику моделі.
fn prepare_claim(
    claim: &Value,
    evidence_by_id: &BTreeMap<String, String>,
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
) -> Result<Work, Diagnostic> {
    let claim_id = claim
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|id| !id.is_empty());
    let evidence_ids = claim.get("evidenceIds").and_then(Value::as_array);
    let Some(evidence_ids) = evidence_ids.filter(|ids| !ids.is_empty()) else {
        return Err(Diagnostic::new(
            "invalid-entailment-claim",
            "Claim мусить мати id та непорожній evidenceIds[].",
            claim_id,
        ));
    };
    let Some(claim_id) = claim_id else {
        return Err(Diagnostic::new(
            "invalid-entailment-claim",
            "Claim мусить мати id та непорожній evidenceIds[].",
            None,
        ));
    };

    let ids: Vec<&str> = evidence_ids.iter().filter_map(Value::as_str).collect();
    let all_non_empty = ids.len() == evidence_ids.len() && ids.iter().all(|id| !id.is_empty());
    let unique = ids.iter().collect::<HashSet<_>>().len() == ids.len();
    if !all_non_empty || !unique {
        return Err(Diagnostic::new(
            "invalid-entailment-evidence",
            "Claim має невалідний evidenceIds[].",
            Some(claim_id),
        ));
    }

    // `.toSorted()` без компаратора — це ПОБАЙТОВЕ сортування JS, а не
    // `localeCompare`. Різниця не косметична: вона входить у fingerprint.
    let mut sorted_ids: Vec<&str> = ids.clone();
    sorted_ids.sort_unstable();

    let mut evidence = Vec::with_capacity(sorted_ids.len());
    for id in &sorted_ids {
        match evidence_content(evidence_by_id, id) {
            Some(content) => evidence.push((id.to_string(), content)),
            None => {
                return Err(Diagnostic::new(
                    "missing-evidence-content",
                    &format!("Немає local source content для evidence {id}."),
                    Some(claim_id),
                ))
            }
        }
    }

    let evidence_value = Value::Array(
        evidence
            .iter()
            .map(|(id, content)| json!({"id": id, "content": content}))
            .collect(),
    );
    let evidence_fingerprint = canonical_hash(&evidence_value);

    // Payload промпта — `JSON.stringify({claim: canonicalize(claim), evidence})`
    // ДОСЛІВНО: `claim` у канонічній формі, а `evidence` — у порядку
    // вставки (`id`, потім `content`), який канонічний писемник переставив
    // би. Тому обʼєкти evidence складаються тут вручну.
    let evidence_payload = evidence
        .iter()
        .map(|(id, content)| {
            format!(
                "{{\"id\":{},\"content\":{}}}",
                Value::String(id.clone()),
                Value::String(content.clone())
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let payload = format!(
        "{{\"claim\":{},\"evidence\":[{}]}}",
        canonical_json(claim),
        evidence_payload
    );
    let prompt = [
        "Verify whether every asserted field of claim is entailed by the exact local evidence.",
        "Do not rewrite, repair, infer beyond evidence, or return a replacement claim.",
        "Return exactly one JSON object with only claimId, entails, unsupportedFields.",
        "entails must be boolean; unsupportedFields must be an empty string array only when entails is true.",
        &payload,
    ]
    .join("\n");

    let cache_key = create_entailment_cache_key(
        claim,
        &evidence_fingerprint,
        prompt_version,
        schema_version,
        model_policy,
    );
    Ok(Work {
        id: claim_id,
        prompt,
        cache_key,
    })
}

/// Cache-ключ одного claim-а — порт `createEntailmentCacheKey`: канонічний
/// claim, fingerprint ТЕКСТУ evidence і версії політики.
#[must_use]
pub fn create_entailment_cache_key(
    claim: &Value,
    evidence_fingerprint: &str,
    prompt_version: &str,
    schema_version: &str,
    model_policy: &[Tier],
) -> String {
    canonical_hash(&json!({
        "claim": claim,
        "evidenceFingerprint": evidence_fingerprint,
        "promptVersion": prompt_version,
        "schemaVersion": schema_version,
        "modelPolicy": model_policy.iter().map(|tier| tier_name(*tier)).collect::<Vec<_>>(),
    }))
}

/// Парсить строгу відповідь верифікатора — порт `parseEntailmentResult`.
///
/// Жодного поблажливого coercion: зайвий ключ, чужий `claimId`, дублікат у
/// `unsupportedFields` — усе це відхилення форми, а не «майже те саме».
/// Прийнятною є РІВНО одна відповідь: `entails: true` з порожнім
/// `unsupportedFields`.
///
/// # Errors
/// Причина відмови машинним кодом — вона ж потрапляє в діагностику.
pub fn parse_entailment_result(text: Option<&Value>, claim_id: &str) -> Result<(), String> {
    let Some(Value::String(text)) = text else {
        return Err("invalid-entailment-json".to_string());
    };
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return Err("invalid-entailment-json".to_string());
    };
    let Some(object) = parsed.as_object() else {
        return Err("invalid-entailment-shape".to_string());
    };
    // Ключі звіряються ВІДСОРТОВАНИМИ (`Object.keys(...).toSorted()` у JS) —
    // порядок у відповіді моделі довільний і формою не є.
    //
    // Сортувати обовʼязково й на боці Rust, і не «про всяк випадок»: у цьому
    // графі `serde_json` зібраний із `preserve_order` (приходить транзитивно
    // schemars → agent-client-protocol → `n7n-llm-lib` фіча `agents`), тож
    // `Map` віддає ключі в порядку ДОКУМЕНТА. Фіча вмикається уніфікацією,
    // тобто може зникнути від зміни в чужому Cargo.toml — код не покладається
    // ні на цей порядок, ні на протилежний.
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != ["claimId", "entails", "unsupportedFields"] {
        return Err("invalid-entailment-shape".to_string());
    }
    let matching_id = object.get("claimId").and_then(Value::as_str) == Some(claim_id);
    let Some(entails) = object.get("entails").and_then(Value::as_bool) else {
        return Err("invalid-entailment-shape".to_string());
    };
    let Some(fields) = object.get("unsupportedFields").and_then(Value::as_array) else {
        return Err("invalid-entailment-shape".to_string());
    };
    let strings: Vec<&str> = fields.iter().filter_map(Value::as_str).collect();
    let all_valid = strings.len() == fields.len() && strings.iter().all(|field| !field.is_empty());
    if !matching_id || !all_valid {
        return Err("invalid-entailment-shape".to_string());
    }
    if strings.iter().collect::<HashSet<_>>().len() != strings.len() {
        return Err("invalid-entailment-shape".to_string());
    }
    if !entails || !fields.is_empty() {
        return Err("claim-not-entailed".to_string());
    }
    Ok(())
}

/// Лишає тільки промахи верифікатора — порт `selectPendingWork`.
fn select_pending<'a>(work: &'a [Work], cache: &VersionedCache) -> Vec<&'a Work> {
    work.iter()
        .filter(|item| {
            parse_entailment_result(cache.entries.get(&item.cache_key), &item.id).is_err()
        })
        .collect()
}

/// Верифікує claims графа проти точного локального evidence — порт
/// `verifyEvidenceEntailment`.
///
/// Точка інтеграції runner-а: після claims плюс Expected overlay і ДО
/// gap/render; продовжувати лише на [`EntailmentOutcome::Verified`].
///
/// # Errors
/// Помилка вводу-виводу кешу — fail-closed (див. [`load_versioned_cache`]).
pub async fn verify_evidence_entailment(
    input: EntailmentInput<'_>,
) -> Result<EntailmentOutcome, String> {
    let mut cache = load_versioned_cache(input.cache_path, input.cache, CACHE_VERSION)?;
    let blocked = |diagnostics: Vec<Diagnostic>, cache: &VersionedCache| {
        Ok(EntailmentOutcome::Blocked {
            diagnostics,
            cache: cache.to_value(),
        })
    };

    let Some(claims) = input.graph.get("claims").and_then(Value::as_array) else {
        return blocked(
            vec![Diagnostic::new(
                "invalid-entailment-graph",
                "Graph мусить містити claims[].",
                None,
            )],
            &cache,
        );
    };
    let verifiable: Vec<&Value> = claims
        .iter()
        .filter(|claim| {
            matches!(
                claim.get("layer").and_then(Value::as_str),
                Some("implemented") | Some("expected")
            )
        })
        .collect();
    if verifiable.is_empty() {
        return Ok(EntailmentOutcome::Verified {
            claims: Value::Array(claims.clone()),
            cache: cache.to_value(),
        });
    }

    // Порядок перевірок дослівний: спершу самі claims, і лише потім політика
    // й версії. Інакше зламаний claim ховався б за діагностикою політики.
    let mut work = Vec::with_capacity(verifiable.len());
    let mut invalid = Vec::new();
    for claim in verifiable {
        match prepare_claim(
            claim,
            input.evidence_content_by_id,
            &input.prompt_version,
            &input.schema_version,
            &input.model_policy,
        ) {
            Ok(prepared) => work.push(prepared),
            Err(diagnostic) => invalid.push(diagnostic),
        }
    }
    if !invalid.is_empty() {
        invalid.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
        return blocked(invalid, &cache);
    }
    if input.model_policy != crate::wave::default_model_policy() {
        return blocked(
            vec![Diagnostic::new(
                "invalid-entailment-model-policy",
                "Entailment використовує universal policy min -> avg -> max.",
                None,
            )],
            &cache,
        );
    }
    if input.prompt_version.is_empty() || input.schema_version.is_empty() {
        return blocked(
            vec![Diagnostic::new(
                "invalid-entailment-version",
                "promptVersion і schemaVersion мають бути непорожніми.",
                None,
            )],
            &cache,
        );
    }

    let mut failures: HashMap<String, String> = HashMap::new();
    let mut pending: Vec<&Work> = select_pending(&work, &cache);
    for tier in &input.model_policy {
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
        let responses = submit_wave(items, *tier, &input.submit, &input.chain).await;
        let mut retry = Vec::new();
        for item in pending {
            let response: Option<&WaveResult> = responses.get(&item.id);
            let text = response.and_then(|result| result.outcome.as_ref().ok());
            let text_value = text.map(|text| Value::String(text.clone()));
            match parse_entailment_result(text_value.as_ref(), &item.id) {
                Ok(()) => {
                    cache
                        .entries
                        .insert(item.cache_key.clone(), text_value.unwrap_or(Value::Null));
                    failures.remove(&item.id);
                }
                Err(reason) => {
                    // Помилка ВИКЛИКУ і сміттєва відповідь — різні коди:
                    // перше лікується повтором, друге — ні.
                    let code = match response {
                        Some(result) if result.outcome.is_err() => "entailment-batch-error",
                        _ => reason.as_str(),
                    };
                    failures.insert(item.id.clone(), code.to_string());
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
                Diagnostic::new(
                    failures
                        .get(&item.id)
                        .map_or("unresolved-entailment", String::as_str),
                    "Claim не пройшов strict evidence entailment verifier.",
                    Some(item.id.clone()),
                )
            })
            .collect();
        diagnostics.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
        return blocked(diagnostics, &cache);
    }
    Ok(EntailmentOutcome::Verified {
        claims: Value::Array(claims.clone()),
        cache: cache.to_value(),
    })
}
