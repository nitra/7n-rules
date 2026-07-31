//! Native-порт `checkTextSubset` (`npm/scripts/lib/template.mjs:254-271`) —
//! єдина функція `template.mjs`, потрібна для `security/trufflehog`
//! (лінія-за-лінією subset-перевірка `.trufflehog-exclude` супроти
//! канонічного сніпета). Решта `template.mjs` (`checkSnippet`, `checkDeny`,
//! `checkContains`, `loadTemplate`, `resolveConcernTemplateData`) обслуговує
//! інші JS-concern-и (`ga/workflows` і т.д., перевірено через grep
//! консюмерів перед портом) і лишається в JS — модуль **не** видаляється,
//! портується лише потрібний зріз.

use std::collections::HashSet;

/// Порожні рядки й рядки-коментарі (`#...`) шаблону ігноруються — точний
/// порт `checkTextSubset` (`template.mjs:254-271`): кожен непорожній
/// не-коментарний (після `trim()`) рядок `template` має бути присутнім серед
/// trim-нутих рядків `actual`. `\r?\n`-спліт JS відтворюється через
/// `split('\n')` + `trim()` (`trim()` в Rust прибирає й хвостовий `\r`,
/// той самий видимий результат для CRLF-файлів).
pub fn check_text_subset(
    actual: &str,
    template: &str,
    target_path: &str,
    source: &str,
) -> Vec<String> {
    let actual_lines: HashSet<&str> = actual.split('\n').map(str::trim).collect();

    let mut out = Vec::new();
    for raw in template.split('\n') {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if !actual_lines.contains(line) {
            out.push(format!(
                "{target_path}: відсутній рядок {} ({source})",
                json_quote(line)
            ));
        }
    }
    out
}

/// Порт `quote(v)` для рядкового `v` (`template.mjs:111-113`) —
/// `JSON.stringify` еквівалент.
fn json_quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("{s:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Дзеркало `describe('checkTextSubset', ...)` (`template.test.mjs:244-268`).
    #[test]
    fn returns_empty_when_actual_contains_every_template_line() {
        let actual = "dist/\nnode_modules/\n";
        let template = "dist/\n";
        assert!(check_text_subset(actual, template, ".stylelintignore", "style.mdc").is_empty());
    }

    #[test]
    fn reports_missing_line() {
        let actual = "node_modules/\n";
        let template = "dist/\n";
        assert_eq!(
            check_text_subset(actual, template, ".stylelintignore", "style.mdc"),
            vec![r#".stylelintignore: відсутній рядок "dist/" (style.mdc)"#]
        );
    }

    #[test]
    fn ignores_empty_lines_and_comments() {
        let actual = "dist/\n";
        let template = "# comment\n\ndist/\n";
        assert!(check_text_subset(actual, template, ".stylelintignore", "style.mdc").is_empty());
    }

    #[test]
    fn crlf_actual_still_matches_after_trim() {
        let actual = "dist/\r\nnode_modules/\r\n";
        let template = "dist/\n";
        assert!(check_text_subset(actual, template, ".stylelintignore", "style.mdc").is_empty());
    }
}
