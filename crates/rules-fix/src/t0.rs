//! T0 — детерміновані фікси перед будь-яким викликом моделі.
//!
//! Міст між реєстром `rules_core::concerns::fix::NATIVE_FIXES` і слотом
//! `PipelineDeps::t0` петлі `fix` — тепер у ДЕКЛАРАТИВНІЙ моделі
//! (`harness::pipeline::T0Step`, спека `2026-08-17-n7n-harness-local-models.md`
//! §3.9, рішення И): T0 рахує план ([`EditPlan`]), а застосовує його хост
//! двома фазами (`prepare` → журнальна подія → `commit`). Стара модель
//! (`apply_plan` писав файли сам і звітував лише лічильник) померла разом із
//! нею: T0-правки не потрапляли ні в editLog, ні в журнал — відтворити дерево
//! з журналу було неможливо.
//!
//! # Переклад `FixPlan` → `EditPlan`
//!
//! Контракт native-фіксів ([`rules_contract::fix::FileEdit`]) має дві
//! операції, план — три, і мапінг нетривіальний рівно у двох місцях:
//!
//! - `Write` на НАЯВНИЙ файл — основний шлях 7 із 10 `NATIVE_FIXES`
//!   (читають файл → трансформують → пишуть повний новий вміст ТОГО Ж
//!   шляху). `EditPlan::Create` на наявний файл — `Err` за контрактом
//!   («повний перезапис свідомо не виражається планом»), тож перезапис виражається
//!   [`FileEditPlan::Anchored`]-стратегією: якір першого рядка несе ПОВНИЙ
//!   новий вміст (`new_text` багаторядковий за контрактом `AnchoredEdit`),
//!   решта рядків старого файлу позначається на видалення. Хост при цьому
//!   й далі бачить, ПРОТИ ЧОГО план порахований — застарілі якорі дають
//!   чисту відмову замість зіпсованого файлу.
//! - `Delete` на ДИРЕКТОРІЮ (`abie/firebase_hosting` видаляє `.firebase/`)
//!   — план оперує файлами (`commit_edit_plan` кличе `fs::remove_file`), і
//!   «видалити теку» в ньому не виражається. Міст розгортає таку операцію в
//!   пофайлові `Delete` всього піддерева, а ПІСЛЯ успішного commit прибирає
//!   спорожнілі теки (`remove_dir`, знизу вгору) — інакше детектор, що
//!   перевіряє `exists(".firebase")`, лишився б червоним на порожній теці.
//!   Прибирання тек — поза журналом свідомо: журнал несе вміст (файли з
//!   pre-image), а порожня тека вмісту не має.
//!
//! # Місце в петлі
//!
//! T0 виконується ДО гейту `fixability` (`harness::pipeline::run_fix`), тож
//! спрацьовує навіть на concern-ах, позначених `structural`/`config`. Це
//! навмисно: «не для моделі» і «не автоматизується» — різні твердження.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use harness::pipeline::{PreparedPlan, T0Step};
use llm_lib::anchored_edit::line_anchor;
use llm_lib::attempt::BoxFuture;
use llm_lib::edit_plan::{AnchoredEdit, EditPlan, FileEditPlan};
use llm_lib::journal::{EditPreImage, FilePreImage};
use llm_lib::write_guard::{commit_edit_plan, prepare_edit_plan, PreparedEditPlan, WriteGuard};
use rules_contract::fix::FileEdit;
use rules_core::concerns::fix::{run_concern_fix, NATIVE_FIXES};
use rules_core::concerns::run_concern;
use rules_core::diagnostics::Violation;

/// Чи має concern детермінований native-фікс.
#[must_use]
pub fn has_native_fix(key: &str) -> bool {
    NATIVE_FIXES.contains(&key)
}

