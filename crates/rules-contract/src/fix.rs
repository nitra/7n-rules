//! `FixRequest`/`FixPlan`/`FileEdit`/`WriteFile` — вхід/вихід lint-домену
//! (`export fix`, WIT `wit/world.wit`).
//!
//! # Форма v3.0 — мінімум, не декларативний patch-формат
//!
//! T0Pattern-семантика (`npm/scripts/lib/lint-surface/run-detectors.mjs`) —
//! декларативний опис фіксів на боці JS-runner-а (find/replace-патерни,
//! collateral-veto навколо `data.line`) — **не** переїжджає у WIT цієї
//! задачі: вона лишається host-side логікою над списком [`Diagnostic`]-ів.
//! Натомість `export fix` у v3.0 повертає [`FixPlan`] — найпростішу
//! транспортабельну форму: список файлових операцій із **повним новим
//! вмістом** файлу ([`FileEdit::Write`]) або видаленням ([`FileEdit::Delete`]).
//! Частковий diff/patch-формат — свідомо поза v3.0 (кандидат на
//! `n-rules:plugin@3.x`, якщо розмір payload-у стане проблемою для великих
//! файлів із малими правками).
//!
//! # Ці типи — спільні для wasm- І builtin-шляху (злиття дзеркала)
//!
//! Від fix-контуру contract v3 (host-виклик `export fix`) [`FixPlan`]/
//! [`FileEdit`]/[`WriteFile`] — єдине означення для обох шляхів:
//! `rules-core` (builtin T0-фікси, `crates/rules-core/src/concerns/fix.rs`)
//! реекспортує їх звідси замість колишнього структурного дзеркала — напрямок
//! залежності `rules-core` → `rules-contract` — саме той, що документує
//! `crate`-doc-коментар `lib.rs` («Залежність — лише в один бік»). Похідні
//! `PartialEq`/`Eq` додані задля цього злиття (порівняння планів у тестах
//! builtin-фіксів).
//!
//! План від wasm-плагіна — недовірений вхід: перед передачею оркестрації
//! хост валідує його ([`crate::validators::fix::validate_fix_plan`] —
//! safe-path + ліміти розміру).
//!
//! [`Diagnostic`]: crate::diagnostic::Diagnostic

use serde::{Deserialize, Serialize};

use crate::detect::SourceFile;
use crate::diagnostic::Diagnostic;

/// Записати файл — повний новий вміст (точний відповідник WIT
/// `record write-file`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteFile {
    pub path: String,
    pub content: String,
}

/// Одна файлова операція fix-plan-у — точний відповідник WIT
/// `variant file-edit`. serde-тег `type` (`"write"`/`"delete"`) — явний
/// discriminant, бо WIT variant-и не серіалізуються в JSON автоматично
/// (це вибір Rust-боку DTO, не частина WIT ABI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FileEdit {
    /// Записати файл (створити чи перезаписати) — повний новий вміст.
    Write(WriteFile),
    /// Видалити файл за шляхом.
    Delete { path: String },
}

/// Вхід `fix` — ті самі файли й концерн, що й `detect`, плюс діагностики,
/// для яких запитується fix (підмножина результату `detect`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixRequest {
    pub concern_id: String,
    pub files: Vec<SourceFile>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Результат `fix` — впорядкований список файлових операцій; порожній
/// список = «fix для цього запиту нічого не змінює».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct FixPlan {
    pub edits: Vec<FileEdit>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_fix_plan_means_no_changes() {
        let plan = FixPlan::default();
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn file_edit_write_round_trips_with_type_tag() {
        let edit = FileEdit::Write(WriteFile {
            path: "a.txt".to_string(),
            content: "нове".to_string(),
        });
        let json = serde_json::to_value(&edit).unwrap();
        assert_eq!(json["type"], "write");
        assert_eq!(json["path"], "a.txt");
        let back: FileEdit = serde_json::from_value(json).unwrap();
        match back {
            FileEdit::Write(w) => assert_eq!(w.content, "нове"),
            FileEdit::Delete { .. } => panic!("очікували write"),
        }
    }

    #[test]
    fn file_edit_delete_round_trips_with_type_tag() {
        let edit = FileEdit::Delete {
            path: "b.txt".to_string(),
        };
        let json = serde_json::to_value(&edit).unwrap();
        assert_eq!(json["type"], "delete");
        assert_eq!(json["path"], "b.txt");
    }
}
