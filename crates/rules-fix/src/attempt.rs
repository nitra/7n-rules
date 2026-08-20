//! cspell:ignore ttft компакція компакції
//! `PipelineDeps::attempt` — обгортка над `llm_lib::fix::runner::run_attempt`
//! для одного concern-а: крок 2 задачі (частина `attempt`).
//!
//! # Відома прогалина: `AttemptContext::capture` нікуди не під'єднаний
//!
//! `pipeline::AttemptContext` документує (доккомент `CaptureFn`,
//! `pipeline.rs`), що виконавець МУСИТЬ викликати `capture` ПЕРЕД кожним
//! записом у файл поза вже знятим S1 — інакше pre-image знімається вже з
//! правленого вмісту, і cross-file collateral-veto стає сліпим (дефект,
//! який `pipeline.rs`-тести вже одного разу ловили,
//! `collateral_outside_target_set_rejects_even_when_detector_is_clean`).
//! Бойовий міст для цього — `WriteGuard::with_on_capture` (доккомент
//! `snapshot.rs`, розділ «Міст між рівнями»).
//!
//! `run_attempt` (0.3: `req, deps, tools, journal`) приймає callback через
//! `FixDeps::on_capture` — сюди й підключається `ctx.capture` (див.
//! `build_attempt_fn` нижче). Історична прогалина «сигнатура не лишає точки
//! ін'єкції» закрита ще в 0.2.x додаванням `on_capture`; абзац лишається як
//! пояснення, ЧОМУ хук існує.
//!

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use harness::ladder::RungTier;
use harness::pipeline::{AttemptContext, AttemptFn};
use llm_lib::fix::runner::run_attempt;
use llm_lib::fix::tools::build_toolset;
use llm_lib::fix::{EditMode, FixDeps, FixRequest};
use llm_lib::tiers::Tier;
use rig_agent::tool::server::ToolServer;

use crate::verify::build_verify_fn;

/// Env-оверрайд стелі ходів (той самий ключ, що був у JS-джерелі) — тепер
/// оверрайд ПОЛІТИКИ, не власного дефолту.
const TURN_CEILING_ENV: &str = "N_LLM_FIX_TURN_CEILING";

/// Стеля ходів одного attempt-у: env-оверрайд або дефолт політики
/// (`FixPolicy`), окремий для local/cloud.
///
/// JS-паритетний дефолт 50 помер разом із міграцією на 0.3, і живий прогін
/// показав чому: валідація вміщення (§3.3) робить `50 × output_ceiling`
/// таким, що не влазить у жодне реальне вікно — стара стеля була продуктом
/// світу БЕЗ бюджетної арифметики, де єдиним обмежувачем був сам лічильник.
/// Політика 0.3 веде ходи інакше: мало ходів + часовий кеп + компакція
/// («повільну машину зупиняє часовий кеп §3.4, а не менше ходів» —
/// доккоментар `FixPolicy::turns`). Env-ручка лишається для вимірювань.
fn turn_ceiling(local: bool, policy: &llm_lib::budget::FixPolicy) -> usize {
    std::env::var(TURN_CEILING_ENV)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|&value| value > 0)
        .unwrap_or(if local {
            policy.turns
        } else {
            policy.cloud_turns
        })
}

/// Скільки разів verify-петля може повернути фідбек у тій самій сесії
/// одного attempt-у (`FixRequest::verify_max`) — паритет із `run-fix.mjs:618`:
/// локальній моделі даємо одну спробу виправитись, хмарній дві. Причина не
/// в економії, а в тому, що слабка модель на другому фідбеці частіше
/// повторює ту саму правку, ніж знаходить іншу — дешевше віддати хід
/// наступному рунгу драбини.
fn verify_max(local: bool) -> usize {
    if local {
        1
    } else {
        2
    }
}

/// Env-ключ стелі output-токенів на хід (`FixRequest::output_ceiling`).
const MAX_TOKENS_ENV: &str = "N_LLM_FIX_MAX_TOKENS";

/// Стеля output-токенів на хід — тепер ЗАВЖДИ зі значенням (поле перестало
/// бути `Option`): env-оверрайд або дефолт політики (`FixPolicy`), окремий
/// для local/cloud. Виноситься назовні, бо потрібне значення залежить від
/// моделі: те, що рятує 4B від розгону, обрізає багатофайловий фікс на 26B.
fn output_ceiling(local: bool, policy: &llm_lib::budget::FixPolicy) -> u64 {
    std::env::var(MAX_TOKENS_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|&value| value > 0)
        .unwrap_or(if local {
            policy.output_ceiling
        } else {
            policy.cloud_output_ceiling
        })
}

