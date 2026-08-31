//! wasm-компонент `n-rules:plugin@5.0.0` — `docgen/judge`, ПЕРШИЙ портований
//! LLM-етап `docgen` (крок 7 порядку реалізації спеки
//! `docs/specs/2026-08-31-plugin-contract-v5.md` §12). Карта повної
//! поверхні `docgen` (12 639 рядків JS, `npm/rules/doc-files/`) і
//! обґрунтування, чому саме `docgen-judge` — перший ported етап, живе в
//! `docs/specs/2026-08-31-recon-docgen-surface.md` (§3); список НЕпортованого
//! — там само, §5, явно, а не мовчки.
//!
//! # Що портовано 1:1
//!
//! `npm/rules/doc-files/docgen-judge/main.mjs` (135 рядків):
//!
//! - [`REFUSAL_FILLER_PATTERNS`] + [`detect_refusal_filler`] — курований
//!   детермінований пре-гейт (0 токенів) на чат-філер/refusal локальної
//!   моделі замість документації (доккомент JS-оригіналу називає два живі
//!   кейси, порт зберігає обидва regex-набори byte-exact);
//! - [`parse_doc_verdict`] — валідація JSON-відповіді судді
//!   (`{"verdict":...,"confidence":...,"reason":...}`);
//! - [`judge_fails_doc`] — поріг впевненості, за яким `inaccurate`-verdict
//!   позначає доку як degraded;
//! - [`judge_messages`] — текст промпту судді. WIT-форма `llm-call`
//!   (`n-rules:caps/llm-consumer@1.0.0`) свідомо НЕ несе окремого
//!   `system`-поля (доккомент `deps/caps/llm-consumer.wit`: «жоден наявний
//!   споживач не показав потреби» — `docgen` тепер ПОКАЗУЄ, але мінімально:
//!   один string-параметр досить), тому порт зливає `JUDGE_SYSTEM` і
//!   user-текст JS-оригіналу в ОДИН `prompt` — той самий підхід, що
//!   `RealLlmCaller::call` (`crates/rules-plugin-host/src/caps_llm_consumer.rs`):
//!   `LocalCloud::one_shot(Tier::Local, None, &prompt)` теж не передає
//!   системний текст окремо;
//! - [`judge_doc`] — сам виклик, тепер крізь host-імпорт `llm-call` замість
//!   `runOneShot` з `@7n/llm-lib`. Хост вирішує тир/модель (доккомент
//!   `caps_llm_consumer.rs`, пункт 2 «Ціна виклику») — гість передає лише
//!   готовий `prompt`.
//!
//! # Що НЕ портовано цим кроком (`docs/specs/2026-08-31-recon-docgen-surface.md`
//! §5, розгорнуто там)
//!
//! - Пара (джерело, дока) не читається диском гостя — цей крок НЕ включає
//!   `n-rules:caps/file-reader@1.0.0` (доккомент
//!   `crates/rules-contract/wit/docgen-guest.wit`). `detect()` цього гостя
//!   очікує batch, де кожен `source-file.content` — JSON `{"source":
//!   "...", "doc": "..."}` ([`parse_judge_pair`]) — явна, названа
//!   демонстраційна форма для гейт-тесту, не продакшн-контракт `docgen-scan`.
//! - `JUDGE_CONFIDENCE`/`JUDGE_MODEL`/`JUDGE_ENABLED` JS-оригіналу читають
//!   env (`N_CURSOR_DOCGEN_JUDGE_THRESHOLD`, policy resolver хмарної
//!   моделі) — у гості немає host-каналу для env/policy (janв WIT-world),
//!   тож [`JUDGE_CONFIDENCE`] тут — константа `0.7` (той самий дефолт, що
//!   JS-оригінал БЕЗ env-перевизначення), а вибір моделі — рішення хоста
//!   (`RealLlmCaller`, `Tier::Local`), не гостя (доккомент `judge_doc`).

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "docgen-guest",
    generate_all,
});

use regex::Regex;
use std::sync::OnceLock;

/// Ключ єдиної контрибуції цього гостя — точний відповідник
/// `plugin.toml::concerns[0].key`.
const CONCERN_DOCGEN_JUDGE: &str = "docgen/judge";

