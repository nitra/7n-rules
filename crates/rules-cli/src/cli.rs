//! cspell:ignore ранерів одруківка
//!
//! Єдина граматика argv бінаря `rules-cli` — `clap` (derive).
//!
//! # Чому clap, хоча зріз 3 фази 8 його відкинув
//!
//! Розділ 9 мінідизайну `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`
//! відхилив `clap` з однієї підстави: кожна native-команда мусить byte-exact
//! дзеркалити СВІЙ JS-парсер, а ті різні за контрактом. Рішення **Р11** спеки
//! міграції (`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`) цю
//! підставу зняло: розбіжності JS-парсерів — випадковість JS-епохи, паритет
//! доводиться поведінковими тестами на СПОСТЕРЕЖУВАНІЙ поверхні, а побайтова
//! рівність потрібна лише там, де її споживає хтось зовні (текст
//! `lint --help`, stdout хука, DTO на межі napi/WIT). Отже граматика
//! уніфікується, а розбір бере зрілий крейт (Р11 п. 1).
//!
//! # Що саме уніфіковано
//!
//! - **форми значень.** Скрізь працюють обидві: `--root <шлях>` і
//!   `--root=<шлях>`. Раніше `rename-yaml-extensions` приймав лише форму з
//!   `=`, решта команд — лише форму з пробілом;
//! - **позиція й повтори.** `clap` бере ОСТАННЄ входження прапорця; JS-порти
//!   `ci plan`/`lint` брали перше (`indexOf`). Різниця спостережувана лише на
//!   argv із дубльованим прапорцем — за це не тримається жоден консюмер
//!   (перевірка — блок «Хто це споживає» нижче);
//! - **прапорець без значення** (`--base` останнім аргументом) — помилка
//!   розбору замість мовчазного `null`.
//!
//! # Чого НЕ уніфіковано і чому
//!
//! Політика невідомого аргументу лишається різною — але тепер вона виводиться
//! з ОДНОГО критерію: **хто володіє поверхнею команди**.
//!
//! - `changed-files`, `rename-yaml-extensions`, `tools` — поверхнею володіє
//!   цей бінар (JS-двійника або немає взагалі, або він виводиться разом із
//!   фазою 8). Невідомий аргумент — usage-помилка, код `2`;
//! - `lint`, `hook`, `ci plan`, `skill` — це поверхні, які бінар ЩЕ віддає в
//!   JS-CLI: native-шлях покриває підмножину, решта чесно делегується
//!   ([`crate::js_fallback`]). Зробити їх fail-closed означало б, що argv,
//!   який JS розуміє, впирається в Rust-парсер і НЕ доїжджає до виконавця, —
//!   тобто регресія, а не уніфікація. Тому невідомий аргумент там не помилка,
//!   а сигнал «це не наша частина поверхні» → делегація. Межа зникне разом із
//!   JS-CLI, і тоді ці команди перейдуть у першу групу.
//!
//! # Хто це споживає (перевірено, а не припущено)
//!
//! - `ci plan` — реальний зовнішній споживач: rego-правила сервіс-канону
//!   (`plugins/ci-github/rules/ga/service_deploy_workflow`,
//!   `plugins/ci-azure/rules/azure-pipelines/service_deploy_pipeline`) шукають
//!   у workflow-ах регекс `n-rules ci plan\s+--path\s+(\S+)`, а `.cursor/rules/
//!   n-ga.mdc` документує саме `bunx n-rules ci plan --path run/<service>
//!   --github`. Форма з пробілом лишається валідною — регекс не ламається;
//! - `tools ensure` — `.github/workflows/test.yml` (`rules-cli tools ensure
//!   kubeconform`), позиційний тул без прапорців;
//! - `rename-yaml-extensions --root=<шлях>` — задокументована форма
//!   (`npm/bin/docs/rename-yaml-extensions.md`); лишається робочою як частина
//!   надмножини;
//! - `changed-files` — споживачів поза тестами цього репо немає (команди
//!   немає навіть у JS-CLI).
//!
//! # Довідка
//!
//! `lint --help`/`-h` перехоплюється роутером ДО `clap` і лишається байтовою
//! копією `printLintHelp` (`crate::LINT_HELP`) — це єдина довідка, яку читає
//! хтось зовні. Команди, чию поверхню бінар уже тримає сам, отримали
//! згенеровану `clap`-довідку з українськими заголовками ([`HELP_TEMPLATE`]);
//! делегувальні команди довідку не генерують (`disable_help_flag`), щоб
//! `--help` доїхав до JS-CLI.

