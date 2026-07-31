//! Native-порт `npm/scripts/utils/cargo-workspace.mjs` — спільні T0
//! (без spawn `cargo`) утиліти для роботи з Cargo workspace-структурою:
//! читання `Cargo.toml`, резолв `[workspace].members`-glob-патернів у
//! каталоги, пошук найближчого предка-workspace root для крейту. Спільна
//! утиліта для `tauri/gitignore_target` і `tauri/core_test_isolation` (G1
//! кластер фази 5) — той самий поділ, що й у JS
//! (`rules/rust/workspace_root`/`tauri/gitignore_target`).

use std::path::{Component, Path, PathBuf};

use crate::concerns::glob_compat::scan_glob;

/// Лексично нормалізує `path` (без звернень до файлової системи, той самий
/// принцип, що й Node `path.resolve`/`path.normalize`: `.`-компоненти
/// відкидаються, `..`-компонент «з'їдає» попередній звичайний компонент, не
/// заглядаючи на диск).
pub(crate) fn normalize_lexical(path: &Path) -> PathBuf {
    let mut stack: Vec<Component> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(stack.last(), Some(Component::Normal(_))) {
                    stack.pop();
                } else {
                    stack.push(component);
                }
            }
            other => stack.push(other),
        }
    }
    stack.into_iter().collect()
}

/// Лексично з'єднує `rel` з `base` (абсолютний `rel` лишається як є) і
/// нормалізує результат — той самий принцип, що й Node `path.resolve(base, rel)`.
fn resolve_path(base: &Path, rel: &str) -> PathBuf {
    let candidate = Path::new(rel);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base.join(candidate)
    };
    normalize_lexical(&joined)
}

/// Розпарсений `Cargo.toml` або `None` (файл відсутній чи невалідний TOML) —
/// точний порт `readCargoManifest` (`cargo-workspace.mjs:22-29`).
pub fn read_cargo_manifest(abs_path: &Path) -> Option<toml::Table> {
    if !abs_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(abs_path).ok()?;
    toml::from_str::<toml::Table>(&content).ok()
}

