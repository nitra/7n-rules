//! cspell:ignore детектори оркестратором резолвної батчиться
//!
//! `lint --no-fix` як ОСНОВНИЙ шлях виконання в Rust — інверсія мосту (Р12
//! спеки `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
//!
//! Досі оркестрував JS (`detectAll` у `run-detectors.mjs`), а Rust відповідав
//! на його запити через napi. Тут порядок зворотний: план, диспатч,
//! сортування, рендер і exit-код рахує `rules-core`, а node — дочірній
//! процес-виконавець залишку ([`crate::bridge`]).
//!
//! # Що робить Rust, а що — міст
//!
//! | Крок | Де |
//! |---|---|
//! | резолв плагінів (`resolveRulesDirs`/`getActiveCapabilities`) | міст (блокер зрізу 3: ~1200 рядків JS-автодетекту) |
//! | дискавері `concern.json` + `asDetectorConcern` | Rust (`rules_core::concern_meta`) |
//! | capability-фільтр | Rust |
//! | rule-level gate `main.json:applies` | Rust (`rules_core::rule_applies`); міст — лише для `"dynamic"` |
//! | `enabledRuleIds` + warning про правила без концернів | Rust (`rules_core::config`) |
//! | дельта (`resolveChangedBase`/`collectChangedFilesSince`) | Rust (`rules_core::changed_*`) |
//! | план (`buildPlan` × 5 режимів) | Rust (`rules_core::lint_plan`) |
//! | виконання 26 native-концернів | Rust (`rules_core::concerns::batch`) |
//! | виконання концернів із `main.mjs`/policy | міст (батчем, не по одному) |
//! | сортування/рендер/exit-код | Rust (`rules_core::lint_render`) |
//!
//! # Гейт: новий шлях НЕ дефолтний
//!
//! Паритет неповний (див. нижче), тож native-шлях вмикається явно:
//! `--native-detect` або `N_RULES_NATIVE_LINT=1`. Без цього — та сама чесна
//! делегація в JS-CLI, що й для решти команд.
//!
//! Native-шлях також ВІДМОВЛЯЄТЬСЯ (делегує) там, де паритет недосяжний
//! цим зрізом:
//! - без `--no-fix` (fix-пайплайн — T0-патерни + LLM-ladder — не портовано);
//! - з `--path` (перетин піддерева з дельтою живе в `path-scope.mjs`);
//! - якщо план зачепив wasm-концерн (виконання wasm через
//!   `rules-plugin-host` — окремий зріз; мовчазна розбіжність гірша
//!   за делегацію).
//!
//! # Свідомі розбіжності (не покрито цим зрізом)
//!
//! - **Глобальна черга `--full`** (`lint-lock.mjs`) і worktree-ізоляція:
//!   detect-only прогін нічого не мутує, тож чергу native-шлях не бере.
//! - **Progress-бар TTY** (`progress.mjs`) — вивід прогресу не відтворюється.
//! - **`N_RULES_LINT_CONCURRENCY>1`** (experimental two-lane scheduler) —
//!   native-шлях завжди послідовний, як і дефолт JS.
//! - **Self-upgrade `devDependencies`** — та сама свідома розбіжність, що
//!   для зрізів 2–4 (розділ 8.2 мінідизайну): read-only команда лишається
//!   read-only.
//! - **Порядок рядків `--verbose`.** JS друкує `🔍 …` перед КОЖНИМ концерном
//!   по ходу виконання; тут — перед кожним СЕГМЕНТОМ одразу за всі його
//!   items, бо сегмент виконується одним викликом (native-батч або один
//!   `detect` мосту). Набір і формат рядків ті самі, чергування з виводом
//!   самих концернів — інше. Це прямий наслідок батчингу, не недогляд.
//! - **Валідація форми violations від native-концернів.** JS проганяє й
//!   native-результат через `normalizeViolation` (перевірка
//!   posix-relative `file` тощо); тут native-концерни віддають уже типізований
//!   `diagnostics::Violation`, тож перевіряється лише те, що виражає тип.
//!   Для концернів МОСТУ валідація не зникає — її робить той самий
//!   `normalizeResult` усередині `runConcernDetector`.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rules_core::concern_meta::{ConcernMeta, LintScope};
use rules_core::config::LiteConfig;
use rules_core::lint_plan::{BuildLintPlanInput, ConcernPlanInput, LintSurfaceInput, PlanItem};
use rules_core::lint_render::{LintViolation, SortAndRenderInput};
use rules_core::rule_applies::{evaluate_applies, read_rule_applies, AppliesSpec};
use serde_json::{json, Value};