/// Anchored-правки, що замінюють ВЕСЬ наявний вміст файлу на новий.
///
/// Якір першого рядка отримує повний новий вміст (контракт `AnchoredEdit`
/// прямо дозволяє багаторядковий `new_text`), рядки 2..n позначаються на
/// видалення. Розбиття — `split('\n')`, точно як у `apply_anchored_edits`
/// (включно з порожнім хвостовим сегментом файлу, що закінчується `\n`):
/// якорі мають збігтися з тим, що хост порахує сам.
fn overwrite_edits(current: &str, new_content: &str) -> Vec<AnchoredEdit> {
    let lines: Vec<&str> = current.split('\n').collect();
    let mut edits = Vec::with_capacity(lines.len());
    edits.push(AnchoredEdit {
        anchor: line_anchor(lines[0]),
        line: 1,
        new_text: Some(new_content.to_string()),
    });
    for (i, line) in lines.iter().enumerate().skip(1) {
        edits.push(AnchoredEdit {
            anchor: line_anchor(line),
            line: i + 1,
            new_text: None,
        });
    }
    edits
}

/// Рекурсивно збирає ВСІ файли піддерева (для розгортання `Delete` теки в
/// пофайлові операції). Порядок не значущий — валідація й запис у плані
/// однаково пофайлові.
fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(files_under(&path));
        } else {
            out.push(path);
        }
    }
    out
}

/// Прибирає спорожнілі теки знизу вгору, починаючи від `root` включно.
/// Непорожні теки лишаються (у них жив хтось поза планом) — `remove_dir`
/// на непорожній теці чесно провалюється, і це не помилка мосту.
fn sweep_empty_dirs(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            sweep_empty_dirs(&path);
        }
    }
    let _ = std::fs::remove_dir(root);
}

/// Переклад плану native-фікса в декларативний [`EditPlan`] + перелік
/// тек-коренів, які треба прибрати після commit (розгорнуті `Delete`-теки).
fn to_edit_plan(cwd: &Path, edits: &[FileEdit]) -> (EditPlan, Vec<PathBuf>) {
    let mut files = Vec::new();
    let mut dir_roots = Vec::new();
    for edit in edits {
        match edit {
            FileEdit::Write(write) => {
                let abs = cwd.join(&write.path);
                match std::fs::read_to_string(&abs) {
                    Ok(current) => {
                        // Уже цільовий вміст — no-op: правка в плані лише
                        // засмічувала б журнал подією без різниці.
                        if current == write.content {
                            continue;
                        }
                        files.push(FileEditPlan::Anchored {
                            path: PathBuf::from(&write.path),
                            edits: overwrite_edits(&current, &write.content),
                        });
                    }
                    // Немає файлу (чи він не UTF-8 — тоді Create чесно
                    // впаде на валідації «файл існує») → створення.
                    Err(_) => files.push(FileEditPlan::Create {
                        path: PathBuf::from(&write.path),
                        content: write.content.clone(),
                    }),
                }
            }
            FileEdit::Delete { path } => {
                let abs = cwd.join(path);
                if abs.is_dir() {
                    for file in files_under(&abs) {
                        // План несе шляхи відносно cwd — тримаємо формат.
                        let rel = file.strip_prefix(cwd).unwrap_or(&file).to_path_buf();
                        files.push(FileEditPlan::Delete { path: rel });
                    }
                    dir_roots.push(abs);
                } else if abs.exists() {
                    files.push(FileEditPlan::Delete {
                        path: PathBuf::from(path),
                    });
                }
                // Відсутній шлях — мета вже досягнута, у план не потрапляє
                // (Delete на відсутній файл — Err валідації, а не no-op).
            }
        }
    }
    (EditPlan { files }, dir_roots)
}

/// Стан між `prepare` і `commit`: guard (несе pre-images і editLog) і
/// провалідований план фази 1. `commit` без `prepare` — помилка контракту.
type PreparedState = Arc<Mutex<Option<(WriteGuard, PreparedEditPlan)>>>;

