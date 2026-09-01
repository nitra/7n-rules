//! Оркестрація навколо auto-worktree lifecycle — точний порт алгоритмічної
//! частини `npm/scripts/lib/auto-worktree.mjs` (клас A, крок 4 плану
//! `docs/plans/2026-08-31-full-rust-migration-plan.md`, §2.141 реєстру,
//! `docs/specs/2026-08-31-recon-orchestration-gap.md` §2/§6).
//!
//! Worktree lifecycle сам (`sanitizeWorktreeName`/`worktreeCreate`/
//! `worktreeRemove`) УЖЕ нативний — [`rules_core::worktree`]. Тут
//! портовано те, чого в Rust не було ВЗАГАЛІ: git-статус-гейт на брудне
//! дерево, confirm-флоу (`y/N` через stdin), copy-back-логіка
//! (`bringChangesBackToOriginal`/`copyDirectoryRecursive` — перенесення
//! змін з автоствореного worktree назад чистим копіюванням файлів, НЕ
//! git-операція), і синхронний спавн `bun install`/`npx @7n/n push`.
//!
//! # Що НЕ портовано і чому
//!
//! Живого CLI-споживача немає цим кроком — той самий gap, що
//! [`crate::lint_full_lock`]/[`crate::lint_scheduler`] (доккоменти цих
//! модулів): єдиний споживач `auto-worktree.mjs`, що лишився,—
//! `npm/bin/n-rules-cli.mjs`'s `lint --full` без `--no-fix` — сам зникає
//! разом із JS-CLI-роутером на кроці Д1 (зріз 6), той самий крок, який
//! спека називає межею для ЦЬОГО файлу (§2.3 спеки). Другий колишній
//! споживач (`taze`-скіл) уже знято §2.125 реєстру — застереження класу A
//! знято звідти ж.

#![allow(dead_code)]

use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use rules_core::worktree;

/// Осі виклику `ensure_running_in_worktree` — порт третього параметра JS
/// (`{ suffix, description, requireCleanTree }`).
pub struct EnsureOptions<'a> {
    pub suffix: &'a str,
    pub description: &'a str,
    /// Типово `true` — порт дефолту `requireCleanTree = true`.
    pub require_clean_tree: bool,
}

/// Результат — точний порт повернення `ensureRunningInWorktree`.
#[derive(Debug)]
pub struct EnsureResult {
    pub cwd: PathBuf,
    pub auto_created: bool,
    pub worktree_name: Option<String>,
}

/// Виконує `git <args>` у `cwd`, повертає `(success, stdout)` — той самий
/// контракт, що інжектований `spawnFn` очікує від виклику з
/// `{ encoding: 'utf8' }` (`status === 0` перевіряється окремо у викликача).
fn git(cwd: &Path, args: &[&str]) -> (bool, String) {
    match Command::new("git").current_dir(cwd).args(args).output() {
        Ok(out) => (out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned()),
        Err(_) => (false, String::new()),
    }
}

/// Чи шлях (git toplevel) лежить під `.worktrees/` (репо-конвенція) або
/// `.claude/worktrees/` (harness Claude Code) — точний порт перевірки
/// `segments.has('.worktrees') || isClaudeHarnessWorktree`
/// (`auto-worktree.mjs:69-74`): membership по сегментах шляху, без
/// прив'язки до наявності сегмента ПІСЛЯ (на відміну від
/// `changed_files::is_worktree_checkout_path`, яка перевіряє шлях ФАЙЛУ
/// всередині такої директорії — інша семантика, тому не перевикористано).
fn is_isolated_worktree_toplevel(toplevel: &str) -> bool {
    let normalized = toplevel.replace('\\', "/");
    let segments: Vec<&str> = normalized.split('/').collect();
    if segments.iter().any(|s| *s == ".worktrees") {
        return true;
    }
    segments.windows(2).any(|w| w[0] == ".claude" && w[1] == "worktrees")
}