use crate::bridge::Bridge;
use crate::cli::LintArgs;
use crate::{git_policy, js_fallback, paths};

/// Прапорець вмикання native-шляху (поряд із env `N_RULES_NATIVE_LINT`).
const NATIVE_FLAG: &str = "--native-detect";
/// Env-вмикач native-шляху — для хуків/CI, куди argv не дотягнутись.
const NATIVE_ENV: &str = "N_RULES_NATIVE_LINT";

/// Чому native-шлях відмовився і команда пішла в JS-CLI.
enum Bail {
    /// Делегувати з тим самим argv (паритет недосяжний цим зрізом).
    Delegate(String),
    /// Помилка, яку нема сенсу маскувати делегацією.
    Fail(String),
}

/// Аргументи `lint`, доведені до вигляду, у якому їх споживає native-шлях
/// (абсолютний корінь, `migrateRuleIds`, обчислена вісь `--full`).
#[derive(Debug)]
struct LintRun {
    cwd: PathBuf,
    base_ref: Option<String>,
    repo_wide: bool,
    full: bool,
    verbose: bool,
    rules: Vec<String>,
}

/// Чи спрацьовує native-фікс БЕЗ явного `--native-fix` — крок 3 плану
/// `docs/specs/2026-08-31-full-rust-migration-plan.md`: прапорець перестав
/// бути потрібним для форми виклику, яку `fix_cmd::run` і так підтримує
/// (§2.104 реєстру відкритих питань пояснює межу: `fix_cmd` бере РІВНО
/// перелік ключів `rule/concern`, не весь lint-план, тож дефолт можна
/// перемкнути безпечно лише для цієї форми — бо для голого `lint` без
/// ключів `fix_cmd::run` одразу впав би на «бракує ключа concern-а»).
///
/// Умови: є хоча б один позиційний аргумент, і ВСІ вони мають вигляд
/// `rule/concern` (містять `/`) — голий фільтр за назвою правила
/// (`lint text`) під евристику не підпадає, бо `fix_cmd` таких не приймає;
/// `--no-fix` (детекція) і `--no-native-fix` (аварійний люк) вимикають
/// евристику явно.
fn native_fix_default_applies(parsed: &LintArgs) -> bool {
    !parsed.no_fix
        && !parsed.no_native_fix
        && !parsed.rules.is_empty()
        && parsed.rules.iter().all(|rule| rule.contains('/'))
}

/// Чи ввімкнено native-шлях (прапорець або env).
fn native_enabled(parsed: &LintArgs) -> bool {
    if parsed.native_detect {
        return true;
    }
    std::env::var(NATIVE_ENV).is_ok_and(|v| v == "1" || v == "true")
}

/// Доводить розібрані `clap`-аргументи до [`LintRun`]. Позиційні аргументи
/// проходять `migrateRuleIds`, як у JS; `--native-detect` — власний прапорець
/// бінаря, у переліку правил не зʼявляється.
fn resolve_args(parsed: &LintArgs, process_cwd: &Path) -> Result<LintRun, String> {
    let cwd = parsed.cwd.as_deref().map_or_else(
        || process_cwd.to_path_buf(),
        |v| paths::resolve(process_cwd, v),
    );
    let rules = rules_core::config::migrate_rule_ids(&parsed.rules);

    if parsed.repo_wide && (parsed.path.is_some() || !rules.is_empty()) {
        return Err(
            "--repo-wide не поєднується з --path чи scoped rule/concern фільтром — оберіть щось одне"
                .to_string(),
        );
    }

    Ok(LintRun {
        cwd,
        base_ref: parsed.base.clone(),
        repo_wide: parsed.repo_wide,
        // `--full` неактивний разом із `--path`/`--repo-wide` — той самий
        // предикат, що в JS (`--path` тут і так веде до делегації).
        full: parsed.full && parsed.path.is_none() && !parsed.repo_wide,
        verbose: parsed.verbose,
        rules,
    })
}

/// Прапорець аварійного люка назад у JS fix-конвеєр — вирізається з argv
/// перед делегацією так само, як [`crate::fix_cmd::NATIVE_FIX_FLAG`]
/// (JS-CLI про нього не знає).
const NO_NATIVE_FIX_FLAG: &str = "--no-native-fix";

