//! cspell:ignore портовні портовна ранери
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
//!   `rules_core::skills`); згодом міграція `agent-skill` (§3.3 спеки
//!   ACP-only) додала сюди й `skill <id>` та `skill <runner> <id>`;
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
//! - `hook --post-tool-use` / `--stop` ([`hook_cmd`]) — від початку native
//!   лише там, де гілка не доходила до `detectAll`. Вимірювання зрізу 4
//!   спростувало підставу цього обмеження (старт JS-рантайму — <3 %
//!   латентності хука, доккомент [`hook_cmd`]), але власник план у §7
//!   (`docs/specs/2026-08-31-full-rust-migration-plan.md`) усе одно ухвалив
//!   добити порт — не заради швидкості, а тому що критерій завершення §1.1
//!   лишається бінарним («нуль JS»), і команда, що лишається за
//!   [`js_fallback`], зробила б його недосяжним. `hook` тепер портована
//!   ЦІЛКОМ ([`hook_cmd`]) і НЕ фігурує в жодній гілці делегації нижче.
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
//! Так само окремо — [`git_reconcile_cmd`] (`git-reconcile inventory|cleanup|
//! gc`, §2.136 реєстру): ефекти скіла `git-reconcile`, чий 3 484-рядковий
//! JS-оркестратор (`skills/git-reconcile/js/orchestrate.mjs`) знесено за тим
//! самим патерном, що вже довів себе на `taze` (§2.125) — `ORCHESTRATED_SKILLS`
//! ([`skill_cmd`]) тепер порожній.
//!
//! Решта (включно з дефолтним sync без підкоманди та legacy-аліасами
//! `lint-*`) — транзитна делегація, перелік скорочується по зрізах фази 8.
//!
//! # Де межа native-шляху зупиняється (інвентаризація після зрізу 7)
//!
//! Без native-шляху лишились рівно пʼять поверхонь JS-switch-а, і **жодна з
//! них не портується** — не через обсяг, а за класом (докладна класифікація і
//! виміри — §3.5 реєстру `docs/plans/2026-08-05-open-questions-register.md`):
//!
//! - `docs build` — **LLM-орієнтований**: латентність тримає модель, а не
//!   рантайм. Той самий урок, що вже виміряний на `hook`. (Сусідній
//!   `adr-normalize-local` цю межу ПОКИНУВ: спека ACP-only портувала весь
//!   конвеєр — [`adr_cmd`], ядро в `crates/rules-adr`);
//! - `docs domains|index|slice|validate` — портовна read-only логіка, але її
//!   кличе агент між LLM-ходами: стеля виграшу ≈ 70 мс;
//! - `taze diff` — не логіка, а dispatch слоту `taze.provider@1` у
//!   `@7n/rules-lang-js`: питання контракту плагінів, не фази 8;
//! - `release` і дефолтний sync — портовні, але `npm/package.json#bin` веде в
//!   JS-entrypoint, тож їхній native-шлях ніхто не виконував би до
//!   bin-launcher-а (зріз 6).
//!
//! Контракт бінаря щодо цих пʼяти — довезти argv незміненим і повернути
//! exit-код; він закріплений тестом `commands_kept_in_js_delegate_argv_verbatim`
//! (`tests/cli.rs`) і граматичним `foreign_commands_do_not_parse` ([`cli`]).
//!
//! # Про арг-парсинг (ревізія рішення Б, 2026-08-05)
//!
//! Розбір argv тримає `clap` — єдина граматика на всі native-команди
//! ([`cli`]). Підстава зрізу 3 («кожна команда дзеркалить СВІЙ JS-парсер, а
//! вони різні за контрактом») знята рішенням **Р11** спеки міграції: паритет
//! поведінковий, побайтова рівність — лише там, де її споживає хтось зовні.
//! Що уніфіковано, що свідомо лишилось різним і хто це реально споживає —
//! доккомент модуля [`cli`].