/// Питає y/N у терміналі — точний порт `defaultConfirm`
/// (`auto-worktree.mjs:18-27`). Поза TTY — одразу `false` (безпечний
/// дефолт, без зависання на порожньому stdin).
pub fn default_confirm(message: &str) -> bool {
    if !io::stdin().is_terminal() {
        return false;
    }
    print!("{message} [y/N] ");
    if io::stdout().flush().is_err() {
        return false;
    }
    let mut answer = String::new();
    if io::stdin().read_line(&mut answer).is_err() {
        return false;
    }
    let trimmed = answer.trim();
    trimmed.eq_ignore_ascii_case("y") || trimmed.eq_ignore_ascii_case("yes")
}

/// Синхронно виконує детерміновану команду — точний порт `runCommand`
/// (`auto-worktree.mjs:273-279`): кидає з exit-кодом+stderr при провалі.
fn run_command(cmd: &str, args: &[&str], cwd: &Path) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("{cmd} {}: {error}", args.join(" ")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let tail = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!(
            "{cmd} {} → exit {}: {tail}",
            args.join(" "),
            output.status.code().map_or("?".to_string(), |c| c.to_string())
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Гарантує, що подальші кроки виконуються в ізольованому worktree — точний
/// порт `ensureRunningInWorktree` (`auto-worktree.mjs:60-123`), окрім
/// власне worktree lifecycle (делеговано в [`rules_core::worktree`], уже
/// нативний до цього кроку).
///
/// `confirm` — колбек `y/N` при брудному дереві ([`default_confirm`] у
/// продукції, ін'єкція для тестів); `log` — колбек прогресу.
pub fn ensure_running_in_worktree(
    cwd: &Path,
    opts: &EnsureOptions,
    confirm: &dyn Fn(&str) -> bool,
    log: &dyn Fn(&str),
) -> Result<EnsureResult, String> {
    let (toplevel_ok, toplevel_raw) = git(cwd, &["rev-parse", "--show-toplevel"]);
    let toplevel = if toplevel_ok { toplevel_raw.trim().to_string() } else { String::new() };

    if is_isolated_worktree_toplevel(&toplevel) {
        return Ok(EnsureResult { cwd: cwd.to_path_buf(), auto_created: false, worktree_name: None });
    }

    let (branch_ok, branch_raw) = git(cwd, &["branch", "--show-current"]);
    let current_branch = if branch_ok { branch_raw.trim().to_string() } else { String::new() };
    if current_branch.is_empty() {
        return Err(format!(
            "\"{}\" не в ізольованому worktree (git toplevel: \"{}\"), і поточну гілку визначити не вдалось \
            (detached HEAD?) — автоматичне створення worktree за конвенцією `<current-branch>-<suffix>` неможливе. \
            Перейди на гілку вручну.",
            cwd.display(),
            if toplevel.is_empty() { "?" } else { &toplevel }
        ));
    }

    if opts.require_clean_tree {
        let (status_ok, status_out) = git(cwd, &["status", "--porcelain"]);
        if status_ok && !status_out.trim().is_empty() {
            let dirty_tree_error = || {
                format!(
                    "\"{}\" не в ізольованому worktree і має незакомічені зміни — auto-create worktree тут НЕБЕЗПЕЧНИЙ: \
                    перенесення результату назад копіюванням файлів затерло б ці незакомічені правки версією зі свіжого \
                    checkout (worktree = HEAD, без твоїх правок). Закомить/застеш зміни або створи worktree вручну.",
                    cwd.display()
                )
            };

            let wants_push = confirm(&format!(
                "\"{}\" не в ізольованому worktree і має незакомічені зміни — auto-create worktree тут НЕБЕЗПЕЧНИЙ \
                (перенесення назад копіюванням файлів затерло б їх версією зі свіжого checkout). \
                Закомить і запушити зараз через `npx @7n/n push`?",
                cwd.display()
            ));
            if !wants_push {
                return Err(dirty_tree_error());
            }

            log(&format!("📤 \"{}\" брудне — запускаю `npx @7n/n push` перед auto-create worktree...", cwd.display()));
            run_command("npx", &["@7n/n", "push"], cwd)?;

            let (recheck_ok, recheck_out) = git(cwd, &["status", "--porcelain"]);
            if !recheck_ok || !recheck_out.trim().is_empty() {
                return Err(format!(
                    "`npx @7n/n push` відпрацював, але \"{}\" усе ще не чисте — перевір вручну (git status).",
                    cwd.display()
                ));
            }
        }
    }

    let worktree_name = worktree::sanitize_name(&format!("{current_branch}-{}", opts.suffix));
    log(&format!("⚠️ \"{}\" не в ізольованому worktree — створюю \".worktrees/{worktree_name}\"...", cwd.display()));
    // base=None → rules_core::worktree::create_dev_worktree мапить на дефолт
    // "main" — той самий дефолт, що native worktreeCreate у JS.
    let new_cwd = worktree::create_dev_worktree(cwd, &worktree_name, opts.description, None)
        .map_err(|error| error.to_string())?;

    log("📥 bun install (bootstrap нового дерева)...");
    run_command("bun", &["install"], &new_cwd)?;

    Ok(EnsureResult { cwd: new_cwd, auto_created: true, worktree_name: Some(worktree_name) })
}

/// Прибирає автостворений worktree — точний порт `removeAutoCreatedWorktree`
/// (`auto-worktree.mjs:252-262`): лише лог при провалі, не кидає (прибирання,
/// а не крок, від якого залежить результат прогону).
pub fn remove_auto_created_worktree(worktree_name: &str, original_cwd: &Path, log: &dyn Fn(&str)) {
    log(&format!("🧹 Прибираю автостворений worktree \"{worktree_name}\"..."));
    if let Err(error) = worktree::remove_worktree(original_cwd, worktree_name, true) {
        log(&format!("⚠️ Не вдалось прибрати worktree \"{worktree_name}\" — приберіть вручну ({error})"));
    }
}

/// Результат [`bring_changes_back_to_original`] — точний порт повернення
/// `bringChangesBackToOriginal`.
pub struct BringBackResult {
    pub brought: Vec<String>,
    pub failed: bool,
}

/// Рекурсивно копіює вміст директорії (лише файли-листки) — точний порт
/// `copyDirectoryRecursive` (`auto-worktree.mjs:135-148`), реалізований
/// прямою рекурсією `std::fs::read_dir` (без `walkdir` — крейт не в
/// графі, а обхід тут дрібний і одноразовий).
fn copy_directory_recursive(src_dir: &Path, dest_dir: &Path) -> io::Result<Vec<String>> {
    let mut copied = Vec::new();
    copy_dir_into(src_dir, src_dir, dest_dir, &mut copied)?;
    Ok(copied)
}

fn copy_dir_into(root: &Path, dir: &Path, dest_root: &Path, copied: &mut Vec<String>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_into(root, &path, dest_root, copied)?;
        } else if file_type.is_file() {
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let dest = dest_root.join(rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &dest)?;
            copied.push(rel_str);
        }
    }
    Ok(())
}

