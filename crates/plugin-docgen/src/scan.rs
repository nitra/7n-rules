//! Порт `npm/rules/doc-files/docgen-scan/main.mjs` (237 рядків, +
//! `lang-extensions.mjs` окремо не портується — доккомент нижче) — обхід
//! дерева, пари джерело↔дока, фільтр кандидатів.
//!
//! # Рішення: диск чи параметр — і чому ЦЕЙ етап найбільше розходиться з картою
//! Карта розвідки (`docs/specs/2026-08-31-recon-docgen-surface.md` §2) називає
//! `docgen-scan` детермінованим поряд з іншими пʼятьма, без застережень. На
//! практиці це НАЙБІЛЬШ дисково-залежний етап із шести, і має ДВІ окремі
//! причини, з яких порт розходиться з JS-оригіналом 1:1 по СТРУКТУРІ (не по
//! алгоритму фільтрації — той портований точно):
//!
//! 1. **`readdirSync`-обхід дерева.** Той самий мотив, що [`crate::crc`] і
//!    [`crate::test_context`] (доккоменти там): жодного консюмера ще нема
//!    (`docgen-stage` — майбутня робота, §5.4 розвідки), тож `file-reader`
//!    world НЕ підключений до `docgen-guest.wit` цим кроком. Публічні функції
//!    цього модуля тому приймають РЕЗУЛЬТАТ обходу (`CandidateInput`,
//!    `RepoTree`) як параметр, а не виконують `readdirSync` самі.
//! 2. **`execFileSync('git', ['check-ignore', ...])` — ПРИНЦИПОВО інший клас
//!    прогалини, не "диск чи параметр".** `gitIgnoredPaths` (`main.mjs:166-185`)
//!    запускає зовнішній процес. У поточному наборі world-ів
//!    (`crates/rules-contract/wit/deps/caps/`) НЕМАЄ жодної capability класу
//!    "виконати процес" — ні `file-reader`, ні гіпотетичне розширення не
//!    покривають це: `file-reader` дає лише `list-files`/`read-file-bytes`,
//!    обидва — читання, не виконання. Це РОЗХОДЖЕННЯ З КАРТОЮ, зафіксоване
//!    явно (задача фази 2: «не підганяй під карту»): [`find_orphaned_docs`]
//!    ПОРТУЄ фільтрацію сирітських доків 1:1, але git-ignore-подвійна
//!    фільтрація (`scanForDocFiles`, `main.mjs:222-226`) НЕ портована —
//!    немає способу відтворити її без нової capability, якої немає в спеці.
//!    Зверни увагу: host-бік `list-files` (`crates/rules-plugin-host/src/caps_file_reader.rs`)
//!    і так фільтрує через `rules_core::concerns::cursor_ignore::walk_repo`
//!    (consumer-ignore з `.n-rules.json`), але це ІНША множина правил, ніж
//!    `.gitignore` — не еквівалентна заміна.
//!
//! `pluginDocFilesExtensions` (`lang-extensions.mjs`, динамічний slot-граф
//! плагінів) не портується взагалі — не Rust-порт, а JS-orchestration
//! механізм (`resolveSlotGraph`, потенційний `import()` екстракторів), якому
//! немає еквівалента в гості. [`is_source_file`]/[`is_doc_candidate`] тому
//! приймають вже вирішену мапу розширень (`extensions: &HashMap<String,String>`)
//! параметром — викликач (хост або майбутній консюмер) відповідає за
//! резолюцію, той самий підхід, що [`crate::crc::build_doc_frontmatter`]
//! приймає `type_label` готовим.

use crate::crc::{read_doc_crc, staleness, StalenessReason};
use crate::ignore::{is_docgen_ignored, IgnoreKind};
use crate::test_context::TestEvidenceIndex;
use std::collections::{HashMap, HashSet};

/// `*.test.*`, `*.spec.*`, `*.stories.*` — не документуємо — порт
/// `TEST_FILE_RE` (`main.mjs:12`).
fn is_test_or_story_file(file_name: &str) -> bool {
    let Some(dot) = file_name.rfind('.') else {
        return false;
    };
    let stem_and_more = &file_name[..dot];
    for suffix in [".test", ".spec", ".stories"] {
        if stem_and_more.ends_with(suffix) {
            return true;
        }
    }
    false
}

fn extname(file_name: &str) -> &str {
    match file_name.rfind('.') {
        Some(0) => "",
        Some(i) => &file_name[i..],
        None => "",
    }
}

/// Чи є файл кодовим джерелом для документування — порт `isSourceFile`
/// (`main.mjs:35-39`). `extensions` — вже вирішена мапа `doc-files.extensions@1`
/// (доккомент модуля: гість не резолвить slot-граф сам).
pub fn is_source_file(file_name: &str, extensions: &HashMap<String, String>) -> bool {
    if file_name.ends_with(".d.ts") {
        return false;
    }
    if is_test_or_story_file(file_name) {
        return false;
    }
    extensions.contains_key(extname(file_name))
}

