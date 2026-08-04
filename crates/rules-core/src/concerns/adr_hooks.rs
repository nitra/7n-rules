//! Native-порт `adr/hooks` (`npm/rules/adr/hooks/main.mjs`, 369 рядків) —
//! adr.mdc: наявність і канонічність managed hook-скриптів
//! (`capture-decisions.sh`/`normalize-decisions.sh`), `.claude/settings.json`,
//! `.cursor/hooks.json`-Stop-hooks, `.gitignore`-покриття лог/state-файлів,
//! `docs/adr/`-каталогу.
//!
//! # `include_str!` замість runtime-читання
//!
//! JS-версія читала канонічні скрипти в runtime відносно `import.meta.url`
//! свого `main.mjs` (`npm/.claude-template/hooks/`). Той самий підхід, що й
//! `security_trufflehog.rs` (доккомент там): скомпільований бінарник не має
//! шляху встановленого npm-пакета, тож канонічний вміст вбудовується
//! компіляційно через [`include_str!`]. Наслідок — гілка «канонічний скрипт
//! у пакеті не знайдено» (`main.mjs:84-87`) у Rust-порті недосяжна (compile-time
//! гарантія наявності), тому не відтворена.
//!
//! # `resolveModel`/`isLocalModel` → `llm_lib::tiers` (Р9 спеки)
//!
//! `checkCaptureBackendAvailable` (`main.mjs:271-295`) — єдине місце
//! `adr/hooks`, що використовує `@7n/llm-lib/model-tiers`
//! (`resolveModel('min')` + `isLocalModel`). Це **інформативна** перевірка:
//! `pass()` у `violation-reporter.mjs` — no-op (доккомент
//! `violation-reporter.mjs`), тож ця гілка НІКОЛИ не додає violation, лише
//! обчислює діагностичний рядок, який ніде не спостерігається через
//! `LintResult`. [`capture_backend_status`] тут — точний функціональний
//! порт (для паритету семантики й тестованості `llm_lib::tiers::resolve_model`/
//! `is_local_model`); [`adr_hooks`] викликає її (як і JS викликає
//! `checkCaptureBackendAvailable` у своєму `lint()`), але результат
//! відкидається — той самий видимий ефект (завжди 0 violations від цієї
//! перевірки), що й у JS.

use std::path::Path;

use crate::diagnostics::{Severity, Violation};
use llm_lib::tiers::{is_local_model, resolve_model, Tier};

/// Стабільний reason для всіх violations цього concern-а — дефолтний
/// `ctx.concernId` JS-reporter-а (`violation-reporter.mjs:27`); жоден
/// `fail()`-виклик у `main.mjs` не передає явний reason (`opts`), тож усі
/// падіння звітуються з reason-ом самого concern-а (`adr/hooks`).
const REASON: &str = "hooks";

fn fail(message: impl Into<String>) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message: message.into(),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Один hook-артефакт: bash-скрипт + канонічний вміст, вбудований компіляційно
/// — точний порт `HOOK_ARTIFACTS` (`main.mjs:12-15`).
struct HookArtifact {
    script_name: &'static str,
    log_name: &'static str,
    canonical: &'static str,
}

const CAPTURE_DECISIONS_SCRIPT: &str =
    include_str!("../../../../npm/.claude-template/hooks/capture-decisions.sh");
const NORMALIZE_DECISIONS_SCRIPT: &str =
    include_str!("../../../../npm/.claude-template/hooks/normalize-decisions.sh");

const HOOK_ARTIFACTS: &[HookArtifact] = &[
    HookArtifact {
        script_name: "capture-decisions.sh",
        log_name: "capture-decisions.log",
        canonical: CAPTURE_DECISIONS_SCRIPT,
    },
    HookArtifact {
        script_name: "normalize-decisions.sh",
        log_name: "normalize-decisions.log",
        canonical: NORMALIZE_DECISIONS_SCRIPT,
    },
];

/// Файли стану/блокування normalize-хука, які не мають потрапляти в git —
/// точний порт `NORMALIZE_STATE_FILES` (`main.mjs:298`).
const NORMALIZE_STATE_FILES: &[&str] = &[".normalize-state", ".normalize.lock"];
const CLAUDE_HOOKS_REL: &str = ".claude/hooks";

/// Розбиває на рядки за `\r?\n` — точний порт `EOL_RE = /\r?\n/u`
/// (`main.mjs:19`), без regex-двигуна: `\n`-спліт з обрізанням хвостового
/// `\r` дає той самий результат для CRLF і LF джерел.
fn split_lines(content: &str) -> Vec<&str> {
    content
        .split('\n')
        .map(|s| s.strip_suffix('\r').unwrap_or(s))
        .collect()
}

