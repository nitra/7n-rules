//! Native-порт `tauri/gitignore_target` (`npm/rules/tauri/gitignore_target/main.mjs`,
//! 99 рядків) — read-only detector: для кожного знайденого `<ws>/src-tauri/`
//! у монорепо кореневий `.gitignore` повинен містити точний ignore-запис для
//! build-артефактів, шлях до якого залежить від фактичного Cargo workspace
//! root крейту (не завжди суфікс `src-tauri/target/` — doc-комент
//! `main.mjs:1-21`, кейс `nitra/task@3cb0df3`).
//!
//! На відміну від `tauri/cargo_mutants_config`, JS-фікс цього concern-а
//! (`fix-gitignore_target.mjs`) читає саме `violation.data.missing` (не
//! рахує все заново через `main.mjs`) — тож форма `data` тут МАЄ
//! збігатися з JS 1:1: `{ kind: <той самий reason>, missing: [...] }`.

use std::path::Path;

use crate::concerns::cargo_workspace::find_ancestor_workspace_root;
use crate::concerns::find_src_tauri::{find_src_tauri_dirs, relative_posix};
use crate::diagnostics::{Severity, Violation};

/// Стабільний reason: у корінному `.gitignore` бракує ignore-запису(ів) для
/// `src-tauri/target/` — порт `MISSING_GITIGNORE_TARGET_ENTRIES` (`main.mjs:23`).
pub const MISSING_GITIGNORE_TARGET_ENTRIES: &str = "missing-gitignore-target-entries";

/// Корінний `.gitignore` — один на монорепо, не по workspace.
const ROOT_GITIGNORE: &str = ".gitignore";

/// Очікуваний ignore-запис для build-артефактів одного `<ws>/src-tauri/` —
/// точний порт `expectedTargetEntry` (`main.mjs:35-42`).
fn expected_target_entry(cwd: &Path, src_tauri_dir: &Path) -> String {
    match find_ancestor_workspace_root(src_tauri_dir, cwd) {
        None => format!("{}/target/", relative_posix(cwd, src_tauri_dir)),
        Some(ancestor) => {
            let rel_root = relative_posix(cwd, &ancestor.root_dir);
            if rel_root.is_empty() {
                "target/".to_string()
            } else {
                format!("{rel_root}/target/")
            }
        }
    }
}

/// Знаходить очікувані entries, яких бракує у вмісті кореневого
/// `.gitignore` — точний match рядка (після trim), substring не рахується —
/// точний порт `findMissingEntries` (`main.mjs:52-59`).
fn find_missing_entries(content: &str, expected_entries: &[String]) -> Vec<String> {
    let present: std::collections::HashSet<&str> = content.split('\n').map(str::trim).collect();
    expected_entries
        .iter()
        .filter(|e| !present.contains(e.as_str()))
        .cloned()
        .collect()
}