/// System-частина judge-промпту — byte-exact порт `JUDGE_SYSTEM`
/// (`npm/rules/doc-files/docgen-judge/main.mjs:26-31`).
const JUDGE_SYSTEM: &str = "You are a strict technical-documentation reviewer. You receive a SOURCE file and an auto-generated Markdown DOC describing it. Classify the DOC into exactly one verdict:\n- \"accurate\": specific to THIS file AND every factual claim is supported by the source.\n- \"generic\": vague/boilerplate; could describe almost any file of this kind.\n- \"inaccurate\": contains at least one claim NOT supported by, or contradicted by, the source code (e.g. wrong return behavior, false \"no network\"/\"read-only\", invented symbols/fields).\nPrefer \"inaccurate\" if any claim is wrong. Respond with ONLY a JSON object, no prose:\n{\"verdict\":\"accurate|generic|inaccurate\",\"confidence\":0.0-1.0,\"reason\":\"<10-300 chars>\"}";

/// Мін. впевненість, щоб verdict `inaccurate` позначив док як degraded —
/// той самий дефолт, що JS `JUDGE_CONFIDENCE` без env-перевизначення
/// (доккомент модуля, «Що НЕ портовано»).
const JUDGE_CONFIDENCE: f64 = 0.7;

/// Курований безпечний список refusal/filler-фраз — byte-exact порт
/// `REFUSAL_FILLER_RES` (`main.mjs:45-60`). Кожен рядок — джерело
/// `Regex::new` з прапорцями `(?i)` (case-insensitive) `u` (unicode за
/// замовчуванням у крейті `regex`, окремого прапорця не треба).
const REFUSAL_FILLER_PATTERNS: &[&str] = &[
    r"(?i)я готов(?:ий|а)",
    r"(?i)надайте(?:\s+мені)?\s+(?:код|файл|вміст|джерело)",
    r"(?i)надішліть(?:\s+мені)?\s+(?:код|файл)",
    r"(?i)будь ласка,?\s+надайте",
    r"(?i)не можу\s+(?:згенерувати|створити|написати)",
    r"(?i)чекаю на\s+(?:код|файл|вміст)",
    r"(?i)давайте почнемо",
    r"(?i)(?:мені|нам)\s+(?:потрібен|потрібно|потрібна|потрібні)\s+(?:сам(?:ий|е)?\s+)?(?:код|файл|вміст|джерел)",
    r"(?i)щоб написати\s+(?:точну|повну|якісну|детальну)\s+документацію",
    r"(?i)as an ai(?: language)? model",
    r"(?i)i(?:'m| am)\s+(?:ready to|unable to)",
    r"(?i)i need\s+(?:the\s+)?(?:source\s+)?(?:code|file)",
    r"(?i)please provide(?: the| me)?\s+(?:code|file|source)",
];

/// Скомпільовані [`REFUSAL_FILLER_PATTERNS`] — компіляція раз на виклик
/// гостя (той самий lazy-init мотив, що `resolveModel`/`RealLlmCaller`
/// (host-бік) читає env на кожен виклик, тут — компіляція один раз на
/// інстанс компонента).
fn refusal_filler_regexes() -> &'static Vec<Regex> {
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        REFUSAL_FILLER_PATTERNS
            .iter()
            .map(|pat| Regex::new(pat).expect("REFUSAL_FILLER_PATTERNS мають бути валідним regex"))
            .collect()
    })
}

/// Порт `detectRefusalFiller` (`main.mjs:67-73`): шукає у тексті доки
/// refusal/filler-фразу моделі.
///
/// # Аргументи
/// * `text` — машинні секції доки (без захищеного людського «Призначення»).
///
/// # Повертає
/// Перший збіг (для issue/діагностики) або `None` — фраз немає.
pub fn detect_refusal_filler(text: &str) -> Option<String> {
    for re in refusal_filler_regexes() {
        if let Some(m) = re.find(text) {
            return Some(m.as_str().to_string());
        }
    }
    None
}

/// Провалідований verdict судді — точний структурний відповідник обʼєкта,
/// який повертає `parseDocVerdict` (`main.mjs:81-91`).
#[derive(Debug, Clone, PartialEq)]
pub struct DocVerdict {
    pub verdict: String,
    pub confidence: f64,
    pub reason: String,
}