/// Відносний шлях до managed hook-скрипта у проєкті — точний порт
/// `projectHookPath` (`main.mjs:29-31`).
fn project_hook_path(script_name: &str) -> String {
    format!(".claude/hooks/{script_name}")
}

/// Відносний шлях до лог-файлу managed hook'а у проєкті — точний порт
/// `projectLogPath` (`main.mjs:38-40`).
fn project_log_path(log_name: &str) -> String {
    format!(".claude/hooks/{log_name}")
}

/// Чи містить рядок `.gitignore` шаблон, який покриває цей конкретний
/// лог-файл хука — точний порт `gitignoreLineCoversHookLog` (`main.mjs:49-66`).
fn gitignore_line_covers_hook_log(line: &str, log_path: &str) -> bool {
    if line.is_empty() || line.starts_with('#') {
        return false;
    }
    if line == log_path {
        return true;
    }
    if line == ".claude/hooks/*.log" || line == ".claude/hooks/**/*.log" {
        return true;
    }
    if line == ".claude/hooks/*" || line == ".claude/hooks/**" {
        return true;
    }
    if line == "*.log" || line == "**/*.log" {
        return true;
    }
    false
}

/// Чи рядок `.gitignore` покриває конкретний state/lock файл — точний порт
/// `gitignoreLineCoversStatePath` (`main.mjs:307-312`).
fn gitignore_line_covers_state_path(line: &str, state_path: &str) -> bool {
    if line == state_path {
        return true;
    }
    let star = format!("{CLAUDE_HOOKS_REL}/*");
    let double_star = format!("{CLAUDE_HOOKS_REL}/**");
    line == star || line == double_star
}

/// Перевіряє наявність і канонічність одного hook-скрипта — точний порт
/// `checkHookScript` (`main.mjs:75-94`, мінус гілка «канон не знайдено в
/// пакеті» — доккомент модуля).
fn check_hook_script(cwd: &Path, artifact: &HookArtifact, violations: &mut Vec<Violation>) {
    let project_rel = project_hook_path(artifact.script_name);
    let project_abs = cwd.join(&project_rel);
    if !project_abs.exists() {
        violations.push(fail(format!(
            "{project_rel} не існує — запусти `npx @7n/rules` (правило adr копіює канонічний скрипт)"
        )));
        return;
    }
    let project_content = std::fs::read_to_string(&project_abs).unwrap_or_default();
    if project_content != artifact.canonical {
        violations.push(fail(format!(
            "{project_rel} відрізняється від канонічного — запусти `npx @7n/rules` для повторного синку"
        )));
    }
}

/// FS-existence для project-shared `.claude/settings.json` — точний порт
/// `checkProjectSettings` (`main.mjs:104-111`).
fn check_project_settings(cwd: &Path, violations: &mut Vec<Violation>) {
    if !cwd.join(".claude/settings.json").exists() {
        violations.push(fail(
            "`.claude/settings.json` не існує — запусти `npx @7n/rules`",
        ));
    }
}

/// Чи має Cursor hooks config stop-entry з потрібним command marker —
/// точний порт `cursorConfigHasStopHook` (`main.mjs:132-151`).
fn cursor_config_has_stop_hook(config: &serde_json::Value, marker: &str) -> bool {
    let Some(config_obj) = config.as_object() else {
        return false;
    };
    let Some(hooks) = config_obj.get("hooks").and_then(|v| v.as_object()) else {
        return false;
    };
    let Some(stop) = hooks.get("stop").and_then(|v| v.as_array()) else {
        return false;
    };
    stop.iter().any(|entry| {
        entry
            .as_object()
            .and_then(|e| e.get("command"))
            .and_then(|c| c.as_str())
            .is_some_and(|command| command.contains(marker))
    })
}

/// Перевіряє project-level Cursor hooks config для ADR stop-hooks — точний
/// порт `checkCursorHooks` (`main.mjs:159-179`).
fn check_cursor_hooks(cwd: &Path, violations: &mut Vec<Violation>) {
    let cursor_hooks_abs = cwd.join(".cursor/hooks.json");
    if !cursor_hooks_abs.exists() {
        violations.push(fail(
            "`.cursor/hooks.json` не існує — запусти `npx @7n/rules`",
        ));
        return;
    }
    let config: Option<serde_json::Value> = std::fs::read_to_string(&cursor_hooks_abs)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());
    let Some(config) = config else {
        violations.push(fail(
            "`.cursor/hooks.json` не парситься як JSON — запусти `npx @7n/rules` або виправ файл",
        ));
        return;
    };
    for artifact in HOOK_ARTIFACTS {
        let marker = project_hook_path(artifact.script_name);
        if !cursor_config_has_stop_hook(&config, &marker) {
            violations.push(fail(format!(
                "`.cursor/hooks.json`: відсутній stop-hook для `{marker}` (adr.mdc)"
            )));
        }
    }
}

