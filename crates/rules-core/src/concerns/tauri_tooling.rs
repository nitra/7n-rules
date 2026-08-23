//! Native-порт `tauri/tooling` (`npm/rules/tauri/tooling/main.mjs`, 94
//! рядки) — tauri.mdc: якщо проєкт (чи будь-який його workspace-пакет) має
//! маркер Tauri (`src-tauri/`-каталог, `src-tauri/Cargo.toml`,
//! `tauri.conf.json` — nested чи flat, або залежність `@tauri-apps/*` у
//! `package.json`), корінний `.vscode/extensions.json` повинен існувати й
//! мати `recommendations` з `tauri-apps.tauri-vscode` — друге перевіряється
//! rego-полісі `tauri/vscode_extensions` через [`crate::conftest::run_conftest_batch`]
//! (та сама «Rego-authoritative» межа, що в [`super::k8s_hasura_configmap`]/
//! [`super::text_markdownlint`] — сам rego тут НЕ портується).
//!
//! `getMonorepoPackageRootDirs` — [`super::workspaces::get_monorepo_package_root_dirs`],
//! уже вжитий [`super::tauri_release`]/[`super::tauri_updater`].
//!
//! # Канал помилок — по гілках
//!
//! JS-канон обгортає все `lint(ctx)` у `createViolationReporter`
//! (`violation-reporter.mjs`), але `pass()` — навмисний no-op (успіх не
//! накопичує ні violation, ні нотатку), тож [`crate::diagnostics::ConcernDiagnostic`]
//! у цьому концерні не зʼявляється НІКОЛИ — порожній `ConcernReport::default()`
//! і є точним дзеркалом «чистого» прогону.
//!
//! - **читання/парсинг `package.json` у [`workspace_has_tauri_marker`]**
//!   (`main.mjs:38-44`, `JSON.parse(await readFile(...))`) — виклик БЕЗ
//!   `try/catch`, і `projectHasTauriMarker`/`lint(ctx)` теж не ловлять цей
//!   виняток — піднімається аж до рушія `lint()` → [`RulesError::Concern`];
//! - **`runConftestBatch(...)`** (`main.mjs:78-82`) — так само викликається
//!   БЕЗ `try/catch` (ні тут, ні деінде в `lint(ctx)`) — будь-яка його
//!   помилка (тул не резолвиться, rego-каталог відсутній, спавн упав,
//!   exit-код поза `{0,1}`) так само піднімається як [`RulesError::Concern`]
//!   (готово всередині [`crate::conftest::run_conftest_batch`], тут лише
//!   пропускається через `?`);
//! - **відсутній `.vscode/extensions.json`** (`main.mjs:74-77`) — це власний
//!   `fail(...)` JS-канону (не виняток) → звичайна violation, не `Err`;
//! - **порушення rego-полісі** (`main.mjs:84-88`, цикл `for (const v of
//!   violations) fail(v.message)`) — так само `fail(...)` → violation, не
//!   `Err`. Обидва класи `fail()`-порушень нижче ділять ОДИН reason —
//!   секція «Спільний reason» нижче.
//!
//! # Спільний reason: `ctx.concernId`, не окремий machine code
//!
//! Жоден із двох `fail(msg)` у `main.mjs:76,86` не передає `opts` (ні
//! рядок-reason, ні обʼєкт) — `createViolationReporter` тоді бере
//! `defaultReason = ctx?.concernId ?? 'violation'` (`violation-reporter.mjs:19,33`).
//! `ctx.concernId` для цього правила — назва каталогу концерну
//! (`npm/rules/tauri/tooling` → `entry.concern.name` = `"tooling"`,
//! `run-detectors.mjs:371,551`), тож і «нема `.vscode/extensions.json`», і
//! «rego-порушення `tauri.vscode_extensions`» у JS-виводі мають РІВНО той
//! самий `reason: "tooling"`. Це не помилка порту — це точне дзеркало
//! чинної поведінки `createViolationReporter`, коли викликач не задає
//! власний reason.
//!
//! # `ctx.files` ігнорується — концерн full-scope
//!
//! `concern.json` цього правила декларує `"lint": {"scope": "full", ...}` —
//! `lint(ctx)` ніколи не читає `ctx.files` (той самий патерн, що
//! [`super::k8s_hasura_configmap`], секція «`ctx.files` ігнорується» його
//! доккоменту). `files` тут — лише заради єдиної сигнатури диспетчера
//! [`super::run_concern`]; full і delta режими дають ідентичний результат
//! (перевірено тестом [`tests::files_parameter_is_ignored_in_both_modes`]).
//!
//! # Violation без `file`/`data`
//!
//! Обидва `fail(msg)` викликаються без `opts.file`/`opts.data`
//! (`violation-reporter.mjs:31`: `if (o.file) v.file = o.file` — умова
//! хибна для обох викликів), тож жодна violation цього концерну не несе
//! ні `file`, ні `data` — порт лишає обидва поля `None`.

