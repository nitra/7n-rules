//! Snapshot/rollback ladder-а — pre-image дерева на S1, відкат на провал рунга.
//!
//! Rust-порт `npm/scripts/lib/lint-surface/snapshot.mjs` (спека
//! `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7 — оркестрація поза LLM).
//!
//! # Область дії (навмисно ширша за одну `FixRequest`)
//!
//! [`crate::fix::FixRequest`] документує "один рунг драбини" як один attempt
//! (одна модель/тір, один виклик [`crate::fix::runner::run_attempt`]). Це
//! ЦЕЙ [`Snapshot`] НЕ те саме, хоч і успадковує слово "рунг" зі свого
//! початкового doc-коментаря-стаба — джерело істини (`snapshot.mjs`,
//! коментар у `run-fix.mjs`: `detect → T0 → snapshot S1 → ladder[restore S1
//! → worker → detect]*`) знімає S1 РІВНО ОДИН РАЗ на весь ladder одного
//! concern-а (усі тіри/спроби послідовно), а не наново на кожен attempt. Тому:
//!
//! - одна інстанція [`Snapshot`] живе, поки orchestrator (майбутній
//!   `ladder.rs`) обробляє ВЕСЬ ladder одного concern-а;
//! - вона створюється ПІСЛЯ T0 (детермінований pre-ladder прохід): T0-правки
//!   ніколи не потрапляють у pre-image (permanent, поза rollback) — тому що
//!   `record()` на конкретний шлях вперше викликається вже ПІСЛЯ того, як T0
//!   відпрацював, і бачить його результат як "вихідний" стан S1;
//! - кожен провальний рунг (attempt) відкочується до цього ЄДИНОГО S1 через
//!   [`Snapshot::rollback`] ПЕРЕД тим, як стартує наступний рунг — інакше
//!   зіпсований стан одного тіру тік би в обчислення veto наступного;
//! - успішний рунг НІКОЛИ не відкочується (закриває concern) — виклик боку
//!   мусить явно НЕ звати rollback у цьому випадку (див. [`RungGuard::commit`]).
//!
//! Якщо це поле "один Snapshot на ladder" виявиться незручним для
//! `ladder.rs` (наприклад, якщо оркестрація вирішить дробити ladder на
//! підетапи інакше) — це відкрите архітектурне питання, не мовчазне
//! рішення цього файлу; див. звіт задачі.
//!
//! # Межа з [`crate::write_guard::WriteGuard`]
//!
//! `WriteGuard` — pre-image/rollback/veto ОДНІЄЇ агентної сесії (одного
//! рунга/attempt-у зсередини [`crate::fix::runner::run_attempt`]): він
//! перехоплює кожен write-tool-виклик ПЕРЕД його тілом (scope/denylist veto)
//! і паралельно знімає pre-image. [`Snapshot`] тут — pre-image на рівень
//! вище: ВЕСЬ ladder одного concern-а, без жодного поняття про tool-виклики
//! чи veto запису. Обидва типи незалежно тримають (path → чи-то `Existing`,
//! чи `New`) і мають структурно ідентичну rollback-логіку — це НАВМИСНЕ
//! дублювання, не недогляд: вони живуть у різних lifetime-ах (одна сесія
//! проти цілого ladder-а) і різних відповідальностях (veto запису проти
//! durable-семантики й джерела collateral-veto, якого `WriteGuard` взагалі
//! не знає — і не мусить, це специфіка fix-worker-ів на кшталт doc-files, а
//! не generic SDK-агностичного write-guard). Тип pre-image ([`PreImage`])
//! свідомо перевикористаний з `write_guard` (не продубльовано окремим
//! enum) — форма "наявний вміст чи sentinel відсутності" однакова для обох
//! рівнів.
//!
//! Міст між рівнями вже готовий на боці `write_guard`:
//! [`crate::write_guard::WriteGuard::with_on_capture`] — хук "pre-image
//! щойно знятий" саме для "зовнішнього snapshot-власника" (doc-коментар
//! `write_guard.rs` прямо це називає). Очікуваний спосіб інтеграції
//! (рішення `ladder.rs`, не цього файлу): `WriteGuard::new(cwd)
//! .with_on_capture({ let snap = snapshot.clone(); move |abs| { let _ =
//! snap.lock().unwrap_or_else(PoisonError::into_inner).record(abs); } })` —
//! кожен перший дотик `WriteGuard` усередині рунга дзеркально потрапляє і в
//! ladder-рівневий [`Snapshot`], тим самим ladder бачить те саме "перше
//! торкання", що й guard сесії, без потреби писати власний tool-хук ще раз.
//!
//! **Чи варто об'єднати два типи в один?** Ні — навмисно залишено окремими.
//! `WriteGuard` документує себе як SDK-агностичний примітив рівно одного
//! concern-а: veto (scope/denylist) — його ЄДИНА причина існування, і
//! rollback там — побічний продукт снятого для veto pre-image, а не
//! самостійна фіча. Додавання ladder-рівневого стану (durable-реєстр,
//! `modifiedExisting` для collateral-veto, час життя через кілька
//! `run_attempt`-викликів) у `WriteGuard` порушило б цю single-purpose межу
//! й прив'язало б generic veto-примітив до конкретного orchestration-шару.
//! Розділення відповідає й power-розподілу коду: `runner.rs` конструює й
//! володіє `WriteGuard` (одна інстанція на attempt), тоді як власник
//! [`Snapshot`] — зовнішній до `runner.rs` orchestrator (`ladder.rs`), що
//! якраз і бачить кілька послідовних `WriteGuard`-сесій одного concern-а.
//!
//! # Гарантія відкату, якщо детектор кидає виняток
//!
//! JS-джерело (`run-fix.mjs`) обгортає canonical re-detect у `try/catch` і
//! ЯВНО кличе `snapshot.rollback()` у catch-гілці перед `throw` — легко
//! забути на новому call-сайті. У Rust самого `Result`-контракту (функція
//! повертає `Result`, виклик має `match`/`?`) недостатньо: `?` виконує
//! ранній `return` без жодного проміжного коду, тож "не забудь відкотити у
//! гілці помилки" — той самий клас багу, що й у JS, лише мовою Rust. Єдиний
//! механізм, що виконується безумовно на шляху виходу (включно з `?`,
//! панікою, раннім `return`) — [`Drop`]. Тому тут guard-тип, що на `Drop`
//! автоматично відкочує стан ([`RungGuard`]): відкат — типова поведінка при
//! виході зі скоупу, і лише
//! явний [`RungGuard::commit`] (викликається на ЧИСТОМУ, не-vetoed успіху)
//! вимикає його. Той самий підхід, що й `#[must_use]` на
//! [`crate::write_guard::Decision`] у цьому крейті: "забути обробити" стає
//! видимим/неможливим на рівні типів, а не конвенцією коду.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

