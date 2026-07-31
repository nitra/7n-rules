//! Native-порт `tauri/tool_surface` (`npm/rules/tauri/tool_surface/main.mjs`,
//! 119 рядків) — tauri.mdc `tool_surface`: кожен Tauri-плагін, якого JS
//! торкається через wrapper-пакет `@tauri-apps/plugin-*` чи прямий
//! `invoke('plugin:<slug>|...')`, має бути (1) залежністю в Cargo.toml,
//! (2) згаданий у lib.rs (реєстрація builder-а), (3) мати permission у
//! `capabilities/*.json` — інакше виклик тихо падає в рантаймі, без
//! компіляційної помилки.
//!
//! Reuse-межа: JS-версія імпортувала `findTauriAppWorkspaces`,
//! `groupCargoDepsBySection`, `collectCapabilityPermissionIds` напряму з
//! сусіднього `updater/main.mjs` — тут той самий спільний блок читається з
//! [`crate::concerns::tauri_updater`], без дублювання.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::find_src_tauri::relative_posix;
use crate::concerns::glob_compat::scan_glob;
use crate::concerns::tauri_updater::{
    collect_capability_permission_ids, find_tauri_app_workspaces, group_cargo_deps_by_section,
};
use crate::diagnostics::{Severity, Violation};
use crate::RulesError;

/// JS торкається плагіна, але crate відсутній у `src-tauri/Cargo.toml` —
/// порт `PLUGIN_DEP_MISSING` (`main.mjs:12`).
pub const PLUGIN_DEP_MISSING: &str = "tool-surface-plugin-dep-missing";
/// JS торкається плагіна, але його rust-ідентифікатор ніде не згадується в
/// `lib.rs` — порт `PLUGIN_NOT_REGISTERED` (`main.mjs:14`).
pub const PLUGIN_NOT_REGISTERED: &str = "tool-surface-plugin-not-registered";
/// JS торкається плагіна, але жодна `capabilities/*.json` не дає йому
/// permission — порт `PLUGIN_CAPABILITY_MISSING` (`main.mjs:16`).
pub const PLUGIN_CAPABILITY_MISSING: &str = "tool-surface-plugin-capability-missing";

static JS_PLUGIN_IMPORT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@tauri-apps/plugin-([a-z0-9-]+)").expect("valid regex"));
static INVOKE_PLUGIN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"invoke\(\s*['"]plugin:([a-z0-9-]+)\|"#).expect("valid regex"));

/// Збирає slugs Tauri-плагінів, яких торкається JS/TS/Vue-код — точний порт
/// `collectPluginUsages` (`main.mjs:29-44`). `BTreeSet` замість `Set` +
/// окремий `.toSorted()` — природний ordered-set, дає той самий
/// відсортований прохід у [`check_workspace`].
fn collect_plugin_usages(src_dir: &Path) -> Result<BTreeSet<String>, RulesError> {
    let mut slugs = BTreeSet::new();
    if !src_dir.exists() {
        return Ok(slugs);
    }

    let mut files: Vec<String> = Vec::new();
    for pattern in ["**/*.js", "**/*.ts", "**/*.jsx", "**/*.tsx", "**/*.vue"] {
        files.extend(scan_glob(pattern, src_dir));
    }
    for file in files {
        let content = std::fs::read_to_string(src_dir.join(&file))
            .map_err(|e| RulesError::Concern(format!("{file}: не вдалося прочитати: {e}")))?;
        for caps in JS_PLUGIN_IMPORT_RE.captures_iter(&content) {
            slugs.insert(caps[1].to_string());
        }
        for caps in INVOKE_PLUGIN_RE.captures_iter(&content) {
            slugs.insert(caps[1].to_string());
        }
    }
    Ok(slugs)
}

