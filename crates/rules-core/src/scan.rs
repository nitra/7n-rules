//! Native filesystem scan — точний порт `walkDir` з
//! `npm/scripts/utils/walkDir.mjs:48-76` (D1 фази 4а спеки
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
//!
//! # Двигун
//!
//! JS-версія використовує `globby('**/*', { cwd, gitignore: true, dot: true,
//! onlyFiles: true, ignore: [...ALWAYS_IGNORE, ...extraIgnore] })`. Тут —
//! `ignore::WalkBuilder` (двигун `rg`/`fd`), а не ручний порт glob-логіки:
//! обидва парсять gitignore-синтаксис однаково (сам `.gitignore`-парсер у
//! `ignore` — той самий клас алгоритму, що й `fast-glob`/`globby`
//! використовують під капотом через `.gitignore`-читання), і мати повний
//! контроль над кожним прапорцем (`hidden`/`parents`/`require_git`/…) простіше
//! й надійніше за відтворення внутрішньої evaluation-логіки globby вручну.
//!
//! # Звірка семантики globby (пункт за пунктом, spec D1 фази 4а)
//!
//! - `dot: true` → [`WalkBuilder::hidden`]`(false)` — приховані файли не
//!   пропускаються.
//! - `gitignore: true` → [`WalkBuilder::git_ignore`]`(true)` — вкладені
//!   `.gitignore` поважаються.
//! - globby **не** читає `~/.config/git/ignore` (global gitignore) і **не**
//!   читає `.git/info/exclude` → [`WalkBuilder::git_global`]`(false)`,
//!   [`WalkBuilder::git_exclude`]`(false)`.
//! - globby **не** читає `.ignore`-файли (це розширення `ripgrep`, не частина
//!   fast-glob) → [`WalkBuilder::ignore`]`(false)`.
//! - globby **не** підіймає `.gitignore` з директорій НАД `cwd` →
//!   [`WalkBuilder::parents`]`(false)` (перевірено фікстурою
//!   `parent_gitignore_above_dir_not_applied`).
//! - globby застосовує gitignore-правила навіть поза git-репозиторієм (немає
//!   `.git`) → [`WalkBuilder::require_git`]`(false)` (перевірено фікстурою
//!   `gitignore_applies_outside_git_repo`).
//! - `onlyFiles: true` → фільтр по `entry.file_type().is_file()` (директорії й
//!   інші типи відкидаються після проходу walker-а, не через сам walker —
//!   `ignore` не має еквівалента `onlyFiles`).
//! - **Симлінки** — дослідження на живій фікстурі (Node.js + `globby`,
//!   `/private/tmp/.../scratchpad/symlink-test.mjs`): симлінк на файл
//!   потрапляє у вивід під своїм власним шляхом (не резолвиться в target);
//!   симлінк на директорію globby **проходить** і віддає файли всередині під
//!   шляхом `<symlink-name>/<file>` (сама директорія-симлінк не з'являється
//!   окремим записом, бо `onlyFiles` — це узгоджено, бо fast-glob за
//!   замовчуванням `followSymbolicLinks: true`); зламаний симлінк (target не
//!   існує) у вивід **не** потрапляє, а решта дерева лишається у виводі (не
//!   фатальна помилка для всього виклику — окрема жива фікстура це
//!   підтвердила: `globby` на дереві зі зламаним симлінком все одно резолвить
//!   інші файли). Точний відповідник — [`WalkBuilder::follow_links`]`(true)`:
//!   `ignore` слідує симлінкам на директорії (з вбудованим захистом від
//!   циклів) і трактує симлінк-файл як звичайний файл під його власним
//!   шляхом; зламаний симлінк дає `stat`-помилку з `io::ErrorKind::NotFound`
//!   на конкретному entry — [`walk_dir`] трактує САМЕ цей вид помилки як
//!   «пропустити entry», а не «обнулити весь результат» (нюанс fail-safe
//!   політики — детальніше секція «Fail-safe» нижче).
//! - Ignore-глоби (`ALWAYS_IGNORE` + `extra_ignore_globs`) — через
//!   [`ignore::overrides::OverrideBuilder`] з інвертованими (`!glob`)
//!   патернами. Причина інверсії: `Override` семантично «дзеркальний»
//!   gitignore — патерн без `!` у `OverrideBuilder` означає whitelist
//!   (тільки перелічене включається, решта відкидається), а
//!   заперечений (`!glob`) — це саме «завжди виключити», незалежно від
//!   іншої gitignore-логіки (той самий пріоритет, що й `ALWAYS_IGNORE` у
//!   JS: захардкоджені паттерни діють понад `.gitignore`).
//!
//! # Fail-safe
//!
//! JS-версія обгортає весь виклик `globby(...)` у `try {} catch { return }` —
//! єдиний `Promise`, тож помилка глибокого читання директорії (наприклад,
//! `EACCES` на `scandir`) відкидає **весь** результат: жива фікстура це
//! підтвердила — `globby` на дереві з недоступною піддиректорією кидає
//! `EACCES`, `walkDir` ловить і повертає `[]`, навіть якщо частину файлів
//! технічно вже можна було б зібрати. [`walk_dir`] відтворює це буквально для
//! відповідного класу помилок обходу (`ignore::Error` без `io::ErrorKind::
//! NotFound`) → порожній `Vec`.
//!
//! Але не всі помилки обходу фатальні для globby: `stat`-помилка на
//! конкретному entry з `io::ErrorKind::NotFound` (типовий випадок — зламаний
//! симлінк, ціль якого не існує) інша жива фікстура підтвердила навпаки —
//! `globby` мовчки пропускає таку ціль і резолвиться з рештою дерева. Тому
//! [`walk_dir`] розрізняє: `NotFound` на entry → `continue` (пропустити
//! entry, обхід триває); будь-яка інша помилка (`EACCES`, `ELOOP` на
//! symlink-циклі тощо) → `Vec::new()` (fail-safe, як описано вище).
//! Неіснуючий/не-каталоговий `dir` — окрема рання перевірка перед стартом
//! walker-а (той самий контракт: `globby` кидає ще до першого entry).
//!
//! # Порядок
//!
//! globby (fast-glob) не гарантує детермінований порядок виводу — контракту
//! на порядок немає ні в JS-тестах (усюди `toSorted()`), ні в globby-доці.
//! [`walk_dir`] сортує результат байтово-лексикографічно (`Vec<String>::sort`)
//! — детермінізм отримуємо явно, а не мімікруємо недетермінований порядок
//! ходу директорій.