use std::path::Path;

use crate::concerns::workspaces::get_monorepo_package_root_dirs;
use crate::conftest::{run_conftest_batch, ConftestViolation};
use crate::diagnostics::{ConcernReport, Severity, Violation};
use crate::rules_package::{missing_package_root_hint, rules_root};
use crate::RulesError;

/// Спільний machine code для ОБОХ класів порушень цього концерну — секція
/// «Спільний reason» доккоменту модуля.
const REASON: &str = "tooling";

/// Відносний шлях кореневого `.vscode/extensions.json` — порт `extPath`
/// (`main.mjs:73`).
const EXT_PATH: &str = ".vscode/extensions.json";

/// Каталог rego-полісі відносно `<корінь пакета>/rules` — порт
/// `policyDirRel: 'tauri/vscode_extensions'` (`main.mjs:78`).
const POLICY_DIR_REL: &str = "tauri/vscode_extensions";

/// Namespace rego-пакета — порт `namespace: 'tauri.vscode_extensions'`
/// (`main.mjs:79`).
const NAMESPACE: &str = "tauri.vscode_extensions";

/// Чи `dependencies`/`devDependencies` `pkg` мають ключ з префіксом
/// `@tauri-apps/` — точний порт `packageHasTauriDep` (`main.mjs:16-27`).
fn package_has_tauri_dep(pkg: &serde_json::Value) -> bool {
    let Some(obj) = pkg.as_object() else {
        return false;
    };
    for field in ["dependencies", "devDependencies"] {
        let Some(deps) = obj.get(field).and_then(serde_json::Value::as_object) else {
            continue;
        };
        if deps.keys().any(|name| name.starts_with("@tauri-apps/")) {
            return true;
        }
    }
    false
}

/// Чи один workspace-пакет має маркер Tauri — точний порт
/// `workspaceHasTauriMarker` (`main.mjs:33-45`): каталог `src-tauri/`,
/// `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, flat
/// `tauri.conf.json`, або `package.json` із залежністю `@tauri-apps/*`.
///
/// Помилка читання/парсингу `package.json` піднімається як
/// [`RulesError::Concern`] — секція «Канал помилок» доккоменту модуля
/// (JS-гілка без `try/catch`).
fn workspace_has_tauri_marker(cwd: &Path, ws: &str) -> Result<bool, RulesError> {
    let base = if ws == "." {
        cwd.to_path_buf()
    } else {
        cwd.join(ws)
    };
    let src_tauri = base.join("src-tauri");
    if src_tauri.is_dir() {
        return Ok(true);
    }
    if src_tauri.join("Cargo.toml").exists() {
        return Ok(true);
    }
    if src_tauri.join("tauri.conf.json").exists() {
        return Ok(true);
    }
    if base.join("tauri.conf.json").exists() {
        return Ok(true);
    }

    let pkg_path = base.join("package.json");
    if !pkg_path.exists() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(&pkg_path).map_err(|error| {
        RulesError::Concern(format!(
            "{}: не вдалося прочитати: {error}",
            pkg_path.display()
        ))
    })?;
    let pkg: serde_json::Value = serde_json::from_str(&raw).map_err(|error| {
        RulesError::Concern(format!(
            "{}: не вдалося розпарсити JSON: {error}",
            pkg_path.display()
        ))
    })?;
    Ok(package_has_tauri_dep(&pkg))
}