/// Порт `parseDocVerdict` (`main.mjs:81-91`): витягує й валідує verdict-JSON
/// із сирої текстової відповіді судді.
///
/// # Аргументи
/// * `raw_text` — сира текстова відповідь судді (`llm-response.text`).
///
/// # Повертає
/// `Ok(DocVerdict)` за валідного JSON, інакше `Err` із людинозрозумілим
/// текстом (той самий текст помилок, що JS `throw new Error(...)`).
pub fn parse_doc_verdict(raw_text: &str) -> Result<DocVerdict, String> {
    let a = raw_text.find('{').ok_or("judge: no JSON object in response")?;
    let b = raw_text
        .rfind('}')
        .ok_or("judge: no JSON object in response")?;
    if b < a {
        return Err("judge: no JSON object in response".to_string());
    }
    let slice = &raw_text[a..=b];
    let value: serde_json::Value =
        serde_json::from_str(slice).map_err(|err| format!("judge: bad JSON in response ({err})"))?;

    let verdict = value
        .get("verdict")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !matches!(verdict, "accurate" | "generic" | "inaccurate") {
        return Err(format!("judge: bad verdict \"{verdict}\""));
    }

    let confidence = value
        .get("confidence")
        .and_then(|v| v.as_f64())
        .ok_or("judge: bad confidence")?;
    if !(0.0..=1.0).contains(&confidence) {
        return Err("judge: bad confidence".to_string());
    }

    let reason = value
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let reason: String = reason.chars().take(500).collect();

    Ok(DocVerdict {
        verdict: verdict.to_string(),
        confidence,
        reason,
    })
}

/// Порт `judgeFailsDoc` (`main.mjs:133-135`): чи позначає verdict док як
/// degraded (лише `inaccurate` із достатньою впевненістю).
pub fn judge_fails_doc(verdict: Option<&DocVerdict>) -> bool {
    match verdict {
        Some(v) => v.verdict == "inaccurate" && v.confidence >= JUDGE_CONFIDENCE,
        None => false,
    }
}

/// Порт `judgeMessages` (`main.mjs:101-107`), злитий у ОДИН `prompt`
/// (доккомент модуля, «Що портовано 1:1» — форма `llm-call` не несе
/// окремого `system`-поля). `src`/`doc` обрізаються тими самими лімітами,
/// що JS-оригінал (12 000/8 000 символів) — захист від переповнення
/// контексту моделі.
pub fn judge_messages(src: &str, doc: &str) -> String {
    let src_clip: String = src.chars().take(12_000).collect();
    let doc_clip: String = doc.chars().take(8_000).collect();
    format!(
        "{JUDGE_SYSTEM}\n\nSOURCE FILE:\n```\n{src_clip}\n```\n\nGENERATED DOC:\n```md\n{doc_clip}\n```\n\nReturn the JSON verdict."
    )
}

/// Помилка [`judge_doc`] — обгортка над `LlmConsumerDomainError`
/// (host-канал) плюс власна гілка для локальної помилки парсингу verdict-у
/// (JS-оригінал це просто `throw`, тут — окремий варіант, бо
/// `LlmConsumerDomainError` не несе випадку «відповідь прийшла, але не
/// парситься»).
#[derive(Debug, Clone, PartialEq)]
pub enum JudgeError {
    /// Хост не має LLM-можливості взагалі (`LlmConsumerDomainError::NotSupported`,
    /// доккомент `caps_llm_consumer.rs`, пункт 3: «модель не налаштована»).
    NotSupported,
    /// Виклик стався, але відмовив, АБО відповідь прийшла, але не
    /// пройшла [`parse_doc_verdict`].
    Failed(String),
}

/// Порт `judgeDoc` (`main.mjs:116-126`): судить згенерований док сильною
/// моделлю проти джерела, крізь host-імпорт `llm-call`.
///
/// # Пре-гейт (0 токенів)
/// ПЕРЕД LLM-викликом гейт перевіряє [`detect_refusal_filler`] на самій
/// доці — живий кейс JS-оригіналу (доккомент модуля `main.mjs`, рядки
/// 36-44): чат-філер моделі замість документації структурно проходить
/// det-скорер, тому цей пре-гейт ловить його БЕЗ виклику судді. Порт
/// вирішує ту саму дилему прямо тут (JS-оригінал лишає виклик пре-гейту на
/// боці оркестратора `docgen-gen`, порт якого поза обсягом цього кроку,
/// §5.1 розвідки) — вирок `inaccurate`, confidence `1.0`, `reason` несе
/// саму знайдену фразу.
pub fn judge_doc(src: &str, doc: &str) -> Result<DocVerdict, JudgeError> {
    if let Some(filler) = detect_refusal_filler(doc) {
        return Ok(DocVerdict {
            verdict: "inaccurate".to_string(),
            confidence: 1.0,
            reason: format!("refusal/filler pre-gate: {filler}"),
        });
    }

    let prompt = judge_messages(src, doc);
    let response = llm_call(&LlmRequest { prompt }).map_err(|err| match err {
        LlmConsumerDomainError::NotSupported => JudgeError::NotSupported,
        LlmConsumerDomainError::Failed(msg) => JudgeError::Failed(msg),
    })?;
    parse_doc_verdict(&response.text).map_err(JudgeError::Failed)
}