/// Точка входу підкоманди. `args` — argv ПІСЛЯ `lint` (для делегації як є).
pub fn run(parsed: &LintArgs, args: &[String]) -> ExitCode {
    // Native-фікс — окрема поверхня зі своїм прапорцем: не плутається з
    // детекційним native-шляхом і не змінює дефолтну делегацію. Крок 3
    // плану full-rust-migration зробив її дефолтною для власної
    // підтримуваної форми виклику — доккомент [`native_fix_default_applies`].
    if parsed.native_fix || native_fix_default_applies(parsed) {
        return crate::fix_cmd::run(parsed);
    }
    if !native_enabled(parsed) {
        return delegate(args);
    }
    if !parsed.no_fix {
        eprintln!(
            "ℹ️ rules-cli lint: детекційний native-шлях покриває лише --no-fix; для native-фіксу одного concern-а є --native-fix — делегую в JS-CLI."
        );
        return delegate(args);
    }
    if parsed.path.is_some() {
        eprintln!("ℹ️ rules-cli lint: --path не покрито native-шляхом — делегую в JS-CLI.");
        return delegate(args);
    }

    let process_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let resolved = match resolve_args(parsed, &process_cwd) {
        Ok(resolved) => resolved,
        Err(message) => {
            eprintln!("❌ {message}");
            return ExitCode::FAILURE;
        }
    };

    match run_native(&resolved, &process_cwd) {
        Ok(code) => ExitCode::from(code),
        Err(Bail::Delegate(reason)) => {
            eprintln!("ℹ️ rules-cli lint: {reason} — делегую в JS-CLI.");
            delegate(args)
        }
        Err(Bail::Fail(message)) => {
            eprintln!("❌ {message}");
            ExitCode::from(2)
        }
    }
}

/// Делегація з відрізаними власними прапорцями: JS-CLI про них не знає
/// (вона їх мовчки проігнорувала б, але чистий argv надійніший).
fn delegate(args: &[String]) -> ExitCode {
    let mut argv = vec!["lint".to_string()];
    argv.extend(
        args.iter()
            .filter(|a| {
                *a != NATIVE_FLAG
                    && *a != crate::fix_cmd::NATIVE_FIX_FLAG
                    && *a != NO_NATIVE_FIX_FLAG
            })
            .cloned(),
    );
    js_fallback::delegate(&argv)
}

/// Повний native-прогін: дискавері → план → диспатч → рендер.
fn run_native(args: &LintRun, process_cwd: &Path) -> Result<u8, Bail> {
    let config = rules_core::config::read_n_rules_config_lite(&args.cwd)
        .map_err(|error| Bail::Delegate(format!("конфіг не читається ({error})")))?;

    let package_root = js_fallback::package_root(process_cwd).map_err(Bail::Fail)?;
    let mut bridge = Bridge::start(&package_root).map_err(Bail::Fail)?;

    // `N_RULES_RULES_DIR` — тестовий seam (дзеркало `opts.rulesDir` у
    // `detectAll`, якого JS-CLI теж не виставляє прапорцем): дає parity-тесту
    // прогнати синтетичний rules-каталог замість вбудованого.
    let mut discover_payload = json!({ "cwd": args.cwd.to_string_lossy() });
    if let Ok(rules_dir) = std::env::var("N_RULES_RULES_DIR") {
        if !rules_dir.is_empty() {
            discover_payload["rulesDir"] = json!(rules_dir);
        }
    }
    let discovered = bridge
        .call("discover", discover_payload)
        .map_err(Bail::Fail)?;
    let rules_dirs: Vec<PathBuf> = string_array(&discovered, "rulesDirs")
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let capabilities: HashSet<String> = string_array(&discovered, "capabilities")
        .into_iter()
        .collect();
    let wasm_keys: HashSet<String> = string_array(&discovered, "wasmConcernKeys")
        .into_iter()
        .collect();

    let by_rule = discover_by_rule(&rules_dirs);
    let by_rule = filter_by_capabilities(by_rule, &capabilities);
    let by_rule = filter_by_applies(by_rule, &args.cwd, &mut bridge)?;

    let plan = build_plan(args, &config, &by_rule, &rules_dirs)?;

    // Гейт wasm — ДО будь-якого виконання: інакше концерн просто мовчки
    // не відпрацював би (порожні violations читаються як «чисто»).
    if let Some(key) = plan
        .iter()
        .map(|item| format!("{}/{}", item.rule_id, item.concern_id))
        .find(|key| wasm_keys.contains(key))
    {
        return Err(Bail::Delegate(format!(
            "план містить wasm-концерн «{key}», який native-шлях цього зрізу не виконує"
        )));
    }

    let (violations, infra_message) = execute_plan(&plan, args, &by_rule, &mut bridge)?;

    let result = rules_core::lint_render::sort_and_render_violations(&SortAndRenderInput {
        violations,
        infra_message: infra_message.clone(),
    });
    if let Some(message) = infra_message {
        println!("💥 {message}");
        return Ok(result.exit_code);
    }
    if !result.sorted.is_empty() {
        print!("{}", result.rendered);
    }
    Ok(result.exit_code)
}