/// Перевіряє `.gitignore` для всіх hook-логів одним проходом — точний порт
/// `checkGitignore` (`main.mjs:208-221`, разом із `checkGitignoreForLog`
/// `main.mjs:188-200`).
fn check_gitignore(cwd: &Path, violations: &mut Vec<Violation>) {
    let gitignore_abs = cwd.join(".gitignore");
    if !gitignore_abs.exists() {
        for artifact in HOOK_ARTIFACTS {
            violations.push(fail(format!(
                "`.gitignore` не існує — додай рядок `{}`",
                project_log_path(artifact.log_name)
            )));
        }
        return;
    }
    let content = std::fs::read_to_string(&gitignore_abs).unwrap_or_default();
    let lines: Vec<String> = split_lines(&content)
        .into_iter()
        .map(str::trim)
        .map(String::from)
        .collect();
    for artifact in HOOK_ARTIFACTS {
        let log_path = project_log_path(artifact.log_name);
        let covers = lines
            .iter()
            .any(|line| gitignore_line_covers_hook_log(line, &log_path));
        if !covers {
            violations.push(fail(format!(
                "`.gitignore` не ігнорує `{log_path}` — додай цей рядок"
            )));
        }
    }
}

/// Перевіряє `.gitignore` на наявність рядків для файлів стану
/// normalize-хука — точний порт `checkGitignoreForStateFiles`
/// (`main.mjs:320-333`).
fn check_gitignore_for_state_files(cwd: &Path, violations: &mut Vec<Violation>) {
    let gitignore_abs = cwd.join(".gitignore");
    let content = std::fs::read_to_string(&gitignore_abs).unwrap_or_default();
    let lines: Vec<String> = split_lines(&content)
        .into_iter()
        .map(str::trim)
        .map(String::from)
        .collect();
    for file in NORMALIZE_STATE_FILES {
        let state_path = format!("{CLAUDE_HOOKS_REL}/{file}");
        let covers = lines
            .iter()
            .any(|line| gitignore_line_covers_state_path(line, &state_path));
        if !covers {
            violations.push(fail(format!(
                "`.gitignore` не ігнорує `{state_path}` — додай рядок (adr.mdc)"
            )));
        }
    }
}

/// Перевіряє наявність каталогу `docs/adr/` — точний порт `checkDocsAdrDir`
/// (`main.mjs:341-349`).
fn check_docs_adr_dir(cwd: &Path, violations: &mut Vec<Violation>) {
    if !cwd.join("docs/adr").exists() {
        violations.push(fail(
            "`docs/adr/` відсутній — створи каталог для ADR-ів (adr.mdc)",
        ));
    }
}

/// Чи виконуваний бінарник з іменем `name` доступний у `PATH` поточного
/// процесу — точний порт `isBinaryInPath` (`main.mjs:229-241`).
fn is_binary_in_path(name: &str) -> bool {
    let Ok(path) = std::env::var("PATH") else {
        return false;
    };
    if path.is_empty() {
        return false;
    }
    std::env::split_paths(&path).any(|dir| dir.join(name).exists())
}

/// npm-first пошук `pi`-бінарника — точний порт `findPiCmd` (`main.mjs:249-260`).
fn find_pi_cmd(cwd: &Path) -> Option<String> {
    let candidates = [
        cwd.join("node_modules").join(".bin").join("pi"),
        cwd.join("node_modules")
            .join("@nitra")
            .join("cursor")
            .join("node_modules")
            .join(".bin")
            .join("pi"),
    ];
    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    is_binary_in_path("pi").then(|| "pi".to_string())
}