/// Витягує масив рядків з `table.section.key` (напр. `workspace.members`) —
/// не-масив/відсутнє поле/не-рядкові елементи дають порожній/скорочений
/// список, той самий контракт, що й `Array.isArray(...) ? ... : []` у JS.
fn string_array_field(table: &toml::Table, section: &str, key: &str) -> Vec<String> {
    table
        .get(section)
        .and_then(toml::Value::as_table)
        .and_then(|t| t.get(key))
        .and_then(toml::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Резолвить `[workspace].members`/`.exclude`-патерни (літеральні шляхи й
/// прості glob з `*`) відносно `root_dir` у список абсолютних каталогів, що
/// мають власний `Cargo.toml` — точний порт `resolveWorkspaceMemberDirs`
/// (`cargo-workspace.mjs:39-55`). Без повної Cargo glob-семантики — лише
/// `*`-сегменти й літерали (doc-комент [`crate::concerns::glob_compat`]).
pub fn resolve_workspace_member_dirs(root_dir: &Path, patterns: &[String]) -> Vec<PathBuf> {
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut found: Vec<PathBuf> = Vec::new();
    for pattern in patterns {
        let norm = pattern.trim_end_matches('/');
        if norm.contains('*') {
            // Патерн для `Cargo.toml` напряму (не для каталогів) — той самий
            // прийом, що й у JS-версії (doc-комент `cargo-workspace.mjs:44-45`).
            let glob_pattern = format!("{norm}/Cargo.toml");
            for rel_manifest in scan_glob(&glob_pattern, root_dir) {
                let rel_dir = Path::new(&rel_manifest)
                    .parent()
                    .unwrap_or_else(|| Path::new(""));
                let abs = normalize_lexical(&root_dir.join(rel_dir));
                if seen.insert(abs.clone()) {
                    found.push(abs);
                }
            }
            continue;
        }
        let abs = resolve_path(root_dir, norm);
        if abs.join("Cargo.toml").exists() && seen.insert(abs.clone()) {
            found.push(abs);
        }
    }
    found
}

/// Чи покриває `[workspace].members` (мінус `.exclude`) конкретний
/// каталог-крейт — точний порт `isWorkspaceMemberDir` (`cargo-workspace.mjs:65-72`).
pub fn is_workspace_member_dir(
    root_dir: &Path,
    crate_dir_abs: &Path,
    members: &[String],
    excludes: &[String],
) -> bool {
    let target = normalize_lexical(crate_dir_abs);
    let member_dirs = resolve_workspace_member_dirs(root_dir, members);
    if !member_dirs.iter().any(|d| normalize_lexical(d) == target) {
        return false;
    }
    if excludes.is_empty() {
        return true;
    }
    let excluded_dirs = resolve_workspace_member_dirs(root_dir, excludes);
    !excluded_dirs.iter().any(|d| normalize_lexical(d) == target)
}

/// Найближчий предок-workspace root, знайдений [`find_ancestor_workspace_root`]:
/// його каталог і розпарсений `Cargo.toml`.
pub struct AncestorWorkspaceRoot {
    /// Каталог workspace root (містить `Cargo.toml` з `[workspace]`).
    pub root_dir: PathBuf,
    /// Розпарсений `Cargo.toml` цього каталогу.
    pub parsed: toml::Table,
}

/// Йде від `dirname(crate_dir_abs)` вгору по предках до `repo_root_abs`
/// (включно), шукаючи найближчий `Cargo.toml` з `[workspace]`, чиї `members`
/// (мінус `exclude`) покривають `crate_dir_abs` — точний порт
/// `findAncestorWorkspaceRoot` (`cargo-workspace.mjs:82-99`). Не перевіряє
/// сам `crate_dir_abs`.
pub fn find_ancestor_workspace_root(
    crate_dir_abs: &Path,
    repo_root_abs: &Path,
) -> Option<AncestorWorkspaceRoot> {
    let stop_at = normalize_lexical(repo_root_abs);
    let mut dir = normalize_lexical(crate_dir_abs).parent()?.to_path_buf();
    loop {
        if let Some(parsed) = read_cargo_manifest(&dir.join("Cargo.toml")) {
            if parsed.contains_key("workspace") {
                let members = string_array_field(&parsed, "workspace", "members");
                let excludes = string_array_field(&parsed, "workspace", "exclude");
                if is_workspace_member_dir(&dir, crate_dir_abs, &members, &excludes) {
                    return Some(AncestorWorkspaceRoot {
                        root_dir: dir,
                        parsed,
                    });
                }
            }
        }
        if dir == stop_at {
            return None;
        }
        let parent = dir.parent()?.to_path_buf();
        if parent == dir {
            return None;
        }
        dir = parent;
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write_manifest(root: &Path, rel_dir: &str, content: &str) {
        let dir = root.join(rel_dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Cargo.toml"), content).unwrap();
    }

    // --- resolve_workspace_member_dirs: дзеркало tests/cargo-workspace.test.mjs ---

    #[test]
    fn literal_paths_resolve_to_absolute_dirs_with_cargo_toml() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write_manifest(root, "a", "[package]\nname=\"a\"\n");
        write_manifest(root, "b", "[package]\nname=\"b\"\n");
        let dirs = resolve_workspace_member_dirs(root, &["a".to_string(), "b".to_string()]);
        let set: std::collections::HashSet<_> = dirs.into_iter().collect();
        assert_eq!(
            set,
            std::collections::HashSet::from([root.join("a"), root.join("b")])
        );
    }

    #[test]
    fn glob_star_resolves_to_all_subdirs_with_cargo_toml() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write_manifest(root, "crates/a", "[package]\nname=\"a\"\n");
        write_manifest(root, "crates/b", "[package]\nname=\"b\"\n");
        fs::create_dir_all(root.join("crates/no-manifest")).unwrap();
        let dirs = resolve_workspace_member_dirs(root, &["crates/*".to_string()]);
        let set: std::collections::HashSet<_> = dirs.into_iter().collect();
        assert_eq!(
            set,
            std::collections::HashSet::from([root.join("crates/a"), root.join("crates/b")])
        );
    }

    #[test]
    fn pattern_without_matching_cargo_toml_is_not_included() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("ghost")).unwrap();
        assert!(resolve_workspace_member_dirs(root, &["ghost".to_string()]).is_empty());
    }

    // --- is_workspace_member_dir ---

    #[test]
    fn exclude_excludes_dir_otherwise_covered_by_members() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write_manifest(root, "crates/a", "[package]\nname=\"a\"\n");
        write_manifest(root, "crates/experimental", "[package]\nname=\"exp\"\n");
        let members = vec!["crates/*".to_string()];
        let excludes = vec!["crates/experimental".to_string()];
        assert!(is_workspace_member_dir(
            root,
            &root.join("crates/a"),
            &members,
            &excludes
        ));
        assert!(!is_workspace_member_dir(
            root,
            &root.join("crates/experimental"),
            &members,
            &excludes
        ));
    }

    // --- find_ancestor_workspace_root ---

    #[test]
    fn nearest_ancestor_whose_members_cover_the_crate() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let crate_dir = root.join("owner/src-tauri");
        fs::create_dir_all(&crate_dir).unwrap();
        fs::write(crate_dir.join("Cargo.toml"), "[package]\nname=\"t\"\n").unwrap();
        write_manifest(root, "owner", "[workspace]\nmembers = [\"src-tauri\"]\n");
        let found = find_ancestor_workspace_root(&crate_dir, root);
        assert_eq!(found.unwrap().root_dir, root.join("owner"));
    }

    #[test]
    fn keeps_searching_up_to_repo_root_when_nearest_ancestor_does_not_cover() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let crate_dir = root.join("owner/src-tauri");
        fs::create_dir_all(&crate_dir).unwrap();
        fs::write(crate_dir.join("Cargo.toml"), "[package]\nname=\"t\"\n").unwrap();
        // owner/Cargo.toml існує, але БЕЗ [workspace] — не рахується.
        write_manifest(root, "owner", "[package]\nname=\"owner-unrelated\"\n");
        write_manifest(root, "", "[workspace]\nmembers = [\"owner/src-tauri\"]\n");
        let found = find_ancestor_workspace_root(&crate_dir, root);
        assert_eq!(found.unwrap().root_dir, root.to_path_buf());
    }

    #[test]
    fn no_matching_ancestor_returns_none() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let crate_dir = root.join("owner/src-tauri");
        fs::create_dir_all(&crate_dir).unwrap();
        fs::write(crate_dir.join("Cargo.toml"), "[package]\nname=\"t\"\n").unwrap();
        assert!(find_ancestor_workspace_root(&crate_dir, root).is_none());
    }
}
