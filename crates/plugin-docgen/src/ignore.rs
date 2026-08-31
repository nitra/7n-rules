//! Порт `npm/rules/doc-files/docgen-ignore/main.mjs` (53 рядки) — детермінований
//! glob-предикат «чи шлях ігнорує `docgen`». Жодного дискового вводу: JS-оригінал
//! теж не читає диск тут (сам список `DOCGEN_IGNORE_GLOBS` — статичні дані, а
//! matching працює над рядком-шляхом, який ВЖЕ переданий викликачем) — тому ЄДИНИЙ
//! із шести детермінованих етапів, що не потребує рішення "file-reader чи параметр":
//! рішення про джерело `relPath` лежить на викликачі й тут, і в JS-оригіналі.
//!
//! # Двигун glob-matching
//! JS-оригінал делегує пакету `ignore` (gitignore-семантика). Тут — власний
//! мінімальний matcher замість нового Cargo-dep: усі 16 записів
//! [`DOCGEN_IGNORE_GLOBS`] мають РІВНО дві форми — `name/**` і `**/name/**` —
//! без символів-класів (`[...]`), альтернатив чи одиночного `?`, тож повний
//! gitignore-двигун (додатковий crate, ширший за реальну потребу) не потрібен.
//! [`glob_match`] підтримує сегментний `**` (нуль-або-більше сегментів) і
//! внутрішньосегментний `*` (будь-які символи, крім `/`) — достатньо для цього
//! конкретного списку І для майбутніх записів такої ж форми.

/// Базовий список glob-ів для `docgen` ignore — byte-exact порт
/// `DOCGEN_IGNORE_GLOBS` (`main.mjs:5-22`).
pub const DOCGEN_IGNORE_GLOBS: &[&str] = &[
    "**/node_modules/**",
    "**/dist/**",
    "**/target/**",
    ".git/**",
    "**/__pycache__/**",
    "**/coverage/**",
    ".cursor/**",
    ".claude/**",
    ".pi/**",
    ".pi-template/**",
    ".worktrees/**",
    "**/benchmarks/**",
    "**/demo/**",
    "**/docs/**",
    "npm/reports/**",
    "npm/bin/**",
];

/// Тип перевірки — дзеркало другого аргументу JS `isDocgenIgnored(relPath, kind)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IgnoreKind {
    /// Перевірка звичайного файлового шляху.
    Path,
    /// Перевірка каталогу: `**/demo/**` не матчить сегмент `demo` напряму,
    /// тому JS-оригінал підставляє фіктивний файл усередині (`main.mjs:48-50`).
    Dir,
}

/// Нормалізує шлях до posix-вигляду для glob-matching — порт `toPosixRelPath`
/// (`main.mjs:31-33`).
fn to_posix_rel_path(rel_path: &str) -> String {
    rel_path.replace('\\', "/")
}

/// Розбиває шлях/патерн на сегменти без пустих (обрізає провідні/кінцеві `/`).
fn segments(path: &str) -> Vec<&str> {
    path.split('/').filter(|s| !s.is_empty()).collect()
}

/// Матчить один сегмент-патерн (може містити `*`) проти одного сегмента шляху.
/// Підтримує лише `*` (будь-які символи, включно з порожнім, крім `/` — сегмент
/// і так не містить `/`) — цього досить для форм у [`DOCGEN_IGNORE_GLOBS`].
fn segment_match(pattern: &str, text: &str) -> bool {
    fn go(p: &[u8], t: &[u8]) -> bool {
        match (p.first(), t.first()) {
            (None, None) => true,
            (Some(b'*'), _) => go(&p[1..], t) || (!t.is_empty() && go(p, &t[1..])),
            (Some(pc), Some(tc)) if pc == tc => go(&p[1..], &t[1..]),
            _ => false,
        }
    }
    go(pattern.as_bytes(), text.as_bytes())
}

