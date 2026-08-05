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
//! Зріз 5 обертає МІСТ (Р12 спеки міграції): `lint` стає основним шляхом
//! виконання, а node — дочірнім процесом-виконавцем залишку:
//!
//! - `lint --no-fix` ([`lint_cmd`]) — план, диспатч, сортування, рендер і
//!   exit-код у `rules-core`; концерни з `main.mjs`/policy виконує ОДИН
//!   дочірній node-процес на прогін ([`bridge`]). Шлях НЕ дефолтний
//!   (`--native-detect`/`N_RULES_NATIVE_LINT=1`) і сам делегує все, де
//!   паритет недосяжний — межі й вимірювання в доккоменті [`lint_cmd`].
//!
//! Окремо від зрізів стоїть команда [`tools_cmd`] (`tools list`/`tools
//! ensure`) — у JS-CLI такої поверхні немає взагалі: це компенсація за
//! прибране авто-встановлення тулів у native-концернах (PR #378, мінідизайн
//! `docs/specs/2026-08-04-tools-ensure-design.md`).
//!
//! Решта (включно з дефолтним sync без підкоманди та legacy-аліасами
//! `lint-*`) — транзитна делегація, перелік скорочується по зрізах фази 8.
//!
//! # Про арг-парсинг (ревізія рішення Б, 2026-08-05)
//!
//! Розбір argv тримає `clap` — єдина граматика на всі native-команди
//! ([`cli`]). Підстава зрізу 3 («кожна команда дзеркалить СВІЙ JS-парсер, а
//! вони різні за контрактом») знята рішенням **Р11** спеки міграції: паритет
//! поведінковий, побайтова рівність — лише там, де її споживає хтось зовні.
//! Що уніфіковано, що свідомо лишилось різним і хто це реально споживає —
//! доккомент модуля [`cli`].

mod bridge;
mod changed_files_cmd;
mod ci_cmd;
mod cli;
mod cursor_ignore;
mod git_policy;
mod hook_cmd;
mod js_fallback;
mod lint_cmd;
mod paths;
mod rename_yaml_cmd;
mod skill_cmd;
mod tool_lock;
mod tools_cmd;

use std::env;
use std::process::ExitCode;

use clap::error::{ContextKind, ErrorKind};
use clap::{CommandFactory as _, Parser as _};

use cli::{CiCommand, Cli, NativeCommand, ToolsCommand};

/// Довідка `lint --help` — байт-у-байт вивід `printLintHelp` з
/// `npm/bin/n-rules-cli.mjs` (включно з двома фінальними `\n`: один із
/// template literal, другий від `console.log`). Дрейф ламає parity-тест.
const LINT_HELP: &str = include_str!("lint_help.txt");

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    run(&args)
}

/// Команди, чию argv-поверхню володіє САМЕ цей бінар: невідомий аргумент там
/// — usage-помилка. Решта (`lint`, `hook`, `ci`, `skill`) ще ділить поверхню з
/// JS-CLI, тож нерозібраний argv туди й їде (доккомент [`cli`]).
const OWNED_SURFACES: [&str; 3] = ["changed-files", "rename-yaml-extensions", "tools"];

/// Код виходу usage-помилки — той самий `2`, що вже був у `tools`
/// (і що дає `clap` за замовчуванням).
const EXIT_USAGE: u8 = 2;

/// Роутер argv: `clap`-граматика native-команд ([`cli`]) або делегація в
/// JS-entrypoint. Окремо від `main` — щоб інтеграційні тести й майбутні зрізи
/// бачили одну точку диспатчу.
fn run(args: &[String]) -> ExitCode {
    let Some(head) = args.first().map(String::as_str) else {
        // Дефолтний sync без підкоманди — цілком JS-поверхня.
        return js_fallback::delegate(args);
    };
    // `lint --help`/`-h` — чиста довідка (у JS — без root-guard і мутацій
    // devDependencies), байт-у-байт із `printLintHelp`. Перехоплюється ДО
    // `clap`: це єдина довідка бінаря, яку читає хтось зовні, тож генерувати
    // її не можна (`disable_help_flag` на `lint`).
    if head == "lint" && args[1..].iter().any(|a| a == "--help" || a == "-h") {
        print!("{LINT_HELP}");
        return ExitCode::SUCCESS;
    }

    let parsed =
        Cli::try_parse_from(std::iter::once("n-rules").chain(args.iter().map(String::as_str)));
    match parsed {
        Ok(cli) => dispatch(cli.command, args),
        // Розбір не вдався. Для власної поверхні це помилка користувача, для
        // спільної з JS — ознака, що argv адресований не нам.
        Err(error) if OWNED_SURFACES.contains(&head) => {
            let (path, mut command) = resolve_subcommand(args);
            // `--help` тут не помилка розбору, а запит довідки: вона вимкнена
            // глобально (щоб `--help` чужих поверхонь доїжджав до JS-CLI, а
            // `lint --help` лишався байтовою копією JS-тексту), тож для власних
            // команд повертаємо її точково.
            if args.iter().any(|a| a == "--help" || a == "-h") {
                let _ = command.print_help();
                return ExitCode::SUCCESS;
            }
            eprintln!(
                "❌ {path}: {} — докладніше: n-rules {path} --help",
                describe_parse_error(&error)
            );
            ExitCode::from(EXIT_USAGE)
        }
        Err(_) => js_fallback::delegate(args),
    }
}