/// Демонстраційна форма батч-елемента, доки `file-reader` не портований на
/// `docgen-scan` (доккомент модуля, «Що НЕ портовано» + `plugin.toml`).
/// `SourceFile::content` — JSON `{"source": "...", "doc": "..."}`.
fn parse_judge_pair(content: &str) -> Result<(String, String), String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|err| format!("docgen/judge: батч-елемент не JSON ({err})"))?;
    let source = value
        .get("source")
        .and_then(|v| v.as_str())
        .ok_or("docgen/judge: батч-елемент без поля \"source\"")?
        .to_string();
    let doc = value
        .get("doc")
        .and_then(|v| v.as_str())
        .ok_or("docgen/judge: батч-елемент без поля \"doc\"")?
        .to_string();
    Ok((source, doc))
}

/// Будує читабельний текст діагностики з результату [`judge_doc`] — той
/// самий мотив, що `caps_llm_consumer_gate.rs::GUEST_LIB_RS` (маркерний
/// префікс `llm-ok`/`llm-err`), тут — людинозрозумілий текст замість
/// тестового маркера, бо цей гість не тестова фікстура.
fn judge_diagnostic_message(result: &Result<DocVerdict, JudgeError>) -> Option<String> {
    match result {
        Ok(verdict) if judge_fails_doc(Some(verdict)) => Some(format!(
            "дока семантично неточна (verdict=inaccurate, confidence={:.2}): {}",
            verdict.confidence, verdict.reason
        )),
        Ok(_) => None,
        Err(JudgeError::NotSupported) => {
            Some("суддя недоступний: хост не налаштував LLM-модель".to_string())
        }
        Err(JudgeError::Failed(msg)) => Some(format!("виклик судді провалився: {msg}")),
    }
}

fn build_manifest() -> Manifest {
    Manifest {
        id: "docgen/judge".to_string(),
        version: "0.1.0".to_string(),
        world_version: "5.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![ConcernContribution {
            key: CONCERN_DOCGEN_JUDGE.to_string(),
            scope: ConcernScope::PerFile,
            glob: vec![],
            fix_glob: vec![],
        }],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
        fix_only_concerns: vec![],
        worlds: vec!["n-rules:caps/llm-consumer@1.0.0".to_string()],
    }
}

struct DocgenJudge;