/// Будує `t0`-крок для concern-а, якщо для нього є native-фікс.
///
/// `None` — фікса немає, петля пропускає T0 (той самий контракт, що й
/// раніше). Помилки самого ПЛАНУВАННЯ свідомо не піднімаються нагору
/// (порожній план — законний no-op; що не закрилось, покаже канонічний
/// детектор наступним кроком петлі), а от помилки ЗАСТОСУВАННЯ (`prepare`/
/// `commit`) повертаються як `Err` — їх побачить журнал.
#[must_use]
pub fn build_t0_step(key: &str, cwd: &Path, files: Option<&[String]>) -> Option<T0Step> {
    if !has_native_fix(key) {
        return None;
    }
    let key = key.to_string();
    let cwd = cwd.to_path_buf();
    let files = files.map(<[String]>::to_vec);

    // Тека-корені розгорнутих Delete-тек: рахуються у фазі плану, потрібні
    // після commit — той самий життєвий цикл, що й у PreparedState.
    let dir_roots: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let state: PreparedState = Arc::new(Mutex::new(None));

    let plan_fn = {
        let (key, cwd, dir_roots) = (key.clone(), cwd.clone(), Arc::clone(&dir_roots));
        Arc::new(move || {
            let key = key.clone();
            let cwd = cwd.clone();
            let files = files.clone();
            let dir_roots = Arc::clone(&dir_roots);
            let fut: BoxFuture<'static, EditPlan> = Box::pin(async move {
                // Детектор напряму, не через `detect::run_canonical`:
                // native-фікс приймає `rules_core::diagnostics::Violation`.
                let violations: Vec<Violation> =
                    run_concern(&key, &cwd, files.as_deref()).unwrap_or_default();
                if violations.is_empty() {
                    return EditPlan::empty();
                }
                let Ok(plan) = run_concern_fix(&key, &cwd, &violations) else {
                    return EditPlan::empty();
                };
                let (edit_plan, roots) = to_edit_plan(&cwd, &plan.edits);
                *lock_ok(&dir_roots) = roots;
                edit_plan
            });
            fut
        })
    };

    let prepare_fn = {
        let (cwd, state) = (cwd.clone(), Arc::clone(&state));
        Arc::new(move |plan: EditPlan| {
            let cwd = cwd.clone();
            let state = Arc::clone(&state);
            let fut: BoxFuture<'static, Result<PreparedPlan, String>> = Box::pin(async move {
                let mut guard = WriteGuard::new(cwd.clone());
                let prepared = prepare_edit_plan(&mut guard, &cwd, &plan)?;
                let pre_images = collect_pre_images(&guard, &cwd, &plan);
                *lock_ok(&state) = Some((guard, prepared));
                Ok(PreparedPlan { plan, pre_images })
            });
            fut
        })
    };

    let commit_fn = {
        let state = Arc::clone(&state);
        Arc::new(move |_prepared: PreparedPlan| {
            let state = Arc::clone(&state);
            let dir_roots = Arc::clone(&dir_roots);
            let fut: BoxFuture<'static, Result<Vec<PathBuf>, String>> = Box::pin(async move {
                let Some((mut guard, prepared)) = lock_ok(&state).take() else {
                    return Err("t0 commit без prepare — порушення контракту T0Step".into());
                };
                let touched = commit_edit_plan(&mut guard, prepared)?;
                for root in lock_ok(&dir_roots).drain(..) {
                    sweep_empty_dirs(&root);
                }
                Ok(touched)
            });
            fut
        })
    };

    Some(T0Step {
        plan: plan_fn,
        prepare: prepare_fn,
        commit: commit_fn,
    })
}

