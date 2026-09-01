//! cspell:ignore портовні портовна
//!
//! Native-шар команди `hook` — повний порт `runHookCli` (`npm/scripts/hook.mjs`),
//! включно з гілкою, що доходить до `detectAll`. Рішення власника
//! (`docs/plans/2026-08-31-full-rust-migration-plan.md` §7 «Ухвалені
//! рішення»): добити порт, попри те що вимірювання зрізу 4 (нижче) спростувало
//! ПЕРВІСНУ підставу зрізу («node-старт — головна вартість хука»). Підстава
//! добивання — не швидкість, а однорідність: критерій завершення §1.1 плану
//! лишається бінарним («нуль JS», без названих виключень), а команда, що
//! лишається за `js_fallback`, зробила б цей критерій недосяжним.
//!
//! # Що саме портовано зараз (звірено з кодом 2026-09-01)
//!
//! `runHookCli` — три гілки; усі три тепер native:
//!
//! | Гілка JS | Native | Як |
//! |---|---|---|
//! | немає ні `--post-tool-use`, ні `--stop` | ✅ | чистий рядок у stderr + код 1 (без змін) |
//! | `--post-tool-use`, зі stdin не дістається жодного шляху | ✅ | код 0 без виводу — без змін |
//! | `--post-tool-use` зі шляхами, `--stop` | ✅ | [`run_detect`] — той самий detect-конвеєр, що `lint --native-detect` ([`crate::lint_cmd`]) |
//!
//! `detectAll` (`npm/scripts/lib/lint-surface/run-detectors.mjs`) сам не
//! портований у Rust ЦІЛКОМ — і не мусить бути: більшість concern-детекторів
//! ядра лишаються ВИКОНУВАНИМИ JS-модулями (`<rule>/<concern>/main.mjs`,
//! частина спавнить зовнішні тули — eslint/cspell/oxfmt), а частина —
//! wasm-компоненти contract v3. Порт зрізу 5 (`crate::lint_cmd`) уже розв'язав
//! ЦЮ саму задачу для `lint --native-detect`: план/диспатч/сортування/рендер
//! рахує `rules-core`, а концерни без native-порту виконує ОДИН довгоживучий
//! JS-процес через [`crate::bridge`] (`bridge-host.mjs`) — НЕ через
//! [`js_fallback`] (повна делегація команди), а через вузький RPC-канал на
//! конкретні операції (`discover`/`applies`/`detect`), який план сам називає
//! окремим боундарі-артефактом, що зникає лише разом із рештою `lint-surface`
//! (крок 6 плану, `bridge-host.mjs` — 298 рядків). Цей модуль переиспользує
//! РІВНО ту саму інфраструктуру ([`crate::lint_cmd::discover_by_rule`],
//! [`crate::lint_cmd::filter_by_capabilities`],
//! [`crate::lint_cmd::filter_by_applies`], [`crate::lint_cmd::to_plan_dto`],
//! [`crate::lint_cmd::enabled_rule_ids`], [`crate::lint_cmd::execute_plan`]) —
//! `hook` не будує другу реалізацію detect-конвеєра.
//!
//! # Режим плану — завжди `delta`, з явним файловим набором
//!
//! JS `buildPlan` для `detectAll({ files, ... })` (обидві гілки хука дають
//! непорожній `opts.files`: `--post-tool-use` — шляхи зі stdin,
//! `--stop` — `collectChangedFiles(cwd)`) завжди потрапляє в гілку
//! `delta / explicit-files` (`rules.length === 0`, `repoWide` і `full` —
//! `false`): `mode: 'delta'`, `changed: explicitFiles`, `pathMode: false`.
//! Це рівно [`rules_core::lint_plan::BuildLintPlanInput`] з `mode: "delta"`
//! і `changed` = вже native-обчислений файловий набір — жодного з інших
//! чотирьох режимів (`scoped`/`scopedDelta`/`repoWide`/`full`) `hook` не
//! використовує, бо не має ні `--rules`, ні `--repo-wide`, ні `--full`.
//!
//! # Wasm-концерни: без гейта-делегації, на відміну від `lint`
//!
//! `lint_cmd::run_native` бачить wasm-концерн у плані й делегує ВЕСЬ `lint`
//! назад у JS (доккомент [`crate::lint_cmd`]) — консервативний вибір першого
//! зрізу мосту, не структурна межа: `bridge-host.mjs::opDetect` виконує
//! wasm-концерн через ТОЙ САМИЙ `runConcernDetector`, яким його виконав би
//! JS-оркестратор напряму (`detect.mjs` викликає `loadNative().runWasmConcern`
//! незалежно від того, хто саме дійшов до цього виклику — `detectAll` чи
//! `opDetect`). Для `hook` немає команди, у яку можна відступити, тож він
//! пропускає wasm-items крізь [`crate::lint_cmd::execute_plan`] так само, як
//! будь-який інший неnative concern (сегмент мосту, доккомент
//! `partition`/`run_bridge_segment` у [`crate::lint_cmd`]) — без жодного
//! гейта. Це не «менш обережно», а точна відповідність тому, що вже робить
//! `detectAll` у JS: `npm-module/package_structure` (full-scope, `glob:
//! ["**/*"]`) і сьогодні виконується на КОЖНОМУ реальному виклику хука з
//! непорожнім `files` — [`run_detect`] лише переносить це виконання з
//! підпроцесу `n-rules.js hook` у виклик мосту, не додає й не прибирає
//! жодної роботи.
//!
//! # Делегація в JS-CLI ([`js_fallback`]) для цієї команди більше не існує
//!
//! `js_fallback::delegate`/`delegate_with_stdin` тут БІЛЬШЕ НЕ
//! викликаються — `hook` зникає з переліку команд, які [`main`](crate)
//! маршрутизує туди. [`js_fallback::package_root`] лишається (потрібен, щоб
//! знайти `bridge-host.mjs` у встановленому пакеті) — це інша, вужча
//! поверхня меж (резолв шляху, не спавн повної команди).
//!
//! # Свідома розбіжність (та сама, що була в зрізі 2)
//!
//! JS-роутер перед `case 'hook'` кличе `ensureNRulesInRootDevDependencies(cwd)`
//! — self-upgrade піна `@7n/rules` у workspace-root `package.json`. Native-шлях
//! його НЕ відтворює (обґрунтування — розділ 8.2 мінідизайну
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`: це поверхня
//! sync/дистрибуції, не семантика команди). `hook` лишається read-only
//! командою в обох гілках — та сама розбіжність, зафіксована тестом у
//! `npm/scripts/lib/tests/rules-cli-parity.test.mjs`.

use std::collections::HashSet;
use std::io::{IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rules_core::lint_plan::BuildLintPlanInput;
use rules_core::lint_render::SortAndRenderInput;
use serde_json::json;

use crate::bridge::Bridge;
use crate::cli::HookArgs;
use crate::js_fallback;
use crate::lint_cmd::{self, Bail};
use crate::paths;

/// Текст помилки «режим не вказано» — байт-у-байт із `runHookCli`
/// (`process.stderr.write`, тобто без додаткового `\n` від `console.error`).
const MISSING_MODE: &str = "hook: потрібен --post-tool-use або --stop\n";

/// Виконує `hook <argv>`. Прапорці розбирає спільна `clap`-граматика
/// ([`crate::cli::HookArgs`]); порядок і повтори, як і в JS
/// (`argv.includes`), значення не мають, `--post-tool-use` має пріоритет.
/// `args` більше не споживається (не залишилось жодної гілки, яка делегує
/// його кудись) — лишається в сигнатурі для однорідності з рештою
/// `NativeCommand`-обробників у [`main`](crate).
pub fn run(parsed: &HookArgs, _args: &[String]) -> ExitCode {
    let post_tool_use = parsed.post_tool_use;
    let stop = parsed.stop;

    if !post_tool_use && !stop {
        eprint!("{MISSING_MODE}");
        return ExitCode::from(1);
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let files = if post_tool_use {
        // TTY → `readStdin` у JS одразу віддає '' і не чекає на ввід.
        let Some(raw) = read_stdin_bytes() else {
            return ExitCode::SUCCESS;
        };
        let raw_paths = extract_file_paths(&String::from_utf8_lossy(&raw));
        if raw_paths.is_empty() {
            return ExitCode::SUCCESS;
        }
        // Порт `toRelativePosix` (`hook.mjs`): `file_path` буває абсолютним
        // (Claude Code) — конкретні детектори (напр. `text/run-v8r`)
        // вимагають posix-relative до `cwd`, як і решта `ctx.files`.
        raw_paths
            .iter()
            .map(|fp| paths::relative_posix(&cwd, &paths::resolve(&cwd, fp)))
            .collect::<Vec<_>>()
    } else {
        // `--stop` читає не stdin, а робоче дерево vs HEAD — той самий
        // виклик, що `changed-files` без бази.
        rules_core::changed_files::collect_changed_files(&cwd)
    };

    match run_detect(&cwd, files) {
        Ok(exit_code) => ExitCode::from(exit_code),
        Err(message) => {
            eprintln!("❌ {message}");
            ExitCode::from(2)
        }
    }
}

/// [`Bail`] → голе повідомлення: `hook` не має куди делегувати (на відміну
/// від `lint`), тож обидва варіанти — `Delegate`/`Fail` — тут однаково
/// фінальна відмова, надрукована як `❌ …` (доккомент [`run`]).
fn bail_message(bail: Bail) -> String {
    match bail {
        Bail::Delegate(message) | Bail::Fail(message) => message,
    }
}

/// Native detect-прогін для непорожнього файлового набору — той самий
/// конвеєр, що `lint --no-fix --native-detect` (доккомент модуля,
/// [`crate::lint_cmd`]), спеціалізований під єдиний режим плану `delta` з
/// явним `changed`. Повертає hook-протокольний exit-код (`0` — чисто,
/// `2` — є порушення ЧИ інфра-помилка, той самий колапс, що
/// `exitCode === 0 ? 0 : 2` у `runHookCli`).
fn run_detect(cwd: &Path, files: Vec<String>) -> Result<u8, String> {
    let config = rules_core::config::read_n_rules_config_lite(cwd)
        .map_err(|error| format!("конфіг не читається ({error})"))?;

    let package_root = js_fallback::package_root(cwd)?;
    let mut bridge = Bridge::start(&package_root)?;

    // `N_RULES_RULES_DIR` — той самий тестовий seam, що в `lint_cmd::run_native`
    // (дзеркало `opts.rulesDir` у `detectAll`, якого `hook.mjs` не виставляє
    // прапорцем): дає parity-тесту прогнати синтетичний rules-каталог.
    let mut discover_payload = json!({ "cwd": cwd.to_string_lossy() });
    if let Ok(rules_dir) = std::env::var("N_RULES_RULES_DIR") {
        if !rules_dir.is_empty() {
            discover_payload["rulesDir"] = json!(rules_dir);
        }
    }
    let discovered = bridge.call("discover", discover_payload)?;
    let rules_dirs: Vec<PathBuf> = lint_cmd::string_array(&discovered, "rulesDirs")
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let capabilities: HashSet<String> = lint_cmd::string_array(&discovered, "capabilities")
        .into_iter()
        .collect();

    let by_rule = lint_cmd::discover_by_rule(&rules_dirs);
    let by_rule = lint_cmd::filter_by_capabilities(by_rule, &capabilities);
    let by_rule =
        lint_cmd::filter_by_applies(by_rule, cwd, &mut bridge).map_err(bail_message)?;

    let enabled_rule_ids = lint_cmd::enabled_rule_ids(&by_rule, &config, &rules_dirs);
    let by_rule_dto = lint_cmd::to_plan_dto(&by_rule);

    let plan = rules_core::lint_plan::build_lint_plan(&BuildLintPlanInput {
        mode: "delta".to_string(),
        by_rule: by_rule_dto,
        rules: Vec::new(),
        explicit_files: Vec::new(),
        enabled_rule_ids,
        changed: files,
        path_mode: false,
    });

    // Wasm-гейт лінту тут СВІДОМО не повторюється — доккомент модуля,
    // розділ «Wasm-концерни».
    let (violations, infra_message) =
        lint_cmd::execute_plan(&plan, cwd, false, &by_rule, &mut bridge).map_err(bail_message)?;

    let result = rules_core::lint_render::sort_and_render_violations(&SortAndRenderInput {
        violations,
        infra_message: infra_message.clone(),
    });
    // `logToStderr` у JS: Claude Code при exit 2 показує агенту лише stderr
    // (доккомент `hook.mjs`) — увесь вивід прогону йде туди, не в stdout.
    if let Some(message) = infra_message {
        eprintln!("💥 {message}");
    } else if !result.sorted.is_empty() {
        eprint!("{}", result.rendered);
    }
    Ok(if result.exit_code == 0 { 0 } else { 2 })
}

/// Читає stdin повністю. `None` — stdin є терміналом (JS-гілка `isTTY`) або
/// читання впало: `readStdin` ковтає помилку потоку й повертає накопичене, а
/// на порожньому вводі гілка все одно дає «шляхів немає».
fn read_stdin_bytes() -> Option<Vec<u8>> {
    let stdin = std::io::stdin();
    if stdin.is_terminal() {
        return None;
    }
    let mut buf = Vec::new();
    match stdin.lock().read_to_end(&mut buf) {
        // Порожній ввід — те саме, що TTY: далі нема чого діставати.
        Ok(_) if buf.is_empty() => None,
        Ok(_) => Some(buf),
        Err(_) if buf.is_empty() => None,
        Err(_) => Some(buf),
    }
}

/// Порт `extractFilePaths`: шлях(и) зміненого файлу зі stdin-JSON PostToolUse —
/// Claude Code (`tool_input.file_path`) або Codex CLI (`tool_name: "apply_patch"`,
/// V4A-патч у `tool_input.command`). Порожньо — невалідний JSON, не file-edit
/// tool, або патч лише видаляє файли.
pub fn extract_file_paths(json: &str) -> Vec<String> {
    if json.is_empty() {
        return Vec::new();
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    // `parsed?.tool_input?.file_path` — на не-обʼєкті optional chaining дає
    // undefined, `Value::get` на не-обʼєкті дає None: та сама семантика.
    let file_path = parsed
        .get("tool_input")
        .and_then(|input| input.get("file_path"))
        .and_then(serde_json::Value::as_str);
    if let Some(path) = file_path {
        if !path.is_empty() {
            return vec![path.to_string()];
        }
    }
    let is_apply_patch = parsed
        .get("tool_name")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|name| name == "apply_patch");
    if is_apply_patch {
        if let Some(command) = parsed
            .get("tool_input")
            .and_then(|input| input.get("command"))
            .and_then(serde_json::Value::as_str)
        {
            return extract_codex_patch_paths(command);
        }
    }
    Vec::new()
}

/// Префікси директив V4A-патча Codex CLI (`*** Begin Patch … *** End Patch`).
const ADD_FILE: &str = "*** Add File: ";
const UPDATE_FILE: &str = "*** Update File: ";
const MOVE_TO: &str = "*** Move to: ";

/// Порт `extractCodexPatchPaths`: `Update File` з наступним рядком `Move to`
/// рахує лише фінальний (перейменований) шлях; `Delete File` пропускається.
pub fn extract_codex_patch_paths(patch: &str) -> Vec<String> {
    let lines: Vec<&str> = split_lines(patch);
    let mut paths = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if let Some(rest) = directive_value(line, ADD_FILE) {
            paths.push(js_trim(rest).to_string());
            continue;
        }
        if let Some(rest) = directive_value(line, UPDATE_FILE) {
            let moved = lines
                .get(index + 1)
                .and_then(|next| directive_value(next, MOVE_TO));
            paths.push(js_trim(moved.unwrap_or(rest)).to_string());
        }
    }
    paths
}

/// `patch.split(/\r?\n/u)` — саме дві форми розділювача, самотній `\r`
/// лишається всередині рядка (і нижче скасує збіг директиви).
fn split_lines(patch: &str) -> Vec<&str> {
    patch
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

/// Значення директиви, якщо рядок їй відповідає. Дзеркалить регекс
/// `/^\*\*\* Add File: (.+)$/u` без прапорця `m`: `.` не матчить термінатори
/// рядка, а `$` без `m` — це кінець УСЬОГО рядка, тож будь-який термінатор
/// усередині залишку (самотній `\r`, `\u{2028}`, `\u{2029}`) збіг скасовує;
/// `(.+)` вимагає щонайменше один символ.
fn directive_value<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(prefix)?;
    if rest.is_empty() || rest.contains(['\r', '\n', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some(rest)
}

/// `String.prototype.trim`: WhiteSpace ∪ LineTerminator за ECMAScript.
/// Від `str::trim` відрізняється двома символами — `\u{feff}` (JS ріже,
/// Unicode White_Space ні) і `\u{85}` (навпаки).
fn js_trim(value: &str) -> &str {
    value.trim_matches(|ch: char| ch == '\u{feff}' || (ch.is_whitespace() && ch != '\u{85}'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_code_payload_yields_the_single_file_path() {
        let json = r#"{"tool_name":"Edit","tool_input":{"file_path":"npm/scripts/hook.mjs"}}"#;
        assert_eq!(extract_file_paths(json), vec!["npm/scripts/hook.mjs"]);
    }

    #[test]
    fn empty_and_broken_payloads_yield_nothing() {
        for json in ["", "не json", "null", "[]", "5", r#""рядок""#, "{}"] {
            assert!(extract_file_paths(json).is_empty(), "payload: {json}");
        }
    }

    #[test]
    fn empty_file_path_falls_through_like_in_js() {
        let json = r#"{"tool_input":{"file_path":""}}"#;
        assert!(extract_file_paths(json).is_empty());
    }

    #[test]
    fn non_string_file_path_is_ignored() {
        let json = r#"{"tool_input":{"file_path":42}}"#;
        assert!(extract_file_paths(json).is_empty());
    }

    #[test]
    fn bash_tool_payload_has_nothing_to_lint() {
        let json = r#"{"tool_name":"Bash","tool_input":{"command":"ls -la"}}"#;
        assert!(extract_file_paths(json).is_empty());
    }

    #[test]
    fn codex_apply_patch_collects_add_and_update_paths() {
        let patch = "*** Begin Patch\n*** Add File: a.rs\n+x\n*** Update File: b.rs\n@@\n-y\n*** End Patch\n";
        let json =
            serde_json::json!({ "tool_name": "apply_patch", "tool_input": { "command": patch } });
        assert_eq!(extract_file_paths(&json.to_string()), vec!["a.rs", "b.rs"]);
    }

    #[test]
    fn codex_move_to_wins_over_the_original_update_path() {
        let patch = "*** Update File: old.rs\n*** Move to: new.rs\n@@\n";
        assert_eq!(extract_codex_patch_paths(patch), vec!["new.rs"]);
    }

    #[test]
    fn codex_delete_only_patch_yields_nothing() {
        let patch = "*** Begin Patch\n*** Delete File: gone.rs\n*** End Patch\n";
        assert!(extract_codex_patch_paths(patch).is_empty());
    }

    #[test]
    fn codex_paths_are_trimmed_and_crlf_tolerant() {
        let patch = "*** Add File:   a.rs  \r\n*** Update File: b.rs\r\n";
        assert_eq!(extract_codex_patch_paths(patch), vec!["a.rs", "b.rs"]);
    }

    #[test]
    fn codex_directive_without_value_is_not_a_match() {
        assert!(extract_codex_patch_paths("*** Add File: \n").is_empty());
    }

    #[test]
    fn apply_patch_without_string_command_yields_nothing() {
        let json = r#"{"tool_name":"apply_patch","tool_input":{"command":123}}"#;
        assert!(extract_file_paths(json).is_empty());
    }

    #[test]
    fn file_path_wins_over_apply_patch_branch() {
        let json = r#"{"tool_name":"apply_patch","tool_input":{"file_path":"a.rs","command":"*** Add File: b.rs\n"}}"#;
        assert_eq!(extract_file_paths(json), vec!["a.rs"]);
    }
}