/// Detector `tauri/gitignore_target` — точний порт `lint(ctx)` (`main.mjs:65-91`).
pub fn tauri_gitignore_target(cwd: &Path) -> Vec<Violation> {
    let src_tauri_dirs = find_src_tauri_dirs(cwd);
    if src_tauri_dirs.is_empty() {
        return Vec::new();
    }

    let expected_entries: Vec<String> = src_tauri_dirs
        .iter()
        .map(|dir| expected_target_entry(cwd, dir))
        .collect();

    let content = std::fs::read_to_string(cwd.join(ROOT_GITIGNORE)).unwrap_or_default();
    let missing = find_missing_entries(&content, &expected_entries);
    if missing.is_empty() {
        return Vec::new();
    }

    vec![Violation {
        reason: MISSING_GITIGNORE_TARGET_ENTRIES.to_string(),
        message: format!(
            "{ROOT_GITIGNORE}: бракує ignore-запису(ів) для Tauri build-артефактів [{}] — build-артефакти можуть потрапити в коміт (tauri.mdc)",
            missing.join(", ")
        ),
        file: Some(ROOT_GITIGNORE.to_string()),
        severity: Severity::Error,
        data: Some(serde_json::json!({
            "kind": MISSING_GITIGNORE_TARGET_ENTRIES,
            "missing": missing
        })),
    }]
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    fn make_monorepo_root(tmp: &TempDir, workspaces: &[&str]) {
        let ws_json = workspaces
            .iter()
            .map(|w| format!("\"{w}\""))
            .collect::<Vec<_>>()
            .join(",");
        write(
            tmp,
            "package.json",
            &format!(r#"{{"name":"root","workspaces":[{ws_json}]}}"#),
        );
    }

    fn make_src_tauri_workspace(tmp: &TempDir, ws: &str) {
        write(
            tmp,
            &format!("{ws}/src-tauri/Cargo.toml"),
            "[package]\nname=\"t\"\n",
        );
        write(
            tmp,
            &format!("{ws}/package.json"),
            &format!(r#"{{"name":"{ws}"}}"#),
        );
    }

    // --- lint: дзеркало tests/gitignore_target.test.mjs (detector-частина) ---

    /// «без жодного src-tauri/Cargo.toml правило не активується» (`:81-90`).
    #[test]
    fn no_src_tauri_disables_rule() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".gitignore", "node_modules/\n");
        assert!(tauri_gitignore_target(tmp.path()).is_empty());
    }

    /// «Tauri-воркспейс без запису в .gitignore → missing-gitignore-target-entries» (`:92-104`).
    #[test]
    fn tauri_workspace_without_gitignore_entry_reports_missing() {
        let tmp = TempDir::new().unwrap();
        make_monorepo_root(&tmp, &["owner"]);
        make_src_tauri_workspace(&tmp, "owner");
        write(&tmp, ".gitignore", "node_modules/\n");
        let violations = tauri_gitignore_target(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MISSING_GITIGNORE_TARGET_ENTRIES)
            .unwrap();
        assert_eq!(
            v.data,
            Some(
                serde_json::json!({ "kind": MISSING_GITIGNORE_TARGET_ENTRIES, "missing": ["owner/src-tauri/target/"] })
            )
        );
    }

    /// «точний канонічний запис присутній → чисто» (`:106-117`).
    #[test]
    fn exact_canonical_entry_present_is_clean() {
        let tmp = TempDir::new().unwrap();
        make_monorepo_root(&tmp, &["owner"]);
        make_src_tauri_workspace(&tmp, "owner");
        write(
            &tmp,
            ".gitignore",
            "node_modules/\n\n# Tauri — Rust build artifacts (tauri.mdc)\nowner/src-tauri/target/\n",
        );
        assert!(tauri_gitignore_target(tmp.path()).is_empty());
    }

    /// «typo-подібний запис owner/target/ не закриває violation (кейс nitra/task)» (`:119-131`).
    #[test]
    fn typo_like_entry_does_not_close_violation() {
        let tmp = TempDir::new().unwrap();
        make_monorepo_root(&tmp, &["owner"]);
        make_src_tauri_workspace(&tmp, "owner");
        write(&tmp, ".gitignore", "node_modules/\nowner/target/\n");
        let violations = tauri_gitignore_target(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MISSING_GITIGNORE_TARGET_ENTRIES)
            .unwrap();
        assert_eq!(
            v.data.as_ref().unwrap()["missing"],
            serde_json::json!(["owner/src-tauri/target/"])
        );
    }

    /// «монорепо з кількома src-tauri/, лише частина записів присутня → missing лише відсутні» (`:133-146`).
    #[test]
    fn multiple_src_tauri_only_missing_ones_are_reported() {
        let tmp = TempDir::new().unwrap();
        make_monorepo_root(&tmp, &["owner", "app"]);
        make_src_tauri_workspace(&tmp, "owner");
        make_src_tauri_workspace(&tmp, "app");
        write(&tmp, ".gitignore", "node_modules/\napp/src-tauri/target/\n");
        let violations = tauri_gitignore_target(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MISSING_GITIGNORE_TARGET_ENTRIES)
            .unwrap();
        assert_eq!(
            v.data.as_ref().unwrap()["missing"],
            serde_json::json!(["owner/src-tauri/target/"])
        );
    }

    /// «.gitignore відсутній повністю → violation з повним переліком» (`:148-159`).
    #[test]
    fn missing_gitignore_file_reports_full_list() {
        let tmp = TempDir::new().unwrap();
        make_monorepo_root(&tmp, &["owner"]);
        make_src_tauri_workspace(&tmp, "owner");
        let violations = tauri_gitignore_target(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MISSING_GITIGNORE_TARGET_ENTRIES)
            .unwrap();
        assert_eq!(
            v.data.as_ref().unwrap()["missing"],
            serde_json::json!(["owner/src-tauri/target/"])
        );
    }

    // --- expected_target_entry: дзеркало describe «фактичний Cargo workspace root крейту» (`:162-227`) ---

    /// «standalone: src-tauri сам собі workspace root → src-tauri/target/» (`:163-174`).
    #[test]
    fn standalone_src_tauri_is_own_workspace_root() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "owner/src-tauri/Cargo.toml",
            "[package]\nname=\"t\"\n",
        );
        let entry = expected_target_entry(tmp.path(), &tmp.path().join("owner/src-tauri"));
        assert_eq!(entry, "owner/src-tauri/target/");
    }

    /// «product-root: owner/Cargo.toml — workspace root для owner/src-tauri → owner/target/» (`:176-192`).
    #[test]
    fn product_root_ancestor_workspace_gives_owner_target() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "owner/Cargo.toml",
            "[workspace]\nmembers = [\"src-tauri\"]\n",
        );
        write(
            &tmp,
            "owner/src-tauri/Cargo.toml",
            "[package]\nname=\"t\"\n",
        );
        // Мертвий/сторонній `owner/src-tauri/target/` на диску не має задовольняти
        // перевірку — очікуваний запис рахується від workspace root, не від диска.
        fs::create_dir_all(tmp.path().join("owner/src-tauri/target")).unwrap();
        let entry = expected_target_entry(tmp.path(), &tmp.path().join("owner/src-tauri"));
        assert_eq!(entry, "owner/target/");
    }

    /// «product-root: .gitignore з owner/src-tauri/target/ все одно violation missing owner/target/» (`:194-212`).
    #[test]
    fn product_root_stale_entry_still_reports_owner_target_missing() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "owner/Cargo.toml",
            "[workspace]\nmembers = [\"src-tauri\"]\n",
        );
        write(
            &tmp,
            "owner/src-tauri/Cargo.toml",
            "[package]\nname=\"t\"\n",
        );
        fs::create_dir_all(tmp.path().join("owner/src-tauri/target")).unwrap();
        write(&tmp, "owner/package.json", r#"{"name":"owner"}"#);
        write(
            &tmp,
            "package.json",
            r#"{"name":"root","workspaces":["owner"]}"#,
        );
        write(
            &tmp,
            ".gitignore",
            "node_modules/\nowner/src-tauri/target/\n",
        );
        let violations = tauri_gitignore_target(tmp.path());
        let v = violations
            .iter()
            .find(|v| v.reason == MISSING_GITIGNORE_TARGET_ENTRIES)
            .unwrap();
        assert_eq!(
            v.data.as_ref().unwrap()["missing"],
            serde_json::json!(["owner/target/"])
        );
    }

    /// «repo-root: кореневий Cargo.toml — workspace root для owner/src-tauri → голий target/» (`:214-226`).
    #[test]
    fn repo_root_ancestor_workspace_gives_bare_target() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "Cargo.toml",
            "[workspace]\nmembers = [\"owner/src-tauri\"]\n",
        );
        write(
            &tmp,
            "owner/src-tauri/Cargo.toml",
            "[package]\nname=\"t\"\n",
        );
        let entry = expected_target_entry(tmp.path(), &tmp.path().join("owner/src-tauri"));
        assert_eq!(entry, "target/");
    }

    // --- find_missing_entries ---

    /// «substring-match не рахується присутністю (лише точний рядок)» (`:230-233`).
    #[test]
    fn substring_match_does_not_count_as_present() {
        let missing = find_missing_entries(
            "owner/src-tauri/target/extra\n",
            &["owner/src-tauri/target/".to_string()],
        );
        assert_eq!(missing, vec!["owner/src-tauri/target/".to_string()]);
    }
}