/// Обчислює шлях md-документа для кодового файлу — порт `docPathForSource`
/// (`main.mjs:47-51`). Працює над posix-шляхами (абсолютні/відносні —
/// прозоро, той самий простір шляхів на вході й виході).
pub fn doc_path_for_source(source_path: &str) -> String {
    let (dir, file_name) = match source_path.rsplit_once('/') {
        Some((d, f)) => (d, f),
        None => ("", source_path),
    };
    let stem = match file_name.rfind('.') {
        Some(0) | None => file_name,
        Some(i) => &file_name[..i],
    };
    if dir.is_empty() {
        format!("docs/{stem}.md")
    } else {
        format!("{dir}/docs/{stem}.md")
    }
}

/// Чи кодовий файл `relPath` підлягає документуванню — порт `isDocCandidate`
/// (`main.mjs:60-65`). `is_system_wide_docs_root` — заміна `existsSync(root/docs/adr)
/// || existsSync(root/docs/explanation)`, обчислена викликачем (доккомент модуля).
pub fn is_doc_candidate(
    rel_path: &str,
    extensions: &HashMap<String, String>,
    is_system_wide_docs_root: bool,
) -> bool {
    let file_name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    if !is_source_file(file_name, extensions) {
        return false;
    }
    let dir = match rel_path.rsplit_once('/') {
        Some((d, _)) => d,
        None => "",
    };
    if is_system_wide_docs_root && dir.is_empty() {
        return false;
    }
    !is_docgen_ignored(rel_path, IgnoreKind::Path)
}

/// Опис одного кодового файлу — структурний відповідник обʼєкта, який
/// повертає `describeFile` (`main.mjs:80-88`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DescribedFile {
    pub source_path: String,
    pub doc_path: String,
    pub stale: bool,
    pub reason: Option<StalenessReason>,
    pub foreign: bool,
}

/// Описує один кодовий файл — порт `describeFile` (`main.mjs:80-88`).
/// `source_bytes`/`doc_content` — вже прочитаний вміст (доккомент модуля).
/// `crc_payload` — `test_context::test_evidence_for_source(...).1` або `None`.
pub fn describe_file(
    source_path: &str,
    source_bytes: &[u8],
    doc_content: Option<&str>,
    crc_payload: Option<&str>,
) -> DescribedFile {
    let doc_path = doc_path_for_source(source_path);
    if doc_content.is_some() && read_doc_crc(doc_content).is_none() {
        // `foreign: true` — доккомент модуля `crc.rs`/JS-оригіналу
        // (`main.mjs:70-74`): дока існує, але без `docgen:`-CRC — рукописна.
        return DescribedFile {
            source_path: source_path.to_string(),
            doc_path,
            stale: false,
            reason: None,
            foreign: true,
        };
    }
    let (stale, reason) = staleness(doc_content, source_bytes, crc_payload);
    DescribedFile {
        source_path: source_path.to_string(),
        doc_path,
        stale,
        reason,
        foreign: false,
    }
}

/// Один вже отриманий кандидат — вхід [`scan_for_doc_files`] (доккомент
/// модуля: обхід дерева й читання лишаються обов'язком викликача).
#[derive(Debug, Clone)]
pub struct CandidateInput {
    pub source_path: String,
    pub source_bytes: Vec<u8>,
    pub doc_content: Option<String>,
}

/// Описує партію кандидатів — порт "фільтрувальної" ЧАСТИНИ `scanForDocFiles`
/// (`main.mjs:194-227`) БЕЗ обходу дерева (доккомент модуля) і БЕЗ
/// git-ignore подвійної фільтрації (доккомент модуля, п.2 — не портовано,
/// немає capability). `test_index` — `None`, якщо порт викликається без
/// test-evidence (той самий факультативний параметр, що JS `testIndex`).
pub fn scan_for_doc_files(
    candidates: &[CandidateInput],
    test_index: Option<&TestEvidenceIndex>,
) -> Vec<DescribedFile> {
    candidates
        .iter()
        .map(|c| {
            let crc_payload = test_index
                .map(|idx| crate::test_context::test_evidence_for_source(&c.source_path, idx).1);
            describe_file(
                &c.source_path,
                &c.source_bytes,
                c.doc_content.as_deref(),
                crc_payload.as_deref().filter(|p| !p.is_empty()),
            )
        })
        .collect()
}

/// Один вже отриманий `docs/*.md` файл — вхід [`find_orphaned_docs`].
#[derive(Debug, Clone)]
pub struct DocFileInput {
    pub rel_path: String,
    pub content: String,
}

