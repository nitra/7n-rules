//! Native-порт `tauri/updater` (`npm/rules/tauri/updater/main.mjs`,
//! 408 рядків) — tauri.mdc `updater`: канонічні updater/process залежності
//! (package.json, Cargo.toml desktop-only scope, lib.rs
//! `#[cfg(desktop)]`-guard, capabilities permissions, `useUpdater()` виклик
//! у Vue, Quasar `Dialog`-plugin для показу діалогу оновлення).
//!
//! Модуль також містить (`pub(crate)`) [`find_tauri_app_workspaces`],
//! [`group_cargo_deps_by_section`] і [`collect_capability_permission_ids`] —
//! той самий спільний блок, що JS-версія (`updater/main.mjs`) експортувала
//! для `tauri/tool_surface` (`tool_surface/main.mjs` імпортував їх напряму
//! з сусіднього `main.mjs` — єдиний такий імпорт між concern-ами у JS-дереві
//! `rules/tauri/`). Тут — той самий спільний модуль
//! (`crate::concerns::tauri_tool_surface` читає ці функції звідси), без
//! дублювання.

use std::collections::HashSet;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::find_src_tauri::relative_posix;
use crate::concerns::glob_compat::scan_glob;
use crate::concerns::workspaces::get_monorepo_package_root_dirs;
use crate::diagnostics::{Severity, Violation};
use crate::RulesError;

/// Мінімально допустима версія tauri-plugin-updater-сумісних компонентів —
/// порт `MIN_TAURI_COMPONENTS_VERSION` (`main.mjs:12`).
pub(crate) const MIN_TAURI_COMPONENTS_VERSION: [u32; 3] = [0, 8, 0];

static CARGO_TABLE_HEADER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\[(.+)\]\s*$").expect("valid regex"));
static CARGO_DEP_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([A-Za-z0-9_-]+)\s*=").expect("valid regex"));
static SEMVER_FLOOR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?").expect("valid regex"));
/// Розпізнає target-специфічну секцію залежностей — порт
/// `CARGO_TARGET_SECTION_RE` (`main.mjs:17`).
pub(crate) static CARGO_TARGET_SECTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"target\.").expect("valid regex"));
/// Розпізнає мобільну (Android/iOS) target-секцію — порт
/// `CARGO_MOBILE_SECTION_RE` (`main.mjs:19`).
pub(crate) static CARGO_MOBILE_SECTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"android|ios").expect("valid regex"));
static QUASAR_DIALOG_IMPORT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"import\s*\{[^}]*\bDialog\b[^}]*\}\s*from\s*['"]quasar['"]"#).expect("valid regex")
});
static QUASAR_DIALOG_PLUGIN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"plugins\s*:\s*\{[^}]*\bDialog\b").expect("valid regex"));

/// Знаходить workspace-каталоги з Tauri-застосунком (`<ws>/src-tauri/
/// tauri.conf.json` чи legacy `<ws>/tauri.conf.json`) — точний порт
/// `findTauriAppWorkspaces` (`main.mjs:47-57`).
pub(crate) fn find_tauri_app_workspaces(cwd: &Path) -> Vec<String> {
    let roots = get_monorepo_package_root_dirs(cwd);
    let mut found = Vec::new();
    for ws in roots {
        let base = if ws == "." {
            cwd.to_path_buf()
        } else {
            cwd.join(&ws)
        };
        let has_marker = base.join("src-tauri").join("tauri.conf.json").exists()
            || base.join("tauri.conf.json").exists();
        if has_marker {
            found.push(ws);
        }
    }
    found
}

/// Розбирає semver-діапазон (`^0.8.0`, `~2.3.1`, `2`) на числові компоненти
/// нижньої межі — точний порт `parseRangeFloor` (`main.mjs:64-68`).
fn parse_range_floor(range: &str) -> [u32; 3] {
    let Some(caps) = SEMVER_FLOOR_RE.captures(range) else {
        return [0, 0, 0];
    };
    let part = |i: usize| {
        caps.get(i)
            .and_then(|m| m.as_str().parse::<u32>().ok())
            .unwrap_or(0)
    };
    [part(1), part(2), part(3)]
}

