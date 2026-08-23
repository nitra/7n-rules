//! Тонкий реекспорт над [`rules_core::git_policy`] для delta-контуру CLI.
//!
//! До задачі порту `changelog/consistency` (native-концерн `rules-core`,
//! `crates/rules-core/src/concerns/changelog_consistency.rs`) повний
//! `readGitPolicy` (`npm/scripts/lib/git-policy.mjs`) існував лише тут, у
//! вузькому зрізі під потреби CLI (`integration_branches`/
//! `integration_candidates`). Той концерн потребує ПОВНУ форму policy
//! (`baseBranch`/`releaseBranches` окремо, не лише готовий список
//! кандидатів) і живе в `rules-core`, а `rules-core` не може залежати від
//! `rules-cli` — тож парсер `.n-rules.json`/`.n-cursor.json` переїхав у
//! `rules_core::git_policy::read_git_policy` (доккомент того модуля), а цей
//! файл лишився тонкою обгорткою: той самий публічний API
//! (`integration_branches`/`integration_candidates`), той самий behavior,
//! жодної дубльованої логіки парсингу конфігу між двома крейтами.
//!
//! Свідомий перший виняток із Р5 спеки міграції («конфіг-парсинг лишається
//! в JS») лишається в силі — фаза 8 обертає межу JS → native, у
//! native-entrypoint конфіг нема кому читати, крім самого Rust (рішення Д
//! мінідизайну `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//! JS-фасад незмінний (Р6); дрейф гейтиться parity-тестом
//! `npm/scripts/lib/tests/rules-cli-parity.test.mjs`.

use std::path::Path;

/// Integration-гілки effective policy: `baseBranch` + `releaseBranches`,
/// унікалізовано (дзеркало поля `integrationBranches` із `readGitPolicy`).
pub fn integration_branches(cwd: &Path) -> Vec<String> {
    rules_core::git_policy::read_git_policy(cwd).integration_branches
}

/// Кандидати бази дельти: кожна integration-гілка у `origin/`- та локальній
/// формах (дзеркало розгортання у `resolveChangedBase`,
/// `npm/scripts/lib/changed-files.mjs`).
pub fn integration_candidates(cwd: &Path) -> Vec<String> {
    integration_branches(cwd)
        .into_iter()
        .flat_map(|name| [format!("origin/{name}"), name])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_config(dir: &Path, file: &str, text: &str) {
        std::fs::write(dir.join(file), text).unwrap();
    }

    #[test]
    fn default_policy_without_config() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(integration_branches(tmp.path()), vec!["main"]);
        assert_eq!(
            integration_candidates(tmp.path()),
            vec!["origin/main", "main"]
        );
    }

    #[test]
    fn base_and_release_branches_deduped() {
        let tmp = TempDir::new().unwrap();
        write_config(
            tmp.path(),
            ".n-rules.json",
            r#"{"git":{"baseBranch":"dev","releaseBranches":[" main ","dev","","main",7]}}"#,
        );
        assert_eq!(integration_branches(tmp.path()), vec!["dev", "main"]);
    }

    #[test]
    fn invalid_json_falls_back_to_default_without_second_file() {
        let tmp = TempDir::new().unwrap();
        write_config(tmp.path(), ".n-rules.json", "{ невалідний json");
        write_config(
            tmp.path(),
            ".n-cursor.json",
            r#"{"git":{"baseBranch":"dev"}}"#,
        );
        // Перший наявний файл виграє навіть невалідним (break після спроби).
        assert_eq!(integration_branches(tmp.path()), vec!["main"]);
    }

    #[test]
    fn legacy_config_file_used_when_primary_absent() {
        let tmp = TempDir::new().unwrap();
        write_config(
            tmp.path(),
            ".n-cursor.json",
            r#"{"git":{"baseBranch":"trunk"}}"#,
        );
        assert_eq!(integration_branches(tmp.path()), vec!["trunk", "main"]);
    }

    #[test]
    fn non_object_git_block_ignored() {
        let tmp = TempDir::new().unwrap();
        write_config(tmp.path(), ".n-rules.json", r#"{"git":["main"]}"#);
        assert_eq!(integration_branches(tmp.path()), vec!["main"]);
    }
}