pub use crate::write_guard::PreImage;

/// Центральний pre-image tracker ОДНОГО ladder-а (усі рунги/тіри одного
/// concern-а послідовно) — S1, знятий одразу після T0. Дивись doc-коментар
/// модуля вище щодо межі з [`crate::write_guard::WriteGuard`].
#[derive(Debug, Default)]
pub struct Snapshot {
    /// Швидка ідемпотентність `record()` — той самий шлях знімається лише
    /// на перший дотик (як і `WriteGuard::touched`).
    touched: HashSet<PathBuf>,
    /// Pre-images у порядку першого дотику.
    pre_images: Vec<(PathBuf, PreImage)>,
    /// Durable-шляхи (`record_durable`): самодостатній кінцевий стан
    /// worker-а — поза rollback і поза `modified_existing`.
    durable: HashSet<PathBuf>,
}

impl Snapshot {
    /// Новий, порожній `Snapshot` — це і є момент зняття S1 (клич одразу
    /// після T0, до першого рунга ladder-а).
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Знімає pre-image `abs`, якщо це перший дотик до цього шляху за час
    /// життя цього `Snapshot` (ідемпотентно — другий і подальші виклики на
    /// той самий шлях нічого не роблять, той самий контракт, що
    /// `WriteGuard::capture_pre_image`, — важливо саме тому, що rollback від
    /// рунга до рунга відновлює файл до стану саме ПЕРШОГО дотику, а не
    /// проміжного).
    ///
    /// # Errors
    /// Пробрасує помилку читання наявного файлу (права доступу тощо) —
    /// викликач вирішує, чи це фатально для рунга.
    pub fn record(&mut self, abs: &Path) -> io::Result<()> {
        if !self.touched.insert(abs.to_path_buf()) {
            return Ok(());
        }
        let pre = if abs.exists() {
            PreImage::Existing(fs::read_to_string(abs)?)
        } else {
            PreImage::New
        };
        self.pre_images.push((abs.to_path_buf(), pre));
        Ok(())
    }

