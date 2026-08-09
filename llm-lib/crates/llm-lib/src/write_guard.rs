//! Write-guard — Rust-порт `llm-lib/lib/write-guard.mjs`
//! (спека `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7, клас 3).
//!
//! Рішення §1 «патч застосовує агент» забирає dry-run, тому контроль над
//! записом винесено у три незалежні під-механізми, що спираються на одну
//! git-precondition:
//!   - **Scope/Denylist** — превентивне veto через [`WriteGuard::check_write`]:
//!     блок запису поза git-root, під `.git/`, або в будь-що, що матчить
//!     `git check-ignore` (build-артефакти, `node_modules`, `.env`, worktrees…).
//!   - **Snapshot** — per-file pre-image (наявний вміст або [`PreImage::New`])
//!     на перший дотик; покриває abort посеред запису.
//!   - **Rollback** — [`WriteGuard::rollback`] відновлює pre-image (або
//!     видаляє NEW-файли) на провал verdict-а.
//!
//! # Межі порту (навмисні відмінності від JS-джерела)
//!
//! JS-версія чіпляється на подію `tool_call` конкретного pi-SDK (через
//! `factory(pi) -> pi.on('tool_call', handler)`) і сама фільтрує write-тули
//! (`WRITE_TOOLS`). Цей Rust-тип — **SDK-агностичний**: жодного `factory`,
//! жодної таксономії tool-name. Майбутній власний цикл (rig-agent, окремий
//! зріз) викликає [`WriteGuard::check_write`] напряму зі свого
//! tool-хендлера ПЕРЕД тим, як застосувати запис, і сам вирішує, який
//! tool-виклик означає намір писати на диск — це рішення тепер належить
//! викликачу, не guard-у.
//!
//! # Fail-closed семантика
//!
//! У JS є canary (`state.attached`), бо `createAgentSession({
//! extensionFactories })` міг мовчки проігнорувати підключення guard-а
//! (окремий SDK-баг) — caller перевіряв прапорець перед `session.prompt`.
//! У Rust немає жодного проміжного SDK-шару: [`WriteGuard`] — звичайний
//! тип, конструюється напряму, тож немає способу, яким "підключення" могло
//! б мовчки не відбутися. Замість runtime-canary тут два конструктивні
//! механізми:
//!
//! 1. [`Decision`] позначений `#[must_use]` — ігнорування вердикту
//!    (виклик `check_write(...)` без обробки результату) генерує
//!    clippy/rustc warning, а `cargo clippy -p llm-lib --all-targets --
//!    -D warnings` (обов'язковий gate цього репозиторію) перетворює його
//!    на помилку збірки. Тобто "забути перевірити" — compile-time provable.
//! 2. [`WriteGuard::check_write`] знімає pre-image як частину ОДНІЄЇ
//!    атомарної перевірки (внутрішній `capture_pre_image` — приватний, не
//!    публічний метод): неможливо отримати [`Decision::Allow`] без
//!    знятого pre-image — на відміну від гіпотетичного публічного
//!    `capture_pre_image()`, який можна було б викликати окремо (або
//!    забути викликати) від `check_write`.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

/// git-root для `cwd` (`git rev-parse --show-toplevel`), або `None`, якщо
/// `cwd` не під git-репо (або `git` недоступний узагалі). Fix-шлях вимагає
/// git — викликач на `None` **пропускає fix** (§12 precondition JS-джерела).
#[must_use]
pub fn git_root(cwd: &Path) -> Option<PathBuf> {
    let out = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(cwd)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s))
    }
}

/// `realpath` шляху з найкращих зусиль: для наявного — повний canonicalize;
/// для ще-неіснуючого (NEW-файл) — canonicalize батьківської теки +
/// filename; інакше — як є. Знімає розбіжність symlink-шляхів (macOS
/// `/tmp` → `/private/tmp`), через яку tracked-файл хибно блокувався в
/// JS-джерелі — той самий фікс тут.
fn realpath_best_effort(p: &Path) -> PathBuf {
    if let Ok(rp) = fs::canonicalize(p) {
        return rp;
    }
    if let Some(parent) = p.parent() {
        if let (Ok(rp), Some(name)) = (fs::canonicalize(parent), p.file_name()) {
            return rp.join(name);
        }
    }
    p.to_path_buf()
}