/// Рядковий масив із JSON-відповіді мосту (відсутнє поле → порожньо).
fn string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Дискавері концернів по всіх rules-каталогах — порт
/// `readLintConcernsByRuleMulti`: правила зливаються за id, концерни за
/// іменем, перший власник виграє (ядро → плагіни в порядку списку).
/// Правило без жодного detector-концерну в результат не потрапляє (та сама
/// умова `concerns.length > 0`, що в JS).
fn discover_by_rule(rules_dirs: &[PathBuf]) -> BTreeMap<String, Vec<ConcernMeta>> {
    let mut merged: BTreeMap<String, Vec<ConcernMeta>> = BTreeMap::new();
    for dir in rules_dirs {
        for rule_id in rules_core::concern_meta::subdirectory_names(dir) {
            let concerns = rules_core::concern_meta::list_detector_concerns(&dir.join(&rule_id));
            if concerns.is_empty() {
                continue;
            }
            match merged.get_mut(&rule_id) {
                None => {
                    merged.insert(rule_id, concerns);
                }
                Some(existing) => {
                    let seen: HashSet<String> = existing.iter().map(|c| c.name.clone()).collect();
                    for concern in concerns {
                        if !seen.contains(&concern.name) {
                            existing.push(concern);
                        }
                    }
                }
            }
        }
    }
    merged
}

/// Порт `filterByCapabilities`: концерн із незадоволеним
/// `requires.capability` відкидається; правило без жодного вцілілого
/// концерну зникає цілком.
fn filter_by_capabilities(
    by_rule: BTreeMap<String, Vec<ConcernMeta>>,
    capabilities: &HashSet<String>,
) -> BTreeMap<String, Vec<ConcernMeta>> {
    by_rule
        .into_iter()
        .filter_map(|(rule_id, concerns)| {
            let kept: Vec<ConcernMeta> = concerns
                .into_iter()
                .filter(|c| {
                    c.requires_capability
                        .as_ref()
                        .is_none_or(|cap| capabilities.contains(cap))
                })
                .collect();
            (!kept.is_empty()).then_some((rule_id, kept))
        })
        .collect()
}

/// Порт `filterByRuleApplies`: правило проходить лише за позитивним вердиктом
/// свого rule-level гейта.
///
/// Гейт ДЕКЛАРАТИВНИЙ (`main.json:applies`, зріз 3 контракту плагінів v3.1),
/// тож [`rules_core::rule_applies`] обчислює його тут-таки, без жодного
/// звернення до мосту — а на гарячому шляху `lint` це рівно та round-trip-на
/// пара запит/відповідь, якої тепер немає. На міст ідуть лише правила, що
/// лишили гейт у JS: літерал `"dynamic"` або старий `applies/main.mjs` без
/// поля в `main.json`. Битий предикат — делегація (текст помилки каноном
/// лишається за JS), решта помилок — fail-closed, як у JS, де `applies`
/// кидає нагору.
fn filter_by_applies(
    by_rule: BTreeMap<String, Vec<ConcernMeta>>,
    cwd: &Path,
    bridge: &mut Bridge,
) -> Result<BTreeMap<String, Vec<ConcernMeta>>, Bail> {
    let mut gated: Vec<(String, PathBuf)> = Vec::new();
    let mut declarative_verdicts: BTreeMap<String, bool> = BTreeMap::new();
    for (rule_id, concerns) in &by_rule {
        let Some(first) = concerns.first() else {
            continue;
        };
        let Some(rule_dir) = first.dir.parent() else {
            continue;
        };
        match read_rule_applies(rule_dir) {
            Ok(AppliesSpec::Always) => {}
            Ok(AppliesSpec::Declarative(node)) => {
                declarative_verdicts.insert(rule_id.clone(), evaluate_applies(&node, cwd));
            }
            Ok(AppliesSpec::Dynamic) => {
                gated.push((rule_id.clone(), rule_dir.join("applies").join("main.mjs")));
            }
            Err(error) => {
                return Err(Bail::Delegate(format!(
                    "правило «{rule_id}»: {error} — точний текст помилки дає JS"
                )))
            }
        }
    }
    if gated.is_empty() {
        return Ok(by_rule
            .into_iter()
            .filter(|(rule_id, _)| declarative_verdicts.get(rule_id) != Some(&false))
            .collect());
    }

    let payload = json!({
        "cwd": cwd.to_string_lossy(),
        "rules": gated.iter().map(|(rule_id, path)| json!({
            "ruleId": rule_id,
            "appliesPath": path.to_string_lossy(),
        })).collect::<Vec<_>>(),
    });
    let response = bridge.call("applies", payload).map_err(Bail::Fail)?;
    let verdicts = response.get("verdicts").cloned().unwrap_or(json!({}));

    let mut out = BTreeMap::new();
    for (rule_id, concerns) in by_rule {
        if declarative_verdicts.get(&rule_id) == Some(&false) {
            continue;
        }
        let Some(verdict) = verdicts.get(&rule_id) else {
            out.insert(rule_id, concerns);
            continue;
        };
        if let Some(error) = verdict.get("error").and_then(Value::as_str) {
            return Err(Bail::Fail(error.to_string()));
        }
        if verdict.get("applies").and_then(Value::as_bool) == Some(true) {
            out.insert(rule_id, concerns);
        }
    }
    Ok(out)
}