use std::path::Path;

use ignore::{overrides::OverrideBuilder, WalkBuilder};

/// Захардкоджені ignore-патерни, що діють завжди — точний порт
/// `ALWAYS_IGNORE` (`walkDir.mjs:16`, разом із `WORKTREE_CHECKOUT_GLOBS`
/// (`walkDir.mjs:10`), інлайновані сюди тим самим списком).
///
/// `.git/**` і `node_modules/**` — БЕЗ провідного `**/`, тож анітрохи не
/// рекурсивні: діють лише на верхньому рівні `dir` (анкоровані, як звичайний
/// `.gitignore`-патерн зі слешем усередині). Перевірено живою фікстурою
/// globby: вкладені `src/node_modules/**` і `sub/.git/**` НЕ фільтруються
/// цими двома патернами (лише `.gitignore`, якщо він є). `**/.worktrees/**`
/// і `**/.claude/worktrees/**` — з провідним `**/`, діють на будь-якій
/// глибині.
const ALWAYS_IGNORE: &[&str] = &[
    ".git/**",
    "node_modules/**",
    "**/.worktrees/**",
    "**/.claude/worktrees/**",
];

/// Конвертує відносний шлях у posix-рядок (`/`-роздільники) незалежно від
/// платформи — компонент за компонентом, lossy для нестандартних байтів (той
/// самий «не падати на екзотиці» дух, що й `git_lines` у `changed_files.rs`).
fn to_posix_rel(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Рекурсивно сканує `dir`, повертає relative-posix шляхи файлів —
/// точний семантичний порт `walkDir` (`walkDir.mjs:48-76`, докладна звірка
/// у doc-коменті модуля вище).
///
/// - `extra_ignore_globs` — уже нормалізовані ignore-глоби (relative-posix
///   від `dir`, із суфіксом `/**`); нормалізація (`resolve`/`relative` від
///   `process.cwd()`) лишається на боці JS-фасаду (D2 фази 4а), бо завʼязана
///   на `process.cwd()`, якого немає у `rules-core`.
/// - Результат відсортований байтово-лексикографічно (детермінізм — секція
///   «Порядок» у doc-коменті модуля; сам globby порядку не гарантує).
/// - Fail-safe (секція «Fail-safe» у doc-коменті модуля): `dir` не існує,
///   `dir` — не каталог, помилка побудови override-матчера, або помилка
///   обходу з `io::ErrorKind`, відмінним від `NotFound`, → порожній `Vec`.
///   `NotFound`-помилка на конкретному entry (типово — зламаний симлінк) не
///   фатальна: entry пропускається, обхід і збір решти файлів тривають.
pub fn walk_dir(dir: &Path, extra_ignore_globs: &[String]) -> Vec<String> {
    // Рання перевірка дає той самий контракт, що й JS: globby на неіснуючому
    // чи не-каталоговому `cwd` кидає, `catch` ловить, результат — [].
    match std::fs::metadata(dir) {
        Ok(meta) if meta.is_dir() => {}
        _ => return Vec::new(),
    }

    let mut override_builder = OverrideBuilder::new(dir);
    for glob in ALWAYS_IGNORE
        .iter()
        .copied()
        .chain(extra_ignore_globs.iter().map(String::as_str))
    {
        // Заперечений (`!glob`) патерн у OverrideBuilder = «завжди
        // виключити» (секція «Ignore-глоби» у doc-коменті модуля).
        if override_builder.add(&format!("!{glob}")).is_err() {
            return Vec::new();
        }
    }
    let overrides = match override_builder.build() {
        Ok(overrides) => overrides,
        Err(_) => return Vec::new(),
    };

    let mut walker = WalkBuilder::new(dir);
    walker
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .ignore(false)
        .parents(false)
        .require_git(false)
        .follow_links(true)
        .overrides(overrides);

    let mut files: Vec<String> = Vec::new();
    for entry in walker.build() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                let is_not_found = err
                    .io_error()
                    .is_some_and(|io_err| io_err.kind() == std::io::ErrorKind::NotFound);
                if is_not_found {
                    // Зламаний симлінк (target не існує) — не фатально,
                    // globby теж мовчки пропускає саме цей entry (секція
                    // «Fail-safe» у doc-коменті модуля).
                    continue;
                }
                // Будь-яка інша помилка обходу (permission denied на
                // `read_dir`, symlink-цикл тощо) — фатальна, точно як єдиний
                // `try/catch` навколо `globby(...)` у JS-версії.
                return Vec::new();
            }
        };
        let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(dir) else {
            continue;
        };
        if rel.as_os_str().is_empty() {
            // Сам корінь (walker завжди повертає entry для стартового
            // `dir`) — не файл (перевірено вище), сюди не потрапляє, але
            // guard залишаємо на випадок майбутньої зміни поведінки крейта.
            continue;
        }
        files.push(to_posix_rel(rel));
    }

    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::symlink, path::Path};

    use tempfile::TempDir;

    use super::walk_dir;

    fn write_file(dir: &Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn basic_walk_collects_and_sorts() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "b.txt", "b");
        write_file(dir, "a.txt", "a");
        write_file(dir, "src/nested/c.txt", "c");

        let files = walk_dir(dir, &[]);
        assert_eq!(files, vec!["a.txt", "b.txt", "src/nested/c.txt"]);
    }

    #[test]
    fn dot_files_included() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "root.txt", "x");
        write_file(dir, ".hidden.txt", "x");
        write_file(dir, ".config/settings.json", "{}");

        let files = walk_dir(dir, &[]);
        assert_eq!(
            files,
            vec![".config/settings.json", ".hidden.txt", "root.txt"]
        );
    }

    #[test]
    fn always_ignore_filters_node_modules_git_and_worktree_checkouts() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "root.txt", "x");
        write_file(dir, "node_modules/pkg/bad.txt", "x");
        write_file(dir, ".git/objects/bad.txt", "x");
        write_file(dir, ".worktrees/feature-x/bad.js", "x");
        write_file(dir, ".claude/worktrees/agent-y/COVERAGE.md", "x");
        write_file(dir, ".claude/settings.json", "{}");
        write_file(dir, "pkg/.worktrees/nested/bad.js", "x");

        let files = walk_dir(dir, &[]);
        assert_eq!(files, vec![".claude/settings.json", "root.txt"]);
    }

    #[test]
    fn always_ignore_is_anchored_nested_node_modules_and_git_survive() {
        // ALWAYS_IGNORE `.git/**`/`node_modules/**` — без провідного `**/`,
        // тож анкоровані лише на верхньому рівні (звірено живою фікстурою
        // globby, doc-комент модуля). Вкладені копії лишаються у виводі.
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "src/node_modules/pkg/b.txt", "x");
        write_file(dir, "sub/.git/objects/d.txt", "x");
        write_file(dir, "root.txt", "x");

        let files = walk_dir(dir, &[]);
        assert_eq!(
            files,
            vec![
                "root.txt",
                "src/node_modules/pkg/b.txt",
                "sub/.git/objects/d.txt"
            ]
        );
    }

    #[test]
    fn nested_gitignore_is_respected() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "sub/.gitignore", "secret.txt\n");
        write_file(dir, "sub/secret.txt", "x");
        write_file(dir, "sub/keep.txt", "x");
        write_file(dir, "root.txt", "x");

        let files = walk_dir(dir, &[]);
        assert_eq!(files, vec!["root.txt", "sub/.gitignore", "sub/keep.txt"]);
    }

    #[test]
    fn gitignore_applies_outside_git_repo() {
        // `require_git(false)`: жодного `.git` у фікстурі немає, але
        // `.gitignore` все одно має діяти (globby теж не вимагає git-репо).
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, ".gitignore", "dist/\n");
        write_file(dir, "dist/bad.txt", "x");
        write_file(dir, "root.txt", "x");

        let files = walk_dir(dir, &[]);
        assert_eq!(files, vec![".gitignore", "root.txt"]);
    }

    #[test]
    fn parent_gitignore_above_dir_not_applied() {
        // Кореневий `.gitignore` (над стартовим `dir`) НЕ має діяти —
        // `parents(false)`, точний порт відсутності підйому вгору в globby.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write_file(root, ".gitignore", "*.log\n");
        write_file(root, "sub/x.log", "x");
        write_file(root, "sub/keep.txt", "x");

        let files = walk_dir(&root.join("sub"), &[]);
        assert_eq!(files, vec!["keep.txt", "x.log"]);
    }

    #[test]
    fn extra_ignore_globs_filter_paths() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "keep.txt", "x");
        write_file(dir, "vendor/chart/values.yaml", "x");
        write_file(dir, "vendor/chart/templates/deploy.yaml", "x");

        let files = walk_dir(dir, &["vendor/chart/**".to_string()]);
        assert_eq!(files, vec!["keep.txt"]);
    }

    #[test]
    fn nonexistent_dir_is_empty() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("nope");
        assert_eq!(walk_dir(&ghost, &[]), Vec::<String>::new());
    }

    #[test]
    fn file_instead_of_dir_is_empty() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.txt");
        write_file(tmp.path(), "a.txt", "x");
        assert_eq!(walk_dir(&file, &[]), Vec::<String>::new());
    }

    #[test]
    fn symlink_to_file_is_included_under_its_own_path() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "real.txt", "x");
        symlink(dir.join("real.txt"), dir.join("link.txt")).unwrap();

        let files = walk_dir(dir, &[]);
        assert_eq!(files, vec!["link.txt", "real.txt"]);
    }

    #[test]
    fn symlink_to_dir_is_followed() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "realdir/inner.txt", "y");
        symlink(dir.join("realdir"), dir.join("link-to-dir")).unwrap();

        let files = walk_dir(dir, &[]);
        assert_eq!(files, vec!["link-to-dir/inner.txt", "realdir/inner.txt"]);
    }

    #[test]
    fn permission_denied_subdir_fails_closed() {
        // На відміну від зламаного симлінка, недоступна для читання
        // піддиректорія (`EACCES` на `scandir`) — фатальна помилка обходу:
        // жива фікстура globby підтвердила, що весь `Promise` кидає й
        // `walkDir` повертає `[]`, навіть якщо `root.txt` технічно вже можна
        // було б зібрати (doc-комент модуля, секція «Fail-safe»).
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "root.txt", "x");
        write_file(dir, "locked/secret.txt", "x");
        let locked = dir.join("locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

        // Root (і деякі sandboxed CI-контейнери) ігнорують права доступу —
        // тест у такому середовищі недостовірний, пропускаємо його замість
        // фолсу.
        let permission_check_effective = fs::read_dir(&locked).is_err();

        let files = walk_dir(dir, &[]);

        // Повертаємо права, інакше `TempDir::drop` не зможе прибрати
        // `locked/secret.txt`.
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();

        if permission_check_effective {
            assert_eq!(files, Vec::<String>::new());
        }
    }

    #[test]
    fn broken_symlink_is_excluded_not_a_walk_failure() {
        // Зламаний симлінк (target не існує) globby мовчки не включає у
        // вивід, і решта дерева лишається доступною — перевіряємо, що
        // `ignore` теж не трактує це як фатальну помилку обходу (яка за
        // fail-safe-контрактом обнулила б увесь результат).
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        write_file(dir, "root.txt", "x");
        symlink(dir.join("nonexistent.txt"), dir.join("broken-link.txt")).unwrap();

        let files = walk_dir(dir, &[]);
        assert_eq!(files, vec!["root.txt"]);
    }
}