/// Pre-image кожного файлу плану — з guard-а, який їх щойно зняв у фазі 1
/// (`check_write` атомарно з veto). Конвертація `edit_log::PreImage` →
/// `journal::FilePreImage` — семантика ідентична за побудовою (доккоментар
/// `FilePreImage`: «журнальне дзеркало» того типу).
fn collect_pre_images(guard: &WriteGuard, cwd: &Path, plan: &EditPlan) -> Vec<EditPreImage> {
    plan.files
        .iter()
        .filter_map(|file_plan| {
            let abs = if file_plan.path().is_absolute() {
                file_plan.path().to_path_buf()
            } else {
                cwd.join(file_plan.path())
            };
            // Guard тримає pre-images під canonical-шляхом (realpath), а
            // cwd.join(...) його не дає (на macOS /var → /private/var).
            // Для Create файл ще не існує — canonical бере батько.
            let abs = abs.canonicalize().unwrap_or_else(|_| {
                match (
                    abs.parent().and_then(|p| p.canonicalize().ok()),
                    abs.file_name(),
                ) {
                    (Some(parent), Some(name)) => parent.join(name),
                    _ => abs.clone(),
                }
            });
            guard.pre_image(&abs).map(|pre| EditPreImage {
                path: file_plan.path().to_path_buf(),
                pre_image: match pre {
                    llm_lib::edit_log::PreImage::Existing(text) => {
                        FilePreImage::Existing(text.clone())
                    }
                    llm_lib::edit_log::PreImage::New => FilePreImage::New,
                },
            })
        })
        .collect()
}

