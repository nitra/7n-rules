//! Native-команда `ci plan` — порт `runCiPlanCli`/`computeCiPlan`
//! (`npm/scripts/lib/lint-surface/ci-plan.mjs`) поверх
//! [`rules_core::ci_plan`], [`rules_core::config`] і
//! [`rules_core::concern_meta`] (зріз 3 фази 8,
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! # Межа native-шляху (свідома, fail-safe в бік делегації)
//!
//! `loadEnabledLintRules` у JS складається з чотирьох кроків, і native-порту
//! наразі недосяжний ОДИН із них:
//!
//! - **rules-каталоги плагінів** (`resolveRulesDirs` → `resolveSlotGraph` →
//!   `resolvePlugins`) — автодетект плагінів за станом репо, читання
//!   маніфестів `n-rules` і envelope-валідація slot-графа: ~1200 рядків JS,
//!   окремий зріз.
//!
//! **Rule-level гейт більше в цьому списку не значиться.** Він був другим
//! блокером, доки лишався виконуваним модулем `<rule>/applies/main.mjs`; зріз 3
//! контракту плагінів v3.1 (`docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`,
//! рішення Д) зробив його ДЕКЛАРАТИВНИМ предикатом у `main.json:applies`, і
//! [`rules_core::rule_applies`] обчислює його нативно — без JS-рантайму й без
//! інстанціації wasm-компонента. Правило, яке лишило гейт у JS (літерал
//! `"dynamic"` — аварійний клапан контракту — або старий `applies/main.mjs` без
//! поля в `main.json`), і далі змушує делегувати; але тепер це властивість
//! КОНКРЕТНОГО правила, а не самого факту наявності гейтів у дереві.
//!
//! Тому native-шлях вмикається там, де плагіни доказово порожні (перевірка
//! дзеркалить `resolvePlugins`: пакет має лежати в `<cwd>/node_modules/<name>`
//! — вгору дерево він не шукає) і кожен гейт у rules-каталозі ядра резолвиться
//! нативно. Інакше (а також коли конфіг битий, предикат битий, чи корінь пакета
//! не резолвиться) команда ЧЕСНО делегується в JS — byte-exact за конструкцією,
//! без мовчазної розбіжності. Зокрема, битий `applies` навмисно НЕ отримує
//! власного native-тексту помилки: делегація віддає його JS, чиє повідомлення
//! і є каноном.
//!
//! # Парсер прапорців
//!
//! Розбір прапорців дослівно повторює JS: `valueOf(flag)` шукає ПЕРШЕ
//! входження й бере наступний елемент (прапорець останнім аргументом →
//! значення відсутнє, як `rest[i+1] ?? null`), невідомі аргументи мовчки
//! ігноруються, `--json`/`--github`/`--azure` перевіряються через
//! `includes` у тому самому порядку пріоритету.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rules_core::ci_plan::{
    build_ci_plan, compute_active_domains, render_azure_lines, render_github_lines, render_human,
    render_json, TEST_FILE_GLOBS,
};
use rules_core::concern_meta::{list_detector_concerns, subdirectory_names, ConcernMeta};
use rules_core::config::{is_rule_enabled, read_n_rules_config_lite, LiteConfig};
use rules_core::lint_plan::match_lint_globs;
use rules_core::locale::locale_compare;
use rules_core::rule_applies::{read_rule_applies, rule_applies, AppliesSpec};

use crate::{cursor_ignore, git_policy, js_fallback, paths};

/// Розібрані аргументи `ci plan`.
struct Args {
    /// Значення `--cwd` як його ввів користувач — саме воно потрапляє в текст
    /// помилок `--path` (JS інтерполює той самий сирий рядок).
    cwd_display: String,
    /// Абсолютний корінь прогону.
    cwd: PathBuf,
    /// Значення `--path`.
    path_arg: Option<String>,
    /// Значення `--base`.
    base_ref: Option<String>,
    /// Наявність `--json`/`--github`/`--azure` (порядок пріоритету — той-таки).
    json: bool,
    github: bool,
    azure: bool,
}