    /// Позначає шлях durable: worker (напр. doc-files) оголосив свій запис
    /// самодостатнім кінцевим станом — rollback його НЕ чіпає, і
    /// [`Snapshot::modified_existing`] (вхід collateral-veto) його не бачить.
    /// Незалежно від того, чи `record` уже торкався цього шляху — типовий
    /// порядок викликів той самий, що й `recordWrite`/`recordDurableWrite` у
    /// JS-джерелі (funnel-яться з worker-а до і після мутації відповідно),
    /// тож попередній `record` не є передумовою.
    pub fn record_durable(&mut self, abs: &Path) {
        self.durable.insert(abs.to_path_buf());
    }

    /// Відновлює всі записані pre-images (окрім durable): наявний вміст —
    /// перезаписує назад, [`PreImage::New`] — видаляє файл (не "відновлює"
    /// порожнім). Ідемпотентно — повторний виклик безпечний (перезаписує тим
    /// самим вмістом / видаляє вже відсутній файл без помилки, той самий
    /// контракт що `WriteGuard::rollback`). Зупиняється на першій
    /// I/O-помилці — викликач вирішує, як діяти далі.
    ///
    /// # Errors
    /// Перша I/O-помилка запису/видалення зупиняє прохід і повертається як є.
    pub fn rollback(&self) -> io::Result<()> {
        for (abs, pre) in &self.pre_images {
            if self.durable.contains(abs) {
                continue;
            }
            match pre {
                PreImage::New => {
                    if abs.exists() {
                        fs::remove_file(abs)?;
                    }
                }
                PreImage::Existing(content) => {
                    fs::write(abs, content)?;
                }
            }
        }
        Ok(())
    }

    /// Усі шляхи, яких snapshot торкнувся: записані pre-images та durable-
    /// позначки разом (без дублікатів).
    #[must_use]
    pub fn touched(&self) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = self.pre_images.iter().map(|(p, _)| p.clone()).collect();
        for d in &self.durable {
            if !out.contains(d) {
                out.push(d.clone());
            }
        }
        out
    }

    /// Наявні на момент S1 файли, чий поточний вміст на диску відрізняється
    /// від pre-image — вхід semantic-collateral veto (`fix::collateral`).
    /// Durable-шляхи й файли, яких на S1 не існувало (нові), виключені: нове
    /// створення — не "модифікація наявного".
    #[must_use]
    pub fn modified_existing(&self) -> Vec<PathBuf> {
        self.pre_images
            .iter()
            .filter_map(|(abs, pre)| {
                let PreImage::Existing(content) = pre else {
                    return None;
                };
                if self.durable.contains(abs) {
                    return None;
                }
                let changed = !abs.exists()
                    || fs::read_to_string(abs)
                        .map(|current| current != *content)
                        .unwrap_or(true);
                changed.then(|| abs.clone())
            })
            .collect()
    }

    /// Pre-image вмісту файлу на момент S1 — вхід in-file hunk-level veto.
    /// `None`, якщо шлях не записано взагалі, або на S1 його не існувало
    /// ([`PreImage::New`] — немає "старого вмісту" для порівняння).
    #[must_use]
    pub fn pre_image_of(&self, abs: &Path) -> Option<&str> {
        self.pre_images
            .iter()
            .find(|(p, _)| p == abs)
            .and_then(|(_, pre)| match pre {
                PreImage::Existing(content) => Some(content.as_str()),
                PreImage::New => None,
            })
    }
}

