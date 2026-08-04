//! Native-порт read-only зрізу `npm/rules/release/lib/change-file.mjs` —
//! [`parse_change_file`]/[`read_change_files`], потрібні `changelog/presence`.
//! Writer-функції (`serializeChangeFile`, `changeFileName`, `newChangeFileName`)
//! цьому read-only detector-у не потрібні й лишаються в JS (`release/release.mjs`,
//! `changelog/consistency` — інші консюмери модуля, перевірено через grep перед
//! портом) — модуль не видаляється, портується лише потрібний зріз.

use std::collections::HashMap;
use std::path::Path;

/// Підкаталог зі change-файлами всередині workspace — порт `CHANGES_DIR`
/// (`change-file.mjs:65`).
pub const CHANGES_DIR: &str = ".changes";

const VALID_BUMPS: &[&str] = &["major", "minor", "patch"];
const VALID_SECTIONS: &[&str] = &["Added", "Changed", "Fixed", "Removed"];

/// Розпарсений запис одного change-файлу — порт `{ bump, section, description }`
/// (`change-file.mjs:37`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeEntry {
    pub bump: String,
    pub section: String,
    pub description: String,
}

/// Парсить frontmatter-блок (`key: value` рядки, перше `:` — роздільник) —
/// точний порт `parseFrontmatterBlock` (`change-file.mjs:24-33`).
fn parse_frontmatter_block(block: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in block.split('\n') {
        if let Some(idx) = line.find(':') {
            out.insert(
                line[..idx].trim().to_string(),
                line[idx + 1..].trim().to_string(),
            );
        }
    }
    out
}

/// Парсить вміст change-файлу — точний порт `parseChangeFile`
/// (`change-file.mjs:39-54`). `Err` — той самий видимий ефект, що й JS
/// `throw new Error(...)`: детектор, що читає change-файли, падає
/// повністю на першому битому файлі, не пропускає його мовчки.
pub fn parse_change_file(text: &str) -> Result<ChangeEntry, String> {
    // Порт FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ — нежадібний
    // (перший) роздільник `\n---\n` після початкового `---\n`.
    let Some(rest) = text.strip_prefix("---\n") else {
        return Err("change-файл: відсутній frontmatter `---`".to_string());
    };
    let Some(sep_idx) = rest.find("\n---\n") else {
        return Err("change-файл: відсутній frontmatter `---`".to_string());
    };
    let block = &rest[..sep_idx];
    let description_raw = &rest[sep_idx + "\n---\n".len()..];

    let fm = parse_frontmatter_block(block);

    let bump = fm.get("bump").cloned().unwrap_or_default();
    if !VALID_BUMPS.contains(&bump.as_str()) {
        return Err(format!(
            "change-файл: bump має бути одним із {} (отримано «{bump}»)",
            VALID_BUMPS.join("|")
        ));
    }
    let section = fm.get("section").cloned().unwrap_or_default();
    if !VALID_SECTIONS.contains(&section.as_str()) {
        return Err(format!(
            "change-файл: section має бути одним із {} (отримано «{section}»)",
            VALID_SECTIONS.join("|")
        ));
    }
    let description = description_raw.trim().to_string();
    if description.is_empty() {
        return Err("change-файл: порожній опис".to_string());
    }
    Ok(ChangeEntry {
        bump,
        section,
        description,
    })
}

/// Читає й парсить усі `<ws>/.changes/*.md`, відсортовані за іменем — точний
/// порт `readChangeFiles` (`change-file.mjs:105-116`). Порожній список для
/// відсутнього каталогу; `Err` на першому файлі, що не парситься (у тому
/// самому сортованому порядку, що й JS `toSorted()`).
pub fn read_change_files(ws: &str, cwd: &Path) -> Result<Vec<ChangeEntry>, String> {
    let dir = cwd.join(ws).join(CHANGES_DIR);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".md"))
        .collect();
    names.sort();

    let mut result = Vec::with_capacity(names.len());
    for name in names {
        let text = std::fs::read_to_string(dir.join(&name)).map_err(|e| e.to_string())?;
        result.push(parse_change_file(&text)?);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    #[test]
    fn parses_valid_change_file() {
        let entry =
            parse_change_file("---\nbump: patch\nsection: Changed\n---\nоновлення\n").unwrap();
        assert_eq!(
            entry,
            ChangeEntry {
                bump: "patch".to_string(),
                section: "Changed".to_string(),
                description: "оновлення".to_string()
            }
        );
    }

    #[test]
    fn missing_frontmatter_is_error() {
        assert!(parse_change_file("no frontmatter here").is_err());
    }

    #[test]
    fn invalid_bump_is_error() {
        let err = parse_change_file("---\nbump: huge\nsection: Changed\n---\nx\n").unwrap_err();
        assert!(err.contains("bump"));
    }

    #[test]
    fn invalid_section_is_error() {
        let err = parse_change_file("---\nbump: patch\nsection: Nope\n---\nx\n").unwrap_err();
        assert!(err.contains("section"));
    }

    #[test]
    fn empty_description_is_error() {
        let err = parse_change_file("---\nbump: patch\nsection: Changed\n---\n\n").unwrap_err();
        assert!(err.contains("опис"));
    }

    #[test]
    fn missing_changes_dir_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read_change_files(".", tmp.path()).unwrap(), vec![]);
    }

    #[test]
    fn reads_sorted_change_files() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            ".changes/260701-0900.md",
            "---\nbump: patch\nsection: Fixed\n---\nb\n",
        );
        write(
            &tmp,
            ".changes/260601-0900.md",
            "---\nbump: minor\nsection: Added\n---\na\n",
        );
        let entries = read_change_files(".", tmp.path()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].description, "a");
        assert_eq!(entries[1].description, "b");
    }

    #[test]
    fn non_md_files_are_ignored() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".changes/README.txt", "not a change file");
        assert_eq!(read_change_files(".", tmp.path()).unwrap(), vec![]);
    }

    #[test]
    fn malformed_change_file_propagates_error() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".changes/260701-0900.md", "garbage");
        assert!(read_change_files(".", tmp.path()).is_err());
    }
}
