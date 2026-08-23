//! Native-порт `npm/rules/release/lib/change-file.mjs`.
//!
//! Спершу тут був лише read-only зріз — [`parse_change_file`]/
//! [`read_change_files`], потрібні `changelog/presence`. Порт
//! `changelog/consistency` (`crate::concerns::changelog_consistency`) додав
//! і writer-зріз — [`change_file_name`]/[`serialize_change_file`]/
//! [`write_change`], точний порт `changeFileName`/`serializeChangeFile`
//! (`change-file.mjs`) + `writeChange` (`npm/rules/release/change.mjs`):
//! autofix-гілка `checkPublishedWorkspace`/`checkLocalOnlyChangedWorkspace`
//! (env `N_RULES_CHANGELOG_AUTOFIX=1`) сама СТВОРЮЄ change-файл, коли
//! знаходить релевантні зміни без нього — той самий шлях, яким користується
//! pre-commit хук репозиторію.
//!
//! `newChangeFileName()` (генератор `Date.now()` без параметра) НЕ
//! портований — жоден живий консюмер `changelog/consistency` його не кличе
//! (сам `change.mjs`/`writeChange` формує ім'я через `changeFileName` із
//! явним `timestamp`, `newChangeFileName` лишається невикористаним поза
//! документацією) — той самий принцип «портуємо лише потрібний зріз», що й
//! у попередньому read-only заході.
//!
//! Сам JS-файл `change-file.mjs` НЕ видаляється: `release/change.mjs` і
//! `release/release.mjs` лишаються живими консюмери модуля (перевірено
//! через grep перед портом) — Rust-копія тут співіснує з JS, не заміщує її.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::Path;

use chrono::{Local, TimeZone};

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

/// Серіалізує запис у вміст change-файлу — точний порт `serializeChangeFile`
/// (`change-file.mjs:60-62`).
pub fn serialize_change_file(entry: &ChangeEntry) -> String {
    format!(
        "---\nbump: {}\nsection: {}\n---\n{}\n",
        entry.bump, entry.section, entry.description
    )
}

/// Локальний timestamp-префікс `YYMMDD-HHMM` — точний порт
/// `formatChangeTimestamp` (`change-file.mjs:71-79`). JS-канон читає
/// СИСТЕМНИЙ ЛОКАЛЬНИЙ час (`new Date(timestamp).getFullYear()` тощо, не
/// `getUTC*`) — тут те саме через `chrono::Local`. `timestamp_millis` поза
/// представним діапазоном (вкрай малоймовірно для epoch millis) дає fallback
/// на поточний момент, аби формат ніколи не панікував.
fn format_change_timestamp(timestamp_millis: i64) -> String {
    let dt = Local
        .timestamp_millis_opt(timestamp_millis)
        .single()
        .unwrap_or_else(Local::now);
    dt.format("%y%m%d-%H%M").to_string()
}

/// Ім'я change-файлу — точний порт `changeFileName` (`change-file.mjs:86-89`):
/// `sequence <= 1` без суфіксу, інакше `-<sequence>`.
pub fn change_file_name(timestamp_millis: i64, sequence: u32) -> String {
    let base = format_change_timestamp(timestamp_millis);
    if sequence > 1 {
        format!("{base}-{sequence}.md")
    } else {
        format!("{base}.md")
    }
}

/// Параметри [`write_change`] — порт іменованих параметрів `writeChange`
/// (`npm/rules/release/change.mjs:49`).
pub struct WriteChangeParams<'a> {
    pub bump: &'a str,
    pub section: &'a str,
    pub message: &'a str,
    /// Workspace відносно `cwd` (`"."` — корінь).
    pub ws: &'a str,
    pub cwd: &'a Path,
    /// Epoch milliseconds; викликач передає `Date.now()`-еквівалент явно
    /// (детермінізм тестів — той самий параметр, що й у JS `writeChange`).
    pub timestamp_millis: i64,
}

