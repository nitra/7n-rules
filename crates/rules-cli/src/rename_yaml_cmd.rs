//! cspell:ignore одруківка
//!
//! Native-команда `rename-yaml-extensions` — порт CLI-шару
//! `npm/bin/rename-yaml-extensions.mjs` (зріз 2 фази 8,
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`). Сама логіка —
//! [`rules_core::rename_yaml`]; тут лише розбір аргументів, читання
//! ignore-конфігу ([`crate::cursor_ignore`]) і вивід.
//!
//! Єдина МУТУЮЧА команда зрізу, тож поведінка дзеркалиться дослівно:
//! - `--dry-run` — префікс `[dry-run] ` на КОЖНОМУ рядку stdout, включно з
//!   рядком «немає файлів»; на диск нічого не пишеться;
//! - `--root <шлях>` / `--root=<шлях>` — корінь обходу, дефолт cwd;
//! - перейменування — у stdout, помилки — у stderr рядком `  ❌ <текст>`;
//! - exit-код `1` лише за наявності помилок; конфлікт цілі (файл уже існує)
//!   — саме помилка, не мовчазний пропуск.
//!
//! Argv розбирає спільна `clap`-граматика ([`crate::cli::RenameYamlArgs`]).
//! Дві свідомі розбіжності з JS-двійником (`parseRenameYamlArgs`), обидві —
//! наслідок Р11:
//! - JS приймав `--root` ЛИШЕ склеєним через `=`; тепер працюють обидві
//!   форми — надмножина, задокументована форма не ламається;
//! - JS мовчки ковтав будь-який невідомий аргумент, тобто `--help` чи
//!   одруківка в прапорці тихо запускали МУТАЦІЮ дерева. Тепер це
//!   usage-помилка (код `2`), а `--help` друкує довідку.
//!
//! Про self-upgrade `package.json`, який JS-роутер робить перед командою, —
//! доккомент [`crate::skill_cmd`] (та сама свідома розбіжність зрізу).

use std::process::ExitCode;

use crate::cli::RenameYamlArgs;
use crate::{cursor_ignore, paths};

/// Виконує команду: обхід кореня, перейменування, звіт.
pub fn run(parsed: &RenameYamlArgs) -> ExitCode {
    let cwd = match std::env::current_dir() {
        Ok(cwd) => cwd,
        Err(error) => {
            eprintln!("❌ rename-yaml-extensions: не вдалося визначити робочий каталог: {error}");
            return ExitCode::FAILURE;
        }
    };
    let root = parsed
        .root
        .as_deref()
        .map_or_else(|| cwd.clone(), |value| paths::resolve(&cwd, value));
    let label = if parsed.dry_run { "[dry-run] " } else { "" };

    let ignore_globs = cursor_ignore::ignore_globs(&root);
    let outcome =
        rules_core::rename_yaml::rename_yaml_extensions(&root, parsed.dry_run, &ignore_globs);

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