/// Лок без отруєння: T0 однопотоковий за викликом (фази йдуть послідовно),
/// отруєний м'ютекс тут означав би панику попередньої фази — беремо вміст.
fn lock_ok<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use llm_lib::anchored_edit::apply_anchored_edits;

    #[test]
    fn native_fix_registry_is_known() {
        assert!(has_native_fix("hasura/migrations"), "є в NATIVE_FIXES");
        assert!(!has_native_fix("text/formatting"), "немає native-фіксу");
    }

    #[test]
    fn no_t0_for_concern_without_native_fix() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(build_t0_step("text/formatting", dir.path(), None).is_none());
        assert!(build_t0_step("hasura/migrations", dir.path(), None).is_some());
    }

    /// Стратегія перезапису: план, застосований до СТАРОГО вмісту, дає рівно
    /// НОВИЙ — включно з хвостовим `\n` і зміною кількості рядків в обидва
    /// боки. Це той шлях, яким піде більшість T0-прогонів (7/10 фіксів).
    #[test]
    fn overwrite_edits_reproduce_new_content_exactly() {
        for (old, new) in [
            ("a\nb\nc\n", "x\n"),
            ("один\n", "один\nдва\nтри\n"),
            ("", "тепер щось є\n"),
            ("був вміст\n", ""),
            ("без хвостового", "новий\nбез хвостового"),
        ] {
            let edits = overwrite_edits(old, new);
            match apply_anchored_edits(old, &edits) {
                Ok(text) => assert_eq!(text, new, "old={old:?}"),
                Err(stale) => panic!("якорі мають зійтись на власному вмісті: {stale:?}"),
            }
        }
    }

    /// Мапінг `FixPlan` → `EditPlan`: Write у відсутній файл — `Create`,
    /// Write у наявний — `Anchored`, Write без різниці — не потрапляє в
    /// план, Delete теки — розгортається пофайлово.
    #[test]
    fn fix_plan_maps_by_target_state() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path();
        std::fs::write(cwd.join("наявний.txt"), "старе\n").unwrap();
        std::fs::write(cwd.join("той-самий.txt"), "без змін\n").unwrap();
        std::fs::create_dir_all(cwd.join(".fire/nested")).unwrap();
        std::fs::write(cwd.join(".fire/a.json"), "{}").unwrap();
        std::fs::write(cwd.join(".fire/nested/b.json"), "{}").unwrap();

        let edits = vec![
            FileEdit::Write(rules_contract::fix::WriteFile {
                path: "новий.txt".into(),
                content: "створити\n".into(),
            }),
            FileEdit::Write(rules_contract::fix::WriteFile {
                path: "наявний.txt".into(),
                content: "нове\n".into(),
            }),
            FileEdit::Write(rules_contract::fix::WriteFile {
                path: "той-самий.txt".into(),
                content: "без змін\n".into(),
            }),
            FileEdit::Delete {
                path: ".fire".into(),
            },
        ];
        let (plan, dir_roots) = to_edit_plan(cwd, &edits);

        let kinds: Vec<&str> = plan
            .files
            .iter()
            .map(|f| match f {
                FileEditPlan::Anchored { .. } => "anchored",
                FileEditPlan::Create { .. } => "create",
                FileEditPlan::Delete { .. } => "delete",
            })
            .collect();
        assert_eq!(
            kinds,
            vec!["create", "anchored", "delete", "delete"],
            "no-op Write випав, тека розгорнулась у 2 файли: {plan:?}"
        );
        assert_eq!(dir_roots, vec![cwd.join(".fire")]);
    }

    /// Наскрізний прогін T0Step: plan → prepare (pre-images, нічого на
    /// диску) → commit (записано + спорожнілі теки прибрано). Використовує
    /// реальний фікс `hasura/migrations` (видаляє down.sql поряд із up.sql).
    #[tokio::test]
    async fn t0_step_applies_real_fix_two_phase() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path();
        // write_guard пускає записи лише під git-root — T0 тепер іде через
        // нього, тож і фікстура мусить бути репозиторієм (як бойове дерево).
        std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(cwd)
            .status()
            .expect("git init");
        std::fs::create_dir_all(cwd.join("hasura/migrations/default/1_init")).unwrap();
        std::fs::write(
            cwd.join("hasura/migrations/default/1_init/up.sql"),
            "CREATE TABLE x;\n",
        )
        .unwrap();
        std::fs::write(
            cwd.join("hasura/migrations/default/1_init/down.sql"),
            "DROP TABLE x;\n",
        )
        .unwrap();

        let step = build_t0_step("hasura/migrations", cwd, None).expect("фікс існує");
        let plan = (step.plan)().await;
        assert!(!plan.files.is_empty(), "порушення є — план не порожній");

        let prepared = (step.prepare)(plan).await.expect("фаза 1 валідна");
        assert!(
            !prepared.pre_images.is_empty(),
            "pre-image знято ДО ефекту: {prepared:?}"
        );
        assert!(
            cwd.join("hasura/migrations/default/1_init/down.sql")
                .exists(),
            "після prepare на диску ще НІЧОГО не змінилось"
        );

        let touched = (step.commit)(prepared).await.expect("фаза 2 пише");
        assert!(!touched.is_empty());
        assert!(
            !cwd.join("hasura/migrations/default/1_init/down.sql")
                .exists(),
            "down.sql видалено самим commit-ом"
        );
    }

    /// `commit` без `prepare` — помилка контракту, а не паніка й не
    /// мовчазний запис.
    #[tokio::test]
    async fn commit_without_prepare_is_a_contract_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("hasura")).unwrap();
        let step = build_t0_step("hasura/migrations", dir.path(), None).expect("фікс існує");
        let result = (step.commit)(PreparedPlan {
            plan: EditPlan::empty(),
            pre_images: Vec::new(),
        })
        .await;
        assert!(result.is_err(), "commit без prepare мусить відмовити");
    }

    /// Спорожнілі теки прибираються знизу вгору, а непорожні — лишаються.
    #[test]
    fn sweep_removes_only_emptied_directories() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("root");
        std::fs::create_dir_all(root.join("порожня/глибше")).unwrap();
        std::fs::create_dir_all(root.join("зайнята")).unwrap();
        std::fs::write(root.join("зайнята/файл.txt"), "живу тут").unwrap();

        sweep_empty_dirs(&root);

        assert!(!root.join("порожня").exists(), "порожнє піддерево прибрано");
        assert!(root.join("зайнята/файл.txt").exists(), "живий вміст цілий");
        assert!(root.exists(), "корінь із живим вмістом лишився");
    }
}
