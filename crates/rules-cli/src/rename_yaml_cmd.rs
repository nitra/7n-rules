//! Native-команда `rename-yaml-extensions` — порт CLI-шару
//! `npm/bin/rename-yaml-extensions.mjs` (зріз 2 фази 8,
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`). Сама логіка —
//! [`rules_core::rename_yaml`]; тут лише розбір аргументів, читання
//! ignore-конфігу ([`crate::cursor_ignore`]) і вивід.
//!
//! Єдина МУТУЮЧА команда, портована в цьому зрізі, тож дзеркалиться
//! дослівно:
//! - `--dry-run` — префікс `[dry-run] ` на КОЖНОМУ рядку stdout, включно з
//!   рядком «немає файлів»; на диск нічого не пишеться;
//! - `--root=<шлях>` (саме через `=`, як у JS — форма з пробілом там не
//!   підтримується) — корінь обходу, дефолт cwd;
//! - невідомі аргументи мовчки ігноруються (`parseRenameYamlArgs` не має
//!   гілки помилки) — навмисно НЕ як у `changed-files`, де поверхня нова й
//!   fail-closed;
//! - перейменування — у stdout, помилки — у stderr рядком `  ❌ <текст>`;
//! - exit-код `1` лише за наявності помилок; конфлікт цілі (файл уже існує)
//!   — саме помилка, не мовчазний пропуск.
//!
//! Про self-upgrade `package.json`, який JS-роутер робить перед командою, —
//! доккомент [`crate::skill_cmd`] (та сама свідома розбіжність зрізу).

use std::path::PathBuf;
use std::process::ExitCode;

use crate::{cursor_ignore, paths};

/// Префікс `--root=` (значення склеєне з ключем, як у JS).
const ROOT_PREFIX: &str = "--root=";

/// Розібрані аргументи (дзеркало `parseRenameYamlArgs`).
struct Args {
    dry_run: bool,
    root: PathBuf,
}

/// Плаский розбір: усе, що не `--dry-run`/`--root=…`, ігнорується.
fn parse_args(args: &[String], cwd: &std::path::Path) -> Args {
    let mut parsed = Args {
        dry_run: false,
        root: cwd.to_path_buf(),
    };
    for arg in args {
        if arg == "--dry-run" {
            parsed.dry_run = true;
        } else if let Some(value) = arg.strip_prefix(ROOT_PREFIX) {
            parsed.root = paths::resolve(cwd, value);
        }
    }
    parsed
}

/// Виконує команду: обхід кореня, перейменування, звіт.
pub fn run(args: &[String]) -> ExitCode {
    let cwd = match std::env::current_dir() {
        Ok(cwd) => cwd,
        Err(error) => {
            eprintln!("❌ rename-yaml-extensions: не вдалося визначити робочий каталог: {error}");
            return ExitCode::FAILURE;
        }
    };
    let parsed = parse_args(args, &cwd);
    let label = if parsed.dry_run { "[dry-run] " } else { "" };

    let ignore_globs = cursor_ignore::ignore_globs(&parsed.root);
    let outcome = rules_core::rename_yaml::rename_yaml_extensions(
        &parsed.root,
        parsed.dry_run,
        &ignore_globs,
    );

    let mut out = String::new();
    for (from, to) in &outcome.renamed {
        out.push_str(&format!("{label}{from} → {to}\n"));
    }
    if outcome.renamed.is_empty() && outcome.errors.is_empty() {
        out.push_str(&format!(
            "{label}Немає файлів для перейменування (k8s + .yml → .yaml; .github + .yaml → .yml).\n"
        ));
    }
    print!("{out}");

    for error in &outcome.errors {
        eprintln!("  ❌ {error}");
    }

    if outcome.errors.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parse_args_defaults_to_cwd_and_no_dry_run() {
        let parsed = parse_args(&[], Path::new("/repo"));
        assert!(!parsed.dry_run);
        assert_eq!(parsed.root, Path::new("/repo"));
    }

    #[test]
    fn parse_args_reads_dry_run_and_root_and_ignores_unknown() {
        let args = [
            "--dry-run".to_string(),
            "--root=./sub".to_string(),
            "--що-завгодно".to_string(),
        ];
        let parsed = parse_args(&args, Path::new("/repo"));
        assert!(parsed.dry_run);
        assert_eq!(parsed.root, Path::new("/repo/sub"));
    }

    #[test]
    fn parse_args_accepts_absolute_root() {
        let args = ["--root=/abs/dir".to_string()];
        assert_eq!(
            parse_args(&args, Path::new("/repo")).root,
            Path::new("/abs/dir")
        );
    }
}