use clap::{Args, Parser, Subcommand};

/// Шаблон довідки з українськими заголовками — дефолтний англомовний
/// `Usage:`/`Options:` у продукті, чия мова українська, був би регресією.
pub const HELP_TEMPLATE: &str = "{about}\n\nВикористання: {usage}\n\n{all-args}\n";

/// Заголовок секції прапорців (замість дефолтного `Options`).
const FLAGS_HEADING: &str = "Прапори";

/// Корінь граматики. Довідка й версія вимкнені на цьому рівні: `n-rules
/// --help` — поверхня JS-CLI, вона делегується.
#[derive(Parser, Debug)]
#[command(
    name = "n-rules",
    disable_help_flag = true,
    disable_version_flag = true,
    disable_help_subcommand = true
)]
pub struct Cli {
    /// Розібрана підкоманда.
    #[command(subcommand)]
    pub command: NativeCommand,
}

/// Підкоманди, які бінар розбирає сам. Усе інше (дефолтний sync без
/// підкоманди, legacy-аліаси `lint-*`, `release`, `taze`…) до `clap`
/// не доходить: роутер віддає такий argv у JS-entrypoint незміненим.
/// `docs` — частковий виняток: грамотика тут парситься (як і `skill`), але
/// native-шлях бере лише підмножину (`docs_cmd`).
#[derive(Subcommand, Debug)]
pub enum NativeCommand {
    /// Змінені файли (plumbing).
    ChangedFiles(ChangedFilesArgs),
    /// Перейменування YAML-розширень у k8s/`.github`.
    RenameYamlExtensions(RenameYamlArgs),
    /// Інвентар і провізіонінг зовнішніх тулів.
    Tools(ToolsArgs),
    /// Скіли пакета (нативний лише `list`).
    Skill(SkillArgs),
    /// CI-гейти.
    Ci(CiArgs),
    /// Хук агента (PostToolUse/Stop).
    Hook(HookArgs),
    /// Лінт.
    Lint(LintArgs),
    /// Package knowledge (`crates/rules-docs`, нативний лише
    /// `domains`/`index`/`slice`/`validate` за `--native-docs`).
    Docs(DocsArgs),
    /// Д2: вбудова маніфесту й публікація first-party wasm-плагінів у OCI
    /// (`plugin_cmd`) — поверхні в JS-CLI немає взагалі, команда нативна
    /// цілком.
    Plugin(PluginArgs),
}

/// `changed-files [--cwd <dir>] [--delta] [--base <ref>]`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules changed-files [прапори]",
    next_help_heading = FLAGS_HEADING
)]
pub struct ChangedFilesArgs {
    /// Робочий каталог замість поточного.
    #[arg(long, value_name = "dir")]
    pub cwd: Option<std::path::PathBuf>,
    /// Явна база дельти (fail-closed: нерезолвний ref — помилка).
    #[arg(long, value_name = "ref")]
    pub base: Option<String>,
    /// Дельта від merge-base за Git policy (fail-open на робоче дерево).
    #[arg(long)]
    pub delta: bool,
}

/// `rename-yaml-extensions [--dry-run] [--root <шлях>]`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules rename-yaml-extensions [прапори]",
    next_help_heading = FLAGS_HEADING
)]
pub struct RenameYamlArgs {
    /// Лише показати, нічого не писати на диск.
    #[arg(long)]
    pub dry_run: bool,
    /// Корінь обходу (дефолт — поточний каталог).
    #[arg(long, value_name = "шлях")]
    pub root: Option<String>,
}

/// `tools <list|ensure>`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules tools <list|ensure>",
    subcommand_help_heading = "Підкоманди"
)]
pub struct ToolsArgs {
    /// Підкоманда `tools`.
    #[command(subcommand)]
    pub command: ToolsCommand,
}