/// Порт диспетчера `buildPlan`: вибір режиму + ліниве обчислення саме тих
/// входів, які цей режим використовує (дельта — git-виклик, `enabledRuleIds`
/// — конфіг + warning).
fn build_plan(
    args: &LintRun,
    config: &LiteConfig,
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
    rules_dirs: &[PathBuf],
) -> Result<Vec<PlanItem>, Bail> {
    let by_rule_dto = to_plan_dto(by_rule);

    // scoped: усі lint-concerns названих правил, whole-repo.
    if !args.rules.is_empty() {
        return Ok(rules_core::lint_plan::build_lint_plan(
            &BuildLintPlanInput {
                mode: "scoped".to_string(),
                by_rule: by_rule_dto,
                rules: args.rules.clone(),
                explicit_files: Vec::new(),
                enabled_rule_ids: Vec::new(),
                changed: Vec::new(),
                path_mode: false,
            },
        ));
    }

    let enabled = enabled_rule_ids(by_rule, config, rules_dirs);

    let (mode, changed) = if args.repo_wide {
        ("repoWide", Vec::new())
    } else if args.full {
        ("full", Vec::new())
    } else {
        ("delta", collect_changed(args)?)
    };

    Ok(rules_core::lint_plan::build_lint_plan(
        &BuildLintPlanInput {
            mode: mode.to_string(),
            by_rule: by_rule_dto,
            rules: Vec::new(),
            explicit_files: Vec::new(),
            enabled_rule_ids: enabled,
            changed,
            path_mode: false,
        },
    ))
}

/// Мінімальний DTO концернів для планувальника — рівно те, що читають
/// builders (порт `toByRuleDto`).
fn to_plan_dto(
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
) -> BTreeMap<String, Vec<ConcernPlanInput>> {
    by_rule
        .iter()
        .map(|(rule_id, concerns)| {
            let items = concerns
                .iter()
                .map(|c| {
                    let lint = c.lint.as_ref();
                    ConcernPlanInput {
                        name: c.name.clone(),
                        lint: LintSurfaceInput {
                            scope: match lint.map(|l| l.scope) {
                                Some(LintScope::PerFile) => "per-file".to_string(),
                                _ => "full".to_string(),
                            },
                            glob: lint.map(|l| l.glob.clone()).unwrap_or_default(),
                            anchors: lint.map(|l| l.anchors.clone()).unwrap_or_default(),
                        },
                    }
                })
                .collect();
            (rule_id.clone(), items)
        })
        .collect()
}

/// Порт `enabledRuleIds` (+ `warnAboutRulesWithoutConcerns`): без конфігу
/// делта/full-режими не мають активних правил узагалі.
fn enabled_rule_ids(
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
    config: &LiteConfig,
    rules_dirs: &[PathBuf],
) -> Vec<String> {
    if !config.exists {
        return Vec::new();
    }
    warn_about_rules_without_concerns(by_rule, config, rules_dirs);
    by_rule
        .keys()
        .filter(|id| rules_core::config::is_rule_enabled(config, id))
        .cloned()
        .collect()
}

