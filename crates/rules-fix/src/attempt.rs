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
//! Але `llm_lib::fix::runner::run_attempt` будує СВІЙ ВЛАСНИЙ `WriteGuard`
//! усередині (`WriteGuard::new(req.cwd.clone())`, без `.with_on_capture`) і
//! НЕ приймає ні готовий guard, ні callback ззовні — його сигнатура
//! (`req: &FixRequest, deps: FixDeps, tools: ToolServerHandle`) не лишає
//! точки ін'єкції. Тобто зовнішній `ctx.capture` із цього крейта
//! технічно немає куди під'єднати без зміни API `run_attempt` — а міняти
//! `llm-lib` тут заборонено (див. звіт задачі, пункт «що лишилось
//! незробленим»/«запропонований API»).
//!
//! Наслідок: cross-file collateral-veto (файл ПОЗА `target_files`, якого
//! торкнулась ця спроба) наразі не працює — не тому, що цей крейт про нього
//! забув, а тому, що `run_attempt` не дає для нього гачка. In-file
//! hunk-window veto (правки ВСЕРЕДИНІ `target_files`) НЕ постраждав: ці
//! файли вже мають pre-image у S1, знятому `run_fix` (`pipeline.rs`) ДО
//! першого рангу драбини — до виклику цього модуля справа не доходить.
//! `ctx.capture` тут навмисно НЕ викликається заднім числом (після того, як
//! `run_attempt` уже повернувся): це дало б хибний, ЩЕ гірший результат —
//! `Snapshot::record` зняв би як «pre-image» вже ЗМІНЕНИЙ вміст, і
//! collateral-veto не просто мовчав би, а стверджував би «змін нема» на
//! файлі, що насправді змінено.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use llm_lib::fix::ladder::RungTier;
use llm_lib::fix::pipeline::{AttemptContext, AttemptFn};
use llm_lib::fix::runner::run_attempt;
use llm_lib::fix::tools::build_toolset;
use llm_lib::fix::{EditMode, FixDeps, FixRequest};
use llm_lib::tiers::Tier;
use rig_agent::tool::server::ToolServer;

use crate::verify::build_verify_fn;

/// Стеля ходів моделі на один attempt (backstop проти зациклення,
/// `FixRequest::turn_ceiling`) — паритет із `agent-fix.mjs`, де дефолт 50 і
/// той самий env-оверрайд.
///
/// Живий прогін на локальній 26B показав, чому 50, а не «здається, вистачить»:
/// зі стелею 10 обидва рунги драбини вигоряли на `MaxTurnsError`, бо модель
/// спершу читає файл і оглядає дерево — розвідка з'їдає ходи ще до першої
/// правки, і до неї справа просто не доходила.
const TURN_CEILING_DEFAULT: usize = 50;

/// Env-оверрайд стелі ходів (той самий ключ, що в JS-джерелі).
const TURN_CEILING_ENV: &str = "N_LLM_FIX_TURN_CEILING";

/// Стеля ходів: env-оверрайд або дефолт. Невалідне чи нульове значення —
/// дефолт (той самий `Number(...) || 50`, що в JS).
fn turn_ceiling() -> usize {
    std::env::var(TURN_CEILING_ENV)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|&value| value > 0)
        .unwrap_or(TURN_CEILING_DEFAULT)
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

/// Env-ключ стелі output-токенів на хід (`FixRequest::max_tokens`).
const MAX_TOKENS_ENV: &str = "N_LLM_FIX_MAX_TOKENS";

