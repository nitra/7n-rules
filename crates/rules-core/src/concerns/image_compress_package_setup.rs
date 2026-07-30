//! Native-порт `image-compress/package_setup`
//! (`npm/rules/image-compress/package_setup/main.mjs`, 98 рядків) —
//! `package.json` має існувати; `.n-minify-image.tsv` НЕ має бути в
//! `.gitignore` (committed source of truth split-cache 3.2.0); застарілий
//! `.minify-image-cache.tsv` (< 3.2) має бути видалений з кореня й з
//! `.gitignore` (`image-compress.mdc`).

use std::path::Path;

use crate::diagnostics::{Severity, Violation};

/// Імʼя committed-кешу (`@nitra/minify-image` ≥ 3.2.0) — порт
/// `HASH_CACHE_FILENAME` (`main.mjs:9`).
const HASH_CACHE_FILENAME: &str = ".n-minify-image.tsv";

/// Імʼя застарілого 4-колонкового кешу (`@nitra/minify-image` < 3.2) — порт
/// `LEGACY_CACHE_FILENAME` (`main.mjs:12`).
const LEGACY_CACHE_FILENAME: &str = ".minify-image-cache.tsv";

/// Дефолтний `reason` — усі виклики `fail()` цього concern-а без `opts`
/// (`main.mjs:44,63,71`) → `ctx.concernId` = `package_setup`.
const REASON: &str = "package_setup";

fn violation(message: String) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Зчитує всі змістовні рядки `.gitignore` (без коментарів і порожніх). Якщо
/// файла нема — `None` — точний порт `readGitignoreLines` (`main.mjs:19-27`).
fn read_gitignore_lines(cwd: &Path) -> Option<Vec<String>> {
    let raw = std::fs::read_to_string(cwd.join(".gitignore")).ok()?;
    Some(
        raw.split('\n')
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(str::to_string)
            .collect(),
    )
}

/// Перевіряє, що `.n-minify-image.tsv` НЕ в `.gitignore` — точний порт
/// `checkHashCacheNotIgnored` (`main.mjs:40-49`; сам факт існування файла не
/// вимагається).
fn check_hash_cache_not_ignored(cwd: &Path, violations: &mut Vec<Violation>) {
    if let Some(lines) = read_gitignore_lines(cwd) {
        if lines.iter().any(|l| l == HASH_CACHE_FILENAME) {
            violations.push(violation(format!(
                ".gitignore: прибери рядок `{HASH_CACHE_FILENAME}` — це закомічений source of truth split-cache 3.2.0 (image-compress.mdc)"
            )));
        }
    }
}

/// Перевіряє, що застарілий `.minify-image-cache.tsv` видалений з кореня й
/// з `.gitignore` — точний порт `checkLegacyCacheRemoved` (`main.mjs:60-75`).
fn check_legacy_cache_removed(cwd: &Path, violations: &mut Vec<Violation>) {
    if cwd.join(LEGACY_CACHE_FILENAME).exists() {
        violations.push(violation(format!(
            "{LEGACY_CACHE_FILENAME} застарілий (split-cache 3.2.0) — видали: `git rm --cached {LEGACY_CACHE_FILENAME} 2>/dev/null || true && rm -f {LEGACY_CACHE_FILENAME}` (також прибери відповідний рядок з .gitignore, якщо є)"
        )));
        return;
    }
    if let Some(lines) = read_gitignore_lines(cwd) {
        if lines.iter().any(|l| l == LEGACY_CACHE_FILENAME) {
            violations.push(violation(format!(
                ".gitignore: прибери застарілий рядок `{LEGACY_CACHE_FILENAME}` — split-cache 3.2.0 його не використовує"
            )));
        }
    }
}

/// Перевіряє відповідність проєкту `image-compress.mdc` — точний порт
/// `lint(ctx)` (`main.mjs:83-98`).
pub fn image_compress_package_setup(cwd: &Path) -> Vec<Violation> {
    if !cwd.join("package.json").exists() {
        return vec![violation(
            "package.json не знайдено в корені — додай (image-compress.mdc)".to_string(),
        )];
    }

    let mut violations = Vec::new();
    check_hash_cache_not_ignored(cwd, &mut violations);
    check_legacy_cache_removed(cwd, &mut violations);
    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn setup_valid_image_project(tmp: &TempDir) {
        fs::write(
            tmp.path().join("package.json"),
            r#"{"name":"image-fixture","private":true}"#,
        )
        .unwrap();
        fs::write(tmp.path().join(".gitignore"), "node_modules/\n").unwrap();
    }

    /// «успіх: чисте дерево без застарілих файлів» (`tests/package_setup.test.mjs:36-41`).
    #[test]
    fn clean_tree_has_no_violations() {
        let tmp = TempDir::new().unwrap();
        setup_valid_image_project(&tmp);
        assert!(image_compress_package_setup(tmp.path()).is_empty());
    }

    /// «успіх: `.n-minify-image.tsv` існує і не в .gitignore» (`:43-49`).
    #[test]
    fn hash_cache_present_and_not_ignored_is_clean() {
        let tmp = TempDir::new().unwrap();
        setup_valid_image_project(&tmp);
        fs::write(
            tmp.path().join(".n-minify-image.tsv"),
            "src/hero.png\tabc123\t1024\t800\n",
        )
        .unwrap();
        assert!(image_compress_package_setup(tmp.path()).is_empty());
    }

    /// «помилка: `.n-minify-image.tsv` у .gitignore (має бути в git)» (`:51-58`).
    #[test]
    fn hash_cache_ignored_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_image_project(&tmp);
        fs::write(
            tmp.path().join(".gitignore"),
            "node_modules/\n.n-minify-image.tsv\n",
        )
        .unwrap();
        assert!(!image_compress_package_setup(tmp.path()).is_empty());
    }

    /// «помилка: застарілий `.minify-image-cache.tsv` лежить у корені» (`:60-67`).
    #[test]
    fn legacy_cache_present_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_image_project(&tmp);
        fs::write(
            tmp.path().join(".minify-image-cache.tsv"),
            "src/hero.png\t1700000000000\t1024\t800\n",
        )
        .unwrap();
        assert!(!image_compress_package_setup(tmp.path()).is_empty());
    }

    /// «помилка: застарілий рядок `.minify-image-cache.tsv` лишився у .gitignore» (`:69-76`).
    #[test]
    fn legacy_cache_line_in_gitignore_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_valid_image_project(&tmp);
        fs::write(
            tmp.path().join(".gitignore"),
            "node_modules/\n.minify-image-cache.tsv\n",
        )
        .unwrap();
        assert!(!image_compress_package_setup(tmp.path()).is_empty());
    }

    /// Порт гілки «package.json відсутній» (`main.mjs:88-91`) — не покрито
    /// окремим JS-тестом файла `package_setup.test.mjs` (усі фікстури там
    /// проходять через `setupValidImageProject`), але це перша й найраніша
    /// гілка `lint(ctx)`.
    #[test]
    fn missing_package_json_is_violation() {
        let tmp = TempDir::new().unwrap();
        let violations = image_compress_package_setup(tmp.path());
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "package_setup");
        assert_eq!(
            violations[0].message,
            "package.json не знайдено в корені — додай (image-compress.mdc)"
        );
    }
}