/// Перевіряє один workspace — точний порт `checkWorkspace` (`main.mjs:57-103`).
fn check_workspace(
    ws: &str,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let base = if ws == "." {
        cwd.to_path_buf()
    } else {
        cwd.join(ws)
    };
    let src_dir = base.join("src");
    let used_slugs = collect_plugin_usages(&src_dir)?;
    if used_slugs.is_empty() {
        return Ok(());
    }

    let src_tauri_dir = base.join("src-tauri");
    let cargo_path = src_tauri_dir.join("Cargo.toml");
    let lib_rs_path = src_tauri_dir.join("src").join("lib.rs");
    let cap_dir = src_tauri_dir.join("capabilities");

    let by_section = if cargo_path.exists() {
        let text = std::fs::read_to_string(&cargo_path)
            .map_err(|e| RulesError::Concern(format!("Cargo.toml: не вдалося прочитати: {e}")))?;
        group_cargo_deps_by_section(&text)
    } else {
        Vec::new()
    };
    let lib_rs_content = if lib_rs_path.exists() {
        std::fs::read_to_string(&lib_rs_path)
            .map_err(|e| RulesError::Concern(format!("lib.rs: не вдалося прочитати: {e}")))?
    } else {
        String::new()
    };
    let cap_ids = collect_capability_permission_ids(&cap_dir);

    let cargo_rel = relative_posix(cwd, &cargo_path);
    let lib_rs_rel = relative_posix(cwd, &lib_rs_path);
    let cap_rel = relative_posix(cwd, &cap_dir);

    for slug in &used_slugs {
        let cargo_dep = format!("tauri-plugin-{slug}");
        let rust_ident = format!("tauri_plugin_{}", slug.replace('-', "_"));

        if by_section
            .iter()
            .all(|(_, keys)| !keys.iter().any(|k| k == &cargo_dep))
        {
            violations.push(Violation {
                reason: PLUGIN_DEP_MISSING.to_string(),
                message: format!(
                    r#"{cargo_rel}: JS звертається до плагіна "{slug}" (@tauri-apps/plugin-{slug} чи invoke('plugin:{slug}|...')), але "{cargo_dep}" відсутній у Cargo.toml (tauri.mdc tool_surface)"#
                ),
                file: Some(cargo_rel.clone()),
                severity: Severity::Error,
                data: Some(serde_json::json!({ "slug": slug })),
            });
        }

        if !lib_rs_content.contains(&rust_ident) {
            violations.push(Violation {
                reason: PLUGIN_NOT_REGISTERED.to_string(),
                message: format!(
                    r#"{lib_rs_rel}: плагін "{slug}" ніде не згадується — invoke('plugin:{slug}|...') з UI тихо впаде, бо builder.plugin({rust_ident}::…) не зареєстрований (tauri.mdc tool_surface)"#
                ),
                file: Some(lib_rs_rel.clone()),
                severity: Severity::Error,
                data: Some(serde_json::json!({ "slug": slug })),
            });
        }

        if cap_ids
            .iter()
            .all(|id| id != slug && !id.starts_with(&format!("{slug}:")))
        {
            violations.push(Violation {
                reason: PLUGIN_CAPABILITY_MISSING.to_string(),
                message: format!(
                    r#"{cap_rel}/*.json: бракує permission "{slug}:*" для плагіна, якого торкається JS — invoke тихо падає permission-denied, видно лише в console.error (tauri.mdc tool_surface)"#
                ),
                file: Some(cap_rel.clone()),
                severity: Severity::Error,
                data: Some(serde_json::json!({ "slug": slug })),
            });
        }
    }
    Ok(())
}