/// Виконує `ci <subcommand>`: `args` — ПОВНИЙ argv (з `ci` на нульовій
/// позиції), щоб делегація віддала його в JS без змін.
pub fn run(args: &[String]) -> ExitCode {
    let after_ci = &args[1..];
    let sub = after_ci.first().map(String::as_str);
    if sub != Some("plan") {
        eprintln!(
            "❌ Невідома підкоманда ci: {} — очікується: n-rules ci plan [--path <dir>] [--base <ref>] [--github|--azure|--json]",
            sub.unwrap_or("(порожньо)")
        );
        return ExitCode::FAILURE;
    }

    let Ok(process_cwd) = std::env::current_dir() else {
        return js_fallback::delegate(args);
    };
    let parsed = parse_args(&after_ci[1..], &process_cwd);

    // Конфіг битий / корінь пакета не резолвиться / плагіни в грі — усе це
    // native-шлях не відтворює byte-exact, тож делегуємо (доккомент модуля).
    let Ok(config) = read_n_rules_config_lite(&parsed.cwd) else {
        return js_fallback::delegate(args);
    };
    let Ok(rules_dir) = js_fallback::package_root(&process_cwd).map(|root| root.join("rules"))
    else {
        return js_fallback::delegate(args);
    };
    if !native_eligible(&parsed.cwd, &config, &rules_dir) {
        return js_fallback::delegate(args);
    }

    match plan_and_render(&parsed, &config, &rules_dir) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

/// Порт розбору аргументів `runCiPlanCli` (семантика — доккомент модуля).
fn parse_args(rest: &[String], process_cwd: &Path) -> Args {
    let value_of = |flag: &str| -> Option<String> {
        rest.iter()
            .position(|arg| arg == flag)
            .and_then(|index| rest.get(index + 1))
            .cloned()
    };
    let cwd_display = value_of("--cwd").unwrap_or_else(|| process_cwd.display().to_string());
    Args {
        cwd: paths::resolve(process_cwd, &cwd_display),
        cwd_display,
        path_arg: value_of("--path"),
        base_ref: value_of("--base"),
        json: rest.iter().any(|arg| arg == "--json"),
        github: rest.iter().any(|arg| arg == "--github"),
        azure: rest.iter().any(|arg| arg == "--azure"),
    }
}

/// Чи можна виконати команду нативно без розбіжності з JS (доккомент модуля).
fn native_eligible(cwd: &Path, config: &LiteConfig, rules_dir: &Path) -> bool {
    if config.plugins.as_ref().is_some_and(|declared| {
        declared
            .iter()
            .any(|name| is_installed_package(cwd, Path::new(name)))
    }) {
        return false;
    }
    if has_installed_first_party_plugin(cwd) {
        return false;
    }
    // Гейти правил: нативно резолвиться `main.json:applies` (декларативний
    // предикат або відсутність поля). `"dynamic"`, старий `applies/main.mjs`
    // без поля і битий предикат — усі троє дають `Err`, тобто делегацію.
    subdirectory_names(rules_dir)
        .iter()
        .all(|rule| natively_gated(&rules_dir.join(rule)))
}

/// Чи резолвиться rule-level гейт правила без JS.
fn natively_gated(rule_dir: &Path) -> bool {
    matches!(
        read_rule_applies(rule_dir),
        Ok(AppliesSpec::Always | AppliesSpec::Declarative(_))
    )
}

/// Чи лежить пакет у `<cwd>/node_modules/<name>` (той самий шлях, яким
/// `resolvePlugins` вирішує «плагін доступний»).
fn is_installed_package(cwd: &Path, name: &Path) -> bool {
    cwd.join("node_modules")
        .join(name)
        .join("package.json")
        .is_file()
}

/// Чи встановлено хоч один first-party плагін `@7n/rules-*` — консервативна
/// надмножина того, що може принести автодетект `detectPluginsFromRepo`
/// (усі його кандидати — пакети саме цієї конвенції).
fn has_installed_first_party_plugin(cwd: &Path) -> bool {
    let scope = cwd.join("node_modules").join("@7n");
    let Ok(entries) = std::fs::read_dir(scope) else {
        return false;
    };
    entries.filter_map(Result::ok).any(|entry| {
        entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with("rules-"))
            && entry.path().join("package.json").is_file()
    })
}