/// Підкоманди `tools`.
#[derive(Subcommand, Debug)]
pub enum ToolsCommand {
    /// Інвентар тулів і їхній стан.
    List(ToolsListArgs),
    /// Провізіонінг тулів (або перевірка наявності).
    Ensure(ToolsEnsureArgs),
}

/// `tools list [--json]`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules tools list [--json]",
    next_help_heading = FLAGS_HEADING
)]
pub struct ToolsListArgs {
    /// Машинна форма виводу.
    #[arg(long)]
    pub json: bool,
}

/// `tools ensure [<тул>…] [--check]`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules tools ensure [<тул>…] [--check]",
    next_help_heading = FLAGS_HEADING
)]
pub struct ToolsEnsureArgs {
    /// Лише перевірити наявність, нічого не ставити.
    #[arg(long)]
    pub check: bool,
    /// Конкретні тули; порожньо — увесь реєстр.
    #[arg(value_name = "тул", help_heading = "Аргументи")]
    pub names: Vec<String>,
}

/// `skill <argv…>` — нативний лише `skill list`, решта делегується, тож argv
/// береться як є (включно з прапорцями чужих ранерів).
#[derive(Args, Debug)]
#[command(disable_help_flag = true)]
pub struct SkillArgs {
    /// Усе після `skill`, без розбору.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub rest: Vec<String>,
}

/// `ci <plan|…>`.
#[derive(Args, Debug)]
#[command(disable_help_flag = true)]
pub struct CiArgs {
    /// Підкоманда `ci`.
    #[command(subcommand)]
    pub command: CiCommand,
}

/// Підкоманди `ci`.
#[derive(Subcommand, Debug)]
pub enum CiCommand {
    /// Skip-логіка сервіс-орієнтованого CI-канону.
    Plan(CiPlanArgs),
    /// Будь-яка інша підкоманда — власне повідомлення про помилку, як досі.
    #[command(external_subcommand)]
    Unknown(Vec<String>),
}

/// `ci plan [--cwd <dir>] [--path <dir>] [--base <ref>] [--github|--azure|--json]`.
#[derive(Args, Debug)]
#[command(disable_help_flag = true)]
pub struct CiPlanArgs {
    /// Корінь прогону замість поточного каталогу.
    #[arg(long, value_name = "dir")]
    pub cwd: Option<String>,
    /// Каталог сервісу — звужує файловий набір.
    #[arg(long, value_name = "dir")]
    pub path: Option<String>,
    /// Явна база дельти.
    #[arg(long, value_name = "ref")]
    pub base: Option<String>,
    /// JSON-вивід.
    #[arg(long)]
    pub json: bool,
    /// Job outputs у `$GITHUB_OUTPUT`.
    #[arg(long)]
    pub github: bool,
    /// `##vso`-рядки в stdout.
    #[arg(long)]
    pub azure: bool,
}

/// `hook --post-tool-use | --stop`.
#[derive(Args, Debug)]
#[command(disable_help_flag = true)]
pub struct HookArgs {
    /// PostToolUse: цільові файли беруться зі stdin-JSON.
    #[arg(long)]
    pub post_tool_use: bool,
    /// Stop: робоче дерево vs HEAD.
    #[arg(long)]
    pub stop: bool,
}

/// `lint [rule|concern …] [прапори]` — підмножина поверхні, яку розуміє
/// native-шлях; решта argv доїжджає до JS-CLI делегацією.
#[derive(Args, Debug)]
#[command(disable_help_flag = true)]
pub struct LintArgs {
    /// Корінь прогону замість поточного каталогу.
    #[arg(long, value_name = "path")]
    pub cwd: Option<String>,
    /// Звузити файловий набір до піддиректорії.
    #[arg(long, value_name = "dir")]
    pub path: Option<String>,
    /// Явна база дельти.
    #[arg(long, value_name = "ref")]
    pub base: Option<String>,
    /// Лише full-scope правила по всьому репозиторію.
    #[arg(long)]
    pub repo_wide: bool,
    /// Прогін по всьому репозиторію.
    #[arg(long)]
    pub full: bool,
    /// Розширений вивід.
    #[arg(long)]
    pub verbose: bool,
    /// Лише детекція, без мутацій.
    #[arg(long)]
    pub no_fix: bool,
    /// Увімкнути native-контур детекції (власний прапорець бінаря).
    #[arg(long)]
    pub native_detect: bool,
    /// Запустити native-контур фіксу для одного concern-а (власний прапорець
    /// бінаря): `n-rules lint --native-fix rule/concern`.
    #[arg(long)]
    pub native_fix: bool,
    /// Фільтр за назвою правила чи concern.
    #[arg(value_name = "rule|concern")]
    pub rules: Vec<String>,
}