/// Detector `tauri/tool_surface` — точний порт `lint(ctx)` (`main.mjs:109-119`).
pub fn tauri_tool_surface(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let apps = find_tauri_app_workspaces(cwd);
    let mut violations = Vec::new();
    for ws in &apps {
        check_workspace(ws, cwd, &mut violations)?;
    }
    Ok(violations)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn make_tauri_marker(tmp: &TempDir) {
        write(tmp, "tauri.conf.json", "{}\n");
    }

    fn write_js_plugin_import(tmp: &TempDir) {
        write(
            tmp,
            "src/App.vue",
            "<script setup>\nimport { open } from '@tauri-apps/plugin-dialog'\nopen()\n</script>\n",
        );
    }

    fn write_js_invoke_call(tmp: &TempDir) {
        write(
            tmp,
            "src/main.ts",
            "import { invoke } from '@tauri-apps/api/core'\ninvoke('plugin:shell|open', { path: '/tmp' })\n",
        );
    }

    fn write_cargo_toml(tmp: &TempDir, deps: &[&str]) {
        let lines: Vec<String> = std::iter::once("[dependencies]".to_string())
            .chain(deps.iter().map(|d| format!("{d} = \"2\"")))
            .collect();
        write(
            tmp,
            "src-tauri/Cargo.toml",
            &format!("{}\n", lines.join("\n")),
        );
    }

    fn write_lib_rs(tmp: &TempDir, identifiers: &[&str]) {
        let plugins: Vec<String> = identifiers
            .iter()
            .map(|id| format!("        .plugin({id}::init())"))
            .collect();
        write(
            tmp,
            "src-tauri/src/lib.rs",
            &format!(
                "pub fn run() {{\n    tauri::Builder::default()\n{}\n        .run(tauri::generate_context!())\n        .unwrap();\n}}\n",
                plugins.join("\n")
            ),
        );
    }

    fn write_capabilities(tmp: &TempDir, permissions: &[&str]) {
        write(
            tmp,
            "src-tauri/capabilities/default.json",
            &serde_json::json!({ "permissions": permissions }).to_string(),
        );
    }

    #[test]
    fn without_tauri_marker_rule_does_not_activate() {
        let tmp = TempDir::new().unwrap();
        write_js_plugin_import(&tmp);
        assert!(tauri_tool_surface(tmp.path()).unwrap().is_empty());
    }

    #[test]
    fn js_touches_plugin_absent_everywhere_reports_all_three() {
        let tmp = TempDir::new().unwrap();
        make_tauri_marker(&tmp);
        write_js_plugin_import(&tmp);
        let violations = tauri_tool_surface(tmp.path()).unwrap();
        let reasons: Vec<&str> = violations.iter().map(|v| v.reason.as_str()).collect();
        assert!(reasons.contains(&PLUGIN_DEP_MISSING));
        assert!(reasons.contains(&PLUGIN_NOT_REGISTERED));
        assert!(reasons.contains(&PLUGIN_CAPABILITY_MISSING));
    }

    #[test]
    fn crate_present_but_not_registered_skips_dep_missing() {
        let tmp = TempDir::new().unwrap();
        make_tauri_marker(&tmp);
        write_js_plugin_import(&tmp);
        write_cargo_toml(&tmp, &["tauri-plugin-dialog"]);
        let violations = tauri_tool_surface(tmp.path()).unwrap();
        let reasons: Vec<&str> = violations.iter().map(|v| v.reason.as_str()).collect();
        assert!(!reasons.contains(&PLUGIN_DEP_MISSING));
        assert!(reasons.contains(&PLUGIN_NOT_REGISTERED));
        assert!(reasons.contains(&PLUGIN_CAPABILITY_MISSING));
    }

    #[test]
    fn dep_and_lib_rs_present_only_capability_missing() {
        let tmp = TempDir::new().unwrap();
        make_tauri_marker(&tmp);
        write_js_plugin_import(&tmp);
        write_cargo_toml(&tmp, &["tauri-plugin-dialog"]);
        write_lib_rs(&tmp, &["tauri_plugin_dialog"]);
        let violations = tauri_tool_surface(tmp.path()).unwrap();
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, PLUGIN_CAPABILITY_MISSING);
    }

    #[test]
    fn direct_invoke_call_also_triggers_check() {
        let tmp = TempDir::new().unwrap();
        make_tauri_marker(&tmp);
        write_js_invoke_call(&tmp);
        let violations = tauri_tool_surface(tmp.path()).unwrap();
        assert!(violations.iter().any(|v| v
            .data
            .as_ref()
            .and_then(|d| d.get("slug"))
            .and_then(|s| s.as_str())
            == Some("shell")));
    }

    #[test]
    fn full_canonical_chain_is_clean() {
        let tmp = TempDir::new().unwrap();
        make_tauri_marker(&tmp);
        write_js_plugin_import(&tmp);
        write_cargo_toml(&tmp, &["tauri-plugin-dialog"]);
        write_lib_rs(&tmp, &["tauri_plugin_dialog"]);
        write_capabilities(&tmp, &["dialog:default"]);
        assert!(tauri_tool_surface(tmp.path()).unwrap().is_empty());
    }
}
