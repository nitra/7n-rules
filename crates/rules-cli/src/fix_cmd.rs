//! Native-контур фіксу: `n-rules lint --native-fix <rule/concern>`.
//!
//! Точка, з якої власний цикл `fix` (спека
//! `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7 клас 3) стає доступним
//! командою, а не лише з тестів. Уся логіка — у `rules_fix::fix_concern`:
//! цей модуль лише розбирає аргументи, заводить async-рантайм і рендерить
//! звіт українською.
//!
//! # Чому окремий прапорець, а не заміна дефолту
//!
//! `--native-fix` — близнюк наявного `--native-detect`: опційний вмикач
//! бінаря. Без нього `lint` без `--no-fix` і далі делегується в JS-CLI, де
//! живе чинний fix-пайплайн. Так само, як з batch-емуляцією (рішення К
//! спеки), нова поверхня зʼявляється доступною й явно обираною, а перемикання
//! дефолту — окреме рішення, коли контур доведе себе на реальних прогонах.
//!
//! # Межі цього зрізу
//!
//! Приймається РІВНО один concern-ключ (`rule/concern`): `fix_concern`
//! працює з одним concern-ом, а не з планом усього прогону. Кеп найдорожчого
//! тиру створюється на цей виклик — спільний бюджет на кілька concern-ів
//! зʼявиться разом із native-планом фіксу.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use llm_lib::fix::ladder::{AvgBudget, DEFAULT_MAX_AVG};
use llm_lib::fix::pipeline::{FixReport, PipelineOutcome, RungFailure};

use crate::cli::LintArgs;
use crate::paths;

/// Прапорець вмикання native-фіксу — вирізається з argv перед делегацією
/// (JS-CLI про нього не знає).
pub const NATIVE_FIX_FLAG: &str = "--native-fix";

/// Точка входу: `parsed` — уже розібрані аргументи `lint`.
pub fn run(parsed: &LintArgs) -> ExitCode {
    let process_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cwd = parsed.cwd.as_deref().map_or_else(
        || process_cwd.clone(),
        |value| paths::resolve(&process_cwd, value),
    );

    let keys = match concern_keys(&parsed.rules) {
        Ok(keys) => keys,
        Err(message) => {
            eprintln!("❌ {message}");
            return ExitCode::from(2);
        }
    };

    let runs = match run_blocking(&keys, &cwd) {
        Ok(runs) => runs,
        Err(message) => {
            eprintln!("❌ native-фікс: {message}");
            return ExitCode::from(2);
        }
    };

    let mut worst = 0u8;
    for run in &runs {
        match &run.outcome {
            Ok(report) => {
                print_report(&run.key, report);
                worst = worst.max(exit_code(&report.outcome));
            }
            Err(error) => {
                // Провал одного concern-а не ховає решту звіту — інакше
                // незрозуміло, що встигло полагодитись до нього.
                eprintln!("❌ native-фікс {}: {error}", run.key);
                worst = 2;
            }
        }
    }
    ExitCode::from(worst)
}

/// Перевіряє позиційні аргументи як перелік ключів `rule/concern`.
///
/// Кілька ключів прогоняються ПОСЛІДОВНО зі спільним бюджетом найдорожчого
/// тиру (рішення И спеки): кеп рахується на весь прогін, а не на concern.
/// Невалідний формат — помилка для всього виклику, а не тихий пропуск: краще
/// не почати, ніж зробити половину непоміченим чином.
fn concern_keys(rules: &[String]) -> Result<Vec<String>, String> {
    if rules.is_empty() {
        return Err(
            "--native-fix потребує щонайменше одного ключа concern-а у форматі `rule/concern`, напр. `n-rules lint --native-fix text/forbidden-prettier`"
                .to_string(),
        );
    }
    if let Some(bad) = rules.iter().find(|key| !key.contains('/')) {
        return Err(format!(
            "`{bad}` не схоже на ключ concern-а: очікується формат `rule/concern`"
        ));
    }
    Ok(rules.to_vec())
}

/// Заводить async-рантайм під один виклик і виконує контур.
///
/// Рантайм створюється тут, а не в `main`: решта native-команд CLI повністю
/// синхронна, і платити за багатопотоковий рантайм на кожному `changed-files`
/// не було б за що.
fn run_blocking(keys: &[String], cwd: &Path) -> Result<Vec<rules_fix::ConcernRun>, String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("не вдалося створити async-рантайм: {error}"))?;

    // ОДИН бюджет на весь виклик — саме тут спільний кеп найдорожчого тиру
    // починає означати те, що обіцяє спека.
    let mut avg_budget = AvgBudget::new(DEFAULT_MAX_AVG);
    Ok(runtime.block_on(rules_fix::fix_concerns(keys, cwd, None, &mut avg_budget)))
}

/// Код виходу за конвенцією lint-поверхні: 0 — чисто, 1 — порушення лишилось.
/// Помилки самого прогону дають 2 і рендеряться окремо.
fn exit_code(outcome: &PipelineOutcome) -> u8 {
    match outcome {
        PipelineOutcome::CleanNoWork | PipelineOutcome::T0Closed | PipelineOutcome::Success => 0,
        PipelineOutcome::Failed | PipelineOutcome::SkippedNotFixable => 1,
    }
}