/// Стеля output-токенів на хід: `None` — консервативний дефолт циклу.
/// Виноситься назовні, бо потрібне значення залежить від моделі й контексту
/// сервера: те, що рятує 4B від розгону, обрізає багатофайловий фікс на 26B.
fn max_tokens() -> Option<u64> {
    std::env::var(MAX_TOKENS_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|&value| value > 0)
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

/// Мапить тир рангу драбини (`RungTier`, конкретний рівень ескалації) на
/// грубий `llm_lib::tiers::Tier` (`Min`/`Avg`/`Max`), який читає
/// `run_attempt` для резолву моделі.
///
/// **Неточність мапінгу** (звіт задачі): `run_attempt` резолвить модель
/// НАНОВО через `crate::tiers::resolve_model(tier)` (каскад від `Tier`,
/// стартує з ЛОКАЛЬНОЇ сходинки того самого рівня), а НЕ бере вже готовий
/// `Rung::model` із драбини (`resolve_ladder_models`/`build_ladder`,
/// `ladder.rs`). Для `CloudMin`/`CloudAvg` це не гарантує ту саму модель,
/// яку побудувала драбина: якщо в env заданий і `N_LOCAL_AVG_MODEL`, рунг
/// `CloudMin` (мапиться в `Tier::Avg`) пішов би на ЛОКАЛЬНУ `avg`-модель
/// замість хмарної `cloud-min`. Точний фікс вимагає зміни API
/// `run_attempt`/`FixRequest` (прийняти вже резолвлений
/// `"provider/model-id"` напряму, а не тир) — поза межами цього крейта.
fn rung_tier_to_llm_tier(tier: RungTier) -> Tier {
    match tier {
        RungTier::LocalMin | RungTier::LocalMinRetry => Tier::Min,
        RungTier::CloudMin => Tier::Avg,
        RungTier::CloudAvg => Tier::Max,
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

/// Складає [`PipelineDeps::attempt`](llm_lib::fix::pipeline::PipelineDeps::attempt)
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
) -> AttemptFn {
    Arc::new(move |ctx: AttemptContext| {
        let rule_id = rule_id.clone();
        let cwd = cwd.clone();
        let key = key.clone();
        let files = files.clone();
        let target_files = target_files.clone();
        let fix_hint = fix_hint.clone();
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
            let toolset = build_toolset(cwd.clone(), &deps, false);
            let handle = ToolServer::new().run();
            handle.append_toolset(toolset).await;

            let req = FixRequest {
                rule_id,
                violation_text: violation_text(&ctx),
                fix_hint,
                target_files,
                cwd,
                tier: rung_tier_to_llm_tier(ctx.rung.tier),
                // Модель бере драбина, не каскад: інакше рунг `cloud-min` міг
                // би піти на локальну модель, бо `resolve_model` завжди
                // починає з local.
                model: Some(ctx.rung.model.clone()),
                timeout: Duration::from_millis(ctx.rung.timeout_ms),
                turn_ceiling: turn_ceiling(),
                max_tokens: max_tokens(),
                temperature: temperature(),
                verify_max: verify_max(ctx.rung.local),
                anchored_edits: false,
                edit_mode: EditMode::Generic,
            };

            run_attempt(&req, deps, handle).await
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use llm_lib::fix::ladder::Rung;
    use llm_lib::fix::pipeline::Violation as PipelineViolation;
    use std::sync::Arc as StdArc;

    #[test]
    fn local_rungs_map_to_min_tier() {
        assert_eq!(rung_tier_to_llm_tier(RungTier::LocalMin), Tier::Min);
        assert_eq!(rung_tier_to_llm_tier(RungTier::LocalMinRetry), Tier::Min);
    }

    #[test]
    fn cloud_rungs_map_to_avg_and_max_tier() {
        assert_eq!(rung_tier_to_llm_tier(RungTier::CloudMin), Tier::Avg);
        assert_eq!(rung_tier_to_llm_tier(RungTier::CloudAvg), Tier::Max);
    }

    fn rung(tier: RungTier) -> Rung {
        Rung {
            tier,
            model: "fake/model".to_string(),
            feedback: false,
            local: matches!(tier, RungTier::LocalMin | RungTier::LocalMinRetry),
            is_avg: false,
            timeout_ms: 1000,
        }
    }

    fn ctx(violations: Vec<PipelineViolation>, feedback: Option<String>) -> AttemptContext {
        AttemptContext {
            capture: StdArc::new(|_path| {}),
            rung: rung(RungTier::LocalMin),
            feedback,
            violations,
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
