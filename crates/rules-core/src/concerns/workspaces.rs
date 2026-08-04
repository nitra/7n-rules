//! Native-порт `npm/scripts/lib/workspaces.mjs` — читає кореневий
//! `package.json` і повертає список каталогів-пакетів (корінь `.` плюс
//! шляхи з `workspaces`, з урахуванням glob) монорепо. Спільна утиліта для
//! [`crate::concerns::find_src_tauri`] (усі чотири Tauri TOML-concern-и G1
//! кластеру фази 5).
//!
//! # Fail-safe відхилення від JS
//!
//! JS-версія не обгортає `JSON.parse(await readFile(rootPkgPath, 'utf8'))`
//! у `try/catch` — побитий кореневий `package.json` кидає, `lint()` рухається
//! у rejected promise. Тут — той самий fail-safe принцип, що й в інших
//! native-концернах цього крейту (`cursor_ignore::load_cursor_ignore_paths`,
//! doc-комент там): нечитабельний файл чи невалідний JSON деградує до
//! `['.']`, а не панікує. Точки виклику (`fix_src_tauri_dirs` → чотири
//! read-only detector-и) від цього нічого не втрачають — TOML-concern-и й
//! так read-only, а невалідний `package.json` — окрема проблема поза їхнім
//! мандатом.

use std::collections::HashSet;
use std::path::Path;

use crate::concerns::glob_compat::scan_glob;

/// Теки, ігноровані при розгортанні workspace-патернів із `*`/`**` — порт
/// `WORKSPACE_IGNORED_DIRS` (`workspaces.mjs:17`, узгоджено з
/// `rules/changelog/lib/package-manifest.mjs`).
const WORKSPACE_IGNORED_DIRS: &[&str] = &["node_modules", ".git", ".venv", "venv"];

/// Чи слід виключити каталог зі списку workspace-коренів (не стосується
/// `.`) — точний порт `isIgnoredWorkspaceRoot` (`workspaces.mjs:24-29`).
pub fn is_ignored_workspace_root(ws: &str) -> bool {
    if ws == "." {
        return false;
    }
    let posix = ws.replace('\\', "/");
    let trimmed = posix.strip_prefix("./").unwrap_or(&posix);
    let segments: HashSet<&str> = trimmed.split('/').collect();
    WORKSPACE_IGNORED_DIRS
        .iter()
        .any(|dir| segments.contains(dir))
}

/// Нормалізує workspace-патерн до POSIX-формату і прибирає хвостові `/` —
/// точний порт `normalizeWorkspacePattern` (`workspaces.mjs:36-42`).
fn normalize_workspace_pattern(pattern: &str) -> String {
    let mut normalized = pattern.replace('\\', "/");
    while normalized.ends_with('/') {
        normalized.pop();
    }
    if normalized.is_empty() {
        ".".to_string()
    } else {
        normalized
    }
}

