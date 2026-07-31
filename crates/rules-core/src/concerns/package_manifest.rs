//! Native-порт `getMonorepoProjectRootDirs`
//! (`npm/rules/changelog/lib/package-manifest.mjs:142-165`) — єдина функція
//! `package-manifest.mjs`, потрібна `changelog/presence`. Решта модуля
//! (`readPackageManifest`, `manifestFilePath`, `parsePyprojectFields`)
//! обслуговує `changelog/consistency` і `release/release.mjs` (перевірено
//! через grep консюмерів перед портом) і лишається в JS — не дублюємо тут.
//!
//! Перетин із [`crate::concerns::workspaces`]: `getMonorepoProjectRootDirs`
//! обгортає `getMonorepoPackageRootDirs` (npm-пакети) і додає ще Python
//! `pyproject.toml`-каталоги без сусіднього `package.json` — той самий
//! композиційний підхід, що й JS-версія, тому тут окремий файл, не
//! розширення `workspaces.rs` (він лишається чистим npm-портом
//! `workspaces.mjs`, без домішки Python-специфіки).

use std::collections::HashSet;
use std::path::Path;

use crate::concerns::glob_compat::scan_glob;
use crate::concerns::workspaces::{get_monorepo_package_root_dirs, is_ignored_workspace_root};

/// Posix-dirname з фолбеком на `"."` для файлів у корені — точний порт
/// комбінації `dirname(join(repoRoot, relPy))` + `relative(repoRoot, ...)`
/// (`package-manifest.mjs:150-152`), спрощений до прямої роботи з
/// relative-posix рядком, бо `repoRoot`-префікс і так скорочується назад.
fn dirname_or_dot(rel_posix: &str) -> String {
    match rel_posix.rfind('/') {
        Some(idx) => rel_posix[..idx].to_string(),
        None => ".".to_string(),
    }
}

/// Каталоги пакетів: npm (`package.json`/workspaces) + Python
/// (`pyproject.toml` без сусіднього `package.json`) — точний порт
/// `getMonorepoProjectRootDirs` (`package-manifest.mjs:142-165`).
pub fn get_monorepo_project_root_dirs(repo_root: &Path) -> Vec<String> {
    let mut roots: HashSet<String> = get_monorepo_package_root_dirs(repo_root)
        .into_iter()
        .collect();

    let has_pyproject = repo_root.join("pyproject.toml").exists();
    let has_package_json = repo_root.join("package.json").exists();
    if has_pyproject && !has_package_json {
        roots.insert(".".to_string());
    }

    for rel_py in scan_glob("**/pyproject.toml", repo_root) {
        let ws = dirname_or_dot(&rel_py);
        if !is_ignored_workspace_root(&ws) && !repo_root.join(&ws).join("package.json").exists() {
            roots.insert(ws);
        }
    }

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

    #[test]
    fn no_manifests_yields_only_dot() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec!["."]);
    }

    #[test]
    fn npm_workspaces_are_included() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["npm"]}"#);
        write(&tmp, "npm/package.json", r#"{"name":"npm"}"#);
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec![".", "npm"]);
    }

    #[test]
    fn root_pyproject_without_package_json_adds_dot() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pyproject.toml", "[project]\nname=\"r\"\n");
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec!["."]);
    }

    #[test]
    fn nested_pyproject_without_package_json_is_a_root() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        write(&tmp, "svc/pyproject.toml", "[project]\nname=\"svc\"\n");
        assert_eq!(
            get_monorepo_project_root_dirs(tmp.path()),
            vec![".", "app", "svc"]
        );
    }

    #[test]
    fn nested_pyproject_with_sibling_package_json_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        write(&tmp, "app/pyproject.toml", "[project]\nname=\"app-py\"\n");
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec![".", "app"]);
    }

    #[test]
    fn pyproject_under_node_modules_is_ignored() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        write(
            &tmp,
            "node_modules/dep/pyproject.toml",
            "[project]\nname=\"dep\"\n",
        );
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec![".", "app"]);
    }
}
