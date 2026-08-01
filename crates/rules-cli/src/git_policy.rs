//! Rust-порт `readGitPolicy` (`npm/scripts/lib/git-policy.mjs`) — компактна
//! Git policy проєкту для delta-контуру CLI.
//!
//! Свідомий перший виняток із Р5 спеки міграції («конфіг-парсинг лишається
//! в JS»): Р5 формулювався для межі JS → native, а фаза 8 цю межу обертає —
//! у native-entrypoint конфіг більше нема кому читати, крім самого Rust
//! (рішення Д мінідизайну `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//! JS-фасад незмінний (Р6); семантика тут — точний порт, дрейф гейтиться
//! parity-тестом `npm/scripts/lib/tests/rules-cli-parity.test.mjs`.
//!
//! Порт 1:1 (safe-by-default, як оригінал):
//! - перший наявний файл із `.n-rules.json`, `.n-cursor.json` — і лише він
//!   (помилка парсингу НЕ веде до наступного файлу — `break` після спроби);
//! - невалідний JSON / відсутній файл / не-обʼєктний `git` → дефолтний канон
//!   `main`;
//! - `releaseBranches` — лише непорожні рядки після trim, унікалізовані зі
//!   збереженням порядку; порожній результат → `["main"]`;
//! - `integrationBranches` = унікальне `[baseBranch, ...releaseBranches]`.

use std::path::Path;

/// Файли конфігурації в порядку пріоритету (дзеркало `CONFIG_FILES`).
const CONFIG_FILES: [&str; 2] = [".n-rules.json", ".n-cursor.json"];
/// Історичний канон бази (дзеркало `DEFAULT_BASE_BRANCH`).
const DEFAULT_BASE_BRANCH: &str = "main";

/// Нормалізує потенційне ім'я гілки: рядок, trim, непорожній
/// (дзеркало `branchName`).
fn branch_name(value: &serde_json::Value) -> Option<String> {
    let name = value.as_str()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// Додає елемент, якщо його ще немає (унікалізація зі збереженням порядку —
/// семантика JS `new Set([...])`).
fn push_unique(list: &mut Vec<String>, value: String) {
    if !list.contains(&value) {
        list.push(value);
    }
}

/// Integration-гілки effective policy: `baseBranch` + `releaseBranches`,
/// унікалізовано (дзеркало поля `integrationBranches` із `readGitPolicy`).
pub fn integration_branches(cwd: &Path) -> Vec<String> {
    let mut raw: Option<serde_json::Value> = None;
    for file in CONFIG_FILES {
        let path = cwd.join(file);
        if !path.exists() {
            continue;
        }
        // Помилка читання/парсингу → None, але наступний файл уже не
        // пробуємо (той самий `break` після першого наявного, що в JS).
        raw = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok());
        break;
    }

    let git = match raw.as_ref().map(|v| v.get("git")) {
        Some(Some(value)) if value.is_object() => value.clone(),
        _ => serde_json::Value::Object(serde_json::Map::new()),
    };

    let base_branch = git
        .get("baseBranch")
        .and_then(branch_name)
        .unwrap_or_else(|| DEFAULT_BASE_BRANCH.to_string());

    let mut release_branches: Vec<String> = Vec::new();
    if let Some(configured) = git.get("releaseBranches").and_then(|v| v.as_array()) {
        for value in configured {
            if let Some(name) = branch_name(value) {
                push_unique(&mut release_branches, name);
            }
        }
    }
    if release_branches.is_empty() {
        release_branches.push(DEFAULT_BASE_BRANCH.to_string());
    }

    let mut integration = Vec::new();
    push_unique(&mut integration, base_branch);
    for name in release_branches {
        push_unique(&mut integration, name);
    }
    integration
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
