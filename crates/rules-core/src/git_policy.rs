//! Rust-порт `readGitPolicy` (`npm/scripts/lib/git-policy.mjs`) — компактна
//! Git policy проєкту: перший наявний конфіг із `.n-rules.json`/
//! `.n-cursor.json`, safe-by-default канон `main` при відсутньому/невалідному
//! конфізі.
//!
//! # Звідки переїхав і чому тут, а не в `rules-cli`
//!
//! До цього модуля повний `readGitPolicy` існував лише частково —
//! `crates/rules-cli/src/git_policy.rs` мав вузький зріз (`integration_branches`/
//! `integration_candidates`) під конкретну потребу CLI (`n-rules lint --delta`,
//! `n-rules ci`). Концерн `changelog/consistency` (`crate::concerns::changelog_consistency`,
//! порт `npm/rules/changelog/consistency/main.mjs`) потребує ПОВНУ форму —
//! `baseBranch` окремо (порівняння `branch === policy.baseBranch`) і
//! `releaseBranches` окремо (`policy.releaseBranches.includes(branch)`), не
//! лише готовий список кандидатів. Концерн живе в `rules-core`, а
//! `rules-core` не може залежати від `rules-cli` (напрям залежностей
//! протилежний — `rules-cli` тягне `rules-core`, не навпаки) — тож
//! повноцінний парсер конфігу переїхав СЮДИ, а `rules-cli/src/git_policy.rs`
//! став тонким реекспортом над [`read_git_policy`] (той самий публічний API
//! `integration_branches`/`integration_candidates`, той самий behavior,
//! жодної дубльованої логіки парсингу `.n-rules.json` між двома крейтами).
//! Parity-гейт `npm/scripts/lib/tests/rules-cli-parity.test.mjs` і далі
//! звіряє видиму поведінку `rules-cli`, не зачеплений переносом.
//!
//! Порт 1:1 (safe-by-default, як оригінал):
//! - перший наявний файл із `.n-rules.json`, `.n-cursor.json` — і лише він
//!   (помилка парсингу НЕ веде до наступного файлу — `break` після спроби);
//! - невалідний JSON / відсутній файл / не-обʼєктний `git` → дефолтний канон
//!   `main`;
//! - `releaseBranches` — лише непорожні рядки після trim, унікалізовані зі
//!   збереженням порядку; порожній результат → `["main"]`;
//! - `integrationBranches` = унікальне `[baseBranch, ...releaseBranches]`;
//! - `protectedBranches` — те саме значення, що `integrationBranches`
//!   (JS повертає один і той самий масив під двома назвами полів).

use std::path::Path;

/// Файли конфігурації в порядку пріоритету (дзеркало `CONFIG_FILES`).
const CONFIG_FILES: [&str; 2] = [".n-rules.json", ".n-cursor.json"];
/// Історичний канон бази (дзеркало `DEFAULT_BASE_BRANCH`).
const DEFAULT_BASE_BRANCH: &str = "main";

/// Effective Git policy проєкту — точний порт форми, яку повертає
/// `readGitPolicy` (`git-policy.mjs:27-47`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitPolicy {
    pub base_branch: String,
    pub release_branches: Vec<String>,
    pub integration_branches: Vec<String>,
    pub protected_branches: Vec<String>,
}

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

/// Читає effective Git policy — точний порт `readGitPolicy`
/// (`git-policy.mjs:27-47`).
pub fn read_git_policy(cwd: &Path) -> GitPolicy {
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
    push_unique(&mut integration, base_branch.clone());
    for name in &release_branches {
        push_unique(&mut integration, name.clone());
    }

    GitPolicy {
        base_branch,
        release_branches,
        protected_branches: integration.clone(),
        integration_branches: integration,
    }
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
        let policy = read_git_policy(tmp.path());
        assert_eq!(policy.base_branch, "main");
        assert_eq!(policy.release_branches, vec!["main"]);
        assert_eq!(policy.integration_branches, vec!["main"]);
        assert_eq!(policy.protected_branches, vec!["main"]);
    }

    #[test]
    fn base_and_release_branches_deduped() {
        let tmp = TempDir::new().unwrap();
        write_config(
            tmp.path(),
            ".n-rules.json",
            r#"{"git":{"baseBranch":"dev","releaseBranches":[" main ","dev","","main",7]}}"#,
        );
        let policy = read_git_policy(tmp.path());
        assert_eq!(policy.base_branch, "dev");
        assert_eq!(policy.release_branches, vec!["main", "dev"]);
        assert_eq!(policy.integration_branches, vec!["dev", "main"]);
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
        let policy = read_git_policy(tmp.path());
        assert_eq!(policy.base_branch, "main");
    }

    #[test]
    fn legacy_config_file_used_when_primary_absent() {
        let tmp = TempDir::new().unwrap();
        write_config(
            tmp.path(),
            ".n-cursor.json",
            r#"{"git":{"baseBranch":"trunk"}}"#,
        );
        let policy = read_git_policy(tmp.path());
        assert_eq!(policy.base_branch, "trunk");
        assert_eq!(policy.integration_branches, vec!["trunk", "main"]);
    }

    #[test]
    fn non_object_git_block_ignored() {
        let tmp = TempDir::new().unwrap();
        write_config(tmp.path(), ".n-rules.json", r#"{"git":["main"]}"#);
        let policy = read_git_policy(tmp.path());
        assert_eq!(policy.base_branch, "main");
        assert_eq!(policy.release_branches, vec!["main"]);
    }

    #[test]
    fn release_branches_include_check_uses_configured_names() {
        let tmp = TempDir::new().unwrap();
        write_config(
            tmp.path(),
            ".n-rules.json",
            r#"{"git":{"baseBranch":"dev","releaseBranches":["main","stable"]}}"#,
        );
        let policy = read_git_policy(tmp.path());
        assert!(policy.release_branches.contains(&"stable".to_string()));
        assert!(policy.integration_branches.contains(&"stable".to_string()));
    }
}