/// Переносить зміни з автоствореного worktree назад у вихідне дерево як
/// **untracked/незакомічені** правки — точний порт
/// `bringChangesBackToOriginal` (`auto-worktree.mjs:174-233`). Джерело
/// істини — `git status --porcelain` у worktree: для кожного шляху копіює
/// файл (модифікація/додавання), видаляє його у вихідному дереві (файл
/// зник у worktree), або рекурсивно копіює directory (untracked-директорія
/// цілком — git схлопує її в один porcelain-рядок із `/`).
pub fn bring_changes_back_to_original(worktree_cwd: &Path, original_cwd: &Path, log: &dyn Fn(&str)) -> BringBackResult {
    let (status_ok, status_out) = git(worktree_cwd, &["status", "--porcelain"]);
    if !status_ok {
        log(&format!(
            "⚠️ Не вдалось прочитати git status у \"{}\" — зміни НЕ перенесені назад, worktree лишиться для ручного розбору.",
            worktree_cwd.display()
        ));
        return BringBackResult { brought: Vec::new(), failed: true };
    }

    let lines: Vec<&str> = status_out.split('\n').filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        log("ℹ️ Worktree без змін — нічого переносити назад.");
        return BringBackResult { brought: Vec::new(), failed: false };
    }

    let mut brought = Vec::new();
    let mut failed = false;
    for line in lines {
        // porcelain-рядок: 2-символьний статус + пробіл + шлях (`XY path`
        // або `XY old -> new` для перейменувань) — `line.slice(3)` бере все
        // після статусу й розділового пробілу.
        let rest = if line.len() >= 3 { &line[3..] } else { "" };
        let rel_path = if let Some(idx) = rest.find(" -> ") { &rest[idx + 4..] } else { rest };
        let src_path = worktree_cwd.join(rel_path);
        let dest_path = original_cwd.join(rel_path);

        let result: io::Result<()> = (|| {
            if !src_path.exists() {
                // `force: true` — відсутність `dest_path` не помилка (та сама
                // семантика, що `fs.rm(path, { force: true, recursive: true })`).
                if dest_path.is_dir() {
                    if let Err(error) = fs::remove_dir_all(&dest_path) {
                        if error.kind() != io::ErrorKind::NotFound {
                            return Err(error);
                        }
                    }
                } else if let Err(error) = fs::remove_file(&dest_path) {
                    if error.kind() != io::ErrorKind::NotFound {
                        return Err(error);
                    }
                }
                brought.push(rel_path.to_string());
                return Ok(());
            }

            let is_dir = rel_path.ends_with('/') || src_path.is_dir();
            if is_dir {
                let trimmed = rel_path.trim_end_matches('/');
                let nested = copy_directory_recursive(&src_path, &dest_path)?;
                for nested_rel in nested {
                    brought.push(format!("{trimmed}/{nested_rel}"));
                }
            } else {
                if let Some(parent) = dest_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&src_path, &dest_path)?;
                brought.push(rel_path.to_string());
            }
            Ok(())
        })();

        if let Err(error) = result {
            failed = true;
            log(&format!("⚠️ Не вдалось перенести \"{rel_path}\" назад у \"{}\" — {error}", original_cwd.display()));
        }
    }

    if failed {
        log(&format!(
            "⚠️ Перенесення назад у \"{}\" частково провалилось — перенесено: {}",
            original_cwd.display(),
            if brought.is_empty() { "(нічого)".to_string() } else { brought.join(", ") }
        ));
    } else {
        log(&format!("📤 Перенесено назад у \"{}\" як untracked: {}", original_cwd.display(), brought.join(", ")));
    }

    BringBackResult { brought, failed }
}