/// Чи `abs` строго під `root` (захист від `..`-escape). `strip_prefix`
/// порівнює по компонентах шляху, тож на відміну від рядкового `startsWith`
/// у JS-джерелі не потребує окремого захисту від псевдо-збігів на кшталт
/// `root-sibling`.
fn is_under(root: &Path, abs: &Path) -> bool {
    match abs.strip_prefix(root) {
        Ok(rel) => !rel.as_os_str().is_empty(),
        Err(_) => false,
    }
}

/// Чи `abs` ігнорований git'ом (`git check-ignore -q`, exit 0 = ignored).
/// Це і є denylist: build-артефакти, `node_modules`, `.env`, `.worktrees`…
/// Fail-open, якщо `git` недоступний узагалі (той самий компроміс, що й у
/// JS-джерелі — там `spawnSync` без бінаря дає `status: null !== 0`).
fn default_check_ignore(root: &Path, abs: &Path) -> bool {
    Command::new("git")
        .args(["check-ignore", "-q", "--"])
        .arg(abs)
        .current_dir(root)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Pre-image вмісту файлу, знятий на перший дотик [`WriteGuard::check_write`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreImage {
    /// Файл існував — знятий текстовий вміст (UTF-8; як і JS-джерело,
    /// читає файл як текст — гарантії не поширюються на бінарні файли).
    Existing(String),
    /// Файл НЕ існував на момент першого дотику — rollback має його
    /// видалити, а не "відновити" порожнім (sentinel, аналог JS `NEW_FILE`).
    New,
}

/// Вердикт [`WriteGuard::check_write`]. Позначений `#[must_use]` — це
/// частина fail-closed гарантії порту (див. модульну документацію вище):
/// ігнорування вердикту не компілюється чисто під `-D warnings`.
#[must_use = "Decision::Block — це veto: ігнорування вердикту без match зводить нанівець fail-closed гарантію write-guard"]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Шлях пройшов усі три перевірки; pre-image (якщо перший дотик) вже
    /// знятий — викликач може безпечно застосовувати запис.
    Allow,
    /// Заблоковано з причиною (укр. текст, як і в JS-джерелі — придатний
    /// для дистиляційного логування без додаткового перекладу).
    Block { reason: String },
}

/// Один запис editLog — повна правка агента (старий/новий текст або
/// вміст), НЕ лічильник діагностики. Корпус для дистиляційного маховика
/// (§7 спеки) — саме тому `edits`/`content` зберігаються без спрощення.
#[derive(Debug, Clone, PartialEq)]
pub struct EditRecord {
    /// Абсолютний (realpath-нормалізований) шлях зачепленого файлу.
    pub path: PathBuf,
    /// Ім'я tool-у, що виконав правку (напр. `"edit"`, `"write"`,
    /// `"edit_anchored"`) — вільний рядок, guard не знає таксономії tool-ів.
    pub tool: String,
    /// Форма edit-опису (напр. `[{oldText,newText}]` або anchored-форма) —
    /// `None`, якщо tool не використовує пооб'єктні edits (напр. `write`).
    pub edits: Option<serde_json::Value>,
    /// Повний новий вміст файлу — для tool-ів кшталт `write`, що замінюють
    /// файл цілком; `None`, якщо tool працює через `edits`.
    pub content: Option<String>,
}

/// Write-safety guard для власного fix-циклу (клас 3, §3.7 спеки).
///
/// Одна інстанція — одна fix-сесія: тримає git-root, pre-image кожного
/// зачепленого файлу та editLog. Guard **не виконує сам запис** (як і
/// JS-джерело) — лише veto/snapshot/rollback; фактичну модифікацію файлу
/// виконує викликач (майбутній rig-agent tool-хендлер) ПІСЛЯ отримання
/// [`Decision::Allow`].
/// Тип підміни `git check-ignore` (див. [`WriteGuard::with_check_ignore`]).
type CheckIgnoreFn = Box<dyn Fn(&Path, &Path) -> bool>;

/// Тип `on_capture`-хука (див. [`WriteGuard::with_on_capture`]).
type OnCaptureFn = Box<dyn FnMut(&Path)>;

pub struct WriteGuard {
    cwd: PathBuf,
    root: Option<PathBuf>,
    check_ignore: CheckIgnoreFn,
    on_capture: Option<OnCaptureFn>,
    touched: HashSet<PathBuf>,
    pre_images: Vec<(PathBuf, PreImage)>,
    blocks: Vec<(PathBuf, String)>,
    edit_log: Vec<EditRecord>,
}

impl WriteGuard {
    /// Guard з автоматично обчисленим git-root (`git_root(&cwd)`) —
    /// типовий шлях для реального fix-циклу (аналог JS `root: undefined`).
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        let cwd = cwd.into();
        let root = git_root(&cwd);
        Self::from_parts(cwd, root)
    }

    /// Guard з явно заданим root — `None` симулює "не git-репо" (guard
    /// блокує геть усе), `Some(path)` інжектує root в обхід `git
    /// rev-parse` (тести; аналог JS `root: <value>` явно переданого).
    #[must_use]
    pub fn with_root(cwd: impl Into<PathBuf>, root: Option<PathBuf>) -> Self {
        Self::from_parts(cwd.into(), root)
    }

    fn from_parts(cwd: PathBuf, root: Option<PathBuf>) -> Self {
        Self {
            cwd,
            root: root.map(|r| realpath_best_effort(&r)),
            check_ignore: Box::new(default_check_ignore),
            on_capture: None,
            touched: HashSet::new(),
            pre_images: Vec::new(),
            blocks: Vec::new(),
            edit_log: Vec::new(),
        }
    }

    /// Підміняє `git check-ignore` інжектованою предикатною функцією (тести —
    /// без реального git-репо; аналог JS-параметра `checkIgnore`).
    #[must_use]
    pub fn with_check_ignore(mut self, f: impl Fn(&Path, &Path) -> bool + 'static) -> Self {
        self.check_ignore = Box::new(f);
        self
    }

    /// Хук "pre-image щойно знятий" — bridge у зовнішній snapshot-власник
    /// (напр. central rollback consumer), що має дізнатись про файл ДО
    /// його модифікації (аналог JS-параметра `onCapture`).
    #[must_use]
    pub fn with_on_capture(mut self, f: impl FnMut(&Path) + 'static) -> Self {
        self.on_capture = Some(Box::new(f));
        self
    }

    /// git-root цього guard-а (вже realpath-нормалізований), або `None`,
    /// якщо guard працює поза git-репо (усе буде заблоковано).
    #[must_use]
    pub fn root(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    /// Три послідовні перевірки шляху ПЕРЕД записом — (а) поза git-root,
    /// (б) під `.git/`, (в) git-ignored (denylist) — і, якщо всі пройдені,
    /// атомарно знімає pre-image на перший дотик (не окремий публічний
    /// метод — див. модульну документацію "Fail-closed семантика").
    ///
    /// `raw_path` — шлях, як його передав tool (може бути відносним щодо
    /// `cwd` цього guard-а або абсолютним). Порожній рядок повертає
    /// [`Decision::Allow`] без жодних перевірок — guard не резолвить його
    /// сам, як і JS-джерело (`raw === ''` → рано `return`, хай tool сам
    /// розбирається).
    pub fn check_write(&mut self, raw_path: &str) -> Decision {
        if raw_path.is_empty() {
            return Decision::Allow;
        }

        let candidate = if Path::new(raw_path).is_absolute() {
            PathBuf::from(raw_path)
        } else {
            self.cwd.join(raw_path)
        };
        let abs = realpath_best_effort(&candidate);

        // 1. Scope: під git-root (і git-root взагалі є).
        let Some(root) = self.root.clone() else {
            return self.block(&abs, format!("запис поза git-root: {raw_path}"));
        };
        if !is_under(&root, &abs) {
            return self.block(&abs, format!("запис поза git-root: {raw_path}"));
        }

        // 2. .git/ (поза моделлю ignore — git цього шляху не знає).
        let rel = abs
            .strip_prefix(&root)
            .expect("is_under вище вже підтвердив abs під root");
        if rel.starts_with(".git") {
            return self.block(&abs, format!("запис у .git/ заблоковано: {raw_path}"));
        }

        // 3. Denylist = git-ignored (build-артефакти, node_modules, .env, .worktrees…).
        if (self.check_ignore)(&root, &abs) {
            return self.block(&abs, format!("запис у git-ignored заблоковано: {raw_path}"));
        }

        // 4. Allow + snapshot pre-image на перший дотик (атомарно з veto).
        match self.capture_pre_image(&abs) {
            Ok(()) => Decision::Allow,
            // Читання наявного файлу провалилось (права доступу тощо) —
            // без pre-image rollback не зможе відновити вміст, тож
            // безпечніше заблокувати запис, ніж мовчки продовжити без
            // знятого снапшота (JS-джерело тут кинуло б необроблений
            // виняток — операційно еквівалентно: запис так само не відбувається).
            Err(e) => self.block(
                &abs,
                format!("не вдалося зняти pre-image ({e}): {raw_path}"),
            ),
        }
    }

    fn block(&mut self, abs: &Path, reason: String) -> Decision {
        self.blocks.push((abs.to_path_buf(), reason.clone()));
        Decision::Block { reason }
    }

    /// Знімає pre-image `abs` (наявний вміст або [`PreImage::New`]), якщо
    /// це перший дотик до файлу, і викликає `on_capture`-хук. Ідемпотентно
    /// — повторний дотик до того самого файлу нічого не робить (не
    /// перезаписує вже знятий pre-image другим станом).
    fn capture_pre_image(&mut self, abs: &Path) -> io::Result<()> {
        if !self.touched.insert(abs.to_path_buf()) {
            return Ok(());
        }
        let pre = if abs.exists() {
            PreImage::Existing(fs::read_to_string(abs)?)
        } else {
            PreImage::New
        };
        self.pre_images.push((abs.to_path_buf(), pre));
        if let Some(cb) = &mut self.on_capture {
            cb(abs);
        }
        Ok(())
    }

    /// Додає запис у editLog — корпус дистиляційного маховика (§7), не
    /// лічильник. Викликач додає запис ПІСЛЯ [`Decision::Allow`] і
    /// фактичного застосування правки, з повним описом (oldText/newText
    /// або content).
    pub fn record_edit(
        &mut self,
        path: impl Into<PathBuf>,
        tool: impl Into<String>,
        edits: Option<serde_json::Value>,
        content: Option<String>,
    ) {
        self.edit_log.push(EditRecord {
            path: path.into(),
            tool: tool.into(),
            edits,
            content,
        });
    }

    /// Відновлює pre-image усіх зачеплених файлів: наявний вміст —
    /// перезаписує назад, [`PreImage::New`] — видаляє файл (а не
    /// "відновлює" порожнім). Зупиняється на першій I/O-помилці —
    /// викликач вирішує, як діяти далі (JS-джерело кидало необроблений
    /// виняток на тому самому провалі).
    pub fn rollback(&self) -> io::Result<()> {
        for (abs, pre) in &self.pre_images {
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

    /// Абсолютні шляхи всіх файлів, яких guard торкнувся (для scoped
    /// re-check verdict-а — §4+5 спеки), у порядку першого дотику.
    #[must_use]
    pub fn touched_files(&self) -> Vec<PathBuf> {
        self.pre_images.iter().map(|(p, _)| p.clone()).collect()
    }

    /// Pre-image конкретного файлу, якщо guard уже його торкався.
    #[must_use]
    pub fn pre_image(&self, path: &Path) -> Option<&PreImage> {
        self.pre_images
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, pre)| pre)
    }

    /// Усі заблоковані спроби запису (шлях + причина) — телеметрія veto.
    #[must_use]
    pub fn blocks(&self) -> &[(PathBuf, String)] {
        &self.blocks
    }

    /// Повний editLog — корпус правок цієї fix-сесії.
    #[must_use]
    pub fn edit_log(&self) -> &[EditRecord] {
        &self.edit_log
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Тимчасова директорія, яку `Drop` сам прибирає при виході зі скоупу —
    /// власний мінімальний аналог `mkdtempSync` + `afterEach(rmSync)` з
    /// JS-тестів (без нової залежності — std вистачає).
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("час не може бути до epoch")
                .as_nanos();
            let dir =
                std::env::temp_dir().join(format!("wg-test-{}-{n}-{nanos}", std::process::id()));
            fs::create_dir_all(&dir).expect("створити тимчасову директорію");
            Self(realpath_best_effort(&dir))
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn git_available() -> bool {
        StdCommand::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn init_git_repo(dir: &Path) {
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            StdCommand::new("git")
                .args(&args)
                .current_dir(dir)
                .status()
                .expect("git має бути доступний (перевірено git_available)");
        }
    }

    // --- veto-логіка (інжектований root + checkIgnore) --------------------

    fn guard_for(dir: &TempDir) -> WriteGuard {
        WriteGuard::with_root(dir.path(), Some(dir.path().to_path_buf()))
            .with_check_ignore(|_root, abs| abs.to_string_lossy().contains("ignored"))
    }

    #[test]
    fn allow_tracked_file_under_root_with_pre_image() {
        let dir = TempDir::new();
        fs::write(dir.join("src.mjs"), "OLD").unwrap();
        let mut guard = guard_for(&dir);

        assert_eq!(guard.check_write("src.mjs"), Decision::Allow);
        assert_eq!(
            guard.pre_image(&dir.join("src.mjs")),
            Some(&PreImage::Existing("OLD".to_string()))
        );
    }

    #[test]
    fn block_git_ignored_without_pre_image() {
        let dir = TempDir::new();
        let mut guard = guard_for(&dir);

        let decision = guard.check_write("ignored.log");
        assert!(matches!(decision, Decision::Block { .. }));
        assert!(guard.touched_files().is_empty());
    }

    #[test]
    fn block_outside_git_root_escape() {
        let dir = TempDir::new();
        let mut guard = guard_for(&dir);

        assert!(matches!(
            guard.check_write("../outside.txt"),
            Decision::Block { .. }
        ));
    }

    #[test]
    fn block_dot_git_directory() {
        let dir = TempDir::new();
        let mut guard = guard_for(&dir);

        assert!(matches!(
            guard.check_write(".git/config"),
            Decision::Block { .. }
        ));
    }

    #[test]
    fn dot_git_prefix_does_not_false_match_gitignore_sibling() {
        // Регрес: `.gitignore` не має розпізнаватись як "під .git/" —
        // лише компонентний .git або .git/... (перевіряє коректність
        // Path::starts_with проти рядкового prefix-бага).
        let dir = TempDir::new();
        fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        let mut guard = guard_for(&dir);

        assert_eq!(guard.check_write(".gitignore"), Decision::Allow);
    }

    #[test]
    fn new_file_pre_image_is_new_sentinel() {
        let dir = TempDir::new();
        let mut guard = guard_for(&dir);

        assert_eq!(guard.check_write("brand-new.mjs"), Decision::Allow);
        assert_eq!(
            guard.pre_image(&dir.join("brand-new.mjs")),
            Some(&PreImage::New)
        );
    }

    #[test]
    fn second_touch_does_not_overwrite_pre_image() {
        let dir = TempDir::new();
        fs::write(dir.join("src.mjs"), "OLD").unwrap();
        let mut guard = guard_for(&dir);

        assert_eq!(guard.check_write("src.mjs"), Decision::Allow);
        // Агент "застосував" правку між двома дотиками до того самого шляху.
        fs::write(dir.join("src.mjs"), "MUTATED").unwrap();
        assert_eq!(guard.check_write("src.mjs"), Decision::Allow);

        assert_eq!(
            guard.pre_image(&dir.join("src.mjs")),
            Some(&PreImage::Existing("OLD".to_string())),
            "pre-image мусить лишитись знятим на ПЕРШИЙ дотик, не перезаписаним другим"
        );
    }

    #[test]
    fn no_git_root_blocks_everything() {
        let dir = TempDir::new();
        let mut guard = WriteGuard::with_root(dir.path(), None);

        assert!(matches!(
            guard.check_write("anything.mjs"),
            Decision::Block { .. }
        ));
    }

    // --- symlink-кейс (realpath best-effort) -------------------------------

    #[cfg(unix)]
    #[test]
    fn symlinked_root_path_does_not_false_block_tracked_file() {
        // Відтворює macOS `/tmp` → `/private/tmp` баг: root і cwd
        // передаються через НЕ-realpath (symlink) шлях, а guard мусить
        // нормалізувати обидва боки порівняння однаково.
        let base = TempDir::new();
        let real = base.join("real");
        let link = base.join("link");
        fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        fs::write(real.join("tracked.mjs"), "CONTENT").unwrap();

        // cwd і root обидва задані через symlink-шлях (не realpath).
        let mut guard =
            WriteGuard::with_root(&link, Some(link.clone())).with_check_ignore(|_root, _abs| false);

        assert_eq!(guard.check_write("tracked.mjs"), Decision::Allow);
    }

    // --- rollback -----------------------------------------------------------

    #[test]
    fn rollback_restores_tracked_and_removes_new_file() {
        let dir = TempDir::new();
        fs::write(dir.join("keep.mjs"), "ORIGINAL").unwrap();
        let mut guard = WriteGuard::with_root(dir.path(), Some(dir.path().to_path_buf()))
            .with_check_ignore(|_r, _a| false);

        assert_eq!(guard.check_write("keep.mjs"), Decision::Allow); // snapshot ORIGINAL
        assert_eq!(guard.check_write("created.mjs"), Decision::Allow); // snapshot New
        fs::write(dir.join("keep.mjs"), "MUTATED").unwrap();
        fs::write(dir.join("created.mjs"), "NEW CONTENT").unwrap();

        guard.rollback().unwrap();

        assert_eq!(
            fs::read_to_string(dir.join("keep.mjs")).unwrap(),
            "ORIGINAL"
        );
        assert!(!dir.join("created.mjs").exists());
    }

    #[test]
    fn touched_files_returns_visited_paths() {
        let dir = TempDir::new();
        fs::write(dir.join("a.mjs"), "a").unwrap();
        let mut guard = WriteGuard::with_root(dir.path(), Some(dir.path().to_path_buf()))
            .with_check_ignore(|_r, _a| false);

        assert_eq!(guard.check_write("a.mjs"), Decision::Allow);
        assert_eq!(guard.touched_files(), vec![dir.join("a.mjs")]);
    }

    // --- editLog --------------------------------------------------------------

    #[test]
    fn edit_log_accumulates_records() {
        let dir = TempDir::new();
        let mut guard = WriteGuard::with_root(dir.path(), Some(dir.path().to_path_buf()))
            .with_check_ignore(|_r, _a| false);

        let abs = dir.join("a.mjs");
        assert_eq!(guard.check_write("a.mjs"), Decision::Allow);
        guard.record_edit(
            abs.clone(),
            "edit",
            Some(serde_json::json!([{ "oldText": "a", "newText": "b" }])),
            None,
        );
        guard.record_edit(abs.clone(), "write", None, Some("повний вміст".to_string()));

        assert_eq!(guard.edit_log().len(), 2);
        assert_eq!(guard.edit_log()[0].tool, "edit");
        assert_eq!(guard.edit_log()[1].content.as_deref(), Some("повний вміст"));
        assert!(guard.edit_log().iter().all(|e| e.path == abs));
    }

    // --- onCapture-хук -----------------------------------------------------

    #[test]
    fn on_capture_hook_fires_once_per_first_touch() {
        let dir = TempDir::new();
        fs::write(dir.join("a.mjs"), "a").unwrap();
        let captured = std::rc::Rc::new(std::cell::RefCell::new(Vec::<PathBuf>::new()));
        let captured_cb = captured.clone();
        let mut guard = WriteGuard::with_root(dir.path(), Some(dir.path().to_path_buf()))
            .with_check_ignore(|_r, _a| false)
            .with_on_capture(move |abs| captured_cb.borrow_mut().push(abs.to_path_buf()));

        assert_eq!(guard.check_write("a.mjs"), Decision::Allow);
        // другий дотик — НЕ повторний виклик хука
        assert_eq!(guard.check_write("a.mjs"), Decision::Allow);

        assert_eq!(captured.borrow().as_slice(), [dir.join("a.mjs")]);
    }

    // --- integration: справжній git-репо ------------------------------------

    #[test]
    fn git_root_returns_toplevel() {
        if !git_available() {
            eprintln!("skip: git недоступний у середовищі");
            return;
        }
        let dir = TempDir::new();
        init_git_repo(dir.path());
        assert_eq!(
            git_root(dir.path()).map(|p| realpath_best_effort(&p)),
            Some(dir.path().to_path_buf())
        );
    }

    #[test]
    fn git_root_none_outside_repo() {
        if !git_available() {
            eprintln!("skip: git недоступний у середовищі");
            return;
        }
        let dir = TempDir::new();
        // Без git init — не git-репо (за умови, що системний тимчасовий
        // корінь сам не лежить під якимось зовнішнім git-репо; якщо лежить,
        // тест зробить fail-open через ранній skip нижче).
        match git_root(dir.path()) {
            None => {}
            Some(_) => eprintln!("skip: тимчасова тека несподівано під зовнішнім git-репо"),
        }
    }

    #[test]
    fn real_git_check_ignore_blocks_build_and_log_allows_src() {
        if !git_available() {
            eprintln!("skip: git недоступний у середовищі");
            return;
        }
        let dir = TempDir::new();
        init_git_repo(dir.path());
        fs::write(dir.join(".gitignore"), "build/\n*.log\n").unwrap();
        fs::create_dir_all(dir.join("build")).unwrap();
        fs::write(dir.join("src.mjs"), "OLD").unwrap();

        // root обчислюється (не інжектований), реальний check-ignore (не підмінений).
        let mut guard = WriteGuard::new(dir.path());

        assert_eq!(guard.check_write("src.mjs"), Decision::Allow);
        assert!(matches!(
            guard.check_write("build/out.js"),
            Decision::Block { .. }
        ));
        assert!(matches!(
            guard.check_write("debug.log"),
            Decision::Block { .. }
        ));
    }
}
