//! Внутрішній glob-обхід для G1 TOML-кластеру ([`crate::concerns::cargo_workspace`],
//! [`crate::concerns::workspaces`]) — аналог `npm/scripts/utils/glob-compat.mjs#scanGlob`,
//! на який спираються обидва JS-модулі. Порт не намагається відтворити повну
//! `Bun.Glob`/Node `fs.glob()` семантику — лише те, що реально споживають
//! `cargo-workspace.mjs` (`crates/*` — літерали + однорівневий `*`) і
//! `workspaces.mjs` (`packages/*`, `**` — повний double-star).
//!
//! # Підтримувані сегменти патерну (розбитого по `/`)
//!
//! - літерал — точний збіг імені;
//! - сегмент з `*` (у будь-якій позиції, напр. `*`, `*.rs`, `pkg-*`) —
//!   `*` матчить будь-які символи **в межах одного сегмента** (не перетинає `/`);
//! - сегмент, що дорівнює рівно `**`, — стандартна `**`-семантика (double-star
//!   glob): нуль чи більше цілих сегментів-каталогів.
//!
//! # dot-файли
//!
//! Прихований запис (ім'я починається з `.`) матчиться лише буквальним
//! сегментом, що сам починається з `.` — той самий дефолт `dot: false`, що
//! й у `Bun.Glob`/Node `fs.glob()` без явної опції (обидва — реальний рушій
//! під `scanGlob` у JS). Захищає й від випадкового заглиблення в `.git/` під
//! час `**`-рекурсії.

use std::path::Path;

use regex::Regex;

/// Компілює один сегмент патерну (без `/`) у якірний regex: `*` → `.*`,
/// решта символів екранована буквально. Сегмент `**` сюди не потрапляє —
/// обробляється окремо в [`walk`].
fn segment_regex(segment: &str) -> Regex {
    let mut pattern = String::from("^");
    for ch in segment.chars() {
        if ch == '*' {
            pattern.push_str(".*");
        } else {
            pattern.push_str(&regex::escape(&ch.to_string()));
        }
    }
    pattern.push('$');
    Regex::new(&pattern).expect("сегмент glob-патерну компілюється в валідний regex")
}

/// Прихований запис — ім'я починається з `.`.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// З'єднує relative-posix префікс з наступним іменем сегмента.
fn join_rel(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

/// Рекурсивно обходить `dir`, накопичуючи relative-posix шляхи **файлів**
/// (не каталогів), що матчать `segments` — уже розбитий по `/` патерн.
fn walk(dir: &Path, rel_prefix: &str, segments: &[&str], out: &mut Vec<String>) {
    let Some((seg, rest)) = segments.split_first() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    if *seg == "**" {
        // Нуль сегментів — залишок патерну перевіряється прямо в поточному каталозі.
        walk(dir, rel_prefix, rest, out);
        // Один і більше сегментів — рекурсія в кожен підкаталог із тим самим
        // (незмінним) `**` на початку залишку.
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_hidden(&name) {
                continue;
            }
            let next_prefix = join_rel(rel_prefix, &name);
            walk(&entry.path(), &next_prefix, segments, out);
        }
        return;
    }

    let regex = segment_regex(seg);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if seg.contains('*') && is_hidden(&name) {
            continue;
        }
        if !regex.is_match(&name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let next_prefix = join_rel(rel_prefix, &name);
        if rest.is_empty() {
            if file_type.is_file() {
                out.push(next_prefix);
            }
        } else if file_type.is_dir() {
            walk(&entry.path(), &next_prefix, rest, out);
        }
    }
}

/// Повертає relative-posix шляхи файлів під `cwd`, що матчать glob-`pattern`
/// (сегменти через `/`), відсортовані байтово-лексикографічно (сам обхід
/// файлової системи порядку не гарантує — той самий підхід до детермінізму,
/// що й [`crate::scan::walk_dir`]).
pub(crate) fn scan_glob(pattern: &str, cwd: &Path) -> Vec<String> {
    let segments: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    let mut out = Vec::new();
    if segments.is_empty() {
        return out;
    }
    walk(cwd, "", &segments, &mut out);
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::scan_glob;

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn literal_segments_match_exact_file() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "a/b/file.txt", "x");
        assert_eq!(scan_glob("a/b/file.txt", tmp.path()), vec!["a/b/file.txt"]);
    }

    #[test]
    fn single_star_matches_within_one_segment() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "crates/a/Cargo.toml", "x");
        write(&tmp, "crates/b/Cargo.toml", "x");
        write(&tmp, "crates/nested/deep/Cargo.toml", "x");
        let mut out = scan_glob("crates/*/Cargo.toml", tmp.path());
        out.sort();
        assert_eq!(out, vec!["crates/a/Cargo.toml", "crates/b/Cargo.toml"]);
    }

    #[test]
    fn double_star_matches_zero_or_more_dirs() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{}");
        write(&tmp, "pkg/app/package.json", "{}");
        write(&tmp, "pkg/app/nested/deep/package.json", "{}");
        let mut out = scan_glob("**/package.json", tmp.path());
        out.sort();
        assert_eq!(
            out,
            vec![
                "package.json",
                "pkg/app/nested/deep/package.json",
                "pkg/app/package.json"
            ]
        );
    }

    #[test]
    fn hidden_entries_excluded_from_wildcard_segments() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".git/config", "x");
        write(&tmp, "root.txt", "x");
        let out = scan_glob("**/*", tmp.path());
        assert!(!out.iter().any(|p| p.starts_with(".git")));
        assert!(out.contains(&"root.txt".to_string()));
    }

    #[test]
    fn hidden_entry_matched_by_explicit_literal_segment() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".config/settings.json", "{}");
        assert_eq!(
            scan_glob(".config/settings.json", tmp.path()),
            vec![".config/settings.json"]
        );
    }

    #[test]
    fn no_match_returns_empty() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "root.txt", "x");
        assert!(scan_glob("crates/*/Cargo.toml", tmp.path()).is_empty());
    }

    #[test]
    fn directories_are_never_returned_only_files() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "crates/a/marker.txt", "x");
        assert!(scan_glob("crates/*", tmp.path()).is_empty());
    }
}