/// Створює один change-файл `<ws>/.changes/YYMMDD-HHMM[-N].md` — точний порт
/// `writeChange` (`npm/rules/release/change.mjs:49-59`): валідує поля через
/// [`parse_change_file`] (та сама помилка, що дав би читач цього самого
/// файлу), потім create-only запис (`wx`-еквівалент — `create_new(true)`) з
/// числовим suffix-циклом при локальній колізії імені (`sequence` 1, 2, 3…).
///
/// Повертає відносний шлях створеного файлу ВІД `ws` (`.changes/<name>`,
/// без префіксу `ws`) — той самий контракт, що й JS-версія; виклик, що
/// відкладає файл у сам workspace (не в корінь), сам додає префікс `ws`
/// (дзеркало `reportOrFixMissingChangeFile` у `changelog/consistency`).
///
/// `Err` — той самий видимий ефект, що й JS `throw` без `try/catch` навколо
/// виклику: файлова помилка (немає прав, диск повний) чи провал валідації
/// пропагується назовні без спроб «пом'якшити» результат.
pub fn write_change(params: WriteChangeParams) -> Result<String, String> {
    let description = params.message.trim().to_string();
    let content = serialize_change_file(&ChangeEntry {
        bump: params.bump.to_string(),
        section: params.section.to_string(),
        description,
    });
    // Валідація полів: parse_change_file дає зрозумілу помилку на невалідних
    // bump/section/порожньому описі — той самий подвійний прохід, що в JS
    // (`serializeChangeFile` → `parseChangeFile` як self-check).
    parse_change_file(&content)?;

    let dir = params.cwd.join(params.ws).join(CHANGES_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut sequence: u32 = 1;
    loop {
        let name = change_file_name(params.timestamp_millis, sequence);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(&name))
        {
            Ok(mut file) => {
                file.write_all(content.as_bytes())
                    .map_err(|e| e.to_string())?;
                return Ok(format!("{CHANGES_DIR}/{name}"));
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                sequence += 1;
                continue;
            }
            Err(e) => return Err(e.to_string()),
        }
    }
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

    #[test]
    fn serialize_change_file_matches_parse_round_trip() {
        let entry = ChangeEntry {
            bump: "minor".to_string(),
            section: "Added".to_string(),
            description: "новий пакет".to_string(),
        };
        let text = serialize_change_file(&entry);
        assert_eq!(text, "---\nbump: minor\nsection: Added\n---\nновий пакет\n");
        assert_eq!(parse_change_file(&text).unwrap(), entry);
    }

    #[test]
    fn change_file_name_omits_suffix_for_sequence_one() {
        // 2026-07-02 12:34 локального часу — фіксований timestamp для
        // детермінізму (мілісекунди від epoch, UTC-компонент не важливий,
        // формат читає ЛОКАЛЬНИЙ час машини тесту).
        let millis = 1_751_452_440_000i64;
        let name = change_file_name(millis, 1);
        assert!(name.ends_with(".md"));
        assert!(!name.contains('-') || name.matches('-').count() == 1); // лише роздільник дати
    }

    #[test]
    fn change_file_name_appends_suffix_for_collision_sequence() {
        let millis = 1_751_452_440_000i64;
        let base = change_file_name(millis, 1);
        let with_suffix = change_file_name(millis, 2);
        let stem = base.trim_end_matches(".md");
        assert_eq!(with_suffix, format!("{stem}-2.md"));
    }

    #[test]
    fn write_change_creates_file_under_changes_dir() {
        let tmp = TempDir::new().unwrap();
        let rel = write_change(WriteChangeParams {
            bump: "patch",
            section: "Changed",
            message: "  оновлення  ",
            ws: ".",
            cwd: tmp.path(),
            timestamp_millis: 1_751_452_440_000,
        })
        .unwrap();
        assert!(rel.starts_with(".changes/"));
        assert!(rel.ends_with(".md"));
        let entries = read_change_files(".", tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description, "оновлення");
        assert_eq!(entries[0].bump, "patch");
    }

    #[test]
    fn write_change_appends_numeric_suffix_on_local_collision() {
        let tmp = TempDir::new().unwrap();
        let params = |msg: &'static str| WriteChangeParams {
            bump: "patch",
            section: "Changed",
            message: msg,
            ws: ".",
            cwd: tmp.path(),
            timestamp_millis: 1_751_452_440_000,
        };
        let first = write_change(params("перший")).unwrap();
        let second = write_change(params("другий")).unwrap();
        assert_ne!(first, second);
        assert_eq!(read_change_files(".", tmp.path()).unwrap().len(), 2);
    }

    #[test]
    fn write_change_writes_into_sub_workspace() {
        let tmp = TempDir::new().unwrap();
        let rel = write_change(WriteChangeParams {
            bump: "minor",
            section: "Added",
            message: "новий пакет",
            ws: "app",
            cwd: tmp.path(),
            timestamp_millis: 1_751_452_440_000,
        })
        .unwrap();
        assert!(rel.starts_with(".changes/"));
        let entries = read_change_files("app", tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description, "новий пакет");
    }

    #[test]
    fn write_change_rejects_invalid_bump_before_touching_disk() {
        let tmp = TempDir::new().unwrap();
        let err = write_change(WriteChangeParams {
            bump: "huge",
            section: "Changed",
            message: "x",
            ws: ".",
            cwd: tmp.path(),
            timestamp_millis: 1_751_452_440_000,
        })
        .unwrap_err();
        assert!(err.contains("bump"));
        assert!(!tmp.path().join(CHANGES_DIR).exists());
    }
}
