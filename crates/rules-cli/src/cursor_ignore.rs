//! Rust-порт `loadCursorIgnorePaths` (`npm/scripts/lib/load-cursor-config.mjs`)
//! разом із нормалізацією ignore-шляхів у глоби, яку JS робить уже в
//! `walkDir` (`npm/scripts/utils/walkDir.mjs`).
//!
//! Два кроки склеєні тут навмисно: `rules_core::scan::walk_dir` приймає ВЖЕ
//! нормалізовані relative-глоби (нормалізація завʼязана на корінь обходу й
//! лишається поза ядром — доккомент `crates/rules-core/src/scan.rs`), а
//! єдиний споживач цієї пари в CLI — `rename-yaml-extensions`. Той самий
//! виняток із Р5, що й [`crate::git_policy`]: у native-entrypoint конфіг нема
//! кому читати, крім самого Rust (рішення Д мінідизайну
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! Порт 1:1 (усе — safe-by-default, як оригінал):
//! - конфіг — ПЕРШИЙ наявний із `.n-rules.json`, `.n-cursor.json`; невалідний
//!   JSON → порожній список (без переходу до наступного файлу);
//! - `ignore` не масив → порожній список; елементи не-рядки й порожні після
//!   trim — пропускаються;
//! - відносний шлях розв'язується від кореня, абсолютний береться як є;
//! - шлях поза коренем або сам корінь (`relative` дає `..*` чи `""`) —
//!   відкидається, решта стає глобом `<rel>/**`.

use std::path::Path;

use crate::paths;

/// Файли конфігурації в порядку пріоритету (дзеркало `CONFIG_FILE` +
/// `LEGACY_CONFIG_FILE`).
const CONFIG_FILES: [&str; 2] = [".n-rules.json", ".n-cursor.json"];

/// Ignore-глоби для обходу `root`, готові до `rules_core::scan::walk_dir`.
pub fn ignore_globs(root: &Path) -> Vec<String> {
    let Some(raw) = read_config(root) else {
        return Vec::new();
    };
    let Some(list) = raw.get("ignore").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    let mut globs = Vec::new();
    for item in list {
        let Some(value) = item.as_str().map(str::trim).filter(|v| !v.is_empty()) else {
            continue;
        };
        let rel = paths::relative_posix(root, &paths::resolve(root, value));
        if rel.is_empty() || rel.starts_with("..") {
            continue;
        }
        globs.push(format!("{rel}/**"));
    }
    globs
}

/// Читає перший наявний конфіг; помилка читання/парсингу → `None`
/// (наступний файл НЕ пробується — дзеркало каскаду `existsSync` у JS).
fn read_config(root: &Path) -> Option<serde_json::Value> {
    let path = CONFIG_FILES
        .iter()
        .map(|file| root.join(file))
        .find(|path| path.exists())?;
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(dir: &Path, file: &str, text: &str) {
        std::fs::write(dir.join(file), text).unwrap();
    }

    #[test]
    fn no_config_gives_no_globs() {
        let tmp = TempDir::new().unwrap();
        assert!(ignore_globs(tmp.path()).is_empty());
    }

    #[test]
    fn relative_and_absolute_paths_become_globs() {
        let tmp = TempDir::new().unwrap();
        let outside = tmp.path().join("vendor").to_string_lossy().into_owned();
        write(
            tmp.path(),
            ".n-rules.json",
            &format!(
                r#"{{"ignore":[" sub/dir ","{}","..\/outside",".","",7]}}"#,
                outside.replace('\\', "\\\\")
            ),
        );
        assert_eq!(
            ignore_globs(tmp.path()),
            vec!["sub/dir/**".to_string(), "vendor/**".to_string()]
        );
    }

    #[test]
    fn invalid_json_gives_no_globs_without_legacy_fallback() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".n-rules.json", "{ зламаний");
        write(tmp.path(), ".n-cursor.json", r#"{"ignore":["vendor"]}"#);
        assert!(ignore_globs(tmp.path()).is_empty());
    }

    #[test]
    fn legacy_config_used_when_primary_absent() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".n-cursor.json", r#"{"ignore":["vendor"]}"#);
        assert_eq!(ignore_globs(tmp.path()), vec!["vendor/**".to_string()]);
    }

    #[test]
    fn non_array_ignore_field_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".n-rules.json", r#"{"ignore":"vendor"}"#);
        assert!(ignore_globs(tmp.path()).is_empty());
    }
}