/// `docs <domains|build|index|slice|validate> …` — нативний лише
/// read-only/без-LLM зріз (`domains`/`index`/`slice`/`validate`), і лише за
/// власним прапорцем `--native-docs`; `build` (LLM-стадії claims/entailment,
/// мовні екстрактори за slot-каналом, якого в контракті ще нема) лишається
/// JS-поверхнею цілком, незалежно від прапорця. Розбір ручний, як у
/// [`SkillArgs`]: JS-CLI сама розбирає свої флаги (`flagValue`) без
/// потреби в `--`, тож дублювати цю граматику в `clap` означало б другий
/// контракт над тим самим argv, який розійдеться на першому ж рідкісному
/// прапорці.
#[derive(Args, Debug)]
#[command(disable_help_flag = true)]
pub struct DocsArgs {
    /// Усе після `docs`, без розбору.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub rest: Vec<String>,
}

/// `plugin <embed-manifest|publish>`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules plugin <embed-manifest|publish>",
    subcommand_help_heading = "Підкоманди"
)]
pub struct PluginArgs {
    /// Підкоманда `plugin`.
    #[command(subcommand)]
    pub command: PluginCommand,
}

/// Підкоманди `plugin`.
#[derive(Subcommand, Debug)]
pub enum PluginCommand {
    /// Вбудувати авторитетний маніфест (identity + `component_profile`) у
    /// вже зібраний Component Model `.wasm`.
    EmbedManifest(PluginEmbedManifestArgs),
    /// Опублікувати вже зманіфестований `.wasm` через direct OCI transport.
    Publish(PluginPublishArgs),
}

/// `plugin embed-manifest --crate-dir <dir> --package <name> --component
/// <шлях> [--out <шлях>]`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules plugin embed-manifest --crate-dir <dir> --package <name> \
                       --component <шлях> [--out <шлях>]",
    next_help_heading = FLAGS_HEADING
)]
pub struct PluginEmbedManifestArgs {
    /// Корінь крейта-гостя (`Cargo.toml`/`plugin.toml` поряд).
    #[arg(long, value_name = "dir")]
    pub crate_dir: std::path::PathBuf,
    /// Короткий package-суфікс (`FIRST_PARTY_WASM_PLUGINS[].name` у
    /// `npm/scripts/build-wasm-plugins.mjs`, напр. `lang-js`).
    #[arg(long, value_name = "name")]
    pub package: String,
    /// Уже зібраний Component Model `.wasm` без маніфесту.
    #[arg(long, value_name = "шлях")]
    pub component: std::path::PathBuf,
    /// Куди писати результат — дефолт перезаписує `--component` на місці.
    #[arg(long, value_name = "шлях")]
    pub out: Option<std::path::PathBuf>,
}

/// `plugin publish --registry <реєстр> --component <шлях> [--dry-run]`.
#[derive(Args, Debug)]
#[command(
    help_template = HELP_TEMPLATE,
    override_usage = "n-rules plugin publish --registry <реєстр> --component <шлях> [--dry-run]",
    next_help_heading = FLAGS_HEADING
)]
pub struct PluginPublishArgs {
    /// Реєстр призначення — обов'язковий, без дефолту (гібридна вимога Д2:
    /// ядро публічно, плагіни можуть бути приватними).
    #[arg(long, value_name = "реєстр")]
    pub registry: String,
    /// Компонент із уже вбудованим маніфестом (`embed-manifest`).
    #[arg(long, value_name = "шлях")]
    pub component: std::path::PathBuf,
    /// Лише порахувати реліз (package/version/digest/reference), не пушити.
    #[arg(long)]
    pub dry_run: bool,
}