mod adr_cmd;
mod auto_worktree;
mod bridge;
mod changed_files_cmd;
mod ci_cmd;
mod cli;
mod cursor_ignore;
mod docs_cmd;
mod fix_cmd;
mod git_policy;
mod git_reconcile_cmd;
mod hook_cmd;
mod js_fallback;
mod lint_cmd;
mod lint_full_lock;
mod lint_scheduler;
mod lock_sys;
mod paths;
mod plugin_cmd;
mod rename_yaml_cmd;
mod skill_cmd;
mod tool_lock;
mod tools_cmd;

use std::env;
use std::process::ExitCode;

use clap::error::{ContextKind, ErrorKind};
use clap::{CommandFactory as _, Parser as _};

use cli::{CiCommand, Cli, NativeCommand, PluginCommand, ToolsCommand};

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
const OWNED_SURFACES: [&str; 5] = [
    "changed-files",
    "rename-yaml-extensions",
    "tools",
    "plugin",
    "git-reconcile",
];

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
    // `adr-normalize-local` — нативний конвеєр (порт §3.3 спеки ACP-only);
    // перехоплюється ДО clap: команда не в граматиці native-поверхонь, а
    // делегування в JS уже не має сенсу — двигун конвеєра тепер тут.
    if head == "adr-normalize-local" {
        return adr_cmd::run(&args[1..]);
    }
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

/// Чи бере native-шлях гілку `skill <runner> <id> …`.
///
/// Один виняток лишається за JS: `claude` — legacy-ім'я, якого JS-раннером уже
/// НЕ вважає (`RUNNERS` там — `{pi, cursor, codex}`): віддаємо його туди, щоб
/// JS лишався власником свого usage-повідомлення на це ім'я.
/// `skill_cmd::ORCHESTRATED_SKILLS` тепер порожній (§2.136, `taze` пішов
/// раніше — §2.125): `git-reconcile` більше не потребує окремого винятку й
/// іде native-шляхом нижче, як будь-який інший скіл — LLM-хід агент виконує
/// сам, крок за кроком, за текстом `SKILL.md`, а не одним вкладеним
/// ACP-викликом.
fn skill_runner_is_native(rest: &[String]) -> bool {
    let (Some(runner), Some(skill)) = (rest.first(), rest.get(1)) else {
        return false;
    };
    matches!(runner.as_str(), "pi" | "cursor" | "codex") && !skill_cmd::is_orchestrated(skill)
}