#[cfg(test)]
mod tests {
    use std::process::Command as StdCommand;
    use std::sync::Mutex;

    use tempfile::TempDir;

    use super::*;

    fn git_init(dir: &Path) {
        let status = StdCommand::new("git").current_dir(dir).args(["init", "-q"]).status().unwrap();
        assert!(status.success());
        StdCommand::new("git").current_dir(dir).args(["config", "user.email", "t@example.com"]).status().unwrap();
        StdCommand::new("git").current_dir(dir).args(["config", "user.name", "T"]).status().unwrap();
    }

    fn logger() -> (Mutex<Vec<String>>, impl Fn(&str)) {
        let lines: Mutex<Vec<String>> = Mutex::new(Vec::new());
        (lines, |_s: &str| {})
    }

    #[test]
    fn detects_worktrees_toplevel() {
        assert!(is_isolated_worktree_toplevel("/repo/.worktrees/feat-x"));
        assert!(is_isolated_worktree_toplevel("/repo/.claude/worktrees/agent-1"));
        assert!(!is_isolated_worktree_toplevel("/repo"));
        assert!(!is_isolated_worktree_toplevel(""));
    }

    #[test]
    fn ensure_running_returns_unchanged_when_already_isolated() {
        let tmp = TempDir::new().unwrap();
        let worktrees_root = tmp.path().join(".worktrees").join("feat-x");
        fs::create_dir_all(&worktrees_root).unwrap();
        git_init(&worktrees_root);
        fs::write(worktrees_root.join("a.txt"), "x").unwrap();
        StdCommand::new("git").current_dir(&worktrees_root).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(&worktrees_root).args(["commit", "-q", "-m", "init"]).status().unwrap();

        let opts = EnsureOptions { suffix: "sfx", description: "d", require_clean_tree: true };
        let result = ensure_running_in_worktree(&worktrees_root, &opts, &|_| false, &|_| {}).unwrap();
        assert!(!result.auto_created);
        assert_eq!(result.cwd, worktrees_root);
        assert!(result.worktree_name.is_none());
    }