/// Вікно контексту рунга — вхід валідації вміщення (§3.3 спеки harness) і
/// поріг авто-компакції runner-а.
///
/// Локальний рунг — з capability локального сервера
/// (`N_LOCAL_OPENAI_CONTEXT`); невідоме → консервативні 32k: свій сервер
/// МОЖЕ бути маленьким, і чесніше занизити стелю tool-результатів, ніж
/// запланувати промпт, який не влізе.
///
/// Хмарний рунг — з `N_CLOUD_*_CONTEXT`; невідоме → 128k, НЕ 32k. Перший
/// живий прогін після міграції показав чому: консервативні 32k для хмари
/// фабрикували `FitError` із вигадки — жодна модель наших cloud-тирів не
/// має вікна, меншого за 128k, і «валідація» проти вигаданого малого вікна
/// вбивала робочі рунги, яких 0.2 виконував без питань.
fn rung_context(local: bool, tier: Tier) -> u64 {
    const CONSERVATIVE_LOCAL_CONTEXT: u64 = 32_768;
    const FLOOR_CLOUD_CONTEXT: u64 = 128_000;
    if local {
        llm_lib::budget::local_capability()
            .map(|c| c.context)
            .unwrap_or(CONSERVATIVE_LOCAL_CONTEXT)
    } else {
        llm_lib::budget::cloud_capability(tier)
            .context
            .unwrap_or(FLOOR_CLOUD_CONTEXT)
    }
}

/// Env-ключ температури генерації (`FixRequest::temperature`).
const TEMPERATURE_ENV: &str = "N_LLM_FIX_TEMPERATURE";

/// Температура генерації: `None` — дефолт провайдера.
///
/// Свідомо БЕЗ власного дефолту. Спокуса поставити `0.0` («ремонт — не
/// творчість, хай буде відтворювано») живим прогоном спростована: greedy
/// позбавляє слабку модель єдиного способу вийти з повтору — вона зробила 47
/// однакових викликів поспіль і жодної правки, тоді як із ненульовою
/// температурою та сама модель на тому самому вході писала. Нуль лишається
/// корисним для ВИМІРЮВАНЬ (відтворювані прогони) — саме тому ручка є.
fn temperature() -> Option<f64> {
    std::env::var(TEMPERATURE_ENV)
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
}

/// Мапить тир рунга драбини на плоский `llm_lib::tiers::Tier` — 1:1, без
/// каскаду. Стара «неточність мапінгу» (каскадний `resolve_model` міг
/// завезти cloud-рунг на локальну модель) померла разом із каскадом:
/// плоский `Tier` (0.3) зробив відповідність точною за побудовою.
pub(crate) fn rung_tier_to_llm_tier(tier: RungTier) -> Tier {
    match tier {
        RungTier::Local | RungTier::LocalRetry => Tier::Local,
        RungTier::CloudMin => Tier::CloudMin,
        RungTier::CloudAvg => Tier::CloudAvg,
        RungTier::CloudMax => Tier::CloudMax,
    }
}

/// Журнальний ідентифікатор рунга — той самий словник, що всередині
/// `harness::pipeline` (там функція приватна, копія неминуча; словник
/// закритий константами `RungId`, тож дрейф зловить компілятор).
fn rung_id_for(tier: RungTier) -> llm_lib::journal::RungId {
    use llm_lib::journal::RungId;
    match tier {
        RungTier::Local => RungId::LOCAL,
        RungTier::LocalRetry => RungId::LOCAL_RETRY,
        RungTier::CloudMin => RungId::CLOUD_MIN,
        RungTier::CloudAvg => RungId::CLOUD_AVG,
        RungTier::CloudMax => RungId::CLOUD_MAX,
    }
}