/// Сегментний glob-matcher із підтримкою `**` (нуль-або-більше сегментів) —
/// достатньо загальний для всіх записів [`DOCGEN_IGNORE_GLOBS`] (доккомент
/// модуля).
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let p = segments(pattern);
    let t = segments(path);

    fn go(p: &[&str], t: &[&str]) -> bool {
        match p.first() {
            None => t.is_empty(),
            // Trailing `**` (останній сегмент патерну) означає «вміст
            // каталогу», НЕ сам каталог — gitignore-семантика, яку JS-оригінал
            // явно документує (`main.mjs:48-50`: `**/demo/**` не матчить
            // голий сегмент `demo`, лише щось УСЕРЕДИНІ нього). Тому тут —
            // мінімум один залишковий сегмент, на відміну від провідного/
            // серединного `**`, який дозволяє нуль.
            Some(&"**") if p.len() == 1 => !t.is_empty(),
            Some(&"**") => go(&p[1..], t) || (!t.is_empty() && go(p, &t[1..])),
            Some(seg) => !t.is_empty() && segment_match(seg, t[0]) && go(&p[1..], &t[1..]),
        }
    }
    go(&p, &t)
}

/// Перевіряє, чи шлях має бути пропущений `docgen` — порт `isDocgenIgnored`
/// (`main.mjs:43-53`).
///
/// # Аргументи
/// * `rel_path` — відносний шлях від кореня проєкту (порожній рядок — не ігнорується).
/// * `kind` — [`IgnoreKind::Path`] (типово) або [`IgnoreKind::Dir`].
pub fn is_docgen_ignored(rel_path: &str, kind: IgnoreKind) -> bool {
    if rel_path.is_empty() {
        return false;
    }
    let posix_rel_path = to_posix_rel_path(rel_path);
    let matches = |candidate: &str| DOCGEN_IGNORE_GLOBS.iter().any(|g| glob_match(g, candidate));
    match kind {
        IgnoreKind::Dir => {
            matches(&posix_rel_path) || matches(&format!("{posix_rel_path}/__docgen__"))
        }
        IgnoreKind::Path => matches(&posix_rel_path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_node_modules_anywhere() {
        assert!(is_docgen_ignored("a/node_modules/b.js", IgnoreKind::Path));
        assert!(is_docgen_ignored("node_modules/b.js", IgnoreKind::Path));
    }

    #[test]
    fn ignores_rooted_dotdirs() {
        assert!(is_docgen_ignored(".git/HEAD", IgnoreKind::Path));
        assert!(is_docgen_ignored(".worktrees/foo/bar.rs", IgnoreKind::Path));
    }

    #[test]
    fn does_not_ignore_unrelated_path() {
        assert!(!is_docgen_ignored(
            "crates/plugin-docgen/src/lib.rs",
            IgnoreKind::Path
        ));
    }

    #[test]
    fn dir_kind_matches_demo_subtree_via_probe_file() {
        // `**/demo/**` не матчить сегмент `demo` напряму — потрібен фіктивний файл усередині.
        assert!(is_docgen_ignored("demo", IgnoreKind::Dir));
        assert!(!is_docgen_ignored("demo", IgnoreKind::Path));
    }

    #[test]
    fn empty_path_never_ignored() {
        assert!(!is_docgen_ignored("", IgnoreKind::Path));
    }

    #[test]
    fn backslash_path_normalized_to_posix() {
        assert!(is_docgen_ignored(r"a\node_modules\b.js", IgnoreKind::Path));
    }

    #[test]
    fn glob_match_star_within_segment() {
        assert!(glob_match("npm/reports/**", "npm/reports/out.json"));
        assert!(!glob_match("npm/reports/**", "npm/report/out.json"));
    }

    #[test]
    fn glob_match_double_star_matches_zero_segments() {
        assert!(glob_match("**/docs/**", "docs/x.md"));
    }
}
