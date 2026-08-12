//! Native-порт `security/sample_secret`
//! (`npm/rules/security/sample_secret/main.mjs`, 80 рядків) — приклад-файли
//! (`*.example`, `*.sample`, `*.dist`, `*.template`, `fixtures/**`) не мають
//! містити bare-`secret` як значення (`security.mdc`).
//!
//! # Обхід дерева
//!
//! Використовує [`crate::scan::walk_dir`] (наш native scan, той самий
//! `ignore`-двигун, що й `walkDir.mjs` через N-API) — без дублювання
//! ignore-логіки. `walk_dir` уже повертає результат відсортованим
//! байтово-лексикографічно; JS-версія сортує **лише** відфільтровані
//! приклад-файли через `localeCompare` (`main.mjs:52`). Фільтрація байтово
//! відсортованого списку зберігає відносний порядок підмножини — для
//! ASCII-імен фікстур (типовий випадок: `.env.example`, `config.sample`)
//! обидва порядки збігаються; розходження можливе лише на не-ASCII іменах
//! файлів, де `localeCompare` (locale-aware) і byte-sort розійдуться —
//! не впливає на МНОЖИНУ violations, лише на порядок у списку.
//!
//! # Regex-порт без backreference-ів
//!
//! JS `VALUE_SECRET_RE` використовує capture-групу `(['"]?)` і backreference
//! `\1`, щоб вимагати, аби перша й друга лапка збігались (або обидві
//! відсутні). Crate `regex` — DFA-двигун, backreference-и
//! **не підтримує**. Семантично еквівалентна заміна без backreference —
//! 3-way alternation, що перебирає всі три допустимі комбінації лапок
//! (одинарні, подвійні, відсутні) явно: `(?:'secret'|"secret"|secret)`.
//! JS `u`-флаг (unicode mode) тут не семантичний (спека, крок 3) — усі класи
//! символів патерну ASCII, `regex` crate unicode-aware за замовчуванням.

use std::path::Path;

use regex::Regex;
use std::sync::LazyLock;

use crate::diagnostics::{Severity, Violation};
use crate::scan::walk_dir;

/// Суфікс basename'а прикладного файлу (`config.example`, `.env.dist`) —
/// порт `EXAMPLE_SUFFIX_RE` (`main.mjs:9`, `/\.(?:example|sample|template|dist)$/iu`).
static EXAMPLE_SUFFIX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.(?:example|sample|template|dist)$").expect("valid regex"));

/// Infix у basename'і (`docker-compose.example.yml`) — порт `EXAMPLE_INFIX_RE`
/// (`main.mjs:12`, `/\.(?:example|sample|template)\./iu`).
static EXAMPLE_INFIX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.(?:example|sample|template)\.").expect("valid regex"));

/// Сегмент шляху з фікстурами (`fixtures/`, `fixture/`, `__fixtures__/`) —
/// порт `FIXTURE_DIR_RE` (`main.mjs:15`, `/(?:^|\/)(?:__fixtures__|fixtures?)(?:\/|$)/u`,
/// без `i`-флагу — case-sensitive, як в оригіналі).
static FIXTURE_DIR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|/)(?:__fixtures__|fixtures?)(?:/|$)").expect("valid regex"));

/// Bare-`secret` у позиції значення — порт `VALUE_SECRET_RE` (`main.mjs:24`)
/// без backreference-у (doc-комент модуля, секція «Regex-порт»).
static VALUE_SECRET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)[:=]>?\s*(?:'secret'|"secret"|secret)[\s,;}\])]*(?:(?:#|//).*)?$"#)
        .expect("valid regex")
});

/// Стабільний machine code — дзеркало дефолтного `reason` JS-версії
/// (`fail(msg)` без `opts` → `reason = ctx.concernId` = `entry.concern.name`
/// = basename каталогу `sample_secret`, той самий принцип, що й
/// `forbidden_prettier::REASON`).
const REASON: &str = "sample_secret";

/// Чи є файл «прикладним» — таким, де `secret` очікувано є placeholder'ом.
/// Точний порт `isExampleFile` (`main.mjs:31-34`).
fn is_example_file(rel_posix: &str) -> bool {
    // basename — останній сегмент після '/' (або весь шлях, якщо '/' немає),
    // точний еквівалент `relPosix.slice(relPosix.lastIndexOf('/') + 1)`.
    let base = rel_posix.split('/').next_back().unwrap_or(rel_posix);
    EXAMPLE_SUFFIX_RE.is_match(base)
        || EXAMPLE_INFIX_RE.is_match(base)
        || FIXTURE_DIR_RE.is_match(rel_posix)
}

