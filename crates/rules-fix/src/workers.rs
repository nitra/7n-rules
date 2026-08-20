//! cspell:ignore vygadaneslovodyktantu щеодневигаданеслово
//! Fix-воркери — другий клас виконавців спроби поруч з агентною драбиною.
//!
//! Дзеркало JS-архітектури lint-surface (`fix-worker.mjs` проти
//! `agent-fix.mjs`): деякі concern-и лагодяться НЕ агентною сесією з
//! інструментами, а одним детермінованим кроком із рівно одним one-shot
//! LLM-викликом усередині. Воркер вбудовується в ту САМУ драбину
//! (`harness::pipeline`): кожен рунг кличе воркер із моделлю свого тиру,
//! успіх вирішує канонічний re-detect петлі, а не сам воркер — «worker не
//! знає tier ladder і не вирішує success» (контракт JS-джерела).
//!
//! Перший (і поки єдиний) воркер — `text/cspell-fix`: cspell не має
//! нативного `--fix`, тож fix-режим класифікує «Unknown word»-знахідки
//! (bounded JSON one-shot) і дописує валідні слова у `.cspell.json#words`;
//! одруки лишаються людині. Порт `npm/rules/text/cspell-fix/fix-worker.mjs`.
//!
//! # Чому впорскується `ClassifyFn`
//!
//! Сам LLM-виклик — єдина недетермінована ланка воркера. Інʼєкція відділяє
//! її від решти (детект → парсинг → словник), тож тести ганяють воркер
//! наскрізно без мережі, а бойовий шлях ([`default_classify_fn`]) — через
//! `llm_lib::LocalCloud` з universal-слотом локального провайдера (той
//! самий контракт, що `defaultLocalProviders()` у JS).

use std::path::PathBuf;
use std::sync::Arc;

use harness::pipeline::{AttemptContext, AttemptFn};
use llm_lib::attempt::BoxFuture;
use llm_lib::tiers::{parse_model_spec, resolve_model, Tier};

/// One-shot класифікація: промпт → сира відповідь моделі.
pub type ClassifyFn =
    Arc<dyn Fn(String, Tier) -> BoxFuture<'static, Result<String, String>> + Send + Sync>;

/// Чи має concern власний fix-воркер (замість агентної сесії).
#[must_use]
pub fn has_fix_worker(key: &str) -> bool {
    key == "text/cspell-fix"
}

/// Будує воркер-`AttemptFn` для concern-а, якщо він worker-ний.
#[must_use]
pub fn build_fix_worker(
    key: &str,
    cwd: &std::path::Path,
    files: Option<&[String]>,
) -> Option<AttemptFn> {
    if !has_fix_worker(key) {
        return None;
    }
    Some(build_cspell_worker(
        cwd.to_path_buf(),
        files.map(<[String]>::to_vec),
        default_classify_fn(),
    ))
}

/// Бойова класифікація — `LocalCloud::one_shot` за тиром рунга.
///
/// Мапа провайдерів будується з ПРЕФІКСА локальної моделі
/// (`resolve_model(Tier::Local)` → `"omlx/..."` → слот `"omlx"` на
/// `default_local_openai_provider()`): один generic-слот для будь-якого
/// OpenAI-сумісного сервера, хоч би як користувач його назвав. Хмарні тири
/// йдуть у genai-клієнт без реєстрації (адаптер за іменем моделі).
fn default_classify_fn() -> ClassifyFn {
    Arc::new(|prompt: String, tier: Tier| {
        let fut: BoxFuture<'static, Result<String, String>> = Box::pin(async move {
            let mut providers = std::collections::HashMap::new();
            if let Some(local_spec) = resolve_model(Tier::Local) {
                if let Ok((prefix, _)) = parse_model_spec(&local_spec) {
                    providers.insert(
                        prefix.to_string(),
                        llm_lib::local_cloud::default_local_openai_provider(),
                    );
                }
            }
            llm_lib::local_cloud::LocalCloud::new(providers)
                .one_shot(tier, None, &prompt)
                .await
                .map_err(|error| error.to_string())
        });
        fut
    })
}