/// Guard-тип із гарантією відкату одного рунга ladder-а: доки не викликаний
/// [`RungGuard::commit`], [`Drop`] безумовно відкочує [`Snapshot`] до S1 —
/// включно зі шляхом виходу через `?`/паніку/ранній `return`. Див.
/// "Гарантія відкату..." в doc-коментарі модуля щодо того, чому саме
/// `Drop`, а не `Result`-конвенція.
///
/// Тримає `Arc<Mutex<Snapshot>>`, а не голе посилання: `Snapshot`
/// одночасно потрібен і мосту `WriteGuard::with_on_capture` (типізованому
/// як `Send + Sync + 'static` замикання — див. doc-коментар модуля), і
/// цьому guard-у, і — на боці orchestrator-а — коду, що читає
/// `modified_existing`/`touched` для collateral-veto. Спільне володіння
/// через `Arc<Mutex<_>>` — той самий компроміс, що й `Arc<Mutex<WriteGuard>>`
/// у `fix::runner` (коментар там пояснює причину: async-хуки rig отримують
/// лише `&self`, тож мутація стану вимагає внутрішньої синхронізації).
#[must_use = "RungGuard без commit() автоматично відкочує S1 при Drop — якщо рунг завершився невдало (зокрема через `?`, паніку чи ранній `return`), це і є бажана поведінка; якщо рунг ЗАКРИВ concern успішно (canonical re-detect чистий, без veto) і зміни треба залишити — виклич commit()"]
pub struct RungGuard {
    snapshot: Arc<Mutex<Snapshot>>,
    committed: bool,
}

impl RungGuard {
    /// Починає новий рунг: guard тримає `Snapshot`, готовий безумовно
    /// відкотити його на [`Drop`], якщо до того часу не викликано
    /// [`RungGuard::commit`].
    ///
    /// Без власного `#[must_use]`: він уже стоїть на самому типі
    /// [`RungGuard`] (з детальним поясненням), і дублювання атрибута тут —
    /// `clippy::double_must_use` під обовʼязковим `-D warnings`.
    pub fn new(snapshot: Arc<Mutex<Snapshot>>) -> Self {
        Self {
            snapshot,
            committed: false,
        }
    }

    /// Рунг закрив concern успішно — зміни ЛИШАЮТЬСЯ на диску, `Drop` більше
    /// нічого не відкочує. Споживає guard: після `commit()` відкат цього
    /// guard-а неможливий (не просто "вимкнений прапорцем", а недосяжний —
    /// значення більше не існує).
    pub fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for RungGuard {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        // Best-effort: Drop не може прокинути I/O-помилку далі — той самий
        // компроміс, що rollback() узагалі (перша помилка зупиняє прохід),
        // але тут навіть повідомити про неї викликачу нема способу.
        if let Ok(snapshot) = self.snapshot.lock() {
            let _ = snapshot.rollback();
        } else {
            let snapshot = self.snapshot.lock().unwrap_or_else(PoisonError::into_inner);
            let _ = snapshot.rollback();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    // --- record/rollback: наявний файл -------------------------------------

    #[test]
    fn rollback_restores_modified_existing_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.mjs");
        write(&path, "ORIGINAL");

        let mut snap = Snapshot::new();
        snap.record(&path).expect("record успішний");
        write(&path, "MUTATED");

        snap.rollback().expect("rollback успішний");
        assert_eq!(fs::read_to_string(&path).unwrap(), "ORIGINAL");
    }

    // --- record/rollback: новостворений файл -------------------------------

    #[test]
    fn rollback_removes_newly_created_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("created.mjs");

        let mut snap = Snapshot::new();
        snap.record(&path).expect("record успішний (sentinel New)");
        write(&path, "NEW CONTENT");
        assert!(path.exists());

        snap.rollback().expect("rollback успішний");
        assert!(!path.exists(), "новостворений файл мав бути видалений");
    }

