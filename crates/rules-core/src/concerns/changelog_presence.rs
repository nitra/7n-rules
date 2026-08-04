//! Native-порт `changelog/presence` (`npm/rules/changelog/presence/main.mjs`,
//! 87 рядків) — дешевий per-file companion до `changelog/consistency`: без
//! мережі й без git-історії мапить `ctx.files` на workspace-и й перевіряє,
//! що для кожного зачепленого не-root workspace існує хоча б один
//! change-файл у `.changes/`. **Per-file scope** (`concern.json`
//! `lint.scope: "per-file"`) — на відміну від решти трьох concern-ів цього
//! батчу, `files` тут не ігнорується.

use std::collections::HashSet;
use std::path::Path;

use crate::concerns::change_file::read_change_files;
use crate::concerns::package_manifest::get_monorepo_project_root_dirs;
use crate::diagnostics::{Severity, Violation};
use crate::RulesError;

/// Префікси шляхів (posix), які не вважаються релізними змінами — та сама
/// інверсія, що в `changelog/consistency`
/// (`CHANGELOG_IGNORE_PATH_PREFIXES`, `main.mjs:18`).
const CHANGELOG_IGNORE_PATH_PREFIXES: &[&str] = &["docs/", "doc/", ".cursor/", ".claude/"];

/// Порт `isChangelogIgnoredPath` (`main.mjs:26-29`).
fn is_changelog_ignored_path(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/");
    let p = normalized.strip_prefix("./").unwrap_or(&normalized);
    CHANGELOG_IGNORE_PATH_PREFIXES
        .iter()
        .any(|prefix| p.starts_with(prefix))
}

/// Знаходить workspace (найдовший префікс-збіг) для відносного шляху файлу
/// — точний порт `workspaceForFile` (`main.mjs:37-49`).
fn workspace_for_file<'a>(rel_file: &str, workspaces: &'a [String]) -> &'a str {
    let mut best: &str = ".";
    let mut best_len: i64 = -1;
    for ws in workspaces {
        if ws == "." {
            continue;
        }
        let prefix = format!("{ws}/");
        if rel_file.starts_with(&prefix) && prefix.len() as i64 > best_len {
            best = ws.as_str();
            best_len = prefix.len() as i64;
        }
    }
    best
}

/// Detector `changelog/presence` — точний порт `lint(ctx)` (`main.mjs:56-87`).
/// `files: None` (JS `ctx.files === undefined`, full-режим) чи порожній
/// список — нічого не перевіряє (той самий early-return).
pub fn changelog_presence(
    cwd: &Path,
    files: Option<&[String]>,
) -> Result<Vec<Violation>, RulesError> {
    let Some(files) = files else {
        return Ok(Vec::new());
    };
    if files.is_empty() {
        return Ok(Vec::new());
    }

    let workspaces = get_monorepo_project_root_dirs(cwd);
    let is_monorepo_root = workspaces.iter().any(|w| w != ".");

    // Insertion-order dedup — той самий видимий порядок ітерації, що й JS
    // `Set` (перший вхід зберігає позицію).
    let mut touched_order: Vec<String> = Vec::new();
    let mut touched_seen: HashSet<String> = HashSet::new();
    for f in files {
        if is_changelog_ignored_path(f) {
            continue;
        }
        let ws = workspace_for_file(f, &workspaces).to_string();
        if ws == "." && is_monorepo_root {
            continue; // корінь монорепо — glue/tooling, без власного CHANGELOG
        }
        if touched_seen.insert(ws.clone()) {
            touched_order.push(ws);
        }
    }

    let mut violations = Vec::new();
    for ws in touched_order {
        let changes = read_change_files(&ws, cwd).map_err(RulesError::Concern)?;
        if changes.is_empty() {
            let label = if ws == "." {
                "<root>".to_string()
            } else {
                ws.clone()
            };
            violations.push(Violation {
                reason: "changeset-missing".to_string(),
                message: format!(
                    "{label}: змінені файли без change-файлу в .changes/ — додай `npx @7n/n ch` (n-changelog.mdc)"
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }

    Ok(violations)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    #[test]
    fn full_mode_files_none_checks_nothing() {
        let tmp = TempDir::new().unwrap();
        assert!(changelog_presence(tmp.path(), None).unwrap().is_empty());
    }

    #[test]
    fn empty_files_checks_nothing() {
        let tmp = TempDir::new().unwrap();
        let files: Vec<String> = Vec::new();
        assert!(changelog_presence(tmp.path(), Some(&files))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn single_package_repo_without_change_file_is_violation_on_root() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"name":"demo","version":"1.0.0"}"#);
        let files = vec!["src/index.mjs".to_string()];
        let violations = changelog_presence(tmp.path(), Some(&files)).unwrap();
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "changeset-missing");
    }

    #[test]
    fn single_package_repo_with_change_file_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"name":"demo","version":"1.0.0"}"#);
        write(
            &tmp,
            ".changes/260702-1200.md",
            "---\nbump: patch\nsection: Changed\n---\nоновлення\n",
        );
        let files = vec!["src/index.mjs".to_string()];
        assert!(changelog_presence(tmp.path(), Some(&files))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn docs_only_changes_are_ignored() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"name":"demo","version":"1.0.0"}"#);
        let files = vec!["docs/readme.md".to_string()];
        assert!(changelog_presence(tmp.path(), Some(&files))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn monorepo_root_only_changes_are_ignored_when_sub_workspaces_exist() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        let files = vec!["scripts/tool.mjs".to_string()];
        assert!(changelog_presence(tmp.path(), Some(&files))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn touched_sub_workspace_without_change_file_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        let files = vec!["app/src/index.mjs".to_string()];
        let violations = changelog_presence(tmp.path(), Some(&files)).unwrap();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.starts_with("app:"));
    }

    #[test]
    fn malformed_change_file_propagates_error() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"name":"demo","version":"1.0.0"}"#);
        write(&tmp, ".changes/260702-1200.md", "garbage");
        let files = vec!["src/index.mjs".to_string()];
        assert!(changelog_presence(tmp.path(), Some(&files)).is_err());
    }
}