/// Додає каталоги пакетів до `roots` за workspace-патерном — точний порт
/// `addWorkspaceRootsByPattern` (`workspaces.mjs:51-69`).
fn add_workspace_roots_by_pattern(
    roots: &mut HashSet<String>,
    repo_root: &Path,
    workspace_pattern: &str,
) {
    if workspace_pattern.contains('*') {
        let glob_pattern = format!("{workspace_pattern}/package.json");
        for rel_pkg_json_path in scan_glob(&glob_pattern, repo_root) {
            let rel_root = Path::new(&rel_pkg_json_path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let ws = if rel_root.is_empty() {
                ".".to_string()
            } else {
                rel_root
            };
            if !is_ignored_workspace_root(&ws) {
                roots.insert(ws);
            }
        }
        return;
    }

    let pkg_json_path = repo_root.join(workspace_pattern).join("package.json");
    if pkg_json_path.exists() && !is_ignored_workspace_root(workspace_pattern) {
        roots.insert(workspace_pattern.to_string());
    }
}

/// Нормалізує поле `workspaces` з `package.json` (масив рядків або
/// `{ packages: [...] }`) до масиву патернів — точний порт
/// `normalizeWorkspacePatterns` (`workspaces.mjs:76-83`).
pub fn normalize_workspace_patterns(workspaces: Option<&serde_json::Value>) -> Vec<String> {
    let Some(value) = workspaces else {
        return Vec::new();
    };
    if let Some(arr) = value.as_array() {
        return arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
    }
    if let Some(packages) = value.get("packages").and_then(|v| v.as_array()) {
        return packages
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
    }
    Vec::new()
}

/// Повертає каталоги з `package.json`: корінь репозиторію та всі пакети з
/// `workspaces` (`'.'` першим, без дублікатів) — точний порт
/// `getMonorepoPackageRootDirs` (`workspaces.mjs:90-108`).
pub fn get_monorepo_package_root_dirs(repo_root: &Path) -> Vec<String> {
    let root_pkg_path = repo_root.join("package.json");
    if !root_pkg_path.exists() {
        return vec![".".to_string()];
    }
    // Fail-safe (doc-комент модуля): нечитабельний файл чи побитий JSON → ['.'],
    // не panic.
    let Some(pkg) = std::fs::read_to_string(&root_pkg_path)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
    else {
        return vec![".".to_string()];
    };

    let mut roots: HashSet<String> = HashSet::new();
    roots.insert(".".to_string());
    for raw in normalize_workspace_patterns(pkg.get("workspaces")) {
        let pattern = normalize_workspace_pattern(&raw);
        add_workspace_roots_by_pattern(&mut roots, repo_root, &pattern);
    }

    sorted_workspace_roots(roots)
}

/// Детермінований хвіст обох збирачів коренів: відкидає ігноровані каталоги
/// й сортує так, щоб `"."` завжди був першим (`workspaces.mjs:100-107`).
/// Спільний для [`get_monorepo_package_root_dirs`] і
/// [`crate::concerns::package_manifest::get_monorepo_project_root_dirs`] —
/// раніше цей блок був копією в обох файлах.
pub(crate) fn sorted_workspace_roots(roots: HashSet<String>) -> Vec<String> {
    let mut list: Vec<String> = roots
        .into_iter()
        .filter(|ws| !is_ignored_workspace_root(ws))
        .collect();
    list.sort_by(|a, b| match (a.as_str(), b.as_str()) {
        (".", ".") => std::cmp::Ordering::Equal,
        (".", _) => std::cmp::Ordering::Less,
        (_, ".") => std::cmp::Ordering::Greater,
        _ => a.cmp(b),
    });
    list
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    // --- normalize_workspace_patterns: дзеркало tests/workspaces.test.mjs ---

    #[test]
    fn normalize_patterns_returns_empty_for_missing_field() {
        assert!(normalize_workspace_patterns(None).is_empty());
    }

    #[test]
    fn normalize_patterns_array_stays_array() {
        let v = serde_json::json!(["a", "b"]);
        assert_eq!(normalize_workspace_patterns(Some(&v)), vec!["a", "b"]);
    }

    #[test]
    fn normalize_patterns_object_with_packages() {
        let v = serde_json::json!({ "packages": ["pkg/*"] });
        assert_eq!(normalize_workspace_patterns(Some(&v)), vec!["pkg/*"]);
    }

    #[test]
    fn normalize_patterns_other_object_is_empty() {
        let v = serde_json::json!({});
        assert!(normalize_workspace_patterns(Some(&v)).is_empty());
    }

    // --- is_ignored_workspace_root ---

    #[test]
    fn root_dot_is_never_ignored() {
        assert!(!is_ignored_workspace_root("."));
    }

    #[test]
    fn service_dirs_are_ignored() {
        assert!(is_ignored_workspace_root("node_modules/foo"));
        assert!(is_ignored_workspace_root("node_modules/node-gyp/gyp"));
        assert!(is_ignored_workspace_root("packages/.git/pkg"));
        assert!(is_ignored_workspace_root(".venv/lib"));
        assert!(is_ignored_workspace_root("venv"));
    }

    #[test]
    fn ordinary_workspace_paths_are_not_ignored() {
        assert!(!is_ignored_workspace_root("npm"));
        assert!(!is_ignored_workspace_root("packages/a"));
    }

    // --- get_monorepo_package_root_dirs ---

    #[test]
    fn no_package_json_yields_only_dot() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(get_monorepo_package_root_dirs(tmp.path()), vec!["."]);
    }

    #[test]
    fn root_and_explicit_workspace_with_package_json() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"name":"r","workspaces":["npm"]}"#);
        write(&tmp, "npm/package.json", r#"{"name":"npm"}"#);
        assert_eq!(get_monorepo_package_root_dirs(tmp.path()), vec![".", "npm"]);
    }

    #[test]
    fn glob_workspaces() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"name":"r","workspaces":["packages/*"]}"#,
        );
        write(&tmp, "packages/a/package.json", r#"{"name":"a"}"#);
        write(&tmp, "packages/b/package.json", r#"{"name":"b"}"#);
        assert_eq!(
            get_monorepo_package_root_dirs(tmp.path()),
            vec![".", "packages/a", "packages/b"]
        );
    }

    #[test]
    fn double_star_glob_does_not_pick_up_node_modules_package_json() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"name":"r","workspaces":["**"]}"#);
        write(&tmp, "pkg/app/package.json", r#"{"name":"app"}"#);
        write(
            &tmp,
            "node_modules/dep/nested/package.json",
            r#"{"name":"dep"}"#,
        );
        assert_eq!(
            get_monorepo_package_root_dirs(tmp.path()),
            vec![".", "pkg/app"]
        );
    }
}
