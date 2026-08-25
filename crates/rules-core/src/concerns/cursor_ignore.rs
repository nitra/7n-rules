//! Читання repo-локального `.n-rules.json` (fallback — legacy `.n-cursor.json`)
//! для full-scope native concern-ів, яким потрібен список ignore-шляхів для
//! обходу дерева ([`crate::scan::walk_dir`]) — порт `loadCursorIgnorePaths`
//! (`npm/scripts/lib/load-cursor-config.mjs:37-58`) + допоміжна нормалізація
//! `ignorePaths` у relative-posix-`/**`-глоби, яку `walkDir.mjs:60-67` робить
//! inline перед викликом native `walkDir` (звідси другий helper тут же —
//! [`to_relative_ignore_globs`]).
//!
//! # Відхилення від Р5 «конфіг у JS»
//!
//! Спека фази 5 закладає, що per-concern конфігурація (`.n-rules.json` тощо)
//! лишається на боці JS-оркестратора, а native отримує вже готові параметри
//! через dispatch. Тут — виняток: `run_concern` (`mod.rs`) не має per-concern
//! знань (єдина сигнатура `(key, cwd, files)` для всіх native concern-ів), тож
//! немає місця прокинути `ignorePaths`, які `abie/env_dns` читає з
//! `.n-rules.json` ДО виклику `walkDir`. Замість розширення dispatch-сигнатури
//! заради одного concern-а — цей full-scope native concern читає свій
//! repo-локальний конфіг сам, так само як він сам вирішує, що сканувати.
//! Семантика читання — точний порт (усі гілки нижче), лише точка виклику
//! змістилась із JS-оркестратора всередину native concern-а.
//!
//! Той самий аргумент застосовний до `build_full_scope_files`
//! (`crates/rules-napi/src/lib.rs`) — host-функції, яка будує full-scope
//! batch файлів для wasm-концернів (`run_wasm_concern` із `files: None`).
//! Сигнатура `run_wasm_concern(wasm_path, key, cwd, files, tool_paths)` так
//! само не має місця прокинути `ignorePaths` без розширення napi-мосту заради
//! одного шару, тож napi-хост читає `.n-rules.json` сам — звідси модуль
//! `pub`, а не `pub(crate)`: єдиний зовнішній споживач за межами
//! `rules-core` — саме цей napi-binding.

use std::path::{Path, PathBuf};

const CONFIG_FILE: &str = ".n-rules.json";
const LEGACY_CONFIG_FILE: &str = ".n-cursor.json";

/// Лексично нормалізує `path` (без звернень до файлової системи — той самий
/// принцип, що й Node `path.resolve`/`path.normalize`: `.`-компоненти
/// відкидаються, `..`-компоненти «зʼїдають» попередній `Normal`-компонент,
/// не заглядаючи на диск) і повертає posix-рядок (`/`-роздільники).
fn lexical_normalize_posix(path: &Path) -> String {
    use std::path::Component;
    let mut stack: Vec<String> = Vec::new();
    let mut is_absolute = false;
    for component in path.components() {
        match component {
            Component::Prefix(_) => {}
            Component::RootDir => is_absolute = true,
            Component::CurDir => {}
            Component::ParentDir => {
                stack.pop();
            }
            Component::Normal(seg) => stack.push(seg.to_string_lossy().into_owned()),
        }
    }
    let joined = stack.join("/");
    if is_absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

/// Прибирає кінцеві `/` — точний порт `stripTrailingSlashes`
/// (`walkDir.mjs:32-36`).
fn strip_trailing_slashes(p: &str) -> &str {
    p.trim_end_matches('/')
}

/// Нормалізує шлях до абсолютного posix-формату без trailing-slash. Відносні
/// шляхи розвʼязуються від `root` — точний порт `toAbsPosix`
/// (`load-cursor-config.mjs:16-28`).
fn to_abs_posix(root: &Path, p: &str) -> String {
    let trimmed = p.trim();
    let joined: PathBuf = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        root.join(trimmed)
    };
    let mut posix = lexical_normalize_posix(&joined);
    while posix.ends_with('/') {
        posix.pop();
    }
    posix
}

