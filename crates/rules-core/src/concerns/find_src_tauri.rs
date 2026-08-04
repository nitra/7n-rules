//! `find_src_tauri_dirs` — спільний обхід `<ws>/src-tauri/` у монорепо, порт
//! `findSrcTauriDirs` (`npm/rules/tauri/cargo_mutants_config/main.mjs:57-67`,
//! звідти JS реекспортує й перевикористовує `tauri/gitignore_target` і
//! `tauri/linux_deps`). `tauri/core_test_isolation` тримає буквально
//! ідентичну, але окрему копію (`core_test_isolation/main.mjs:44-53`) — межа
//! `main.mjs`-per-concern у JS не дозволяє імпорт з сусіднього `main.mjs` без
//! явного реекспорту; тут усі чотири native concern-и G1 кластеру
//! користуються однією функцією без дублювання.

use std::path::{Path, PathBuf};

use crate::concerns::workspaces::get_monorepo_package_root_dirs;

/// Знаходить усі `<ws>/src-tauri/` каталоги з власним `Cargo.toml` у
/// монорепо — точний порт `findSrcTauriDirs`. Обходить workspace-пакети
/// через [`get_monorepo_package_root_dirs`] (корінь + усі workspaces).
pub fn find_src_tauri_dirs(cwd: &Path) -> Vec<PathBuf> {
    let roots = get_monorepo_package_root_dirs(cwd);
    let mut result = Vec::new();
    for root in roots {
        let src_tauri_cargo = cwd.join(&root).join("src-tauri").join("Cargo.toml");
        if src_tauri_cargo.exists() {
            result.push(cwd.join(&root).join("src-tauri"));
        }
    }
    result
}

/// Posix-relative шлях від `base` до `target` — спрощений аналог Node
/// `path.relative(base, target)`, коректний саме для цього кластеру
/// concern-ів: `target` тут завжди похідний від `base`
/// (`base.join(root).join(...)` — усі виклики будують шлях під `cwd`, а не
/// довільну пару абсолютних шляхів), тож просте зрізання префікса
/// достатнє (без `../`-сходів загального `path.relative`).
pub(crate) fn relative_posix(base: &Path, target: &Path) -> String {
    let rel = target.strip_prefix(base).unwrap_or(target);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    #[test]
    fn no_src_tauri_anywhere_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(find_src_tauri_dirs(tmp.path()).is_empty());
    }

    #[test]
    fn root_level_src_tauri_without_workspaces_is_found() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "src-tauri/Cargo.toml", "[package]\nname=\"t\"\n");
        assert_eq!(
            find_src_tauri_dirs(tmp.path()),
            vec![tmp.path().join("src-tauri")]
        );
    }

    #[test]
    fn multiple_workspace_src_tauri_dirs_are_all_found() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app","desktop"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        write(&tmp, "desktop/package.json", r#"{"name":"desktop"}"#);
        write(&tmp, "app/src-tauri/Cargo.toml", "[package]\nname=\"a\"\n");
        write(
            &tmp,
            "desktop/src-tauri/Cargo.toml",
            "[package]\nname=\"d\"\n",
        );
        assert_eq!(
            find_src_tauri_dirs(tmp.path()),
            vec![
                tmp.path().join("app/src-tauri"),
                tmp.path().join("desktop/src-tauri")
            ]
        );
    }

    #[test]
    fn workspace_without_src_tauri_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["lib"]}"#);
        write(&tmp, "lib/package.json", r#"{"name":"lib"}"#);
        assert!(find_src_tauri_dirs(tmp.path()).is_empty());
    }

    #[test]
    fn relative_posix_strips_base_prefix() {
        let base = Path::new("/repo");
        let target = Path::new("/repo/app/src-tauri/.cargo/mutants.toml");
        assert_eq!(
            relative_posix(base, target),
            "app/src-tauri/.cargo/mutants.toml"
        );
    }

    #[test]
    fn relative_posix_equal_paths_is_empty_string() {
        let base = Path::new("/repo/owner");
        assert_eq!(relative_posix(base, base), "");
    }
}
