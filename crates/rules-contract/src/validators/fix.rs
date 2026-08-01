//! Host-валідатор [`FixPlan`]-ів wasm-плагінів (fix-контур contract v3,
//! продовження рішення Л спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`: семантичні
//! перевірки, які WIT-типізація не покриває). План — недовірений вхід від
//! guest-коду, тож перед застосуванням (`run-fix.mjs`, JS-бік реально пише
//! файли) хост (`rules-plugin-host::LoadedPlugin::fix`) відхиляє:
//!
//! - **path-escape**: кожен шлях edit-а має бути безпечним repo-relative
//!   (без ведучого `/`, без `..`-сегментів) — та сама перевірка
//!   [`is_safe_repo_relative_path`], що вже охороняє `targetPath` слоту
//!   `ci.artifact@1` (переюз, не дублювання);
//! - **ліміти розміру**: кількість edit-ів ([`MAX_FIX_PLAN_EDITS`]), розмір
//!   вмісту одного write ([`MAX_FIX_EDIT_CONTENT_BYTES`]) і сумарний розмір
//!   плану ([`MAX_FIX_PLAN_TOTAL_BYTES`]) — `FixPlan` v3.0 переносить ПОВНИЙ
//!   новий вміст файлу, тож без лімітів зіпсований/зловмисний плагін міг би
//!   змусити хост тримати в пам'яті й писати на диск довільні обсяги.
//!
//! Помилки акумулюються в одному виклику (не early-return на першій) — той
//! самий контракт, що [`super::ci_artifact::validate_ci_artifact_payload`].

use crate::fix::{FileEdit, FixPlan};

use super::ci_artifact::is_safe_repo_relative_path;

/// Максимальна кількість файлових операцій в одному плані. Реальні T0-фікси
/// оперують одиницями файлів; сотні edit-ів — ознака збою guest-логіки.
pub const MAX_FIX_PLAN_EDITS: usize = 512;

/// Максимальний розмір вмісту одного `write`-edit-а (байти UTF-8). 4 МіБ —
/// з запасом більше за будь-який реальний текстовий файл, який фіксить
/// lint-концерн.
pub const MAX_FIX_EDIT_CONTENT_BYTES: usize = 4 * 1024 * 1024;

/// Максимальний сумарний розмір вмісту всіх `write`-edit-ів плану.
pub const MAX_FIX_PLAN_TOTAL_BYTES: usize = 16 * 1024 * 1024;

/// Шлях і розмір вмісту одного edit-а — спільний зріз для перевірок нижче.
fn edit_path_and_len(edit: &FileEdit) -> (&str, usize) {
    match edit {
        FileEdit::Write(write) => (write.path.as_str(), write.content.len()),
        FileEdit::Delete { path } => (path.as_str(), 0),
    }
}

/// Валідує [`FixPlan`] від wasm-плагіна (доккомент модуля). `Err` — список
/// УСІХ знайдених порушень контракту; хост загортає його в типізовану
/// помилку (`PluginHostError::InvalidContractData`) і НЕ застосовує план.
pub fn validate_fix_plan(plan: &FixPlan) -> Result<(), Vec<String>> {
    let mut errors: Vec<String> = Vec::new();

    if plan.edits.len() > MAX_FIX_PLAN_EDITS {
        errors.push(format!(
            "план містить {} edit-ів — більше за ліміт {MAX_FIX_PLAN_EDITS}",
            plan.edits.len()
        ));
    }

    let mut total_bytes: usize = 0;
    for (index, edit) in plan.edits.iter().enumerate() {
        let (path, content_len) = edit_path_and_len(edit);
        if !is_safe_repo_relative_path(path) {
            errors.push(format!(
                "edit #{index}: шлях `{path}` не є безпечним repo-relative \
                 (без абсолютних і \"..\" сегментів)"
            ));
        }
        if content_len > MAX_FIX_EDIT_CONTENT_BYTES {
            errors.push(format!(
                "edit #{index}: вміст `{path}` займає {content_len} байтів — \
                 більше за ліміт {MAX_FIX_EDIT_CONTENT_BYTES}"
            ));
        }
        total_bytes = total_bytes.saturating_add(content_len);
    }

    if total_bytes > MAX_FIX_PLAN_TOTAL_BYTES {
        errors.push(format!(
            "сумарний вміст плану займає {total_bytes} байтів — більше за \
             ліміт {MAX_FIX_PLAN_TOTAL_BYTES}"
        ));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fix::WriteFile;

    fn write_edit(path: &str, content: &str) -> FileEdit {
        FileEdit::Write(WriteFile {
            path: path.to_string(),
            content: content.to_string(),
        })
    }

    #[test]
    fn empty_plan_is_valid() {
        assert!(validate_fix_plan(&FixPlan::default()).is_ok());
    }

    #[test]
    fn plain_write_and_delete_edits_are_valid() {
        let plan = FixPlan {
            edits: vec![
                write_edit("tests/a.test.mjs", "import 'vitest'\n"),
                FileEdit::Delete {
                    path: "hasura/migrations/1/down.sql".to_string(),
                },
            ],
        };
        assert!(validate_fix_plan(&plan).is_ok());
    }

    #[test]
    fn absolute_write_path_is_rejected() {
        let plan = FixPlan {
            edits: vec![write_edit("/etc/passwd", "x")],
        };
        let errors = validate_fix_plan(&plan).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("/etc/passwd")));
    }

    #[test]
    fn dot_dot_delete_path_is_rejected() {
        let plan = FixPlan {
            edits: vec![FileEdit::Delete {
                path: "../escape.txt".to_string(),
            }],
        };
        assert!(validate_fix_plan(&plan).is_err());
    }

    #[test]
    fn oversized_single_edit_content_is_rejected() {
        let plan = FixPlan {
            edits: vec![write_edit(
                "big.txt",
                &"x".repeat(MAX_FIX_EDIT_CONTENT_BYTES + 1),
            )],
        };
        let errors = validate_fix_plan(&plan).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("big.txt")));
    }

    #[test]
    fn oversized_total_plan_content_is_rejected() {
        // Кожен edit у межах свого ліміту, але сума перевищує плановий.
        let chunk = "x".repeat(MAX_FIX_EDIT_CONTENT_BYTES);
        let edits: Vec<FileEdit> = (0..5)
            .map(|i| write_edit(&format!("chunk-{i}.txt"), &chunk))
            .collect();
        let errors = validate_fix_plan(&FixPlan { edits }).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("сумарний")));
    }

    #[test]
    fn too_many_edits_is_rejected() {
        let edits: Vec<FileEdit> = (0..=MAX_FIX_PLAN_EDITS)
            .map(|i| write_edit(&format!("f-{i}.txt"), ""))
            .collect();
        let errors = validate_fix_plan(&FixPlan { edits }).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("edit-ів")));
    }

    /// Дзеркало контракту `validate_ci_artifact_payload`: помилки
    /// акумулюються в одному виклику, не early-return на першій.
    #[test]
    fn all_errors_accumulate_in_a_single_call() {
        let plan = FixPlan {
            edits: vec![
                write_edit("/abs.txt", "x"),
                FileEdit::Delete {
                    path: "a/../b.txt".to_string(),
                },
            ],
        };
        let errors = validate_fix_plan(&plan).unwrap_err();
        assert_eq!(errors.len(), 2);
    }
}