/// Читає `.n-rules.json` (fallback `.n-cursor.json`) з кореня `root` і
/// повертає нормалізовані абсолютні posix-шляхи з поля `ignore`. Порожній
/// `Vec` — якщо файлу нема, поле `ignore` відсутнє/не масив, чи JSON
/// побитий — точний порт `loadCursorIgnorePaths` (`load-cursor-config.mjs:37-58`),
/// сам конфіг не валідується (лише поле `ignore`).
pub fn load_cursor_ignore_paths(root: &Path) -> Vec<String> {
    let primary = root.join(CONFIG_FILE);
    let file = if primary.exists() {
        primary
    } else {
        let legacy = root.join(LEGACY_CONFIG_FILE);
        if !legacy.exists() {
            return Vec::new();
        }
        legacy
    };

    let raw = match std::fs::read_to_string(&file) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(list) = parsed.get("ignore").and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for item in list {
        let Some(s) = item.as_str() else { continue };
        let v = s.trim();
        if v.is_empty() {
            continue;
        }
        out.push(to_abs_posix(root, v));
    }
    out
}

/// Перетворює абсолютні posix-`ignore_paths` (типово — вихід
/// [`load_cursor_ignore_paths`]) на relative-posix-`/**`-глоби відносно
/// `walk_root`, придатні для [`crate::scan::walk_dir`]'s `extra_ignore_globs`
/// — точний порт inline-нормалізації в `walkDir` (`walkDir.mjs:60-67`):
/// шлях поза `walk_root` (перший компонент відносного шляху був би `..`) чи
/// шлях, що збігається з самим `walk_root` (порожній відносний шлях), —
/// відкидається (`null`/`filter(Boolean)` у JS).
pub fn to_relative_ignore_globs(walk_root: &Path, ignore_paths: &[String]) -> Vec<String> {
    let root_posix = lexical_normalize_posix(walk_root);
    let root_parts: Vec<&str> = root_posix.split('/').filter(|s| !s.is_empty()).collect();

    let mut out = Vec::new();
    for raw in ignore_paths {
        let stripped = strip_trailing_slashes(raw);
        let parts: Vec<&str> = stripped.split('/').filter(|s| !s.is_empty()).collect();

        let mut i = 0;
        while i < root_parts.len() && i < parts.len() && root_parts[i] == parts[i] {
            i += 1;
        }
        let up = root_parts.len() - i;
        if up > 0 {
            // rel починався б з ".." — шлях поза walk_root, пропускаємо.
            continue;
        }
        let rel_parts = &parts[i..];
        if rel_parts.is_empty() {
            // rel === '' — ignore-шлях збігається з walk_root, пропускаємо.
            continue;
        }
        out.push(format!("{}/**", rel_parts.join("/")));
    }
    out
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    // --- load_cursor_ignore_paths: дзеркало tests/load-cursor-config.test.mjs ---

    /// «повертає [] якщо .n-rules.json відсутній» (`:23-28`).
    #[test]
    fn missing_config_file_returns_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(load_cursor_ignore_paths(tmp.path()).is_empty());
    }

    /// «повертає [] якщо поле ignore відсутнє» (`:30-36`).
    #[test]
    fn missing_ignore_field_returns_empty() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".n-rules.json"), r#"{"rules":["k8s"]}"#).unwrap();
        assert!(load_cursor_ignore_paths(tmp.path()).is_empty());
    }

    /// «повертає [] якщо ignore не масив» (`:38-44`).
    #[test]
    fn non_array_ignore_field_returns_empty() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(".n-rules.json"),
            r#"{"rules":[],"ignore":"oops"}"#,
        )
        .unwrap();
        assert!(load_cursor_ignore_paths(tmp.path()).is_empty());
    }

    /// «повертає [] якщо .n-rules.json — невалідний JSON» (`:46-52`).
    #[test]
    fn invalid_json_returns_empty() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".n-rules.json"), "{ not: json").unwrap();
        assert!(load_cursor_ignore_paths(tmp.path()).is_empty());
    }

    /// «нормалізує відносні шляхи в абсолютні posix без trailing-slash» (`:54-64`).
    #[test]
    fn normalizes_relative_paths_to_absolute_posix() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(".n-rules.json"),
            r#"{"rules":[],"ignore":["vendor/chart","postgres-master/","a/b/c"]}"#,
        )
        .unwrap();
        let expected_dir = lexical_normalize_posix(tmp.path());
        let out = load_cursor_ignore_paths(tmp.path());
        assert_eq!(
            out,
            vec![
                format!("{expected_dir}/vendor/chart"),
                format!("{expected_dir}/postgres-master"),
                format!("{expected_dir}/a/b/c"),
            ]
        );
    }

    /// «пропускає не-рядкові й порожні елементи» (`:66-76`).
    #[test]
    fn skips_non_string_and_empty_items() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(".n-rules.json"),
            r#"{"rules":[],"ignore":["vendor","","   ",42,null,{"x":1},"ok"]}"#,
        )
        .unwrap();
        let expected_dir = lexical_normalize_posix(tmp.path());
        let out = load_cursor_ignore_paths(tmp.path());
        assert_eq!(
            out,
            vec![
                format!("{expected_dir}/vendor"),
                format!("{expected_dir}/ok")
            ]
        );
    }

    /// «абсолютні шляхи з конфігу залишаються абсолютними» (`:78-86`).
    #[test]
    fn absolute_paths_stay_absolute() {
        let tmp = TempDir::new().unwrap();
        let abs = tmp.path().join("absolute-target");
        fs::write(
            tmp.path().join(".n-rules.json"),
            serde_json::json!({"rules": [], "ignore": [abs.to_string_lossy()]}).to_string(),
        )
        .unwrap();
        let expected = lexical_normalize_posix(&abs);
        let out = load_cursor_ignore_paths(tmp.path());
        assert_eq!(out, vec![expected]);
    }

    /// Fallback на legacy `.n-cursor.json`, якщо `.n-rules.json` відсутній.
    #[test]
    fn falls_back_to_legacy_config_file() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(".n-cursor.json"),
            r#"{"ignore":["legacy-dir"]}"#,
        )
        .unwrap();
        let expected_dir = lexical_normalize_posix(tmp.path());
        let out = load_cursor_ignore_paths(tmp.path());
        assert_eq!(out, vec![format!("{expected_dir}/legacy-dir")]);
    }

    /// Обидва файли присутні — `.n-rules.json` виграє (перший, що існує).
    #[test]
    fn primary_config_wins_over_legacy() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(".n-rules.json"),
            r#"{"ignore":["primary"]}"#,
        )
        .unwrap();
        fs::write(
            tmp.path().join(".n-cursor.json"),
            r#"{"ignore":["legacy"]}"#,
        )
        .unwrap();
        let expected_dir = lexical_normalize_posix(tmp.path());
        let out = load_cursor_ignore_paths(tmp.path());
        assert_eq!(out, vec![format!("{expected_dir}/primary")]);
    }

    // --- to_relative_ignore_globs: дзеркало inline-нормалізації walkDir.mjs:60-67 ---

    #[test]
    fn descendant_ignore_path_becomes_relative_glob() {
        let root = Path::new("/repo");
        let ignore = vec!["/repo/vendor/chart".to_string()];
        assert_eq!(
            to_relative_ignore_globs(root, &ignore),
            vec!["vendor/chart/**".to_string()]
        );
    }

    #[test]
    fn ignore_path_outside_root_is_dropped() {
        let root = Path::new("/repo/sub");
        let ignore = vec!["/other/place".to_string()];
        assert!(to_relative_ignore_globs(root, &ignore).is_empty());
    }

    #[test]
    fn ignore_path_equal_to_root_is_dropped() {
        let root = Path::new("/repo");
        let ignore = vec!["/repo".to_string(), "/repo/".to_string()];
        assert!(to_relative_ignore_globs(root, &ignore).is_empty());
    }

    #[test]
    fn multiple_ignore_paths_mixed() {
        let root = Path::new("/repo");
        let ignore = vec![
            "/repo/vendor".to_string(),
            "/outside".to_string(),
            "/repo/a/b".to_string(),
        ];
        assert_eq!(
            to_relative_ignore_globs(root, &ignore),
            vec!["vendor/**".to_string(), "a/b/**".to_string()]
        );
    }
}