/// Знаходить "сирітські" доки — порт ЛОГІКИ `scanOrphanedDocs`
/// (`main.mjs:98-155`) над уже зібраним списком `docs/*.md` файлів (доккомент
/// модуля: обхід дерева — обов'язок викликача, host `file-reader::list-files`
/// із глобом `**/docs/*.md` дає той самий список без ручного `readdirSync`).
/// `existing_source_paths` — повний набір repo-relative шляхів, що реально
/// існують (для перевірки `!existsSync(join(root, data.source))`).
pub fn find_orphaned_docs(
    doc_files: &[DocFileInput],
    existing_source_paths: &HashSet<String>,
) -> Vec<String> {
    let mut orphans = Vec::new();
    for doc in doc_files {
        let (data, _) = crate::crc::parse_doc_frontmatter(&doc.content);
        let Some(data) = data else { continue };
        let Some(source) = data.source else { continue };
        // Directory Index (resource з `/`) і ручні доки без CRC — пропускаємо.
        if source.ends_with('/') || data.crc.is_none() {
            continue;
        }
        if !existing_source_paths.contains(&source) {
            orphans.push(doc.rel_path.clone());
        }
    }
    orphans
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ext_map() -> HashMap<String, String> {
        [
            (".rs".to_string(), "Rust Module".to_string()),
            (".mjs".to_string(), "JS Module".to_string()),
        ]
        .into_iter()
        .collect()
    }

    #[test]
    fn is_source_file_respects_extensions_map() {
        let ext = ext_map();
        assert!(is_source_file("lib.rs", &ext));
        assert!(!is_source_file("lib.py", &ext));
    }

    #[test]
    fn is_source_file_excludes_d_ts_and_tests() {
        let mut ext = ext_map();
        ext.insert(".ts".to_string(), "TS Module".to_string());
        assert!(!is_source_file("types.d.ts", &ext));
        assert!(!is_source_file("main.test.mjs", &ext_map()));
    }

    #[test]
    fn doc_path_for_source_places_docs_dir_alongside() {
        assert_eq!(
            doc_path_for_source("crates/foo/src/lib.rs"),
            "crates/foo/src/docs/lib.md"
        );
        assert_eq!(doc_path_for_source("main.mjs"), "docs/main.md");
    }

    #[test]
    fn is_doc_candidate_rejects_docgen_ignored_path() {
        let ext = ext_map();
        assert!(!is_doc_candidate("node_modules/pkg/lib.rs", &ext, false));
    }

    #[test]
    fn is_doc_candidate_rejects_root_file_when_system_wide_docs_root() {
        let ext = ext_map();
        assert!(!is_doc_candidate("main.rs", &ext, true));
        assert!(is_doc_candidate("src/main.rs", &ext, true));
    }

    #[test]
    fn describe_file_missing_when_no_doc() {
        let d = describe_file("a.rs", b"fn a(){}", None, None);
        assert!(d.stale);
        assert_eq!(d.reason, Some(StalenessReason::Missing));
        assert!(!d.foreign);
    }

    #[test]
    fn describe_file_foreign_when_doc_exists_without_crc() {
        let doc = "# Рукописна дока\nТекст.\n";
        let d = describe_file("a.rs", b"fn a(){}", Some(doc), None);
        assert!(d.foreign);
        assert!(!d.stale);
    }

    #[test]
    fn describe_file_fresh_when_crc_matches() {
        let src = b"fn a(){}";
        let crc = crate::crc::crc32(src);
        let doc = format!("---\nresource: a.rs\ndocgen:\n  crc: {crc}\n---\n");
        let d = describe_file("a.rs", src, Some(&doc), None);
        assert!(!d.stale);
        assert!(!d.foreign);
    }

    #[test]
    fn scan_for_doc_files_batches_candidates() {
        let candidates = vec![
            CandidateInput {
                source_path: "a.rs".to_string(),
                source_bytes: b"fn a(){}".to_vec(),
                doc_content: None,
            },
            CandidateInput {
                source_path: "b.rs".to_string(),
                source_bytes: b"fn b(){}".to_vec(),
                doc_content: None,
            },
        ];
        let out = scan_for_doc_files(&candidates, None);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|d| d.stale));
    }

    #[test]
    fn find_orphaned_docs_flags_missing_source() {
        let doc = DocFileInput {
            rel_path: "src/docs/gone.md".to_string(),
            content: "---\nresource: src/gone.rs\ndocgen:\n  crc: deadbeef\n---\n".to_string(),
        };
        let existing: HashSet<String> = HashSet::new();
        let orphans = find_orphaned_docs(&[doc], &existing);
        assert_eq!(orphans, vec!["src/docs/gone.md".to_string()]);
    }

    #[test]
    fn find_orphaned_docs_skips_directory_index_and_manual_docs() {
        let dir_index = DocFileInput {
            rel_path: "src/docs/index.md".to_string(),
            content: "---\nresource: src/\ndocgen:\n  crc: x\n---\n".to_string(),
        };
        let manual = DocFileInput {
            rel_path: "npm/docs/index.md".to_string(),
            content: "# Ручна дока без resource/crc\n".to_string(),
        };
        let existing: HashSet<String> = HashSet::new();
        assert!(find_orphaned_docs(&[dir_index, manual], &existing).is_empty());
    }

    #[test]
    fn find_orphaned_docs_keeps_doc_when_source_exists() {
        let doc = DocFileInput {
            rel_path: "src/docs/live.md".to_string(),
            content: "---\nresource: src/live.rs\ndocgen:\n  crc: deadbeef\n---\n".to_string(),
        };
        let existing: HashSet<String> = ["src/live.rs".to_string()].into_iter().collect();
        assert!(find_orphaned_docs(&[doc], &existing).is_empty());
    }
}