/// Чи бере native-шлях гілку `skill <id> …` (друк промпта без LLM).
///
/// Ім'я раннера сюди не потрапляє: його забирає гілка вище, а legacy-`claude`
/// свідомо лишається делегованим цілком (див. вище).
fn skill_prompt_is_native(rest: &[String]) -> bool {
    rest.first().is_some_and(|first| {
        !matches!(
            first.as_str(),
            "pi" | "cursor" | "codex" | "claude" | "list"
        )
    })
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
        // `skill list` — перелік; `skill <runner> <id>` — ACP-раннер;
        // `skill <id>` — друк промпта. Делегованою лишається рівно ОДНА
        // гілка (§2.136 спорожнила `ORCHESTRATED_SKILLS`): legacy-ім'я
        // `claude`, чиє usage-повідомлення лишається за JS.
        NativeCommand::Skill(parsed) if parsed.rest.first().map(String::as_str) == Some("list") => {
            skill_cmd::run_list()
        }
        NativeCommand::Skill(parsed) if skill_runner_is_native(&parsed.rest) => {
            skill_cmd::run_runner(
                &parsed.rest[0],
                &parsed.rest[1],
                &parsed.rest[2..].join(" "),
            )
        }
        NativeCommand::Skill(parsed) if skill_prompt_is_native(&parsed.rest) => {
            skill_cmd::run_prompt(&parsed.rest[0], &parsed.rest[1..].join(" "))
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
        // `docs` — крок 2 плану повного переходу на Rust: `rules-docs` мав
        // увесь потрібний код, підключення тут — `docs_cmd`. Native-шлях
        // бере лише `domains`/`index`/`slice`/`validate` за `--native-docs`;
        // `build` лишається JS-поверхнею цілком (доккомент `docs_cmd`).
        NativeCommand::Docs(parsed) => docs_cmd::run(&parsed, args),
        // Д2: жодного JS-двійника — власна поверхня цілком, нативна
        // безумовно ([`plugin_cmd`]).
        NativeCommand::Plugin(parsed) => match parsed.command {
            PluginCommand::EmbedManifest(embed) => plugin_cmd::run_embed_manifest(&embed),
            PluginCommand::Publish(publish) => plugin_cmd::run_publish(&publish),
            PluginCommand::Fetch(fetch) => plugin_cmd::run_fetch(&fetch),
        },
        // Ефекти скіла `git-reconcile` (§2.136) — жодного JS-двійника,
        // нативна безумовно ([`git_reconcile_cmd`]).
        NativeCommand::GitReconcile(parsed) => match parsed.command {
            cli::GitReconcileCommand::Inventory(inventory) => {
                git_reconcile_cmd::run_inventory(&inventory)
            }
            cli::GitReconcileCommand::Cleanup(cleanup) => git_reconcile_cmd::run_cleanup(&cleanup),
            cli::GitReconcileCommand::Gc(gc) => git_reconcile_cmd::run_gc(&gc),
        },
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Межа native/JS для гілки `skill <runner> <id>` — саме те рішення, яке
    /// процесним тестом не перевірити: він спавнив би справжнього ACP-агента.
    ///
    /// `ORCHESTRATED_SKILLS` тепер порожній (§2.136 — `git-reconcile` пішов
    /// за `taze`, §2.125): жоден скіл більше не потребує винятку "конвеєр
    /// лишається в JS", тож усі йдуть нативно.
    #[test]
    fn runner_branch_is_native_for_every_skill_except_claude() {
        let args = |parts: &[&str]| parts.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();

        for runner in ["pi", "cursor", "codex"] {
            assert!(
                skill_runner_is_native(&args(&[runner, "lint"])),
                "{runner}: звичайний скіл має йти нативно"
            );
            for decomposed in ["taze", "n-taze", "git-reconcile", "n-git-reconcile"] {
                assert!(
                    skill_runner_is_native(&args(&[runner, decomposed])),
                    "{runner} {decomposed}: розібраний скіл (§2.125/§2.136) — звичайний native-хід, без JS-конвеєра"
                );
            }
        }

        assert!(
            !skill_runner_is_native(&args(&["claude", "lint"])),
            "deprecated раннер Rust не моделює"
        );
        assert!(
            !skill_runner_is_native(&args(&["pi"])),
            "без імені скіла гілка не наша — usage друкує JS"
        );
    }

    /// `ORCHESTRATED_SKILLS` спорожнів разом із декомпозицією `git-reconcile`
    /// (§2.136) — прямо на предикаті, а не лише через маршрутизацію вище.
    #[test]
    fn no_skill_is_orchestrated_anymore() {
        for skill in ["git-reconcile", "n-git-reconcile", "taze", "lint"] {
            assert!(
                !skill_cmd::is_orchestrated(skill),
                "{skill}: ORCHESTRATED_SKILLS має бути порожнім (§2.136)"
            );
        }
    }

    /// Гілка `skill <id>` бере все, що не є іменем раннера чи `list`.
    #[test]
    fn prompt_branch_takes_bare_skill_ids_only() {
        let arg = |s: &str| vec![s.to_string()];

        assert!(skill_prompt_is_native(&arg("lint")));
        assert!(
            skill_prompt_is_native(&arg("n-git-reconcile")),
            "будь-який скіл БЕЗ раннера — це лише друк промпта, LLM не викликається"
        );
        for reserved in ["pi", "cursor", "codex", "claude", "list"] {
            assert!(
                !skill_prompt_is_native(&arg(reserved)),
                "{reserved} — не id скіла"
            );
        }
        assert!(!skill_prompt_is_native(&[]), "порожній argv — usage у JS");
    }
}