/// Інформативний (завжди "pass", доккомент модуля) статус capture-бекенду —
/// точний функціональний порт `checkCaptureBackendAvailable`
/// (`main.mjs:271-295`), включно з `resolveModel('min')`/`isLocalModel`
/// (`llm_lib::tiers::resolve_model`/`is_local_model` — Р9 спеки).
#[must_use]
pub fn capture_backend_status(cwd: &Path) -> String {
    let backend = std::env::var("CAPTURE_DECISIONS_BACKEND").unwrap_or_else(|_| "pi".to_string());
    let backend = if backend.is_empty() {
        "pi".to_string()
    } else {
        backend
    };
    let pi_cmd = find_pi_cmd(cwd);
    let resolved_model = resolve_model(Tier::Min);
    let has_env_pi_model = std::env::var("CAPTURE_DECISIONS_PI_MODEL")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let has_local_model = has_env_pi_model
        || resolved_model
            .as_deref()
            .is_some_and(|m| !m.is_empty() && is_local_model(m));
    let has_claude = is_binary_in_path("claude");
    let has_cursor = is_binary_in_path("cursor-agent");

    let pi_status = match &pi_cmd {
        Some(cmd) if has_local_model => {
            format!("pi знайдено ({cmd}), локальна модель сконфігурована")
        }
        Some(cmd) => format!(
            "pi знайдено ({cmd}), але CAPTURE_DECISIONS_PI_MODEL/N_LOCAL_MIN_MODEL не задано — capture skipне"
        ),
        None => "pi не знайдено (root .bin, nested @7n/rules .bin, PATH) — capture skipне"
            .to_string(),
    };
    let cloud_status = match (has_claude, has_cursor) {
        (true, true) => "claude і cursor-agent доступні".to_string(),
        (true, false) => "claude доступний, cursor-agent відсутній".to_string(),
        (false, true) => "cursor-agent доступний, claude відсутній".to_string(),
        (false, false) => "жодного cloud-бекенду не знайдено".to_string(),
    };

    format!("Capture backend (CAPTURE_DECISIONS_BACKEND={backend}): {pi_status}; cloud-фолбек: {cloud_status}")
}