/// Воркер `text/cspell-fix`: детект → класифікація → словник.
///
/// Порядок мутації підпорядкований гарантіям петлі: `ctx.capture` на
/// `.cspell.json` іде ДО запису — pre-image в ladder-snapshot знімається з
/// незміненого вмісту, і відкат провального рунга повертає словник.
fn build_cspell_worker(
    cwd: PathBuf,
    files: Option<Vec<String>>,
    classify: ClassifyFn,
) -> AttemptFn {
    Arc::new(move |ctx: AttemptContext| {
        let cwd = cwd.clone();
        let files = files.clone();
        let classify = Arc::clone(&classify);
        Box::pin(async move {
            let started = std::time::Instant::now();
            let done = |ok: bool, touched: Vec<PathBuf>, error: Option<String>| {
                worker_outcome(ok, touched, error, started.elapsed().as_millis() as u64)
            };

            let Some(npx) = rules_core::tool_resolve::resolve_cmd("npx") else {
                return done(
                    false,
                    Vec::new(),
                    Some("npx не знайдено в PATH (cspell)".into()),
                );
            };
            let run = rules_core::concerns::detect_cspell(&cwd, &npx, files.as_deref());
            if run.code == 0 {
                // Нічого лагодити — петля побачить це власним re-detect-ом.
                return done(true, Vec::new(), None);
            }

            let words = rules_core::concerns::unknown_words(&run.out);
            let batch: Vec<String> = words
                .iter()
                .take(rules_core::concerns::MAX_CLASSIFY_WORDS)
                .cloned()
                .collect();
            if batch.is_empty() {
                return done(false, Vec::new(), Some("cspell червоний без «Unknown word»-знахідок — виводу нема що класифікувати".into()));
            }

            let tier = super::attempt::rung_tier_to_llm_tier(ctx.rung.tier);
            let prompt = rules_core::concerns::classify_prompt(&batch);
            let reply = match classify(prompt, tier).await {
                Ok(reply) => reply,
                Err(error) => return done(false, Vec::new(), Some(error)),
            };
            let Some(verdicts) = rules_core::concerns::parse_classify(&reply) else {
                return done(
                    false,
                    Vec::new(),
                    Some("відповідь класифікації не містить JSON-масиву вердиктів".into()),
                );
            };
            let valid: Vec<String> = verdicts
                .iter()
                .filter(|v| v.verdict.as_deref() == Some("valid"))
                .filter_map(|v| v.w.clone())
                .collect();

            let dict_path = cwd.join(".cspell.json");
            let Ok(current) = std::fs::read_to_string(&dict_path) else {
                return done(
                    false,
                    Vec::new(),
                    Some(
                        ".cspell.json відсутній чи нечитабельний — нема куди дописувати словник"
                            .into(),
                    ),
                );
            };
            match rules_core::concerns::append_words_to_dict(&current, &valid) {
                Some((next, _added)) => {
                    // capture ПЕРЕД записом — інакше pre-image знявся б із
                    // уже зміненого вмісту і відкат став би неможливим.
                    (ctx.capture)(dict_path.clone());
                    if let Err(error) = std::fs::write(&dict_path, next) {
                        return done(
                            false,
                            Vec::new(),
                            Some(format!("запис .cspell.json: {error}")),
                        );
                    }
                    done(true, vec![dict_path], None)
                }
                // Класифікація не дала ЖОДНОГО нового словникового слова —
                // все, що лишилось, або typo, або вже у словнику. Це чесний
                // провал рунга: наступний (сильніша модель) спробує ще раз.
                None => done(
                    false,
                    Vec::new(),
                    Some("класифікація не додала жодного нового слова у словник".into()),
                ),
            }
        })
    })
}