/// Порт `warnAboutRulesWithoutConcerns` — попередження про rule-id з
/// конфігу, яких немає ЖОДНИМ каталогом у rulesDirs (типово правило
/// переїхало в плагін, якого консюмер не підключив).
fn warn_about_rules_without_concerns(
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
    config: &LiteConfig,
    rules_dirs: &[PathBuf],
) {
    let missing: Vec<&String> = config
        .rules
        .iter()
        .filter(|id| !by_rule.contains_key(*id))
        .collect();
    if missing.is_empty() {
        return;
    }
    let all_dir_names: HashSet<String> = rules_dirs
        .iter()
        .flat_map(|dir| rules_core::concern_meta::subdirectory_names(dir))
        .collect();
    for rule_id in missing {
        if all_dir_names.contains(rule_id) {
            continue;
        }
        eprintln!(
            "⚠️  .n-rules.json: правило \"{rule_id}\" не знайдено НІ В ОДНОМУ з rulesDirs (ні в ядрі, ні в \
підключених плагінах \"plugins\") — перевірки для нього НЕ виконуються. Якщо правило нещодавно \
переїхало в окремий плагін, додай відповідний пакет у \"plugins\" (і в devDependencies)."
        );
    }
}

/// Дельта-набір: merge-base за Git policy (або явний `--base`) →
/// `collectChangedFilesSince`. Без резолвної бази — робоче дерево vs HEAD
/// (та сама fail-open поведінка, що в `changed-files --delta`).
fn collect_changed(args: &LintRun) -> Result<Vec<String>, Bail> {
    let candidates = if args.base_ref.is_some() {
        Vec::new()
    } else {
        git_policy::integration_candidates(&args.cwd)
    };
    let base = rules_core::changed_base::resolve_changed_base(
        &args.cwd,
        &candidates,
        args.base_ref.as_deref(),
    )
    .map_err(|error| Bail::Fail(format!("rules-cli lint: {error}")))?;
    match base {
        Some(sha) => rules_core::changed_files::collect_changed_files_since(&args.cwd, Some(&sha))
            .map_err(|error| Bail::Fail(format!("rules-cli lint: {error}"))),
        None => Ok(rules_core::changed_files::collect_changed_files(&args.cwd)),
    }
}

/// Сегмент плану: суцільний прогін builtin-native концернів або суцільний
/// прогін тих, що виконує міст. Порядок плану зберігається — зливаються
/// лише СУСІДНІ однотипні items (порт `partitionPlanIntoSegments`, тільки
/// тут «решта» теж батчиться, бо міст приймає батч).
struct Segment<'a> {
    native: bool,
    items: Vec<&'a PlanItem>,
}

/// Партиціонує план на суцільні сегменти за типом виконавця.
fn partition(plan: &[PlanItem]) -> Vec<Segment<'_>> {
    let mut segments: Vec<Segment<'_>> = Vec::new();
    for item in plan {
        let key = format!("{}/{}", item.rule_id, item.concern_id);
        let native = rules_core::concerns::NATIVE_CONCERNS.contains(&key.as_str());
        match segments.last_mut() {
            Some(last) if last.native == native => last.items.push(item),
            _ => segments.push(Segment {
                native,
                items: vec![item],
            }),
        }
    }
    segments
}

/// Виконує план по сегментах. Перша інфра-помилка зупиняє прогін і стає
/// `infraMessage` (той самий fail-closed контракт, що `DetectorError` у
/// `detectPlanSequentially` → exit 2); уже зібрані violations лишаються.
fn execute_plan(
    plan: &[PlanItem],
    args: &LintRun,
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
    bridge: &mut Bridge,
) -> Result<(Vec<LintViolation>, Option<String>), Bail> {
    let mut violations: Vec<LintViolation> = Vec::new();
    for segment in partition(plan) {
        if args.verbose {
            for item in &segment.items {
                log_pre_run(item, by_rule);
            }
        }
        let outcome = if segment.native {
            run_native_segment(&segment.items, &args.cwd)
        } else {
            run_bridge_segment(&segment.items, args, by_rule, bridge)?
        };
        violations.extend(outcome.0);
        if let Some(message) = outcome.1 {
            return Ok((violations, Some(message)));
        }
    }
    Ok((violations, None))
}