impl Guest for DocgenJudge {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-docgen: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        if batch.concern_id != CONCERN_DOCGEN_JUDGE {
            return Vec::new();
        }
        let total = batch.files.len() as u32;
        let mut diagnostics = Vec::new();
        for (index, file) in batch.files.iter().enumerate() {
            report_progress(index as u32 + 1, total);
            let (source, doc) = match parse_judge_pair(&file.content) {
                Ok(pair) => pair,
                Err(msg) => {
                    log(LogLevel::Error, &format!("plugin-docgen: {msg}"));
                    continue;
                }
            };
            let result = judge_doc(&source, &doc);
            if let Some(message) = judge_diagnostic_message(&result) {
                diagnostics.push(Diagnostic {
                    reason: "docgen-judge-verdict".to_string(),
                    message,
                    file: Some(file.path.clone()),
                    severity: Severity::Warn,
                    data: None,
                });
            }
        }
        log(
            LogLevel::Info,
            &format!("plugin-docgen: detect(docgen/judge) опрацював {total} файл(ів)"),
        );
        diagnostics
    }

    fn fix(_request: FixRequest) -> FixPlan {
        // `docgen/judge` — лише детект (verdict-гейт); фікс не заявлений
        // (`fix_glob` порожній у `build_manifest`, byte-exact дзеркало
        // `plugin.toml`).
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(DocgenJudge);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_refusal_filler_finds_known_ukrainian_filler() {
        let text = "Я готовий писати поведінкову документацію. Надайте мені код.";
        assert!(detect_refusal_filler(text).is_some());
    }

    #[test]
    fn detect_refusal_filler_none_on_clean_doc() {
        let text = "Ця функція читає файл і повертає його CRC32.";
        assert_eq!(detect_refusal_filler(text), None);
    }

    #[test]
    fn parse_doc_verdict_accepts_valid_json() {
        let raw = r#"noise before {"verdict":"inaccurate","confidence":0.9,"reason":"wrong return type"} noise after"#;
        let verdict = parse_doc_verdict(raw).expect("valid JSON must parse");
        assert_eq!(verdict.verdict, "inaccurate");
        assert!((verdict.confidence - 0.9).abs() < f64::EPSILON);
        assert_eq!(verdict.reason, "wrong return type");
    }

    #[test]
    fn parse_doc_verdict_rejects_bad_verdict_tag() {
        let raw = r#"{"verdict":"maybe","confidence":0.5,"reason":"x"}"#;
        assert!(parse_doc_verdict(raw).is_err());
    }

    #[test]
    fn parse_doc_verdict_rejects_out_of_range_confidence() {
        let raw = r#"{"verdict":"accurate","confidence":1.5,"reason":"x"}"#;
        assert!(parse_doc_verdict(raw).is_err());
    }

    #[test]
    fn parse_doc_verdict_rejects_missing_json_object() {
        assert!(parse_doc_verdict("no json here").is_err());
    }

    #[test]
    fn judge_fails_doc_true_only_for_inaccurate_above_threshold() {
        let inaccurate_high = DocVerdict {
            verdict: "inaccurate".to_string(),
            confidence: 0.9,
            reason: String::new(),
        };
        let inaccurate_low = DocVerdict {
            verdict: "inaccurate".to_string(),
            confidence: 0.5,
            reason: String::new(),
        };
        let generic = DocVerdict {
            verdict: "generic".to_string(),
            confidence: 0.95,
            reason: String::new(),
        };
        assert!(judge_fails_doc(Some(&inaccurate_high)));
        assert!(!judge_fails_doc(Some(&inaccurate_low)));
        assert!(!judge_fails_doc(Some(&generic)));
        assert!(!judge_fails_doc(None));
    }

    #[test]
    fn judge_messages_contains_clipped_source_and_doc() {
        let msg = judge_messages("fn main() {}", "# Doc\nBehavior.");
        assert!(msg.contains("fn main() {}"));
        assert!(msg.contains("# Doc"));
        assert!(msg.contains("Return the JSON verdict."));
    }

    #[test]
    fn parse_judge_pair_roundtrips_json() {
        let content = r#"{"source":"fn main(){}","doc":"Doc body"}"#;
        let (source, doc) = parse_judge_pair(content).expect("valid pair JSON must parse");
        assert_eq!(source, "fn main(){}");
        assert_eq!(doc, "Doc body");
    }

    #[test]
    fn parse_judge_pair_rejects_missing_field() {
        assert!(parse_judge_pair(r#"{"source":"x"}"#).is_err());
    }

    /// Anti-drift: `plugin.toml` — довідник для людини й дистрибуційний
    /// supplement, `build_manifest()` — джерело правди в рантаймі (спека
    /// §3.1). Без цього тесту вони могли б розійтись мовчки — той самий
    /// мотив і та сама форма, що
    /// `crates/plugin-lang-rust/src/lib.rs::plugin_toml_concern_keys_match_describe`.
    #[test]
    fn plugin_toml_matches_describe() {
        let manifest: toml::Table = include_str!("../plugin.toml")
            .parse()
            .expect("plugin.toml має бути валідним TOML");
        let runtime = build_manifest();

        assert_eq!(
            manifest.get("id").and_then(|v| v.as_str()),
            Some(runtime.id.as_str()),
            "plugin.toml розійшовся з describe() по id"
        );
        assert_eq!(
            manifest.get("world_version").and_then(|v| v.as_str()),
            Some(runtime.world_version.as_str()),
            "plugin.toml розійшовся з describe() по world_version"
        );

        let declared: Vec<&str> = manifest
            .get("concerns")
            .and_then(|v| v.as_array())
            .expect("`concerns` — array of tables у корені маніфеста")
            .iter()
            .map(|c| c["key"].as_str().expect("`key` — рядок"))
            .collect();
        let runtime_keys: Vec<&str> = runtime.concerns.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(
            declared, runtime_keys,
            "plugin.toml розійшовся з describe() по concerns"
        );

        let declared_worlds: Vec<&str> = manifest
            .get("worlds")
            .and_then(|v| v.as_array())
            .expect("`worlds` мусить бути top-level масивом маніфеста")
            .iter()
            .map(|w| w.as_str().expect("елемент `worlds` — рядок"))
            .collect();
        assert_eq!(
            declared_worlds,
            runtime.worlds.iter().map(String::as_str).collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() по worlds"
        );
    }
}