    // --- durable ------------------------------------------------------------

    #[test]
    fn durable_file_survives_rollback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let durable_path = dir.path().join("doc.md");
        let normal_path = dir.path().join("code.mjs");
        write(&durable_path, "OLD DOC");
        write(&normal_path, "OLD CODE");

        let mut snap = Snapshot::new();
        snap.record(&durable_path).unwrap();
        snap.record(&normal_path).unwrap();

        write(&durable_path, "NEW DOC (свіжий CRC)");
        write(&normal_path, "MUTATED CODE");
        snap.record_durable(&durable_path);

        snap.rollback().expect("rollback успішний");

        assert_eq!(
            fs::read_to_string(&durable_path).unwrap(),
            "NEW DOC (свіжий CRC)",
            "durable-файл rollback не мав чіпати"
        );
        assert_eq!(
            fs::read_to_string(&normal_path).unwrap(),
            "OLD CODE",
            "звичайний файл мав відкотитись"
        );
    }

    #[test]
    fn durable_new_file_is_not_removed_by_rollback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let durable_new = dir.path().join("new-doc.md");

        let mut snap = Snapshot::new();
        snap.record(&durable_new).unwrap(); // sentinel New
        write(&durable_new, "щойно згенерована дока");
        snap.record_durable(&durable_new);

        snap.rollback().unwrap();

        assert!(
            durable_new.exists(),
            "durable новостворений файл rollback не мав видаляти"
        );
    }

    // --- modified_existing ---------------------------------------------------

    #[test]
    fn modified_existing_sees_only_changes_of_current_rung() {
        let dir = tempfile::tempdir().expect("tempdir");
        let changed = dir.path().join("changed.mjs");
        let untouched = dir.path().join("untouched.mjs");
        let durable = dir.path().join("durable.md");
        let brand_new = dir.path().join("brand-new.mjs");
        write(&changed, "OLD");
        write(&untouched, "SAME");
        write(&durable, "OLD DOC");

        let mut snap = Snapshot::new();
        snap.record(&changed).unwrap();
        snap.record(&untouched).unwrap();
        snap.record(&durable).unwrap();
        snap.record(&brand_new).unwrap(); // sentinel New — не "наявний"

        write(&changed, "NEW");
        write(&durable, "NEW DOC");
        snap.record_durable(&durable);
        write(
            &brand_new,
            "щойно створений — не рахується як modified_existing",
        );

        let modified = snap.modified_existing();
        assert_eq!(modified, vec![changed.clone()]);
    }

    #[test]
    fn modified_existing_sees_deleted_file_as_modified() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("deleted.mjs");
        write(&path, "OLD");

        let mut snap = Snapshot::new();
        snap.record(&path).unwrap();
        fs::remove_file(&path).unwrap();

        assert_eq!(snap.modified_existing(), vec![path]);
    }

    // --- touched --------------------------------------------------------------

    #[test]
    fn touched_includes_durable_only_paths_not_recorded() {
        let dir = tempfile::tempdir().expect("tempdir");
        let recorded = dir.path().join("a.mjs");
        let durable_only = dir.path().join("b.md");
        write(&recorded, "x");

        let mut snap = Snapshot::new();
        snap.record(&recorded).unwrap();
        snap.record_durable(&durable_only); // durable без попереднього record

        let touched = snap.touched();
        assert!(touched.contains(&recorded));
        assert!(touched.contains(&durable_only));
        assert_eq!(touched.len(), 2);
    }

    // --- pre_image_of ---------------------------------------------------------

    #[test]
    fn pre_image_of_returns_none_for_new_and_unrecorded_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let new_path = dir.path().join("new.mjs");
        let unrecorded = dir.path().join("unrecorded.mjs");

        let mut snap = Snapshot::new();
        snap.record(&new_path).unwrap(); // sentinel New

        assert_eq!(snap.pre_image_of(&new_path), None);
        assert_eq!(snap.pre_image_of(&unrecorded), None);
    }

    #[test]
    fn pre_image_of_returns_captured_content_for_existing_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.mjs");
        write(&path, "ORIGINAL");

        let mut snap = Snapshot::new();
        snap.record(&path).unwrap();
        write(&path, "MUTATED");

        assert_eq!(snap.pre_image_of(&path), Some("ORIGINAL"));
    }

    // --- ідемпотентність record/rollback ---------------------------------------

    #[test]
    fn second_touch_does_not_overwrite_pre_image() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.mjs");
        write(&path, "ORIGINAL");

        let mut snap = Snapshot::new();
        snap.record(&path).unwrap();
        write(&path, "MUTATED-BY-RUNG-1");
        snap.record(&path).unwrap(); // другий дотик — не має перезаписати pre-image

        assert_eq!(snap.pre_image_of(&path), Some("ORIGINAL"));
    }

    #[test]
    fn repeated_rollback_is_idempotent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let existing = dir.path().join("a.mjs");
        let created = dir.path().join("created.mjs");
        write(&existing, "ORIGINAL");

        let mut snap = Snapshot::new();
        snap.record(&existing).unwrap();
        snap.record(&created).unwrap();
        write(&existing, "MUTATED");
        write(&created, "NEW");

        snap.rollback().expect("перший rollback успішний");
        snap.rollback()
            .expect("другий rollback теж успішний (ідемпотентно)");

        assert_eq!(fs::read_to_string(&existing).unwrap(), "ORIGINAL");
        assert!(!created.exists());
    }

    // --- RungGuard: відкат при помилці посеред роботи ---------------------------

    #[test]
    fn rung_guard_rolls_back_on_early_return_via_question_mark() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.mjs");
        write(&path, "ORIGINAL");

        let snapshot = Arc::new(Mutex::new(Snapshot::new()));
        snapshot.lock().unwrap().record(&path).unwrap();

        // Симулює worker, що зіпсував файл, і детектор, що впав з помилкою —
        // rollback МАЄ спрацювати ПЕРЕД тим, як помилка піде далі, без жодного
        // явного виклику snapshot.rollback() у цій функції.
        fn simulate_rung(snapshot: Arc<Mutex<Snapshot>>, path: &Path) -> io::Result<()> {
            let _guard = RungGuard::new(snapshot);
            fs::write(path, "ЗІПСОВАНО WORKER-ОМ")?;
            Err(io::Error::other("детектор впав із винятком"))?
        }

        let result = simulate_rung(snapshot.clone(), &path);
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "ORIGINAL",
            "Drop guard-а мав відкотити файл до S1 ще до того, як помилка вийшла з функції"
        );
    }

    #[test]
    fn rung_guard_commit_prevents_rollback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.mjs");
        write(&path, "ORIGINAL");

        let snapshot = Arc::new(Mutex::new(Snapshot::new()));
        snapshot.lock().unwrap().record(&path).unwrap();

        {
            let guard = RungGuard::new(snapshot.clone());
            write(&path, "FIXED — рунг закрив concern");
            guard.commit();
        }

        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "FIXED — рунг закрив concern",
            "після commit() Drop не мав нічого відкочувати"
        );
    }

    #[test]
    fn rung_guard_rolls_back_on_plain_drop_without_commit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.mjs");
        write(&path, "ORIGINAL");

        let snapshot = Arc::new(Mutex::new(Snapshot::new()));
        snapshot.lock().unwrap().record(&path).unwrap();

        {
            let _guard = RungGuard::new(snapshot.clone());
            write(&path, "MUTATED — рунг не закрив concern");
        } // guard виходить зі скоупу тут — Drop без commit()

        assert_eq!(fs::read_to_string(&path).unwrap(), "ORIGINAL");
    }
}