/// Розбір argv спільною граматикою для юніт-тестів команд: вони мають
/// перевіряти РЕАЛЬНУ граматику, а не власну копію її правил. Помилка
/// зводиться до [`clap::error::ErrorKind`] — саме він визначає, чи роутер
/// покаже usage-помилку, чи делегує argv у JS-CLI.
#[cfg(test)]
pub fn parse_for_test(argv: &[&str]) -> Result<NativeCommand, clap::error::ErrorKind> {
    Cli::try_parse_from(std::iter::once("n-rules").chain(argv.iter().copied()))
        .map(|cli| cli.command)
        .map_err(|error| error.kind())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Обидві форми значення — скрізь, включно з `--root`, який у JS-порті
    /// приймався ЛИШЕ склеєним через `=`.
    #[test]
    fn value_forms_are_interchangeable_for_rename_yaml_root() {
        for argv in [
            ["rename-yaml-extensions", "--root", "./sub"],
            ["rename-yaml-extensions", "--root=./sub", "--dry-run"],
        ] {
            let NativeCommand::RenameYamlExtensions(parsed) = parse_for_test(&argv).unwrap() else {
                panic!("очікувалась rename-yaml-extensions");
            };
            assert_eq!(parsed.root.as_deref(), Some("./sub"));
        }
    }

    /// Мутуюча команда більше не ковтає невідомий аргумент: у JS `--help`
    /// (як і одруківка в прапорці) мовчки запускав перейменування файлів.
    #[test]
    fn rename_yaml_rejects_unknown_arguments() {
        assert_eq!(
            parse_for_test(&["rename-yaml-extensions", "--що-завгодно"]).unwrap_err(),
            clap::error::ErrorKind::UnknownArgument
        );
    }

    /// Позиційні rule-фільтри `lint` уживаються з прапорцями в будь-якому
    /// порядку — та сама поверхня, що описана в `lint --help`.
    #[test]
    fn lint_mixes_positional_filters_with_flags() {
        let NativeCommand::Lint(parsed) =
            parse_for_test(&["lint", "js", "--no-fix", "text", "--base=origin/main"]).unwrap()
        else {
            panic!("очікувався lint");
        };
        assert_eq!(parsed.rules, vec!["js", "text"]);
        assert!(parsed.no_fix);
        assert_eq!(parsed.base.as_deref(), Some("origin/main"));
    }

    /// `skill` — делегувальна поверхня: argv береться як є, включно з
    /// прапорцями чужих ранерів, які цей бінар не знає.
    #[test]
    fn skill_takes_argv_verbatim() {
        let NativeCommand::Skill(parsed) =
            parse_for_test(&["skill", "pi", "taze", "--whatever"]).unwrap()
        else {
            panic!("очікувався skill");
        };
        assert_eq!(parsed.rest, vec!["pi", "taze", "--whatever"]);
    }

    /// Команда поза граматикою (дефолтний sync, legacy-аліаси `lint-*`,
    /// `release`, `taze`…) — не помилка, а сигнал роутеру делегувати.
    ///
    /// `docs` тут більше НЕМА: воно в граматиці (як `skill`), і його
    /// делегація — рішення `docs_cmd` за підкомандою й `--native-docs`,
    /// не clap-парсера (окремі тести нижче).
    #[test]
    fn foreign_commands_do_not_parse() {
        for argv in [
            &[][..],
            &["release"][..],
            &["taze", "diff"][..],
            &["adr-normalize-local", "--batch", "batch.txt"][..],
            &["lint-ga"][..],
            &["--help"][..],
        ] {
            assert!(parse_for_test(argv).is_err(), "{argv:?}");
        }
    }

    /// `docs` — грамотика бере argv як є (як `skill`): підкоманда і
    /// `--native-docs` розбираються в `docs_cmd`, не тут.
    #[test]
    fn docs_takes_argv_verbatim() {
        let NativeCommand::Docs(parsed) = parse_for_test(&[
            "docs",
            "index",
            "--domain",
            "npm:@7n/rules",
            "--native-docs",
        ])
        .unwrap() else {
            panic!("очікувався docs");
        };
        assert_eq!(
            parsed.rest,
            vec!["index", "--domain", "npm:@7n/rules", "--native-docs"]
        );
    }
}