/// Чи нижня межа `range` >= `min` — точний порт `meetsMinVersion`
/// (`main.mjs:76-82`).
pub(crate) fn meets_min_version(range: &str, min: [u32; 3]) -> bool {
    let v = parse_range_floor(range);
    for i in 0..3 {
        if v[i] != min[i] {
            return v[i] > min[i];
        }
    }
    true
}

/// Чи мажорна версія `range` дорівнює очікуваній — точний порт `hasMajor`
/// (`main.mjs:90-92`).
pub(crate) fn has_major(range: &str, major: u32) -> bool {
    parse_range_floor(range)[0] == major
}

/// Групує рядки Cargo.toml за заголовком секції `[...]` — точний порт
/// `groupCargoDepsBySection` (`main.mjs:142-157`). `Vec<(section, keys)>`
/// замість `HashMap`, щоб зберегти порядок першої появи секції (той самий
/// insertion-order контракт, що й JS `Map`, хоч логіка нижче на нього не
/// покладається — `some`/`find` над невпорядкованою множиною давали б той
/// самий результат).
pub(crate) fn group_cargo_deps_by_section(content: &str) -> Vec<(String, Vec<String>)> {
    let mut by_section: Vec<(String, Vec<String>)> = Vec::new();
    let mut current: Option<usize> = None;
    for raw_line in content.split('\n') {
        let line = raw_line.trim();
        if let Some(header) = CARGO_TABLE_HEADER_RE.captures(line) {
            let name = header[1].to_string();
            let idx = by_section
                .iter()
                .position(|(k, _)| k == &name)
                .unwrap_or_else(|| {
                    by_section.push((name.clone(), Vec::new()));
                    by_section.len() - 1
                });
            current = Some(idx);
            continue;
        }
        if let (Some(kv), Some(idx)) = (CARGO_DEP_KEY_RE.captures(line), current) {
            by_section[idx].1.push(kv[1].to_string());
        }
    }
    by_section
}

/// Знаходить назву секції Cargo.toml, що оголошує задану залежність —
/// точний порт `findSectionDeclaring` (`main.mjs:165-170`).
fn find_section_declaring(by_section: &[(String, Vec<String>)], dep_name: &str) -> Option<String> {
    by_section
        .iter()
        .find(|(_, keys)| keys.iter().any(|k| k == dep_name))
        .map(|(s, _)| s.clone())
}

/// Збирає всі permission-ідентифікатори з `capabilities/*.json` — точний
/// порт `collectCapabilityPermissionIds` (`main.mjs:263-281`). Битий JSON у
/// файлі — `continue` (той самий `try { JSON.parse(...) } catch { continue }`
/// що й JS, на відміну від `checkPackageJson`, де парсинг НЕ обгорнутий).
pub(crate) fn collect_capability_permission_ids(cap_dir: &Path) -> HashSet<String> {
    let mut ids = HashSet::new();
    if !cap_dir.exists() {
        return ids;
    }
    for file in scan_glob("*.json", cap_dir) {
        let Ok(text) = std::fs::read_to_string(cap_dir.join(&file)) else {
            continue;
        };
        let Ok(cap) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let perms = cap
            .get("permissions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for p in perms {
            let id = match &p {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Object(o) => o
                    .get("identifier")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                _ => None,
            };
            if let Some(id) = id {
                if !id.is_empty() {
                    ids.insert(id);
                }
            }
        }
    }
    ids
}

