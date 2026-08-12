//! T0 — детерміновані фікси перед будь-яким викликом моделі.
//!
//! Міст між наявним реєстром `rules_core::concerns::fix::NATIVE_FIXES` і
//! слотом `PipelineDeps::t0` петлі `fix`. Реєстр і диспетчер
//! (`run_concern_fix`) існували давно; бракувало саме цього підключення —
//! через що concern-и з готовим детермінованим фіксом усе одно йшли в
//! LLM-драбину.
//!
//! # Чому T0 закриває те, чого модель не може
//!
//! Контракт фіксу ([`rules_contract::fix::FileEdit`]) має дві операції —
//! `Write` і `Delete`. Друга принципово недосяжна набору інструментів циклу:
//! `delete` там немає й не планується (порожній allowlist — головна гарантія
//! класу 3). Живий прогін показав ціну цієї різниці: concern, чиє порушення
//! усувається видаленням файлу, вигоряв десятки ходів моделі дарма.
//!
//! Видалення тут безпечне не «бо ми обережні», а конструктивно: фікс
//! виконується у worktree, і людина бачить результат у PR — це
//! пропозиція під ревʼю, а не деструктивна дія в робочому дереві.
//!
//! # Місце в петлі
//!
//! T0 виконується ДО гейту `fixability` (`pipeline::run_fix`), тож
//! спрацьовує навіть на concern-ах, позначених `structural`/`config`, тобто
//! закритих для драбини. Це навмисно: «не для моделі» і «не автоматизується»
//! — різні твердження.

use std::path::Path;
use std::sync::Arc;

use llm_lib::fix::pipeline::T0Fn;
use rules_contract::fix::FileEdit;
use rules_core::concerns::fix::{run_concern_fix, NATIVE_FIXES};
use rules_core::diagnostics::Violation;

use rules_core::concerns::run_concern;

/// Чи має concern детермінований native-фікс.
#[must_use]
pub fn has_native_fix(key: &str) -> bool {
    NATIVE_FIXES.contains(&key)
}

/// Застосовує план фіксу до дерева. Повертає кількість застосованих операцій.
///
/// Помилка окремої операції не зупиняє решту: план — це набір незалежних
/// правок, і часткове застосування краще за нуль (те, що не вдалось,
/// побачить повторний прогін детектора одразу після T0).
fn apply_plan(cwd: &Path, edits: &[FileEdit]) -> usize {
    let mut applied = 0;
    for edit in edits {
        let ok = match edit {
            FileEdit::Write(write) => {
                let abs = cwd.join(&write.path);
                if let Some(parent) = abs.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(&abs, &write.content).is_ok()
            }
            FileEdit::Delete { path } => {
                let abs = cwd.join(path);
                // Відсутній файл — не помилка: інший фікс міг прибрати його
                // раніше, а мета операції вже досягнута.
                !abs.exists() || std::fs::remove_file(&abs).is_ok()
            }
        };
        if ok {
            applied += 1;
        }
    }
    applied
}

/// Будує `t0`-інʼєкцію для concern-а, якщо для нього є native-фікс.
///
/// `None` — фікса немає, петля просто пропускає крок T0 (той самий контракт,
/// що й раніше). Помилки самого фіксу свідомо не піднімаються нагору: T0 — спроба
/// здешевити роботу, а не джерело правди; що не закрилось, покаже канонічний
/// детектор наступним кроком петлі.
#[must_use]
pub fn build_t0_fn(key: &str, cwd: &Path, files: Option<&[String]>) -> Option<T0Fn> {
    if !has_native_fix(key) {
        return None;
    }
    let key = key.to_string();
    let cwd = cwd.to_path_buf();
    let files = files.map(<[String]>::to_vec);
    Some(Arc::new(move || {
        let key = key.clone();
        let cwd = cwd.clone();
        let files = files.clone();
        Box::pin(async move {
            // Детектор кличемо НАПРЯМУ, а не через `detect::run_canonical`:
            // native-фікс приймає `rules_core::diagnostics::Violation`, тоді
            // як `run_canonical` уже переклав їх у тип петлі.
            let violations: Vec<Violation> =
                run_concern(&key, &cwd, files.as_deref()).unwrap_or_default();
            if violations.is_empty() {
                return;
            }
            if let Ok(plan) = run_concern_fix(&key, &cwd, &violations) {
                let _ = apply_plan(&cwd, &plan.edits);
            }
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rules_contract::fix::WriteFile;

    #[test]
    fn native_fix_registry_is_known() {
        assert!(has_native_fix("hasura/migrations"), "є в NATIVE_FIXES");
        assert!(!has_native_fix("text/formatting"), "немає native-фіксу");
    }

    #[test]
    fn no_t0_for_concern_without_native_fix() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(build_t0_fn("text/formatting", dir.path(), None).is_none());
    }

    #[test]
    fn t0_exists_for_concern_with_native_fix() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(build_t0_fn("hasura/migrations", dir.path(), None).is_some());
    }

    #[test]
    fn plan_writes_file_and_creates_parent_directories() {
        let dir = tempfile::tempdir().expect("tempdir");
        let edits = vec![FileEdit::Write(WriteFile {
            path: "nested/deep/a.txt".to_string(),
            content: "вміст".to_string(),
        })];
        assert_eq!(apply_plan(dir.path(), &edits), 1);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("nested/deep/a.txt")).expect("файл створено"),
            "вміст"
        );
    }

    #[test]
    fn plan_deletes_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let victim = dir.path().join("down.sql");
        std::fs::write(&victim, "DROP TABLE x;").expect("створити файл");
        let edits = vec![FileEdit::Delete {
            path: "down.sql".to_string(),
        }];
        assert_eq!(apply_plan(dir.path(), &edits), 1);
        assert!(!victim.exists(), "файл видалено детерміновано, без моделі");
    }

    #[test]
    fn deleting_absent_file_counts_as_done_not_as_failure() {
        let dir = tempfile::tempdir().expect("tempdir");
        let edits = vec![FileEdit::Delete {
            path: "already-gone.sql".to_string(),
        }];
        assert_eq!(
            apply_plan(dir.path(), &edits),
            1,
            "мета операції вже досягнута — це не помилка"
        );
    }

    #[test]
    fn one_failing_edit_does_not_block_the_rest_of_the_plan() {
        let dir = tempfile::tempdir().expect("tempdir");
        // Видалення директорії як файлу провалиться, запис — ні.
        std::fs::create_dir(dir.path().join("a_dir")).expect("створити теку");
        let edits = vec![
            FileEdit::Delete {
                path: "a_dir".to_string(),
            },
            FileEdit::Write(WriteFile {
                path: "ok.txt".to_string(),
                content: "далі".to_string(),
            }),
        ];
        assert_eq!(
            apply_plan(dir.path(), &edits),
            1,
            "друга правка застосована"
        );
        assert!(dir.path().join("ok.txt").exists());
    }
}