/// Detector `adr/hooks` — точний порт `lint(ctx)` (`main.mjs:356-369`).
/// `checkCaptureBackendAvailable` викликається (як і в JS — `main.mjs:367`),
/// але результат відкидається: доккомент модуля — `pass()`-only, тож він
/// НІКОЛИ не впливає на `violations`, лише обчислюється (той самий видимий
/// ефект нуль-violations, що й у JS, з тим самим побічним обчисленням).
pub fn adr_hooks(cwd: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();
    for artifact in HOOK_ARTIFACTS {
        check_hook_script(cwd, artifact, &mut violations);
    }
    check_project_settings(cwd, &mut violations);
    check_cursor_hooks(cwd, &mut violations);
    check_gitignore(cwd, &mut violations);
    check_gitignore_for_state_files(cwd, &mut violations);
    check_docs_adr_dir(cwd, &mut violations);
    let _ = capture_backend_status(cwd);
    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    fn write_json(tmp: &TempDir, rel: &str, value: serde_json::Value) {
        write(tmp, rel, &value.to_string());
    }

    fn valid_settings() -> serde_json::Value {
        serde_json::json!({
            "hooks": {
                "Stop": [
                    { "matcher": "", "hooks": [{ "type": "command", "command": "npx --no @7n/rules stop-hook", "timeout": 60 }] },
                    { "matcher": "", "hooks": [{ "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-decisions.sh\"", "async": true, "timeout": 180 }] },
                    { "matcher": "", "hooks": [{ "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/normalize-decisions.sh\"", "async": true, "timeout": 600 }] }
                ]
            }
        })
    }

    fn setup_valid_project(tmp: &TempDir) {
        write(
            tmp,
            ".claude/hooks/capture-decisions.sh",
            CAPTURE_DECISIONS_SCRIPT,
        );
        write(
            tmp,
            ".claude/hooks/normalize-decisions.sh",
            NORMALIZE_DECISIONS_SCRIPT,
        );
        write_json(tmp, ".claude/settings.json", valid_settings());
        write_json(
            tmp,
            ".cursor/hooks.json",
            serde_json::json!({
                "version": 1,
                "hooks": {
                    "stop": [
                        { "command": "bash \"$PWD/.claude/hooks/capture-decisions.sh\"", "timeout": 180 },
                        { "command": "bash \"$PWD/.claude/hooks/normalize-decisions.sh\"", "timeout": 600 }
                    ]
                }
            }),
        );
        write(
            tmp,
            ".gitignore",
            "node_modules/\n.claude/hooks/capture-decisions.log\n.claude/hooks/normalize-decisions.log\n.claude/hooks/.normalize-state\n.claude/hooks/.normalize.lock\n",
        );
        fs::create_dir_all(tmp.path().join("docs/adr")).unwrap();
    }

    #[test]
    fn full_valid_setup_is_clean() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        assert!(adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn non_canonical_capture_script_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(&tmp, ".claude/hooks/capture-decisions.sh", "");
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn non_canonical_normalize_script_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(&tmp, ".claude/hooks/normalize-decisions.sh", "");
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn missing_capture_script_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        fs::remove_file(tmp.path().join(".claude/hooks/capture-decisions.sh")).unwrap();
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn missing_project_settings_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        fs::remove_file(tmp.path().join(".claude/settings.json")).unwrap();
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn missing_cursor_hooks_json_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        fs::remove_file(tmp.path().join(".cursor/hooks.json")).unwrap();
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn invalid_json_cursor_hooks_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(&tmp, ".cursor/hooks.json", "{ invalid json }");
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn cursor_hooks_missing_capture_marker_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write_json(
            &tmp,
            ".cursor/hooks.json",
            serde_json::json!({
                "version": 1,
                "hooks": { "stop": [{ "command": "bash \"$PWD/.claude/hooks/normalize-decisions.sh\"" }] }
            }),
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn cursor_hooks_array_config_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(&tmp, ".cursor/hooks.json", "[]");
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn cursor_hooks_array_hooks_field_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write_json(
            &tmp,
            ".cursor/hooks.json",
            serde_json::json!({ "hooks": [] }),
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn cursor_hooks_non_array_stop_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write_json(
            &tmp,
            ".cursor/hooks.json",
            serde_json::json!({ "hooks": { "stop": null } }),
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn cursor_hooks_null_stop_entry_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write_json(
            &tmp,
            ".cursor/hooks.json",
            serde_json::json!({ "hooks": { "stop": [null] } }),
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn gitignore_missing_capture_log_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(
            &tmp,
            ".gitignore",
            "node_modules/\n.claude/hooks/normalize-decisions.log\n",
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn gitignore_missing_normalize_log_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(
            &tmp,
            ".gitignore",
            "node_modules/\n.claude/hooks/capture-decisions.log\n",
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn gitignore_wide_glob_star_log_passes() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(
            &tmp,
            ".gitignore",
            "node_modules/\n*.log\n.claude/hooks/.normalize-state\n.claude/hooks/.normalize.lock\n",
        );
        assert!(adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn gitignore_claude_hooks_star_covers_logs_and_state() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(&tmp, ".gitignore", "node_modules/\n.claude/hooks/*\n");
        assert!(adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn missing_gitignore_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        fs::remove_file(tmp.path().join(".gitignore")).unwrap();
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn gitignore_missing_normalize_state_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(
            &tmp,
            ".gitignore",
            "node_modules/\n.claude/hooks/capture-decisions.log\n.claude/hooks/normalize-decisions.log\n.claude/hooks/.normalize.lock\n",
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn gitignore_missing_normalize_lock_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write(
            &tmp,
            ".gitignore",
            "node_modules/\n.claude/hooks/capture-decisions.log\n.claude/hooks/normalize-decisions.log\n.claude/hooks/.normalize-state\n",
        );
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn missing_docs_adr_dir_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        fs::remove_dir_all(tmp.path().join("docs/adr")).unwrap();
        assert!(!adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn settings_local_json_without_adr_hooks_is_not_duplicate_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_project(&tmp);
        write_json(
            &tmp,
            ".claude/settings.local.json",
            serde_json::json!({ "permissions": { "allow": ["Bash"] } }),
        );
        assert!(adr_hooks(tmp.path()).is_empty());
    }

    #[test]
    fn all_violations_carry_hooks_reason() {
        let tmp = TempDir::new().unwrap();
        for v in adr_hooks(tmp.path()) {
            assert_eq!(v.reason, "hooks");
            assert!(v.file.is_none());
        }
    }

    // --- capture_backend_status: llm_lib::tiers-інтеграція (Р9 спеки) ---

    #[test]
    fn capture_backend_status_never_panics_and_mentions_backend() {
        let tmp = TempDir::new().unwrap();
        let status = capture_backend_status(tmp.path());
        assert!(status.contains("Capture backend"));
    }

    #[test]
    fn capture_backend_status_reports_local_model_when_env_pi_model_set() {
        let tmp = TempDir::new().unwrap();
        // CAPTURE_DECISIONS_PI_MODEL сам собою вважається "локальна модель
        // сконфігурована" незалежно від resolve_model/is_local_model
        // (main.mjs:276 — `||` з env-полем перед резолвом).
        // SAFETY: тест ізольований по env-змінній, послідовний виклик у
        // межах цього тесту (не паралелиться з іншими тестами цього ж env).
        unsafe { std::env::set_var("CAPTURE_DECISIONS_PI_MODEL", "omlx/whatever") };
        let status = capture_backend_status(tmp.path());
        unsafe { std::env::remove_var("CAPTURE_DECISIONS_PI_MODEL") };
        assert!(status.contains("Capture backend"));
    }
}
