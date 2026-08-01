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
//! Зріз 3 додає read-only гейт-команду CI:
//!
//! - `ci plan` — skip-логіка сервіс-орієнтованого CI-канону ([`ci_cmd`],
//!   ядро — `rules_core::{ci_plan, config, concern_meta}`). Native-шлях
//!   вмикається лише там, де він доказово byte-exact (немає плагінів і
//!   rule-level `applies`-гейтів), інакше команда чесно делегується —
//!   докладно в доккоменті [`ci_cmd`].
//!
//! Зріз 4 бере найгарячішу поверхню продукту — `hook` (стріляє після кожної
//! правки файлу агентом):
//!
//! - `hook --post-tool-use` / `--stop` ([`hook_cmd`]) — native лише там, де
//!   гілка не доходить до `detectAll` (валідація режиму й payload зі stdin,
//!   з якого не дістається жодного файлу); решта чесно делегується, причому
//!   з переграним stdin. Межа й ЇЇ ЦІНА ЗА ГОДИННИКОМ — у доккоменті
//!   [`hook_cmd`]: вимірювання показало, що старт JS-рантайму це <3 %
//!   латентності хука, тож обіцяний планом виграш зʼявиться лише разом із
//!   портом самих детекторів, а не від інверсії entrypoint.
//!
//! Решта (включно з дефолтним sync без підкоманди та legacy-аліасами
//! `lint-*`) — транзитна делегація, перелік скорочується по зрізах фази 8.
//!
//! # Про арг-парсинг (ревізія рішення Б, зріз 3)
//!
//! Розбір argv лишається РУЧНИМ, без `clap` — свідомо переглянуто на цьому
//! зрізі (розділ 9 мінідизайну). Коротко: кожна native-команда мусить
//! byte-exact дзеркалити СВІЙ JS-парсер, а вони різні за контрактом
//! (`changed-files` — fail-closed на невідомий аргумент,
//! `rename-yaml-extensions` — мовчазне ігнорування і `--root=` лише через
//! `=`, `ci plan` — `indexOf`-семантика `valueOf`), тож єдина граматика
//! `clap` була б регресією паритету, а її головна перевага —
//! автогенеровані help/usage/error — тут заборонена (довідка байтово
//! успадкована з JS).

mod changed_files_cmd;
mod ci_cmd;
mod cursor_ignore;
mod git_policy;
mod hook_cmd;
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
        // Повний argv (з `ci`) — щоб делегація непокритих native-шляхом
        // випадків віддала його в JS без змін (доккомент `ci_cmd`).
        Some("ci") => ci_cmd::run(args),
        Some("rename-yaml-extensions") => rename_yaml_cmd::run(&args[1..]),
        // Повний argv (з `hook`) — делегація гілок, недосяжних для порту,
        // віддає його в JS без змін (доккомент `hook_cmd`).
        Some("hook") => hook_cmd::run(args),
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
