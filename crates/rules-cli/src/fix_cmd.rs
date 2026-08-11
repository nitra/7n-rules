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

    let key = match single_concern_key(&parsed.rules) {
        Ok(key) => key,
        Err(message) => {
            eprintln!("❌ {message}");
            return ExitCode::from(2);
        }
    };

    match run_blocking(&key, &cwd) {
        Ok(report) => {
            print_report(&key, &report);
            ExitCode::from(exit_code(&report.outcome))
        }
        Err(message) => {
            eprintln!("❌ native-фікс {key}: {message}");
            ExitCode::from(2)
        }
    }
}

/// Витягує рівно один `rule/concern` із позиційних аргументів.
///
/// Свідомо суворо: мовчазний вибір «першого» з кількох ключів приховав би від
/// викликача, що решта не оброблена.
fn single_concern_key(rules: &[String]) -> Result<String, String> {
    match rules {
        [] => Err(
            "--native-fix потребує ключа concern-а у форматі `rule/concern`, напр. `n-rules lint --native-fix text/forbidden-prettier`"
                .to_string(),
        ),
        [single] if single.contains('/') => Ok(single.clone()),
        [single] => Err(format!(
            "`{single}` не схоже на ключ concern-а: очікується формат `rule/concern`"
        )),
        many => Err(format!(
            "--native-fix обробляє рівно один concern за виклик, а передано {}: {}",
            many.len(),
            many.join(", ")
        )),
    }
}

/// Заводить async-рантайм під один виклик і виконує контур.
///
/// Рантайм створюється тут, а не в `main`: решта native-команд CLI повністю
/// синхронна, і платити за багатопотоковий рантайм на кожному `changed-files`
/// не було б за що.
fn run_blocking(key: &str, cwd: &Path) -> Result<FixReport, String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("не вдалося створити async-рантайм: {error}"))?;

    let mut avg_budget = AvgBudget::new(DEFAULT_MAX_AVG);
    runtime.block_on(async {
        rules_fix::fix_concern(key, cwd, None, &mut avg_budget)
            .await
            .map_err(|error| error.to_string())
    })
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
        let key = single_concern_key(&["text/forbidden-prettier".to_string()])
            .expect("валідний ключ приймається");
        assert_eq!(key, "text/forbidden-prettier");
    }

    #[test]
    fn empty_rules_explain_the_expected_format() {
        let error = single_concern_key(&[]).expect_err("без ключа — помилка");
        assert!(error.contains("rule/concern"), "підказано формат: {error}");
    }

    #[test]
    fn key_without_slash_is_rejected() {
        let error = single_concern_key(&["text".to_string()]).expect_err("не ключ concern-а");
        assert!(error.contains("rule/concern"));
    }

    #[test]
    fn several_keys_are_rejected_instead_of_silently_taking_the_first() {
        let error = single_concern_key(&["a/b".to_string(), "c/d".to_string()])
            .expect_err("кілька ключів — помилка, не мовчазний вибір першого");
        assert!(error.contains("a/b") && error.contains("c/d"), "{error}");
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