/// Людський опис причини, чому спроба не зарахована.
fn describe_failure(failure: &RungFailure) -> String {
    match failure {
        RungFailure::Error(err) => format!("помилка: {err}"),
        RungFailure::StillFailing => "порушення лишилось".to_string(),
        RungFailure::CollateralFiles(files) => format!(
            "правки поза дозволеними файлами ({})",
            files
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        RungFailure::CollateralLines { file, from, to } => format!(
            "правки поза ділянкою порушення ({}:{from}-{to})",
            file.display()
        ),
        RungFailure::NoEdits => "жодного файлу не змінено".to_string(),
        RungFailure::AvgCapExhausted => "пропущено: вичерпано бюджет найдорожчого тиру".to_string(),
    }
}

/// Рендерить звіт: підсумок, хто закрив, і перелік спроб із причинами.
/// Спроби друкуємо ЗАВЖДИ, а не лише на провалі — саме вони пояснюють, чому
/// прогін коштував стільки, скільки коштував.
fn print_report(key: &str, report: &FixReport) {
    let summary = match report.outcome {
        PipelineOutcome::CleanNoWork => "✅ чисто — порушень не було".to_string(),
        PipelineOutcome::T0Closed => {
            "✅ закрито детермінованим фіксом, без виклику моделі".to_string()
        }
        PipelineOutcome::Success => format!(
            "✅ закрито: {}",
            report.resolved_by.as_deref().unwrap_or("невідомо")
        ),
        PipelineOutcome::SkippedNotFixable => {
            "⏭️ concern не фіксується кодом — драбина не запускалась".to_string()
        }
        PipelineOutcome::Failed => "❌ порушення лишилось, дерево відкочено".to_string(),
    };
    println!("{summary} · {key}");

    for attempt in &report.attempts {
        let status = if attempt.ok { "✅" } else { "❌" };
        let reason = attempt
            .failure
            .as_ref()
            .map(|failure| format!(" — {}", describe_failure(failure)))
            .unwrap_or_default();
        println!(
            "  {status} {}:{} · {} ходів, {} викликів інструментів{reason}",
            attempt.tier, attempt.model, attempt.turns, attempt.tool_calls
        );
    }

    if report.rollbacks > 0 {
        println!("  ↩️ відкотів: {}", report.rollbacks);
    }
    if report.avg_cap_skipped {
        println!("  ⚠️ бюджет найдорожчого тиру вичерпано — частину спроб пропущено");
    }
    if !report.touched_files.is_empty() {
        println!("  📝 змінено файлів: {}", report.touched_files.len());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_key_is_accepted() {
        let keys = concern_keys(&["text/forbidden-prettier".to_string()])
            .expect("валідний ключ приймається");
        assert_eq!(keys, vec!["text/forbidden-prettier".to_string()]);
    }

    #[test]
    fn several_keys_run_in_one_invocation_sharing_the_budget() {
        let keys = concern_keys(&["a/b".to_string(), "c/d".to_string()])
            .expect("кілька ключів — валідний виклик зі спільним бюджетом");
        assert_eq!(keys.len(), 2, "усі ключі доходять до прогону");
    }

    #[test]
    fn empty_rules_explain_the_expected_format() {
        let error = concern_keys(&[]).expect_err("без ключа — помилка");
        assert!(error.contains("rule/concern"), "підказано формат: {error}");
    }

    #[test]
    fn key_without_slash_is_rejected() {
        let error = concern_keys(&["text".to_string()]).expect_err("не ключ concern-а");
        assert!(error.contains("rule/concern"));
    }

    #[test]
    fn one_bad_key_rejects_the_whole_call_instead_of_silently_skipping_it() {
        let error = concern_keys(&["a/b".to_string(), "zzz".to_string()])
            .expect_err("невалідний ключ серед валідних — помилка всього виклику");
        assert!(
            error.contains("zzz"),
            "названо саме проблемний ключ: {error}"
        );
    }

    #[test]
    fn exit_codes_follow_the_lint_convention() {
        assert_eq!(exit_code(&PipelineOutcome::CleanNoWork), 0);
        assert_eq!(exit_code(&PipelineOutcome::T0Closed), 0);
        assert_eq!(exit_code(&PipelineOutcome::Success), 0);
        assert_eq!(exit_code(&PipelineOutcome::Failed), 1);
        assert_eq!(exit_code(&PipelineOutcome::SkippedNotFixable), 1);
    }

    #[test]
    fn failure_descriptions_name_the_offending_paths() {
        let text = describe_failure(&RungFailure::CollateralFiles(vec![PathBuf::from("b.rs")]));
        assert!(text.contains("b.rs"), "{text}");
        let text = describe_failure(&RungFailure::CollateralLines {
            file: PathBuf::from("a.rs"),
            from: 10,
            to: 40,
        });
        assert!(text.contains("a.rs") && text.contains("10-40"), "{text}");
    }
}