/// Звітує violation при провалі перевірки — спільна форма для всіх
/// canon-перевірок нижче, аналог `reportCheck` (`main.mjs:34-40`) без
/// pass-гілки (JS-reporter `pass()` — no-op, тут просто не додаємо нічого).
fn report_check(
    ok: bool,
    fail_message: String,
    reason: &str,
    file: &str,
    violations: &mut Vec<Violation>,
) {
    if !ok {
        violations.push(Violation {
            reason: reason.to_string(),
            message: format!("{fail_message} (tauri.mdc updater)"),
            file: Some(file.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }
}

/// Перевіряє `package.json` workspace-каталогу — точний порт
/// `checkPackageJson` (`main.mjs:101-135`). Невалідний JSON — `Err`
/// (JS `JSON.parse(...)` там НЕ обгорнутий у try/catch, тож кидає й валить
/// увесь `lint()`).
fn check_package_json(
    ws: &str,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let base = if ws == "." {
        cwd.to_path_buf()
    } else {
        cwd.join(ws)
    };
    let pkg_path = base.join("package.json");
    if !pkg_path.exists() {
        return Ok(());
    }
    let rel = if ws == "." {
        "package.json".to_string()
    } else {
        format!("{ws}/package.json")
    };

    let text = std::fs::read_to_string(&pkg_path)
        .map_err(|e| RulesError::Concern(format!("{rel}: не вдалося прочитати: {e}")))?;
    let pkg: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| RulesError::Concern(format!("{rel}: не вдалося розпарсити JSON: {e}")))?;

    let mut deps: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for key in ["dependencies", "devDependencies"] {
        if let Some(obj) = pkg.get(key).and_then(|v| v.as_object()) {
            for (k, v) in obj {
                if let Some(s) = v.as_str() {
                    deps.insert(k.clone(), s.to_string());
                }
            }
        }
    }
    let get = |k: &str| deps.get(k).map(String::as_str).unwrap_or("");

    report_check(
        meets_min_version(get("@7n/tauri-components"), MIN_TAURI_COMPONENTS_VERSION),
        format!(
            r#"{rel}: потрібна залежність "@7n/tauri-components" >=0.8 — useUpdater() з локальної копії заборонений"#
        ),
        "tauri-components-version",
        &rel,
        violations,
    );
    report_check(
        has_major(get("@tauri-apps/plugin-updater"), 2),
        format!(r#"{rel}: потрібна залежність "@tauri-apps/plugin-updater" ^2"#),
        "plugin-updater-missing",
        &rel,
        violations,
    );
    report_check(
        has_major(get("@tauri-apps/plugin-process"), 2),
        format!(r#"{rel}: потрібна залежність "@tauri-apps/plugin-process" ^2"#),
        "plugin-process-missing",
        &rel,
        violations,
    );
    Ok(())
}

/// Перевіряє `Cargo.toml` workspace-каталогу — точний порт `checkCargoToml`
/// (`main.mjs:179-212`).
fn check_cargo_toml(
    ws: &str,
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let base = if ws == "." {
        cwd.to_path_buf()
    } else {
        cwd.join(ws)
    };
    let cargo_path = base.join("src-tauri").join("Cargo.toml");
    if !cargo_path.exists() {
        return Ok(());
    }
    let rel = relative_posix(cwd, &cargo_path);

    let text = std::fs::read_to_string(&cargo_path)
        .map_err(|e| RulesError::Concern(format!("{rel}: не вдалося прочитати: {e}")))?;
    let by_section = group_cargo_deps_by_section(&text);

    report_check(
        by_section
            .iter()
            .any(|(_, keys)| keys.iter().any(|k| k == "tauri-plugin-process")),
        format!(r#"{rel}: бракує "tauri-plugin-process" у [dependencies]"#),
        "cargo-plugin-process-missing",
        &rel,
        violations,
    );

    let Some(updater_section) = find_section_declaring(&by_section, "tauri-plugin-updater") else {
        violations.push(Violation {
            reason: "cargo-plugin-updater-missing".to_string(),
            message: format!(r#"{rel}: бракує "tauri-plugin-updater" (tauri.mdc updater)"#),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: None,
        });
        return Ok(());
    };
    report_check(
        CARGO_TARGET_SECTION_RE.is_match(&updater_section)
            && CARGO_MOBILE_SECTION_RE.is_match(&updater_section),
        format!(
            r#"{rel}: "tauri-plugin-updater" має бути в desktop-only [target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies], не в безумовному [dependencies] — плагін не реєструється на mobile"#
        ),
        "cargo-plugin-updater-not-scoped",
        &rel,
        violations,
    );
    Ok(())
}

/// Перевіряє реєстрацію updater/process плагінів у `src-tauri/src/lib.rs` —
/// точний порт `checkLibRs` (`main.mjs:221-256`).
fn check_lib_rs(ws: &str, cwd: &Path, violations: &mut Vec<Violation>) -> Result<(), RulesError> {
    let base = if ws == "." {
        cwd.to_path_buf()
    } else {
        cwd.join(ws)
    };
    let lib_path = base.join("src-tauri").join("src").join("lib.rs");
    if !lib_path.exists() {
        return Ok(());
    }
    let rel = relative_posix(cwd, &lib_path);

    let raw = std::fs::read_to_string(&lib_path)
        .map_err(|e| RulesError::Concern(format!("{rel}: не вдалося прочитати: {e}")))?;
    let lines: Vec<&str> = raw.split('\n').collect();

    report_check(
        lines
            .iter()
            .any(|l| l.contains("tauri_plugin_process::init")),
        format!("{rel}: бракує builder.plugin(tauri_plugin_process::init())"),
        "lib-rs-process-missing",
        &rel,
        violations,
    );

    let Some(updater_idx) = lines
        .iter()
        .position(|l| l.contains("tauri_plugin_updater::Builder"))
    else {
        violations.push(Violation {
            reason: "lib-rs-updater-missing".to_string(),
            message: format!(
                "{rel}: бракує builder.plugin(tauri_plugin_updater::Builder::new().build()) (tauri.mdc updater)"
            ),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: None,
        });
        return Ok(());
    };
    let guard_line = lines[..updater_idx]
        .iter()
        .rev()
        .find(|l| !l.trim().is_empty());
    report_check(
        guard_line.map(|l| l.contains("#[cfg(desktop)]")).unwrap_or(false),
        format!(
            "{rel}: tauri_plugin_updater::Builder має бути одразу під #[cfg(desktop)] — інакше mobile-збірка падає"
        ),
        "lib-rs-updater-not-guarded",
        &rel,
        violations,
    );
    Ok(())
}

/// Перевіряє `capabilities/*.json` на `updater:default`/`process:allow-restart`
/// — точний порт `checkCapabilities` (`main.mjs:290-314`).
fn check_capabilities(ws: &str, cwd: &Path, violations: &mut Vec<Violation>) {
    let base = if ws == "." {
        cwd.to_path_buf()
    } else {
        cwd.join(ws)
    };
    let cap_dir = base.join("src-tauri").join("capabilities");
    if !cap_dir.exists() {
        return;
    }
    let rel_dir = relative_posix(cwd, &cap_dir);

    let ids = collect_capability_permission_ids(&cap_dir);

    report_check(
        ids.contains("updater:default"),
        format!(
            r#"{rel_dir}/*.json: бракує permission "updater:default" — check() з @7n/tauri-components/vue впаде мовчазним permission-denied, видно лише в console.error"#
        ),
        "capability-updater-missing",
        &rel_dir,
        violations,
    );
    report_check(
        ids.contains("process:allow-restart"),
        format!(
            r#"{rel_dir}/*.json: бракує permission "process:allow-restart" — relaunch() після встановлення оновлення впаде"#
        ),
        "capability-process-restart-missing",
        &rel_dir,
        violations,
    );
}

/// Перевіряє, що якийсь Vue-компонент викликає `useUpdater()` — точний порт
/// `checkUseUpdaterCall` (`main.mjs:323-347`).
fn check_use_updater_call(
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
    if !src_dir.exists() {
        return Ok(());
    }
    let rel_dir = relative_posix(cwd, &src_dir);

    let mut found = false;
    for file in scan_glob("**/*.vue", &src_dir) {
        let content = std::fs::read_to_string(src_dir.join(&file)).map_err(|e| {
            RulesError::Concern(format!("{rel_dir}/{file}: не вдалося прочитати: {e}"))
        })?;
        if content.contains("@7n/tauri-components/vue") && content.contains("useUpdater()") {
            found = true;
            break;
        }
    }

    report_check(
        found,
        format!(
            r#"{rel_dir}: жоден *.vue не імпортує useUpdater з "@7n/tauri-components/vue" і не викликає useUpdater() — автооновлення не активується"#
        ),
        "use-updater-not-called",
        &rel_dir,
        violations,
    );
    Ok(())
}

/// Перевіряє підключення Quasar-плагіна `Dialog` у `src/main.{js,ts}` —
/// точний порт `checkQuasarDialogPlugin` (`main.mjs:363-384`).
fn check_quasar_dialog_plugin(
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
    if !src_dir.exists() {
        return Ok(());
    }
    let rel_dir = relative_posix(cwd, &src_dir);

    for name in ["main.js", "main.ts"] {
        let path = src_dir.join(name);
        if !path.exists() {
            continue;
        }
        let content = std::fs::read_to_string(&path).map_err(|e| {
            RulesError::Concern(format!("{rel_dir}/{name}: не вдалося прочитати: {e}"))
        })?;
        if !content.contains("Quasar") {
            continue; // не Quasar-застосунок — поза межами цього чека
        }

        let ok = QUASAR_DIALOG_IMPORT_RE.is_match(&content)
            && QUASAR_DIALOG_PLUGIN_RE.is_match(&content);
        report_check(
            ok,
            format!(
                r#"{rel_dir}/{name}: useUpdater() показує оновлення через $q.dialog(...), але Quasar-плагін "Dialog" не в списку plugins: {{...}} — check()/downloadAndInstall() відпрацьовують, та $q.dialog(...) падає з "e.dialog is not a function"; помилка тихо ковтається в catch, діалог оновлення не з'являється ніколи"#
            ),
            "quasar-dialog-plugin-missing",
            &rel_dir,
            violations,
        );
    }
    Ok(())
}

/// Detector `tauri/updater` — точний порт `lint(ctx)` (`main.mjs:390-408`).
/// Без жодного `tauri.conf.json` у монорепо — silent skip.
pub fn tauri_updater(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let apps = find_tauri_app_workspaces(cwd);
    if apps.is_empty() {
        return Ok(Vec::new());
    }

    let mut violations = Vec::new();
    for ws in &apps {
        check_package_json(ws, cwd, &mut violations)?;
        check_cargo_toml(ws, cwd, &mut violations)?;
        check_lib_rs(ws, cwd, &mut violations)?;
        check_capabilities(ws, cwd, &mut violations);
        check_use_updater_call(ws, cwd, &mut violations)?;
        check_quasar_dialog_plugin(ws, cwd, &mut violations)?;
    }
    Ok(violations)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    const PACKAGE_JSON: &str = r#"{
        "name": "app",
        "version": "0.0.0",
        "dependencies": {
            "@7n/tauri-components": "^0.8.0",
            "@tauri-apps/plugin-updater": "^2",
            "@tauri-apps/plugin-process": "^2"
        }
    }"#;

    const CARGO_TOML: &str = "[package]\nname = \"app\"\nversion = \"0.1.0\"\n\n[dependencies]\ntauri-plugin-process = \"2.3.1\"\n\n[target.'cfg(not(any(target_os = \"android\", target_os = \"ios\")))'.dependencies]\ntauri-plugin-updater = \"2\"\n";

    const LIB_RS: &str = "pub fn run() {\n    let builder = tauri::Builder::default();\n\n    #[cfg(desktop)]\n    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());\n\n    let builder = builder.plugin(tauri_plugin_process::init());\n\n    builder.run(tauri::generate_context!()).unwrap();\n}\n";

    const APP_VUE: &str =
        "<script setup>\nimport { useUpdater } from '@7n/tauri-components/vue'\n\nuseUpdater()\n</script>\n";

    const MAIN_JS: &str = "import { Quasar, Dialog, Notify } from 'quasar'\nimport App from './App.vue'\n\ncreateApp(App)\n  .use(Quasar, {\n    plugins: { Dialog, Notify }\n  })\n  .mount('#app')\n";

    const DEFAULT_CAPABILITY: &str = r#"{"identifier":"default","windows":["main"],"permissions":["core:default","process:allow-restart"]}"#;

    const UPDATER_CAPABILITY: &str = r#"{"identifier":"updater","windows":["main"],"platforms":["macOS","windows","linux"],"permissions":["updater:default"]}"#;

    /// Опції для [`make_proj`] — дзеркало `makeProj` (`updater.test.mjs:82-103`).
    struct MakeProjOpts<'a> {
        no_tauri: bool,
        package_json: &'a str,
        cargo_toml: &'a str,
        lib_rs: &'a str,
        app_vue: Option<&'a str>,
        main_js: Option<&'a str>,
    }

    impl<'a> Default for MakeProjOpts<'a> {
        fn default() -> Self {
            MakeProjOpts {
                no_tauri: false,
                package_json: PACKAGE_JSON,
                cargo_toml: CARGO_TOML,
                lib_rs: LIB_RS,
                app_vue: Some(APP_VUE),
                main_js: Some(MAIN_JS),
            }
        }
    }

    fn make_proj(opts: MakeProjOpts) -> TempDir {
        let tmp = TempDir::new().unwrap();
        if opts.no_tauri {
            return tmp;
        }
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", opts.package_json);
        write(
            &tmp,
            "app/src-tauri/tauri.conf.json",
            r#"{"version":"0.1.0"}"#,
        );
        write(&tmp, "app/src-tauri/Cargo.toml", opts.cargo_toml);
        write(&tmp, "app/src-tauri/src/lib.rs", opts.lib_rs);
        write(
            &tmp,
            "app/src-tauri/capabilities/default.json",
            DEFAULT_CAPABILITY,
        );
        write(
            &tmp,
            "app/src-tauri/capabilities/updater.json",
            UPDATER_CAPABILITY,
        );
        if let Some(vue) = opts.app_vue {
            write(&tmp, "app/src/App.vue", vue);
        }
        if let Some(js) = opts.main_js {
            write(&tmp, "app/src/main.js", js);
        }
        tmp
    }

    #[test]
    fn no_tauri_conf_json_is_silent_skip() {
        let proj = make_proj(MakeProjOpts {
            no_tauri: true,
            ..Default::default()
        });
        assert!(tauri_updater(proj.path()).unwrap().is_empty());
    }

    #[test]
    fn canonical_layout_is_clean() {
        let proj = make_proj(MakeProjOpts::default());
        assert!(tauri_updater(proj.path()).unwrap().is_empty());
    }

    #[test]
    fn low_tauri_components_version_is_violation() {
        let pkg = PACKAGE_JSON.replace("^0.8.0", "^0.7.0");
        let proj = make_proj(MakeProjOpts {
            package_json: &pkg,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "tauri-components-version"));
    }

    #[test]
    fn missing_plugin_updater_dep_is_violation() {
        let pkg = PACKAGE_JSON.replace(r#""@tauri-apps/plugin-updater": "^2","#, "");
        let proj = make_proj(MakeProjOpts {
            package_json: &pkg,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "plugin-updater-missing"));
    }

    #[test]
    fn cargo_plugin_process_missing_is_violation() {
        let cargo = CARGO_TOML.replace("tauri-plugin-process = \"2.3.1\"\n", "");
        let proj = make_proj(MakeProjOpts {
            cargo_toml: &cargo,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "cargo-plugin-process-missing"));
    }

    #[test]
    fn cargo_plugin_updater_not_scoped_is_violation() {
        let cargo = "[package]\nname = \"app\"\nversion = \"0.1.0\"\n\n[dependencies]\ntauri-plugin-process = \"2.3.1\"\ntauri-plugin-updater = \"2\"\n";
        let proj = make_proj(MakeProjOpts {
            cargo_toml: cargo,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "cargo-plugin-updater-not-scoped"));
    }

    #[test]
    fn cargo_plugin_updater_missing_is_violation() {
        let cargo = CARGO_TOML.replace(
            "[target.'cfg(not(any(target_os = \"android\", target_os = \"ios\")))'.dependencies]\ntauri-plugin-updater = \"2\"\n",
            "",
        );
        let proj = make_proj(MakeProjOpts {
            cargo_toml: &cargo,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "cargo-plugin-updater-missing"));
    }

    #[test]
    fn lib_rs_process_missing_is_violation() {
        let lib_rs = LIB_RS.replace(
            "let builder = builder.plugin(tauri_plugin_process::init());\n\n",
            "",
        );
        let proj = make_proj(MakeProjOpts {
            lib_rs: &lib_rs,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "lib-rs-process-missing"));
    }

    #[test]
    fn lib_rs_updater_not_guarded_is_violation() {
        let lib_rs = LIB_RS.replace(
            "#[cfg(desktop)]\n    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());",
            "let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());",
        );
        let proj = make_proj(MakeProjOpts {
            lib_rs: &lib_rs,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "lib-rs-updater-not-guarded"));
    }

    #[test]
    fn capability_updater_missing_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", PACKAGE_JSON);
        write(
            &tmp,
            "app/src-tauri/tauri.conf.json",
            r#"{"version":"0.1.0"}"#,
        );
        write(&tmp, "app/src-tauri/Cargo.toml", CARGO_TOML);
        write(&tmp, "app/src-tauri/src/lib.rs", LIB_RS);
        write(
            &tmp,
            "app/src-tauri/capabilities/default.json",
            DEFAULT_CAPABILITY,
        );
        write(&tmp, "app/src/App.vue", APP_VUE);
        write(&tmp, "app/src/main.js", MAIN_JS);
        let violations = tauri_updater(tmp.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "capability-updater-missing"));
    }

    #[test]
    fn use_updater_not_called_is_violation() {
        let proj = make_proj(MakeProjOpts {
            app_vue: Some("<script setup>\n// no updater here\n</script>\n"),
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "use-updater-not-called"));
    }

    #[test]
    fn quasar_without_dialog_plugin_is_violation() {
        let main_js = MAIN_JS
            .replace("plugins: { Dialog, Notify }", "plugins: { Notify }")
            .replace(
                "import { Quasar, Dialog, Notify }",
                "import { Quasar, Notify }",
            );
        let proj = make_proj(MakeProjOpts {
            main_js: Some(&main_js),
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(violations
            .iter()
            .any(|v| v.reason == "quasar-dialog-plugin-missing"));
    }

    #[test]
    fn non_quasar_main_js_is_not_flagged() {
        let proj = make_proj(MakeProjOpts {
            main_js: Some("createApp(App).mount('#app')\n"),
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(!violations
            .iter()
            .any(|v| v.reason == "quasar-dialog-plugin-missing"));
    }

    #[test]
    fn missing_main_js_is_not_flagged() {
        let proj = make_proj(MakeProjOpts {
            main_js: None,
            ..Default::default()
        });
        let violations = tauri_updater(proj.path()).unwrap();
        assert!(!violations
            .iter()
            .any(|v| v.reason == "quasar-dialog-plugin-missing"));
    }
}