/// Verbose-рядок перед концерном — той самий формат, що `runPlanItem`.
fn log_pre_run(item: &PlanItem, by_rule: &BTreeMap<String, Vec<ConcernMeta>>) {
    let scope = by_rule
        .get(&item.rule_id)
        .and_then(|concerns| concerns.iter().find(|c| c.name == item.concern_id))
        .and_then(|c| c.lint.as_ref())
        .map_or("full", |l| match l.scope {
            LintScope::PerFile => "per-file",
            LintScope::Full => "full",
        });
    let count = match &item.files {
        None => "весь репо".to_string(),
        Some(files) => format!("{} файл(ів)", files.len()),
    };
    println!(
        "  🔍 {}/{}  [{scope}]  → {count}",
        item.rule_id, item.concern_id
    );
}

/// Виконує суцільний native-сегмент одним batch-викликом ядра. Ядро доводить
/// батч до кінця (fail-soft `run_concerns_batch`), стоп на першій помилці
/// робить цей цикл — той самий поділ, що в `runNativeSegmentSync`.
fn run_native_segment(items: &[&PlanItem], cwd: &Path) -> (Vec<LintViolation>, Option<String>) {
    let batch: Vec<rules_core::concerns::BatchItem> = items
        .iter()
        .map(|item| rules_core::concerns::BatchItem {
            key: format!("{}/{}", item.rule_id, item.concern_id),
            cwd: cwd.to_path_buf(),
            files: item.files.clone(),
        })
        .collect();
    let results = rules_core::concerns::run_concerns_batch(&batch, |_, _| {});

    let mut violations = Vec::new();
    for (i, outcome) in results.iter().enumerate() {
        let item = items[i];
        match &outcome.result {
            Err(error) => {
                // Той самий текст, що `detect.mjs` для native-гілки, у тій
                // самій обгортці `DetectorError`.
                return (
                    violations,
                    Some(format!(
                        "detector {}/{}: native concern кинув: {error}",
                        item.rule_id, item.concern_id
                    )),
                );
            }
            Ok(raw) => violations.extend(raw.violations.iter().map(|v| LintViolation {
                rule_id: item.rule_id.clone(),
                concern_id: item.concern_id.clone(),
                reason: v.reason.clone(),
                message: v.message.clone(),
                file: v.file.clone(),
                severity: v.severity,
                data: v.data.clone(),
            })),
        }
    }
    (violations, None)
}