/// Перевіряє відповідність проєкту правилам `security.mdc` (sample-secret) —
/// точний порт `lint(ctx)` (`main.mjs:41-80`).
pub fn sample_secret(cwd: &Path) -> Vec<Violation> {
    let files = walk_dir(cwd, &[]);
    let examples: Vec<&String> = files.iter().filter(|rel| is_example_file(rel)).collect();

    let mut violations = Vec::new();
    for rel in examples {
        let abs = cwd.join(rel);
        // Лояльне UTF-8 декодування (як `readFile(abs, 'utf8')` у Node — не
        // кидає на невалідних байтах, замінює їх), а не `read_to_string`
        // (кинула б `Err` і пропустила б увесь файл на першому ж
        // невалідному байті) — ближча парність до JS fail-safe контракту
        // `try { content = await readFile(abs, 'utf8') } catch { continue }`
        // (тут `catch` ловить лише I/O-помилки, не decode-помилки, бо їх
        // Node-у на цьому шляху не буває).
        let bytes = match std::fs::read(&abs) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let content = String::from_utf8_lossy(&bytes);

        for (i, line_) in content.split('\n').enumerate() {
            let line = line_.strip_suffix('\r').unwrap_or(line_);
            if !VALUE_SECRET_RE.is_match(line) {
                continue;
            }
            violations.push(Violation {
                reason: REASON.to_string(),
                message: format!(
                    "{}:{}: `{}` — заміни placeholder `secret` на `sample-secret` (security.mdc)",
                    rel,
                    i + 1,
                    line.trim()
                ),
                // Шлях і номер рядка машинними полями, а не лише в тексті:
                // T0-фікс бере їх звідси, без розбору повідомлення назад.
                file: Some(rel.clone()),
                severity: Severity::Error,
                data: Some(serde_json::json!({ "line": i + 1 })),
            });
        }
    }
    violations
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    /// Дзеркало «pass: прикладних файлів немає» (`tests/sample_secret.test.mjs:11-17`).
    #[test]
    fn no_example_files_no_violations() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "README.md", "# hello\n");
        assert!(sample_secret(tmp.path()).is_empty());
    }

    /// Дзеркало «pass: .env.example з канонічним sample-secret» (`:19-26`).
    #[test]
    fn canonical_sample_secret_placeholder_passes() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "DB_PASSWORD=sample-secret\n");
        assert!(sample_secret(tmp.path()).is_empty());
    }

    /// Дзеркало «fail: .env.example з bare secret» (`:28-34`).
    #[test]
    fn bare_secret_in_env_example_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "DB_PASSWORD=secret\n");
        let violations = sample_secret(tmp.path());
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "sample_secret");
        assert_eq!(
            violations[0].message,
            ".env.example:1: `DB_PASSWORD=secret` — заміни placeholder `secret` на `sample-secret` (security.mdc)"
        );
        // Шлях і рядок — машинними полями, щоб T0-фікс не розбирав текст
        // повідомлення назад.
        assert_eq!(violations[0].file.as_deref(), Some(".env.example"));
        assert_eq!(
            violations[0].data.as_ref().and_then(|d| d.get("line")),
            Some(&serde_json::json!(1))
        );
    }

    /// Дзеркало «fail: *.sample (YAML) зі значенням "secret" у лапках» (`:36-42`).
    #[test]
    fn quoted_secret_in_sample_yaml_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "config.sample", "password: \"secret\"\n");
        assert_eq!(sample_secret(tmp.path()).len(), 1);
    }

    /// Дзеркало «fail: *.dist з =>-присвоєнням (PHP-стиль)» (`:44-50`).
    #[test]
    fn php_arrow_assignment_in_dist_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "app.php.dist",
            "<?php return ['password' => 'secret'];\n",
        );
        assert_eq!(sample_secret(tmp.path()).len(), 1);
    }

    /// Дзеркало «fail: файл усередині каталогу fixtures/» (`:52-59`).
    #[test]
    fn file_inside_fixtures_dir_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "test/fixtures/tokens.env", "TOKEN=secret\n");
        assert_eq!(sample_secret(tmp.path()).len(), 1);
    }

    /// Дзеркало «pass: ключ з іменем *_secret і реальним значенням не чіпається» (`:61-67`).
    #[test]
    fn secret_suffixed_key_name_with_real_value_passes() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "CLIENT_SECRET=replace-me\n");
        assert!(sample_secret(tmp.path()).is_empty());
    }

    /// Дзеркало «pass: secret лише як частина значення (secret-key) не матчиться» (`:69-75`).
    #[test]
    fn secret_as_value_prefix_does_not_match() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "API_KEY=secret-key\n");
        assert!(sample_secret(tmp.path()).is_empty());
    }

    /// Дзеркало «pass: не-прикладний .env не сканується» (`:77-83`).
    #[test]
    fn non_example_env_file_is_not_scanned() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env", "DB_PASSWORD=secret\n");
        assert!(sample_secret(tmp.path()).is_empty());
    }

    /// Одинарні лапки — третя гілка 3-way alternation (не покрито окремим
    /// JS-тестом явно, але `VALUE_SECRET_RE` дозволяє й одинарні лапки).
    #[test]
    fn single_quoted_secret_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "config.sample", "password: 'secret'\n");
        assert_eq!(sample_secret(tmp.path()).len(), 1);
    }

    /// Різні лапки на кінцях (`'secret"`) НЕ мають збігатись із патерном —
    /// це саме та семантика, яку в оригіналі забезпечував backreference `\1`.
    #[test]
    fn mismatched_quotes_do_not_match() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "config.sample", "password: 'secret\"\n");
        assert!(sample_secret(tmp.path()).is_empty());
    }
}