/// Підсумок worker-рунга: рівно один «хід» (one-shot), нуль агентних
/// tool-викликів, editLog порожній — мутація одна й видима через
/// `touched_files`/snapshot.
fn worker_outcome(
    ok: bool,
    touched_files: Vec<PathBuf>,
    error: Option<String>,
    elapsed_ms: u64,
) -> llm_lib::fix::FixOutcome {
    llm_lib::fix::FixOutcome {
        ok,
        touched_files,
        edit_log: Vec::new(),
        turns: 1,
        tool_calls: 0,
        elapsed_ms,
        empty_completion: false,
        stop_reason: if ok {
            llm_lib::fix::StopReason::Completed
        } else {
            llm_lib::fix::StopReason::ProviderError
        },
        error,
        verify_attempts: 0,
        prompt_tokens: None,
        completion_tokens: None,
        cached_tokens: None,
        reasoning_tokens: None,
        compacted: false,
        compaction_input_tokens: None,
        compaction_output_tokens: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness::ladder::{Rung, RungTier};
    use std::sync::Mutex;

    fn ctx_for(captured: Arc<Mutex<Vec<PathBuf>>>) -> AttemptContext {
        AttemptContext {
            capture: Arc::new(move |path| {
                captured.lock().unwrap().push(path);
            }),
            rung: Rung {
                tier: RungTier::Local,
                model: "fake/model".to_string(),
                feedback: false,
                local: true,
                timeout_ms: 5_000,
            },
            feedback: None,
            violations: Vec::new(),
            journal: Arc::new(Mutex::new(llm_lib::journal::Journal::new())),
            has_next_rung: true,
        }
    }

    fn fixed_reply(reply: &'static str) -> ClassifyFn {
        Arc::new(move |_prompt, _tier| {
            let fut: BoxFuture<'static, Result<String, String>> =
                Box::pin(async move { Ok(reply.to_string()) });
            fut
        })
    }

    #[test]
    fn registry_knows_exactly_cspell() {
        assert!(has_fix_worker("text/cspell-fix"));
        assert!(!has_fix_worker("changelog/presence"));
    }

    /// Наскрізний воркер без мережі: детект знаходить невідоме слово,
    /// класифікація (інʼєкція) каже «valid», словник поповнюється, capture
    /// спрацьовує ДО запису.
    ///
    /// Потребує реального `npx cspell` у PATH — інакше тест чесно
    /// пропускається (той самий клас, що wasm-фікстури: середовищна
    /// залежність, не логіка).
    #[tokio::test]
    async fn cspell_worker_appends_valid_words_end_to_end() {
        let Some(npx) = rules_core::tool_resolve::resolve_cmd("npx") else {
            eprintln!("пропуск: npx недоступний");
            return;
        };
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path();
        std::fs::write(
            cwd.join(".cspell.json"),
            "{\n  \"version\": \"0.2\",\n  \"words\": []\n}\n",
        )
        .unwrap();
        std::fs::write(cwd.join("тест.md"), "vygadaneslovodyktantu\n").unwrap();
        // Прогрів: якщо cspell не ставиться через npx у цьому середовищі —
        // пропуск, а не фейк-зелений.
        let probe = rules_core::concerns::detect_cspell(cwd, &npx, None);
        if probe.code != 0 && rules_core::concerns::unknown_words(&probe.out).is_empty() {
            eprintln!(
                "пропуск: cspell недоступний через npx ({})",
                probe.out.chars().take(120).collect::<String>()
            );
            return;
        }

        let captured = Arc::new(Mutex::new(Vec::new()));
        let worker = build_cspell_worker(
            cwd.to_path_buf(),
            None,
            fixed_reply(r#"[{"w":"vygadaneslovodyktantu","verdict":"valid","fix":null}]"#),
        );
        let outcome = worker(ctx_for(Arc::clone(&captured))).await;

        assert!(outcome.ok, "{:?}", outcome.error);
        assert_eq!(outcome.touched_files.len(), 1);
        assert_eq!(captured.lock().unwrap().len(), 1, "capture перед записом");
        let dict = std::fs::read_to_string(cwd.join(".cspell.json")).unwrap();
        assert!(dict.contains("vygadaneslovodyktantu"), "{dict}");
    }

    /// Відповідь-сміття → чесний провал рунга з причиною, без мутацій.
    #[tokio::test]
    async fn garbage_reply_fails_the_rung_without_touching_dict() {
        let Some(npx) = rules_core::tool_resolve::resolve_cmd("npx") else {
            eprintln!("пропуск: npx недоступний");
            return;
        };
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path();
        let dict_before = "{\n  \"words\": []\n}\n";
        std::fs::write(cwd.join(".cspell.json"), dict_before).unwrap();
        std::fs::write(cwd.join("тест.md"), "щеодневигаданеслово\n").unwrap();
        let probe = rules_core::concerns::detect_cspell(cwd, &npx, None);
        if probe.code != 0 && rules_core::concerns::unknown_words(&probe.out).is_empty() {
            eprintln!("пропуск: cspell недоступний через npx");
            return;
        }

        let captured = Arc::new(Mutex::new(Vec::new()));
        let worker = build_cspell_worker(cwd.to_path_buf(), None, fixed_reply("вибач, не можу"));
        let outcome = worker(ctx_for(Arc::clone(&captured))).await;

        assert!(!outcome.ok);
        assert!(outcome.error.is_some());
        assert!(captured.lock().unwrap().is_empty(), "жодних мутацій");
        assert_eq!(
            std::fs::read_to_string(cwd.join(".cspell.json")).unwrap(),
            dict_before
        );
    }
}
