//! Native-порт `abie/firebase_hosting`
//! (`npm/rules/abie/firebase_hosting/main.mjs`, 46 рядків) — у підкаталогах
//! 1-го рівня кореня (без `.git`/`node_modules`) не має бути
//! `.firebaserc`/`firebase.json`/`.firebase/` (`abie.mdc`). Сам корінь не
//! перевіряється.
//!
//! # Обхід — навмисно НЕ через [`crate::scan::walk_dir`]
//!
//! На відміну від whole-repo концернів (`sample_secret`, `env_dns`), цей
//! concern сканує лише один рівень (`readdir(root, { withFileTypes: true })`,
//! `main.mjs:21`) — не рекурсивний обхід дерева з gitignore-логікою.
//! [`crate::scan::walk_dir`] тут не застосовний за конструкцією (він завжди
//! рекурсивний і повертає файли, не директорії) — прямий `std::fs::read_dir`
//! на верхньому рівні точно відтворює семантику `readdir`.

use std::path::Path;

use crate::diagnostics::{Severity, Violation};

/// Директорії верхнього рівня, які пропускаються — порт `SKIP_TOP_DIR_NAMES`
/// (`main.mjs:8`).
const SKIP_TOP_DIR_NAMES: &[&str] = &[".git", "node_modules"];

/// Заборонені файли верхнього рівня кожного підкаталогу — порт циклу
/// `for (const name of ['.firebaserc', 'firebase.json'])` (`main.mjs:30`).
const FORBIDDEN_FILES: &[&str] = &[".firebaserc", "firebase.json"];

/// Дефолтний `reason` (`fail(msg)` без `opts` → `ctx.concernId` =
/// `firebase_hosting`, той самий принцип, що й `forbidden_prettier::REASON`).
const REASON: &str = "firebase_hosting";

/// Перевіряє підкаталоги 1-го рівня `root` на артефакти Firebase Hosting —
/// точний порт `lint(ctx)` (`main.mjs:14-46`).
pub fn firebase_hosting(root: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();

    // `readdir` на неіснуючому/недоступному шляху кидає — JS ловить і
    // репортує одне порушення з текстом помилки (`main.mjs:20-26`).
    let entries = match std::fs::read_dir(root) {
        Ok(rd) => rd,
        Err(err) => {
            violations.push(Violation {
                reason: REASON.to_string(),
                message: format!(
                    "Не вдалося прочитати {} для перевірки Firebase Hosting: {err} (abie.mdc)",
                    root.display()
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
            return violations;
        }
    };

    // Детермінований порядок (не властивість оригіналу — `readdir` не
    // гарантує порядок жодним контрактом, і жоден JS-тест на нього не
    // покладається) — сортуємо за іменем підкаталогу заради відтворюваності
    // тестів/виводу, без впливу на МНОЖИНУ violations.
    let mut top_dirs: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false)
                && !SKIP_TOP_DIR_NAMES.contains(&entry.file_name().to_string_lossy().as_ref())
        })
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    top_dirs.sort();

    for name in &top_dirs {
        for forbidden in FORBIDDEN_FILES {
            let rel = format!("{name}/{forbidden}");
            if root.join(name).join(forbidden).exists() {
                violations.push(Violation {
                    reason: REASON.to_string(),
                    message: format!(
                        "Знайдено заборонений файл Firebase Hosting: {rel} — видали його (abie.mdc)"
                    ),
                    file: None,
                    severity: Severity::Error,
                    data: None,
                });
            }
        }
        if root.join(name).join(".firebase").exists() {
            violations.push(Violation {
                reason: REASON.to_string(),
                message: format!(
                    "Знайдено заборонену директорію: {name}/.firebase/ — видали її (abie.mdc)"
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn mkdir(tmp: &TempDir, rel: &str) {
        fs::create_dir_all(tmp.path().join(rel)).unwrap();
    }

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    /// «порожній каталог → clean» (`tests/firebase_hosting.test.mjs:18-23`).
    #[test]
    fn empty_dir_is_clean() {
        let tmp = TempDir::new().unwrap();
        assert!(firebase_hosting(tmp.path()).is_empty());
    }

    /// «файли тільки в корені → clean (корінь не перевіряється)» (`:25-33`).
    #[test]
    fn root_level_artifacts_are_ignored() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".firebaserc", "{}");
        write(&tmp, "firebase.json", "{}");
        mkdir(&tmp, ".firebase");
        assert!(firebase_hosting(tmp.path()).is_empty());
    }

    /// «.firebaserc у підкаталозі → violation» (`:35-42`).
    #[test]
    fn firebaserc_in_subdir_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/.firebaserc", "{}");
        assert!(!firebase_hosting(tmp.path()).is_empty());
    }

    /// «firebase.json у підкаталозі → violation» (`:44-51`).
    #[test]
    fn firebase_json_in_subdir_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/firebase.json", "{}");
        assert!(!firebase_hosting(tmp.path()).is_empty());
    }

    /// «.firebase/ директорія у підкаталозі → violation» (`:53-59`).
    #[test]
    fn firebase_dir_in_subdir_is_violation() {
        let tmp = TempDir::new().unwrap();
        mkdir(&tmp, "pkg/.firebase");
        let violations = firebase_hosting(tmp.path());
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains("pkg/.firebase/"));
    }

    /// «.git/ і node_modules/ ігноруються» (`:61-71`).
    #[test]
    fn git_and_node_modules_are_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".git/.firebaserc", "{}");
        write(&tmp, "node_modules/firebase.json", "{}");
        mkdir(&tmp, "node_modules/.firebase");
        assert!(firebase_hosting(tmp.path()).is_empty());
    }

    /// «файли тільки на 1-му рівні; глибші — не сканяться» (`:73-80`).
    #[test]
    fn nested_files_beyond_first_level_are_not_scanned() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/nested/firebase.json", "{}");
        assert!(firebase_hosting(tmp.path()).is_empty());
    }

    /// «кілька підкаталогів — один з артефактом → violation» (`:82-90`).
    #[test]
    fn one_of_several_subdirs_with_artifact_is_violation() {
        let tmp = TempDir::new().unwrap();
        mkdir(&tmp, "pkg-a");
        write(&tmp, "pkg-b/.firebaserc", "{}");
        assert!(!firebase_hosting(tmp.path()).is_empty());
    }

    /// «readdir на неіснуючому шляху → violation (помилка читання)» (`:92-96`).
    #[test]
    fn readdir_error_on_nonexistent_path_is_violation() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("no-such-path").join("nested");
        let violations = firebase_hosting(&ghost);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "firebase_hosting");
    }
}