/// Обчислює план і друкує його у вибраному форматі (порт хвоста
/// `runCiPlanCli`). Помилка — готовий рядок для stderr.
fn plan_and_render(args: &Args, config: &LiteConfig, rules_dir: &Path) -> Result<(), String> {
    let (by_rule, enabled) = load_enabled_lint_rules(rules_dir, config, &args.cwd);

    let changed: Option<Vec<String>> = if let Some(path_arg) = args.path_arg.as_deref() {
        collect_path_scoped_changed_files(args, path_arg)?
    } else {
        let base = resolve_base(args)?;
        match base {
            Some(sha) => Some(collect_since(&args.cwd, &sha)?),
            None => None,
        }
    };

    let active = compute_active_domains(&by_rule, &enabled, changed.as_deref().unwrap_or(&[]));
    let subtree = collect_path_scoped_files(args, args.path_arg.as_deref().unwrap_or("."))?;
    let globs: Vec<String> = TEST_FILE_GLOBS.iter().map(|g| (*g).to_string()).collect();
    let has_tests = !match_lint_globs(&globs, &subtree).is_empty();

    // Порядок як у JS: колізія ключів перевіряється у `computeCiPlan`, тобто
    // ДО рендера, але ПІСЛЯ збору файлових наборів.
    let plan = build_ci_plan(
        args.path_arg.clone(),
        changed.as_deref(),
        &active,
        has_tests,
    )?;

    if !plan.base_resolved {
        eprintln!(
            "⚠️ ci plan: база дельти не резолвиться (немає main/origin/main чи --base-ref у клоні) — fail-open: усі домени true. У CI перевірте fetch-depth/git fetch і прапорець --base."
        );
    }

    if args.json {
        println!("{}", render_json(&plan));
        return Ok(());
    }
    if args.github {
        let out_file = std::env::var("GITHUB_OUTPUT")
            .ok()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "❌ ci plan --github: змінна середовища GITHUB_OUTPUT відсутня (запуск поза GitHub Actions?)".to_string()
            })?;
        append_lines(&out_file, &render_github_lines(&plan))?;
        print!("{}", render_human(&plan));
        return Ok(());
    }
    if args.azure {
        println!("{}", render_azure_lines(&plan).join("\n"));
    }
    print!("{}", render_human(&plan));
    Ok(())
}

/// Дописує рядки у файл `$GITHUB_OUTPUT` (`appendFileSync` + фінальний `\n`).
fn append_lines(path: &str, lines: &[String]) -> Result<(), String> {
    use std::io::Write as _;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("❌ ci plan --github: не вдалося відкрити {path}: {error}"))?;
    writeln!(file, "{}", lines.join("\n"))
        .map_err(|error| format!("❌ ci plan --github: не вдалося записати {path}: {error}"))
}

/// Discovery-фасад `loadEnabledLintRules` для випадку «плагінів немає»:
/// концерни ядра з lint-поверхнею, відфільтровані rule-level гейтом, + набір
/// активних правил. Порядок кроків — той самий, що в JS: спершу capabilities,
/// потім `applies`, і лише потім `enabledRuleIds`.
fn load_enabled_lint_rules(
    rules_dir: &Path,
    config: &LiteConfig,
    cwd: &Path,
) -> (BTreeMap<String, Vec<ConcernMeta>>, BTreeSet<String>) {
    let rule_dir_names = subdirectory_names(rules_dir);
    let mut by_rule: BTreeMap<String, Vec<ConcernMeta>> = BTreeMap::new();
    for rule in &rule_dir_names {
        // Порт `filterByRuleApplies`. `Err` тут неможливий: [`native_eligible`]
        // уже відсіяв дерево з гейтом, що вимагає JS, — але трактуємо його як
        // «правило не проходить», щоб інваріант не тримався на чесному слові.
        if !matches!(rule_applies(&rules_dir.join(rule), cwd), Ok(true)) {
            continue;
        }
        // Capability-фільтр: активних capabilities без плагінів немає, тож
        // концерни з `requires.capability` відпадають усі до одного.
        let concerns: Vec<ConcernMeta> = list_detector_concerns(&rules_dir.join(rule))
            .into_iter()
            .filter(|concern| concern.requires_capability.is_none())
            .collect();
        if !concerns.is_empty() {
            by_rule.insert(rule.clone(), concerns);
        }
    }

    if !config.exists {
        return (by_rule, BTreeSet::new());
    }
    warn_about_rules_without_concerns(&by_rule, config, &rule_dir_names);
    let enabled = by_rule
        .keys()
        .filter(|id| is_rule_enabled(config, id))
        .cloned()
        .collect();
    (by_rule, enabled)
}