/// Виконує суцільний сегмент концернів мосту ОДНИМ запитом `detect`.
fn run_bridge_segment(
    items: &[&PlanItem],
    args: &LintRun,
    by_rule: &BTreeMap<String, Vec<ConcernMeta>>,
    bridge: &mut Bridge,
) -> Result<(Vec<LintViolation>, Option<String>), Bail> {
    let payload_items: Vec<Value> = items
        .iter()
        .map(|item| {
            let dir = by_rule
                .get(&item.rule_id)
                .and_then(|concerns| concerns.iter().find(|c| c.name == item.concern_id))
                .map(|c| c.dir.to_string_lossy().to_string())
                .unwrap_or_default();
            json!({
                "key": format!("{}/{}", item.rule_id, item.concern_id),
                "ruleId": item.rule_id,
                "concernId": item.concern_id,
                "dir": dir,
                "files": item.files,
            })
        })
        .collect();
    let response = bridge
        .call(
            "detect",
            json!({
                "cwd": args.cwd.to_string_lossy(),
                "verbose": args.verbose,
                "items": payload_items,
            }),
        )
        .map_err(Bail::Fail)?;

    let mut violations = Vec::new();
    let results = response
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for (i, entry) in results.iter().enumerate() {
        let item = items[i];
        if let Some(error) = entry.get("error").and_then(Value::as_str) {
            return Ok((violations, Some(error.to_string())));
        }
        let raw = entry.get("violations").cloned().unwrap_or(json!([]));
        let parsed: Vec<LintViolation> = serde_json::from_value(raw).map_err(|error| {
            Bail::Fail(format!(
                "detector {}/{}: міст повернув невалідні violations: {error}",
                item.rule_id, item.concern_id
            ))
        })?;
        violations.extend(parsed);
    }
    Ok((violations, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Розбирає `lint <list>` СПІЛЬНОЮ граматикою.
    fn lint_args(list: &[&str]) -> LintArgs {
        let mut argv = vec!["lint"];
        argv.extend_from_slice(list);
        match crate::cli::parse_for_test(&argv).expect("граматика lint") {
            crate::cli::NativeCommand::Lint(parsed) => parsed,
            other => panic!("очікувався lint, а не {other:?}"),
        }
    }

    #[test]
    fn native_path_is_opt_in() {
        assert!(!native_enabled(&lint_args(&["--no-fix"])));
        assert!(native_enabled(&lint_args(&["--no-fix", NATIVE_FLAG])));
    }

    /// Крок 3 плану full-rust-migration: `rule/concern`-ключі без прапорця
    /// вже вмикають native-фікс — колишній `--native-fix` більше не
    /// потрібен для цієї форми виклику.
    #[test]
    fn native_fix_default_applies_to_bare_concern_keys() {
        assert!(native_fix_default_applies(&lint_args(&[
            "text/forbidden-prettier"
        ])));
        assert!(native_fix_default_applies(&lint_args(&[
            "text/forbidden-prettier",
            "rego/opa_check"
        ])));
    }

    /// Голий `lint` (без ключів) не підпадає — `fix_cmd::run` одразу впав
    /// би на «бракує ключа concern-а»: default-шлях фіксу голого прогону
    /// лишається JS-поверхнею (доккомент модуля `fix_cmd`).
    #[test]
    fn native_fix_default_does_not_apply_without_rules() {
        assert!(!native_fix_default_applies(&lint_args(&[])));
    }

    /// Голий фільтр за назвою правила (без `/`) — не ключ concern-а,
    /// `fix_cmd` його не приймає, тож евристика не спрацьовує і команда
    /// й далі йде звичним шляхом (делегація чи `--native-detect`).
    #[test]
    fn native_fix_default_does_not_apply_to_bare_rule_names() {
        assert!(!native_fix_default_applies(&lint_args(&["text"])));
        assert!(!native_fix_default_applies(&lint_args(&[
            "text/forbidden-prettier",
            "text"
        ])));
    }

    /// `--no-fix` (детекція) і `--no-native-fix` (аварійний люк) вимикають
    /// евристику явно, навіть коли `rules` мають форму `rule/concern`.
    #[test]
    fn native_fix_default_respects_opt_outs() {
        assert!(!native_fix_default_applies(&lint_args(&[
            "text/forbidden-prettier",
            "--no-fix"
        ])));
        assert!(!native_fix_default_applies(&lint_args(&[
            "text/forbidden-prettier",
            "--no-native-fix"
        ])));
    }

    #[test]
    fn positional_arguments_become_scoped_rules() {
        let parsed = resolve_args(
            &lint_args(&["--cwd", "sub", "text", "--no-fix"]),
            Path::new("/repo"),
        )
        .unwrap();
        assert_eq!(parsed.rules, vec!["text"]);
        assert_eq!(parsed.cwd, PathBuf::from("/repo/sub"));
        assert!(!parsed.full);
    }

    #[test]
    fn base_ref_value_is_not_a_scoped_rule() {
        let parsed = resolve_args(
            &lint_args(&["--base", "origin/main", "--no-fix"]),
            Path::new("/repo"),
        )
        .unwrap();
        assert!(parsed.rules.is_empty());
        assert_eq!(parsed.base_ref.as_deref(), Some("origin/main"));
    }

    #[test]
    fn repo_wide_conflicts_with_scoped_rules() {
        let error =
            resolve_args(&lint_args(&["--repo-wide", "text"]), Path::new("/repo")).unwrap_err();
        assert!(error.contains("--repo-wide"), "{error}");
    }

    #[test]
    fn partition_merges_adjacent_same_kind_items() {
        let plan = vec![
            PlanItem {
                rule_id: "text".to_string(),
                concern_id: "forbidden-prettier".to_string(),
                files: None,
            },
            PlanItem {
                rule_id: "security".to_string(),
                concern_id: "sample_secret".to_string(),
                files: None,
            },
            // `js/eslint` — вічний JS (programmatic npm-API в процесі,
            // реєстр §2.2): надійна межа native/JS для цього тесту.
            // Колишній приклад тут — `text/cspell-fix` — став native
            // разом із портом воркера.
            PlanItem {
                rule_id: "js".to_string(),
                concern_id: "eslint".to_string(),
                files: None,
            },
        ];
        let segments = partition(&plan);
        assert_eq!(segments.len(), 2);
        assert!(segments[0].native);
        assert_eq!(segments[0].items.len(), 2);
        assert!(!segments[1].native);
    }
}