/// Чи хоч один workspace монорепо (корінь чи будь-який пакет із
/// `workspaces`) має маркер Tauri — точний порт `projectHasTauriMarker`
/// (`main.mjs:51-57`).
fn project_has_tauri_marker(cwd: &Path) -> Result<bool, RulesError> {
    for ws in get_monorepo_package_root_dirs(cwd) {
        if workspace_has_tauri_marker(cwd, &ws)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Violation «нема `.vscode/extensions.json`» — точний порт тексту
/// `fail(...)` (`main.mjs:74-76`).
fn missing_extensions_file_violation() -> Violation {
    Violation {
        reason: REASON.to_string(),
        message: format!(
            "{EXT_PATH} не існує — створи з recommendations \"tauri-apps.tauri-vscode\" (tauri.mdc)"
        ),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Violation з одного rego-порушення `tauri.vscode_extensions` — точний
/// порт `fail(v.message)` (`main.mjs:86`): жоден `file`/`data` не
/// проставляється, повідомлення — сире `v.message` без префікса шляху
/// (JS-канон його теж не додає).
fn conftest_violation(failure: ConftestViolation) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message: failure.message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Detector `tauri/tooling` — точний порт `lint(ctx)` (`main.mjs:63-92`).
///
/// `files` приймається лише заради єдиної сигнатури [`super::run_concern`] і
/// не читається — секція «`ctx.files` ігнорується» доккоменту модуля.
pub fn tauri_tooling(cwd: &Path, _files: Option<&[String]>) -> Result<ConcernReport, RulesError> {
    let has_tauri = project_has_tauri_marker(cwd)?;
    if !has_tauri {
        // `pass(...)` (`main.mjs:71`) — no-op, секція доккоменту модуля.
        return Ok(ConcernReport::default());
    }

    let ext_path = cwd.join(EXT_PATH);
    if !ext_path.exists() {
        return Ok(ConcernReport::from(vec![
            missing_extensions_file_violation(),
        ]));
    }

    let policy_abs = rules_root(cwd)
        .ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?
        .join(POLICY_DIR_REL);
    let failures = run_conftest_batch(&policy_abs, NAMESPACE, &[ext_path])?;
    if failures.is_empty() {
        return Ok(ConcernReport::default());
    }
    Ok(ConcernReport::from(
        failures
            .into_iter()
            .map(conftest_violation)
            .collect::<Vec<_>>(),
    ))
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    // --- package_has_tauri_dep ---

    #[test]
    fn package_has_tauri_dep_false_for_non_object() {
        assert!(!package_has_tauri_dep(&serde_json::json!(null)));
        assert!(!package_has_tauri_dep(&serde_json::json!("string")));
        assert!(!package_has_tauri_dep(&serde_json::json!([1, 2])));
    }

    #[test]
    fn package_has_tauri_dep_false_for_empty_object() {
        assert!(!package_has_tauri_dep(&serde_json::json!({})));
    }

    #[test]
    fn package_has_tauri_dep_true_for_dependencies_prefix() {
        let pkg = serde_json::json!({ "dependencies": { "@tauri-apps/api": "2.0.0" } });
        assert!(package_has_tauri_dep(&pkg));
    }

    #[test]
    fn package_has_tauri_dep_true_for_dev_dependencies_prefix() {
        let pkg = serde_json::json!({ "devDependencies": { "@tauri-apps/cli": "2.0.0" } });
        assert!(package_has_tauri_dep(&pkg));
    }

    #[test]
    fn package_has_tauri_dep_false_without_prefix_match() {
        let pkg = serde_json::json!({
            "dependencies": { "vue": "3.0.0" },
            "devDependencies": { "vite": "5.0.0" }
        });
        assert!(!package_has_tauri_dep(&pkg));
    }

    // --- workspace_has_tauri_marker ---

    #[test]
    fn workspace_marker_true_for_src_tauri_directory() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "src-tauri/.keep", "");
        assert!(workspace_has_tauri_marker(tmp.path(), ".").unwrap());
    }

    #[test]
    fn workspace_marker_true_for_nested_tauri_conf() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "src-tauri/tauri.conf.json", "{}\n");
        assert!(workspace_has_tauri_marker(tmp.path(), ".").unwrap());
    }

    #[test]
    fn workspace_marker_true_for_flat_tauri_conf() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "tauri.conf.json", "{}\n");
        assert!(workspace_has_tauri_marker(tmp.path(), ".").unwrap());
    }

    #[test]
    fn workspace_marker_true_for_package_json_dependency() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"dependencies":{"@tauri-apps/api":"2.0.0"}}"#,
        );
        assert!(workspace_has_tauri_marker(tmp.path(), ".").unwrap());
    }

    #[test]
    fn workspace_marker_false_without_package_json() {
        let tmp = TempDir::new().unwrap();
        assert!(!workspace_has_tauri_marker(tmp.path(), ".").unwrap());
    }

    #[test]
    fn workspace_marker_false_for_unrelated_package_json() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"dependencies":{"vue":"3.0.0"}}"#);
        assert!(!workspace_has_tauri_marker(tmp.path(), ".").unwrap());
    }

    #[test]
    fn workspace_marker_resolves_non_root_ws_subdirectory() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "apps/desktop/tauri.conf.json", "{}\n");
        assert!(workspace_has_tauri_marker(tmp.path(), "apps/desktop").unwrap());
        assert!(!workspace_has_tauri_marker(tmp.path(), "apps/other").unwrap());
    }

    #[test]
    fn workspace_marker_malformed_package_json_is_concern_error() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{not json");
        let err = workspace_has_tauri_marker(tmp.path(), ".").unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("розпарсити"), "{err}");
    }

    // --- project_has_tauri_marker ---

    #[test]
    fn project_marker_false_for_plain_repo() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "README.md", "# hi\n");
        assert!(!project_has_tauri_marker(tmp.path()).unwrap());
    }

    #[test]
    fn project_marker_true_when_workspace_package_has_marker() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"name":"root","workspaces":["apps/*"]}"#,
        );
        write(&tmp, "apps/desktop/package.json", r#"{"name":"desktop"}"#);
        write(&tmp, "apps/desktop/src-tauri/tauri.conf.json", "{}\n");
        assert!(project_has_tauri_marker(tmp.path()).unwrap());
    }

    #[test]
    fn project_marker_propagates_malformed_package_json_error() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{broken");
        let err = project_has_tauri_marker(tmp.path()).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }

    // --- conftest_violation / missing_extensions_file_violation shape ---

    #[test]
    fn missing_extensions_file_violation_has_shared_reason_and_no_file() {
        let v = missing_extensions_file_violation();
        assert_eq!(v.reason, REASON);
        assert!(v.message.contains(EXT_PATH));
        assert!(v.message.contains("tauri-apps.tauri-vscode"));
        assert!(v.file.is_none());
        assert!(v.data.is_none());
        assert_eq!(v.severity, Severity::Error);
    }

    #[test]
    fn conftest_violation_uses_shared_reason_and_raw_message() {
        let failure = ConftestViolation {
            filename: "/repo/.vscode/extensions.json".to_string(),
            namespace: NAMESPACE.to_string(),
            message: ".vscode/extensions.json: recommendations має містити \"tauri-apps.tauri-vscode\" (tauri.mdc)"
                .to_string(),
        };
        let v = conftest_violation(failure.clone());
        assert_eq!(v.reason, REASON);
        assert_eq!(v.message, failure.message);
        assert!(v.file.is_none());
        assert!(v.data.is_none());
    }

    // --- tauri_tooling: top-level orchestration ---

    #[test]
    fn no_tauri_marker_returns_empty_report() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "README.md", "# hi\n");
        let report = tauri_tooling(tmp.path(), None).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    #[test]
    fn tauri_marker_without_extensions_file_yields_single_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "src-tauri/tauri.conf.json", "{}\n");
        let report = tauri_tooling(tmp.path(), None).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, REASON);
        assert!(report.violations[0].message.contains(EXT_PATH));
        assert!(report.diagnostics.is_empty());
    }

    #[test]
    fn tauri_marker_with_extensions_file_without_package_root_fails_closed() {
        if std::env::var("N_RULES_PACKAGE_ROOT").is_ok() {
            return; // оточення з явним override — сценарій недосяжний
        }
        let tmp = TempDir::new().unwrap();
        write(&tmp, "src-tauri/tauri.conf.json", "{}\n");
        write(
            &tmp,
            ".vscode/extensions.json",
            r#"{"recommendations":["tauri-apps.tauri-vscode"]}"#,
        );
        let err = tauri_tooling(tmp.path(), None).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("N_RULES_PACKAGE_ROOT"), "{err}");
    }

    #[test]
    fn malformed_package_json_propagates_as_concern_error() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{not valid json");
        let err = tauri_tooling(tmp.path(), None).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }

    /// `files` не впливає на результат — концерн full-scope (доккомент
    /// модуля, секція «`ctx.files` ігнорується»): full (`None`) і delta
    /// (`Some`) дають ідентичний звіт на тому самому дереві.
    #[test]
    fn files_parameter_is_ignored_in_both_modes() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "src-tauri/tauri.conf.json", "{}\n");

        let full = tauri_tooling(tmp.path(), None).unwrap();
        let delta_files = vec!["src-tauri/tauri.conf.json".to_string()];
        let delta = tauri_tooling(tmp.path(), Some(&delta_files)).unwrap();

        assert_eq!(full.violations.len(), delta.violations.len());
        assert_eq!(full.violations[0].reason, delta.violations[0].reason);
        assert_eq!(full.violations[0].message, delta.violations[0].message);
    }
}