/// Порт `warnAboutRulesWithoutConcerns`: правило з конфігу, якого немає
/// ЖОДНИМ каталогом (не плутати з «каталог є, але без lint-поверхні»).
fn warn_about_rules_without_concerns(
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
    config: &LiteConfig,
    rule_dir_names: &[String],
) {
    for rule_id in &config.rules {
        if by_rule.contains_key(rule_id) || rule_dir_names.contains(rule_id) {
            continue;
        }
        eprintln!(
            "⚠️  .n-rules.json: правило \"{rule_id}\" не знайдено НІ В ОДНОМУ з rulesDirs (ні в ядрі, ні в підключених плагінах \"plugins\") — перевірки для нього НЕ виконуються. Якщо правило нещодавно переїхало в окремий плагін, додай відповідний пакет у \"plugins\" (і в devDependencies)."
        );
    }
}

/// Резолв бази дельти за Git policy (порт `resolveChangedBase`).
fn resolve_base(args: &Args) -> Result<Option<String>, String> {
    let candidates = git_policy::integration_candidates(&args.cwd);
    rules_core::changed_base::resolve_changed_base(&args.cwd, &candidates, args.base_ref.as_deref())
        .map_err(|error| error.to_string())
}

/// `collectChangedFilesSince` — fail-closed на недосяжній базі.
fn collect_since(cwd: &Path, sha: &str) -> Result<Vec<String>, String> {
    rules_core::changed_files::collect_changed_files_since(cwd, Some(sha))
        .map_err(|error| error.to_string())
}

/// Порт `collectPathScopedChangedFiles`: перетин git-дельти з піддеревом
/// `--path`, мінус `.n-rules.json:ignore`. `Ok(None)` — база не резолвиться.
fn collect_path_scoped_changed_files(
    args: &Args,
    path_arg: &str,
) -> Result<Option<Vec<String>>, String> {
    let target = resolve_and_assert_path_dir(args, path_arg)?;
    let Some(sha) = resolve_base(args)? else {
        return Ok(None);
    };
    let changed = collect_since(&args.cwd, &sha)?;

    let rel_dir = paths::relative_posix(&args.cwd, &target);
    let prefix = if rel_dir.is_empty() {
        String::new()
    } else {
        format!("{rel_dir}/")
    };
    // git уже поважає .gitignore; `.n-rules.json:ignore` застосовуємо явно.
    let ignore_prefixes: Vec<String> = cursor_ignore::ignore_paths(&args.cwd)
        .iter()
        .map(|path| paths::relative_posix(&args.cwd, path))
        .filter(|rel| !rel.is_empty() && !rel.starts_with(".."))
        .map(|rel| format!("{rel}/"))
        .collect();

    let mut files: Vec<String> = changed
        .into_iter()
        .filter(|file| file.starts_with(&prefix))
        .filter(|file| {
            ignore_prefixes
                .iter()
                .all(|ignored| !file.starts_with(ignored))
        })
        .collect();
    files.sort_by(|a, b| locale_compare(a, b));
    Ok(Some(files))
}