    #[test]
    fn ensure_running_errors_on_detached_head_outside_worktree() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        git_init(dir);
        fs::write(dir.join("a.txt"), "x").unwrap();
        StdCommand::new("git").current_dir(dir).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(dir).args(["commit", "-q", "-m", "init"]).status().unwrap();
        let head = String::from_utf8(StdCommand::new("git").current_dir(dir).args(["rev-parse", "HEAD"]).output().unwrap().stdout).unwrap();
        StdCommand::new("git").current_dir(dir).args(["checkout", "-q", head.trim()]).status().unwrap();

        let opts = EnsureOptions { suffix: "sfx", description: "d", require_clean_tree: true };
        let err = ensure_running_in_worktree(dir, &opts, &|_| false, &|_| {}).unwrap_err();
        assert!(err.contains("detached HEAD"), "{err}");
    }

    #[test]
    fn ensure_running_errors_on_dirty_tree_when_confirm_declines() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        git_init(dir);
        fs::write(dir.join("a.txt"), "x").unwrap();
        StdCommand::new("git").current_dir(dir).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(dir).args(["commit", "-q", "-m", "init"]).status().unwrap();
        StdCommand::new("git").current_dir(dir).args(["checkout", "-q", "-b", "feature"]).status().unwrap();
        fs::write(dir.join("a.txt"), "dirty").unwrap();

        let opts = EnsureOptions { suffix: "sfx", description: "d", require_clean_tree: true };
        let err = ensure_running_in_worktree(dir, &opts, &|_| false, &|_| {}).unwrap_err();
        assert!(err.contains("незакомічені зміни"), "{err}");
    }

    #[test]
    fn ensure_running_skips_dirty_gate_when_require_clean_tree_false() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        git_init(dir);
        fs::write(dir.join("a.txt"), "x").unwrap();
        StdCommand::new("git").current_dir(dir).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(dir).args(["commit", "-q", "-m", "init"]).status().unwrap();
        StdCommand::new("git").current_dir(dir).args(["checkout", "-q", "-b", "feature"]).status().unwrap();
        fs::write(dir.join("a.txt"), "dirty").unwrap();

        // require_clean_tree=false пропускає гейт, але потім реально йде в
        // `mt worktree create`, який без git remote/бінаря `bun` у PATH тесту
        // може впасти на пізнішому кроці — тут перевіряємо лише, що ІМЕННО
        // dirty-tree-гейт не спрацював (помилка, якщо є, не про "незакомічені").
        let opts = EnsureOptions { suffix: "sfx", description: "d", require_clean_tree: false };
        let result = ensure_running_in_worktree(dir, &opts, &|_| false, &|_| {});
        if let Err(err) = result {
            assert!(!err.contains("незакомічені зміни"), "{err}");
        }
    }

    #[test]
    fn bring_changes_back_copies_modified_and_new_files() {
        let (_l, log) = logger();
        let worktree = TempDir::new().unwrap();
        let original = TempDir::new().unwrap();
        git_init(worktree.path());
        fs::write(worktree.path().join("a.txt"), "one").unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["commit", "-q", "-m", "init"]).status().unwrap();

        fs::write(worktree.path().join("a.txt"), "two").unwrap();
        fs::write(worktree.path().join("b.txt"), "new").unwrap();

        let result = bring_changes_back_to_original(worktree.path(), original.path(), &log);
        assert!(!result.failed);
        assert!(result.brought.contains(&"a.txt".to_string()));
        assert!(result.brought.contains(&"b.txt".to_string()));
        assert_eq!(fs::read_to_string(original.path().join("a.txt")).unwrap(), "two");
        assert_eq!(fs::read_to_string(original.path().join("b.txt")).unwrap(), "new");
    }

    #[test]
    fn bring_changes_back_removes_file_deleted_in_worktree() {
        let (_l, log) = logger();
        let worktree = TempDir::new().unwrap();
        let original = TempDir::new().unwrap();
        git_init(worktree.path());
        fs::write(worktree.path().join("a.txt"), "one").unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["commit", "-q", "-m", "init"]).status().unwrap();
        fs::write(original.path().join("a.txt"), "one").unwrap();

        fs::remove_file(worktree.path().join("a.txt")).unwrap();

        let result = bring_changes_back_to_original(worktree.path(), original.path(), &log);
        assert!(!result.failed);
        assert!(result.brought.contains(&"a.txt".to_string()));
        assert!(!original.path().join("a.txt").exists());
    }

    #[test]
    fn bring_changes_back_copies_new_untracked_directory_recursively() {
        let (_l, log) = logger();
        let worktree = TempDir::new().unwrap();
        let original = TempDir::new().unwrap();
        git_init(worktree.path());
        fs::write(worktree.path().join("a.txt"), "one").unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["commit", "-q", "-m", "init"]).status().unwrap();

        fs::create_dir_all(worktree.path().join("newdir/nested")).unwrap();
        fs::write(worktree.path().join("newdir/x.txt"), "x").unwrap();
        fs::write(worktree.path().join("newdir/nested/y.txt"), "y").unwrap();

        let result = bring_changes_back_to_original(worktree.path(), original.path(), &log);
        assert!(!result.failed, "{:?}", result.brought);
        assert_eq!(fs::read_to_string(original.path().join("newdir/x.txt")).unwrap(), "x");
        assert_eq!(fs::read_to_string(original.path().join("newdir/nested/y.txt")).unwrap(), "y");
    }

    #[test]
    fn bring_changes_back_no_changes_returns_empty() {
        let (_l, log) = logger();
        let worktree = TempDir::new().unwrap();
        let original = TempDir::new().unwrap();
        git_init(worktree.path());
        fs::write(worktree.path().join("a.txt"), "one").unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["add", "-A"]).status().unwrap();
        StdCommand::new("git").current_dir(worktree.path()).args(["commit", "-q", "-m", "init"]).status().unwrap();

        let result = bring_changes_back_to_original(worktree.path(), original.path(), &log);
        assert!(!result.failed);
        assert!(result.brought.is_empty());
    }

    #[test]
    fn bring_changes_back_reports_failure_on_bad_git_status() {
        let (_l, log) = logger();
        let not_a_repo = TempDir::new().unwrap();
        let original = TempDir::new().unwrap();
        let result = bring_changes_back_to_original(not_a_repo.path(), original.path(), &log);
        assert!(result.failed);
        assert!(result.brought.is_empty());
    }
}