/// Проходить argv по дереву підкоманд і віддає найглибшу, до якої дійшов,
/// разом із її людським шляхом (`tools ensure`). Потрібне і для довідки, і
/// для того, щоб помилка називала САМЕ ту команду, у якій спіткнулась.
fn resolve_subcommand(args: &[String]) -> (String, clap::Command) {
    // `build()` до пошуку — саме він розставляє usage-назви з префіксом
    // батька (`n-rules tools ensure`, а не голе `ensure`) і пропагує вглиб
    // вимкнену довідку.
    let mut command = Cli::command();
    command.build();
    let mut path: Vec<&str> = Vec::new();
    for token in args {
        if token.starts_with('-') {
            break;
        }
        let Some(sub) = command.find_subcommand(token).cloned() else {
            break;
        };
        path.push(token);
        command = sub;
    }
    (path.join(" "), command)
}

/// Виконує розібрану команду. `args` — ПОВНИЙ argv: команди з частковим
/// native-шляхом віддають його в JS без змін.
fn dispatch(command: NativeCommand, args: &[String]) -> ExitCode {
    match command {
        NativeCommand::ChangedFiles(parsed) => changed_files_cmd::run(&parsed),
        NativeCommand::RenameYamlExtensions(parsed) => rename_yaml_cmd::run(&parsed),
        // `tools` — НОВА команда, якої в JS-CLI немає взагалі (компенсація за
        // прибране авто-встановлення в native-концернах, PR #378): делегувати
        // її нікуди, вона нативна цілком ([`tools_cmd`]).
        NativeCommand::Tools(parsed) => match parsed.command {
            ToolsCommand::List(list) => tools_cmd::run_list(&list),
            ToolsCommand::Ensure(ensure) => tools_cmd::run_ensure(&ensure),
        },
        // Нативний лише `skill list`; JS дивиться теж тільки на перший
        // аргумент після `skill` (зайві — ігнорує), решта підкоманд —
        // LLM/агентні ранери, делегуються.
        NativeCommand::Skill(parsed) if parsed.rest.first().map(String::as_str) == Some("list") => {
            skill_cmd::run_list()
        }
        NativeCommand::Skill(_) => js_fallback::delegate(args),
        NativeCommand::Ci(parsed) => match parsed.command {
            CiCommand::Plan(plan) => ci_cmd::run_plan(&plan, args),
            CiCommand::Unknown(rest) => {
                ci_cmd::unknown_subcommand(rest.first().map(String::as_str))
            }
        },
        NativeCommand::Hook(parsed) => hook_cmd::run(&parsed, args),
        // Зріз 5 (Р12): `lint` як основний шлях виконання. Native-контур
        // вмикається явно (`--native-detect`/`N_RULES_NATIVE_LINT=1`) і сам
        // делегує все, де паритет недосяжний — доккомент `lint_cmd`.
        NativeCommand::Lint(parsed) => lint_cmd::run(&parsed, &args[1..]),
    }
}

/// Українська однорядкова діагностика замість англомовного рендера `clap`:
/// мова продукту — українська, і решта повідомлень CLI теж українською.
fn describe_parse_error(error: &clap::Error) -> String {
    let arg = || {
        error
            .get(ContextKind::InvalidArg)
            .map_or_else(String::new, ToString::to_string)
    };
    let value = || {
        error
            .get(ContextKind::InvalidValue)
            .map_or_else(String::new, ToString::to_string)
    };
    match error.kind() {
        ErrorKind::UnknownArgument => format!("невідомий аргумент «{}»", arg()),
        ErrorKind::InvalidSubcommand => format!(
            "невідома підкоманда «{}»",
            error
                .get(ContextKind::InvalidSubcommand)
                .map_or_else(String::new, |name| name.to_string())
        ),
        ErrorKind::MissingSubcommand => "потрібна підкоманда".to_string(),
        // Порожнє значення тут означає «прапорець стоїть останнім і значення
        // після нього немає» — саме той випадок, який JS-порти читали як
        // мовчазний `null`.
        ErrorKind::InvalidValue if value().is_empty() => {
            format!("бракує значення для {}", arg())
        }
        ErrorKind::InvalidValue => format!("недопустиме значення «{}» для {}", value(), arg()),
        ErrorKind::MissingRequiredArgument => format!("бракує обовʼязкового {}", arg()),
        // Прапорець без значення (`--base` останнім аргументом) і решта
        // рідкісних видів: іменуємо аргумент, якщо `clap` його назвав.
        _ if !arg().is_empty() => format!("некоректний аргумент «{}»", arg()),
        _ => "не вдалося розібрати аргументи".to_string(),
    }
}