/// Провальний outcome валідації вміщення (§3.3) — жодного HTTP-виклику ще
/// не було, тож усі лічильники нульові, а причина — `ProviderError` з
/// текстом для журналу. Окремою функцією, бо `FixOutcome` виріс до 17 полів
/// і literal на місці ховав би єдине змістовне: `error`.
fn fit_error_outcome(message: String) -> llm_lib::fix::FixOutcome {
    llm_lib::fix::FixOutcome {
        ok: false,
        touched_files: Vec::new(),
        edit_log: Vec::new(),
        turns: 0,
        tool_calls: 0,
        elapsed_ms: 0,
        empty_completion: true,
        stop_reason: llm_lib::fix::StopReason::ProviderError,
        error: Some(message),
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

/// Текст завдання моделі: поточні порушення рангу і, якщо є, фідбек
/// попереднього провалу — звід `AttemptContext` в один текст промпту.
fn violation_text(ctx: &AttemptContext) -> String {
    let mut lines: Vec<String> = ctx
        .violations
        .iter()
        .map(|v| match v.line {
            Some(line) => format!("{}:{line}: {}", v.file.display(), v.message),
            None => format!("{}: {}", v.file.display(), v.message),
        })
        .collect();
    if let Some(feedback) = &ctx.feedback {
        lines.push(format!("Фідбек попередньої спроби: {feedback}"));
    }
    lines.join("\n")
}

/// Складає [`PipelineDeps::attempt`](harness::pipeline::PipelineDeps::attempt)
/// — обгортку над [`run_attempt`] для одного concern-а: `FixRequest`
/// збирається з `AttemptContext` (тир/таймаут/фідбек/порушення рангу),
/// toolset — з [`build_toolset`] (базовий профіль, без anchored-правок:
/// concern-и `rules-core` — звичайні текстові/YAML/TOML-файли, не той клас
/// ризику fuzzy-редагування, під який заводили анкерний протокол).
#[must_use]
pub fn build_attempt_fn(
    rule_id: String,
    cwd: PathBuf,
    key: String,
    files: Option<Vec<String>>,
    target_files: Vec<PathBuf>,
    fix_hint: Option<String>,
    policy: llm_lib::budget::FixPolicy,
) -> AttemptFn {
    Arc::new(move |ctx: AttemptContext| {
        let rule_id = rule_id.clone();
        let cwd = cwd.clone();
        let key = key.clone();
        let files = files.clone();
        let target_files = target_files.clone();
        let fix_hint = fix_hint.clone();
        let policy = policy.clone();
        Box::pin(async move {
            let verify = build_verify_fn(key, cwd.clone(), files, target_files.clone());
            let deps = FixDeps {
                verify,
                ast_facts: None,
                // Хук першого дотику з петлі — саме він робить
                // ladder-рівневий snapshot видющим для файлів ПОЗА цільовим
                // набором. Без нього cross-file collateral-veto сліпий.
                on_capture: Some(Arc::clone(&ctx.capture)),
            };
            let tier = rung_tier_to_llm_tier(ctx.rung.tier);
            // ТА САМА політика, що в PipelineConfig (lib.rs передає її сюди
            // явно): інакше прогнози harness і реальна стеля attempt-у
            // рахувалися б із різних чисел.
            let turns = turn_ceiling(ctx.rung.local, &policy);
            let out_ceiling = output_ceiling(ctx.rung.local, &policy);
            let context = rung_context(ctx.rung.local, tier);
            // Валідація вміщення ДО HTTP-виклику (§3.3): промпт, що не
            // вміщається у вікно, — провальний outcome із причиною, а не
            // тихий дефолт і не паніка.
            let tool_ceiling = match llm_lib::budget::tool_result_ceiling(
                context,
                llm_lib::budget::CONSERVATIVE_BASE_TOKENS,
                turns,
                out_ceiling,
                &llm_lib::budget::Rates::from_env(),
            ) {
                Ok(value) => value,
                Err(err) => {
                    return fit_error_outcome(format!(
                        "бюджет рунга не вміщається у вікно контексту ({context}): {err}"
                    ));
                }
            };

            let toolset = build_toolset(cwd.clone(), &deps, false, tool_ceiling);
            let handle = ToolServer::new().run();
            handle.append_toolset(toolset).await;

            let req = FixRequest {
                rule_id,
                violation_text: violation_text(&ctx),
                fix_hint,
                temperature: temperature(),
                target_files,
                cwd,
                tier,
                rung: rung_id_for(ctx.rung.tier),
                // Модель бере драбина, не каскад: інакше рунг `cloud-min` міг
                // би піти на локальну модель, бо `resolve_model` завжди
                // починає з local.
                model: Some(ctx.rung.model.clone()),
                timeout: Duration::from_millis(ctx.rung.timeout_ms),
                turn_ceiling: turns,
                verify_max: verify_max(ctx.rung.local),
                output_ceiling: out_ceiling,
                tool_result_ceiling: tool_ceiling,
                anchored_edits: false,
                edit_mode: EditMode::Generic,
                // Бойовий attempt, не калібрувальний прохід — доккоментар
                // поля прямо вимагає явного вибору викликача.
                ttft_calibration: false,
                context,
                has_next_rung: ctx.has_next_rung,
            };

            // Журнал — СПІЛЬНИЙ для всього concern-а (створює run_fix);
            // події рунга пише runner, але в той самий екземпляр. Guard
            // std-м'ютекса через `await` зробив би future !Send (а BoxFuture
            // вимагає Send), тож журнал ЗАБИРАЄТЬСЯ з м'ютекса на час
            // attempt-у й повертається після — безпечно, бо run_fix awaited
            // цю функцію послідовно й сам у цей час журнал не чіпає.
            let mut journal = {
                let mut guard = ctx
                    .journal
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                std::mem::replace(&mut *guard, llm_lib::journal::Journal::new())
            };
            let outcome = run_attempt(&req, deps, handle, &mut journal).await;
            *ctx.journal
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = journal;
            outcome
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness::ladder::Rung;
    use harness::pipeline::Violation as PipelineViolation;
    use std::sync::Arc as StdArc;

    /// Плоский мапінг 1:1 — обидва локальні рунги в `Tier::Local`, хмарні
    /// без зсуву. Стара «неточність мапінгу» (cloud-рунг через каскад міг
    /// заїхати на локальну модель) стала непредставимою.
    #[test]
    fn rung_tiers_map_flat_one_to_one() {
        assert_eq!(rung_tier_to_llm_tier(RungTier::Local), Tier::Local);
        assert_eq!(rung_tier_to_llm_tier(RungTier::LocalRetry), Tier::Local);
        assert_eq!(rung_tier_to_llm_tier(RungTier::CloudMin), Tier::CloudMin);
        assert_eq!(rung_tier_to_llm_tier(RungTier::CloudAvg), Tier::CloudAvg);
        assert_eq!(rung_tier_to_llm_tier(RungTier::CloudMax), Tier::CloudMax);
    }

    /// Журнальні id — той самий словник, що в `harness::pipeline` (копія
    /// приватної функції; дрейф словника зловить цей тест).
    #[test]
    fn rung_ids_match_journal_dictionary() {
        use llm_lib::journal::RungId;
        assert_eq!(rung_id_for(RungTier::Local), RungId::LOCAL);
        assert_eq!(rung_id_for(RungTier::LocalRetry), RungId::LOCAL_RETRY);
        assert_eq!(rung_id_for(RungTier::CloudMin), RungId::CLOUD_MIN);
        assert_eq!(rung_id_for(RungTier::CloudAvg), RungId::CLOUD_AVG);
        assert_eq!(rung_id_for(RungTier::CloudMax), RungId::CLOUD_MAX);
    }

    fn rung(tier: RungTier) -> Rung {
        Rung {
            tier,
            model: "fake/model".to_string(),
            feedback: false,
            local: matches!(tier, RungTier::Local | RungTier::LocalRetry),
            timeout_ms: 1000,
        }
    }

    fn ctx(violations: Vec<PipelineViolation>, feedback: Option<String>) -> AttemptContext {
        AttemptContext {
            capture: StdArc::new(|_path| {}),
            rung: rung(RungTier::Local),
            feedback,
            violations,
            journal: StdArc::new(std::sync::Mutex::new(llm_lib::journal::Journal::new())),
            has_next_rung: true,
        }
    }

    #[test]
    fn violation_text_includes_line_when_present_and_omits_when_absent() {
        let text = violation_text(&ctx(
            vec![
                PipelineViolation {
                    file: PathBuf::from("a.mjs"),
                    line: Some(7),
                    message: "з рядком".to_string(),
                },
                PipelineViolation {
                    file: PathBuf::from("b.mjs"),
                    line: None,
                    message: "без рядка".to_string(),
                },
            ],
            None,
        ));
        assert!(text.contains("a.mjs:7: з рядком"));
        assert!(text.contains("b.mjs: без рядка"));
    }

    #[test]
    fn violation_text_appends_feedback_when_present() {
        let text = violation_text(&ctx(
            Vec::new(),
            Some("попередня спроба не спрацювала".to_string()),
        ));
        assert!(text.contains("попередня спроба не спрацювала"));
    }
}
