//! cspell:ignore портовні ранери
//!
//! Rust CLI `@7n/rules` — фаза 8 (інверсія entrypoint), зрізи 1–2.
//!
//! Drop-in обгортка над чинною CLI-поверхнею `npx @7n/rules` (мінідизайн
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`): плаский роутер argv
//! (дзеркало `switch` у `npm/bin/n-rules-cli.mjs`), у якому кожна підкоманда
//! або виконується повністю нативно поверх `rules-core`, або чесно
//! делегується в JS-entrypoint із тим самим argv і exit-кодом
//! ([`js_fallback`]). Native у зрізі 1:
//!
//! - `lint --help` / `lint -h` — статична довідка, byte-exact із
//!   `printLintHelp` (`npm/bin/n-rules-cli.mjs`); еталонний вивід живе в
//!   `src/lint_help.txt` і гейтиться parity-тестом
//!   (`npm/scripts/lib/tests/rules-cli-parity.test.mjs`);
//! - `changed-files` — plumbing-команда поверх готових
//!   `rules_core::changed_files`/`changed_base` ([`changed_files_cmd`]).
//!
//! Зріз 2 додає дві портовні команди класу (б) інвентаризації:
//!
//! - `skill list` — перелік скілів пакета ([`skill_cmd`], ядро —
//!   `rules_core::skills`);
//! - `rename-yaml-extensions` — перейменування k8s/`.github` YAML
//!   ([`rename_yaml_cmd`], ядро — `rules_core::rename_yaml`); перша
//!   МУТУЮЧА native-команда.
//!
//! Решта (включно з дефолтним sync без підкоманди та legacy-аліасами
//! `lint-*`) — транзитна делегація, перелік скорочується по зрізах фази 8.

mod changed_files_cmd;
mod cursor_ignore;
mod git_policy;
mod js_fallback;
mod paths;
mod rename_yaml_cmd;
mod skill_cmd;

use std::env;
use std::process::ExitCode;

/// Довідка `lint --help` — байт-у-байт вивід `printLintHelp` з
/// `npm/bin/n-rules-cli.mjs` (включно з двома фінальними `\n`: один із
/// template literal, другий від `console.log`). Дрейф ламає parity-тест.
const LINT_HELP: &str = include_str!("lint_help.txt");

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    run(&args)
}

/// Роутер argv: native-команди зрізів 1–2 або делегація в JS-entrypoint.
/// Окремо від `main` — щоб інтеграційні тести й майбутні зрізи бачили
/// одну точку диспатчу.
fn run(args: &[String]) -> ExitCode {
    match args.first().map(String::as_str) {
        Some("changed-files") => changed_files_cmd::run(&args[1..]),
        Some("rename-yaml-extensions") => rename_yaml_cmd::run(&args[1..]),
        // Нативний лише `skill list`; JS дивиться теж тільки на перший
        // аргумент після `skill` (зайві — ігнорує), решта підкоманд —
        // LLM/агентні ранери, делегуються.
        Some("skill") if args.get(1).map(String::as_str) == Some("list") => skill_cmd::run_list(),
        // `lint --help`/`-h` — чиста довідка (у JS — без root-guard і
        // мутацій devDependencies), перший повністю нативний шлях реальної
        // чинної поверхні. Будь-який інший `lint` — делегація.
        Some("lint") if args[1..].iter().any(|a| a == "--help" || a == "-h") => {
            print!("{LINT_HELP}");
            ExitCode::SUCCESS
        }
        _ => js_fallback::delegate(args),
    }
}
