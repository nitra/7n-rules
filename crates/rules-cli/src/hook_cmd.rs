//! cspell:ignore портовні портовна
//!
//! Native-шар команди `hook` — порт `runHookCli` (`npm/scripts/hook.mjs`)
//! у частині, яка НЕ вимагає detect-контуру (зріз 4 фази 8,
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! # Межа native-шляху (вимірювана, а не оцінна)
//!
//! `runHookCli` — три гілки, і лише дві з них портовні:
//!
//! | Гілка JS | Native | Чому |
//! |---|---|---|
//! | немає ні `--post-tool-use`, ні `--stop` | ✅ | чистий рядок у stderr + код 1 |
//! | `--post-tool-use`, зі stdin не дістається жодного шляху | ✅ | код 0 без виводу — робити нічого |
//! | `--post-tool-use` зі шляхами, `--stop` | ❌ делегація | обидві кінчаються `detectAll` |
//!
//! `detectAll` (`npm/scripts/lib/lint-surface/run-detectors.mjs`) недосяжний
//! з Rust не «поки не написали», а за конструкцією: більшість concern-детекторів
//! ядра — ВИКОНУВАНІ JS-модулі `<rule>/<concern>/main.mjs` (частина ще й спавнить
//! зовнішні тули: eslint, cspell, oxfmt), а вибір самого набору концернів
//! проходить через `resolveRulesDirs`/`getActiveCapabilities` і rule-level gate
//! `<rule>/applies/main.mjs` — це два блокери, які зріз 3 вже назвав відкритими
//! (розділ 9.4 мінідизайну). Порт «приблизно» дав би мовчазну розбіжність на
//! найгарячішому шляху продукту, тож межа проходить рівно там, де паритет
//! доводиться, а не припускається.
//!
//! **Чого це коштує за годинником** (macOS arm64, медіана 7 прогонів, цей репо):
//! гілки, які тут стали native, у JS коштували 40 мс (bun) / 55 мс (node);
//! делегована гілка коштує 1.7–7.1 с, з яких понад 98 % — виконання самих
//! детекторів, а не старт рантайму. Тобто теза плану зрізу 4 («головний виграш
//! інверсії — node-старт зникає з найчастішого виклику») вимірюванням НЕ
//! підтверджується: node-старт — це <3 % латентності хука, і виграш зʼявиться
//! лише разом із портом самих детекторів. Числа й методика — у PR зрізу.
//!
//! # Делегація не має права зʼїсти stdin
//!
//! Щоб вирішити, чи гілка портовна, native мусить ПРОЧИТАТИ stdin — а
//! делегований JS-процес читає його ж. Тому байти stdin захоплюються й
//! переграються в дочірній процес ([`js_fallback::delegate_with_stdin`]);
//! `--stop` payload-незалежний і делегується зі stdio як є, як решта
//! команд. На TTY stdin не читається взагалі (дзеркало `process.stdin.isTTY`
//! у `readStdin`), тож інтерактивний запуск не блокується.
//!
//! # Свідома розбіжність (та сама, що в зрізі 2)
//!
//! JS-роутер перед `case 'hook'` кличе `ensureNRulesInRootDevDependencies(cwd)`
//! — self-upgrade піна `@7n/rules` у workspace-root `package.json`. Native-шлях
//! його не відтворює (обґрунтування — розділ 8.2 мінідизайну: це поверхня
//! sync/дистрибуції, не семантика команди, і вона зникає у зрізі 5). Практичний
//! наслідок для `hook` нульовий: обидві native-гілки — це «нічого не робити»,
//! а будь-який реальний виклик із файлом делегується, і ensure відпрацьовує в
//! дочірньому JS-процесі як раніше. Розбіжність зафіксована окремим тестом у
//! `npm/scripts/lib/tests/rules-cli-parity.test.mjs`.

use std::io::{IsTerminal, Read};
use std::process::ExitCode;

use crate::js_fallback;

/// Текст помилки «режим не вказано» — байт-у-байт із `runHookCli`
/// (`process.stderr.write`, тобто без додаткового `\n` від `console.error`).
const MISSING_MODE: &str = "hook: потрібен --post-tool-use або --stop\n";

/// Виконує `hook <argv>`: `args` — ПОВНИЙ argv (з `hook` на нульовій позиції),
/// щоб делегація віддала його в JS без змін.
pub fn run(args: &[String]) -> ExitCode {
    let rest = &args[1..];
    // Дзеркало `argv.includes(...)`: порядок і повтори значення не мають,
    // невідомі аргументи ігноруються, `--post-tool-use` має пріоритет.
    let post_tool_use = rest.iter().any(|arg| arg == "--post-tool-use");
    let stop = rest.iter().any(|arg| arg == "--stop");

    if !post_tool_use && !stop {
        eprint!("{MISSING_MODE}");
        return ExitCode::from(1);
    }
    if !post_tool_use {
        // `--stop` читає не stdin, а робоче дерево — делегуємо як є.
        return js_fallback::delegate(args);
    }

    // TTY → `readStdin` у JS одразу віддає '' і не чекає на ввід.
    let Some(raw) = read_stdin_bytes() else {
        return ExitCode::SUCCESS;
    };
    if extract_file_paths(&String::from_utf8_lossy(&raw)).is_empty() {
        return ExitCode::SUCCESS;
    }
    js_fallback::delegate_with_stdin(args, Some(&raw))
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
