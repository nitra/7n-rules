//! Native-команда `changed-files` — plumbing-вивід зміненого набору файлів
//! поверх готових `rules_core::changed_files`/`changed_base` (рішення Е
//! мінідизайну `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! Режими (по шляху на рядок, порожній набір — порожній вивід):
//! - без прапорців — робоче дерево vs HEAD (семантика `collectChangedFiles`);
//! - `--delta` — merge-base за Git policy ([`crate::git_policy`]) із
//!   fail-open fallback на робоче дерево, коли база не резолвиться (та сама
//!   поведінка, що в delta-lint);
//! - `--base <ref>` — явна база, fail-closed: нерезолвний ref — помилка
//!   (семантика `collectChangedFilesSince` із явним base у CI).
//!
//! JS-CLI такої підкоманди не має (команда native-first); parity гейтиться
//! проти фасадів `npm/scripts/lib/changed-files.mjs` тестом
//! `npm/scripts/lib/tests/rules-cli-parity.test.mjs`.

use std::path::PathBuf;
use std::process::ExitCode;

use crate::git_policy;

/// Використання команди — для повідомлень про невідомі аргументи.
const USAGE: &str = "rules-cli changed-files [--cwd <dir>] [--delta] [--base <ref>]";

/// Розібрані аргументи `changed-files`.
struct Args {
    cwd: Option<PathBuf>,
    base: Option<String>,
    delta: bool,
}

/// Плаский розбір прапорців; будь-який невідомий аргумент — помилка
/// (native-команда володіє своєю поверхнею, мовчазна делегація тут
/// приховувала б одруківки).
fn parse_args(args: &[String]) -> Result<Args, String> {
    let mut parsed = Args {
        cwd: None,
        base: None,
        delta: false,
    };
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--cwd" => {
                let value = it.next().ok_or("--cwd потребує значення <dir>")?;
                parsed.cwd = Some(PathBuf::from(value));
            }
            "--base" => {
                let value = it.next().ok_or("--base потребує значення <ref>")?;
                parsed.base = Some(value.clone());
            }
            "--delta" => parsed.delta = true,
            other => return Err(format!("невідомий аргумент «{other}»")),
        }
    }
    Ok(parsed)
}

/// Виконує команду: збирає набір файлів у вибраному режимі й друкує його.
pub fn run(args: &[String]) -> ExitCode {
    let parsed = match parse_args(args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("❌ changed-files: {message} — використання: {USAGE}");
            return ExitCode::FAILURE;
        }
    };
    let cwd = match parsed.cwd.map_or_else(std::env::current_dir, Ok) {
        Ok(cwd) => cwd,
        Err(error) => {
            eprintln!("❌ changed-files: не вдалося визначити робочий каталог: {error}");
            return ExitCode::FAILURE;
        }
    };

    let files = if let Some(base_ref) = parsed.base.as_deref() {
        // Явна база — fail-closed: і нерезолвний merge-base, і недосяжний
        // commit (rebase/force-update/shallow prune) — помилка, не мовчазний
        // порожній набір.
        let resolved =
            match rules_core::changed_base::resolve_changed_base(&cwd, &[], Some(base_ref)) {
                Ok(resolved) => resolved,
                Err(error) => {
                    eprintln!("❌ changed-files: {error}");
                    return ExitCode::FAILURE;
                }
            };
        let Some(sha) = resolved else {
            eprintln!(
                "❌ changed-files: база «{base_ref}» не резолвиться (merge-base з HEAD відсутній)"
            );
            return ExitCode::FAILURE;
        };
        match rules_core::changed_files::collect_changed_files_since(&cwd, Some(&sha)) {
            Ok(files) => files,
            Err(error) => {
                eprintln!("❌ changed-files: {error}");
                return ExitCode::FAILURE;
            }
        }
    } else if parsed.delta {
        // Policy-кандидати — fail-open на робоче дерево (та сама поведінка,
        // що в delta-lint без резолвнутої бази); помилок resolve наразі не
        // існує (`RulesError` про запас), трактуємо як «немає бази».
        let candidates = git_policy::integration_candidates(&cwd);
        let base = rules_core::changed_base::resolve_changed_base(&cwd, &candidates, None)
            .ok()
            .flatten();
        match base {
            // Повернений sha завжди досяжний (merge-base існуючого ref),
            // fail-closed перевірка `since` не спрацює хибно — Err
            // тут означає реальну git-помилку.
            Some(sha) => {
                match rules_core::changed_files::collect_changed_files_since(&cwd, Some(&sha)) {
                    Ok(files) => files,
                    Err(error) => {
                        eprintln!("❌ changed-files: {error}");
                        return ExitCode::FAILURE;
                    }
                }
            }
            None => rules_core::changed_files::collect_changed_files(&cwd),
        }
    } else {
        rules_core::changed_files::collect_changed_files(&cwd)
    };

    let mut out = String::new();
    for file in &files {
        out.push_str(file);
        out.push('\n');
    }
    print!("{out}");
    ExitCode::SUCCESS
}