/// Порт `collectPathScopedFiles`: усі файли піддерева `--path`, posix-шляхи
/// від кореня прогону.
fn collect_path_scoped_files(args: &Args, path_arg: &str) -> Result<Vec<String>, String> {
    let target = resolve_and_assert_path_dir(args, path_arg)?;
    let globs = cursor_ignore::ignore_globs_for(&target, &cursor_ignore::ignore_paths(&args.cwd));
    let rel_dir = paths::relative_posix(&args.cwd, &target);
    let mut files: Vec<String> = rules_core::scan::walk_dir(&target, &globs)
        .into_iter()
        .map(|rel| {
            if rel_dir.is_empty() {
                rel
            } else {
                format!("{rel_dir}/{rel}")
            }
        })
        .collect();
    files.sort_by(|a, b| locale_compare(a, b));
    Ok(files)
}

/// Порт `resolveAndAssertPathDir` + `assertWithinCwd` (тексти помилок —
/// дослівні, вони доходять до stderr через верхній `catch` JS-CLI).
fn resolve_and_assert_path_dir(args: &Args, path_arg: &str) -> Result<PathBuf, String> {
    let target = paths::resolve(&args.cwd, path_arg);
    let rel = paths::relative_posix(&args.cwd, &target);
    if !rel.is_empty() && rel.starts_with("..") {
        return Err(format!(
            "--path має вказувати каталог усередині {} (отримано поза межами: {})",
            args.cwd_display,
            target.display()
        ));
    }
    if !target.is_dir() {
        return Err(format!("--path не є каталогом: {}", target.display()));
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| (*a).to_string()).collect()
    }

    #[test]
    fn parse_args_mirrors_index_of_semantics() {
        let cwd = Path::new("/repo");
        let parsed = parse_args(
            &args(&["--path", "run/nexus", "--base", "origin/dev", "--azure"]),
            cwd,
        );
        assert_eq!(parsed.path_arg.as_deref(), Some("run/nexus"));
        assert_eq!(parsed.base_ref.as_deref(), Some("origin/dev"));
        assert!(parsed.azure);
        assert!(!parsed.json);
        assert_eq!(parsed.cwd, Path::new("/repo"));
    }

    #[test]
    fn trailing_flag_without_value_reads_as_absent() {
        let parsed = parse_args(&args(&["--path"]), Path::new("/repo"));
        assert!(parsed.path_arg.is_none());
    }

    #[test]
    fn cwd_flag_overrides_root_and_stays_verbatim_in_messages() {
        let parsed = parse_args(&args(&["--cwd", "./sub", "--json"]), Path::new("/repo"));
        assert_eq!(parsed.cwd_display, "./sub");
        assert_eq!(parsed.cwd, Path::new("/repo/sub"));
        assert!(parsed.json);
    }

    #[test]
    fn unknown_arguments_are_ignored_like_in_js() {
        let parsed = parse_args(&args(&["--що-завгодно", "--github"]), Path::new("/repo"));
        assert!(parsed.github);
        assert!(parsed.path_arg.is_none());
    }

    #[test]
    fn path_outside_cwd_is_rejected_with_the_js_message() {
        let tmp = TempDir::new().unwrap();
        let parsed = parse_args(&[], tmp.path());
        let error = resolve_and_assert_path_dir(&parsed, "../outside").unwrap_err();
        assert!(error.starts_with("--path має вказувати каталог усередині "));
    }

    #[test]
    fn path_that_is_not_a_directory_is_rejected() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("file.txt"), "x").unwrap();
        let parsed = parse_args(&[], tmp.path());
        let error = resolve_and_assert_path_dir(&parsed, "file.txt").unwrap_err();
        assert!(error.starts_with("--path не є каталогом: "));
    }

    #[test]
    fn installed_first_party_plugin_disables_the_native_path() {
        let tmp = TempDir::new().unwrap();
        let rules = tmp.path().join("rules");
        std::fs::create_dir_all(&rules).unwrap();
        let config = LiteConfig::default();
        assert!(native_eligible(tmp.path(), &config, &rules));

        let plugin = tmp.path().join("node_modules/@7n/rules-lang-js");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(plugin.join("package.json"), "{}").unwrap();
        assert!(!native_eligible(tmp.path(), &config, &rules));
    }

    /// Legacy-правило (JS-гейт без поля в `main.json`) і далі делегує —
    /// саме та поведінка, що була до зрізу 3.
    #[test]
    fn legacy_js_gate_in_core_rules_disables_the_native_path() {
        let tmp = TempDir::new().unwrap();
        let gate = tmp.path().join("rules/rust/applies");
        std::fs::create_dir_all(&gate).unwrap();
        std::fs::write(gate.join("main.mjs"), "export const applies = () => true").unwrap();
        assert!(!native_eligible(
            tmp.path(),
            &LiteConfig::default(),
            &tmp.path().join("rules")
        ));
    }

    /// А ДЕКЛАРАТИВНИЙ гейт native-шлях більше не вимикає — це і є розблокування
    /// зрізу 3 контракту плагінів v3.1.
    #[test]
    fn declarative_gate_keeps_the_native_path() {
        let tmp = TempDir::new().unwrap();
        let rule = tmp.path().join("rules/rust");
        std::fs::create_dir_all(&rule).unwrap();
        std::fs::write(
            rule.join("main.json"),
            r#"{ "applies": { "pathExists": "Cargo.toml" } }"#,
        )
        .unwrap();
        assert!(native_eligible(
            tmp.path(),
            &LiteConfig::default(),
            &tmp.path().join("rules")
        ));
    }

    /// Літерал аварійного клапана — чесна делегація, не мовчазний пропуск.
    #[test]
    fn dynamic_literal_disables_the_native_path() {
        let tmp = TempDir::new().unwrap();
        let rule = tmp.path().join("rules/rust");
        std::fs::create_dir_all(&rule).unwrap();
        std::fs::write(rule.join("main.json"), r#"{ "applies": "dynamic" }"#).unwrap();
        assert!(!native_eligible(
            tmp.path(),
            &LiteConfig::default(),
            &tmp.path().join("rules")
        ));
    }

    /// Битий предикат теж делегує: канонічний текст помилки дає JS.
    #[test]
    fn broken_predicate_disables_the_native_path() {
        let tmp = TempDir::new().unwrap();
        let rule = tmp.path().join("rules/rust");
        std::fs::create_dir_all(&rule).unwrap();
        std::fs::write(rule.join("main.json"), r#"{ "applies": { "nope": 1 } }"#).unwrap();
        assert!(!native_eligible(
            tmp.path(),
            &LiteConfig::default(),
            &tmp.path().join("rules")
        ));
    }

    /// Правило, чий декларативний гейт хибний, зникає з плану — порт
    /// `filterByRuleApplies` у native-дискавері.
    #[test]
    fn declarative_gate_filters_the_rule_out_of_discovery() {
        let tmp = TempDir::new().unwrap();
        let rules = tmp.path().join("rules");
        let rule = rules.join("rust");
        std::fs::create_dir_all(rule.join("check")).unwrap();
        std::fs::write(
            rule.join("check").join("concern.json"),
            r#"{ "lint": { "scope": "full", "glob": ["**/Cargo.toml"] } }"#,
        )
        .unwrap();
        std::fs::write(
            rule.join("main.json"),
            r#"{ "applies": { "pathExists": "Cargo.toml" } }"#,
        )
        .unwrap();

        let config = LiteConfig::default();
        let (by_rule, _) = load_enabled_lint_rules(&rules, &config, tmp.path());
        assert!(
            !by_rule.contains_key("rust"),
            "без Cargo.toml правило вимкнене"
        );

        std::fs::write(tmp.path().join("Cargo.toml"), "[workspace]\n").unwrap();
        let (by_rule, _) = load_enabled_lint_rules(&rules, &config, tmp.path());
        assert!(
            by_rule.contains_key("rust"),
            "із Cargo.toml правило активне"
        );
    }

    #[test]
    fn declared_but_not_installed_plugin_keeps_the_native_path() {
        let tmp = TempDir::new().unwrap();
        let rules = tmp.path().join("rules");
        std::fs::create_dir_all(&rules).unwrap();
        let config = LiteConfig {
            exists: true,
            plugins: Some(vec!["@7n/rules-ci-github".to_string()]),
            ..LiteConfig::default()
        };
        assert!(native_eligible(tmp.path(), &config, &rules));
    }
}
