//! `worktree_fingerprint` — точний порт `worktreeFingerprint`
//! (`npm/scripts/utils/worktree-fingerprint.mjs`), крок 4 плану
//! `docs/plans/2026-08-31-full-rust-migration-plan.md` (клас A, частина
//! міжпроцесного контракту `lint-lock.mjs`, §2.138 реєстру).
//!
//! Fingerprint стану git-робочого дерева (HEAD + diff + untracked-файли),
//! використовується для TTL-дедуплікації повторних `lint --full` прогонів
//! на незміненому дереві. **Fail-open за конструкцією**: будь-яка помилка
//! (не git-репо, збій команди) → `None`, а не паніка чи `Result::Err` —
//! той самий контракт, що JS-`catch { return null }`: дедуплікація просто
//! вимикається, черга працює як завжди.

use std::path::Path;
use std::process::Command;

use sha2::{Digest, Sha256};

/// Виконує `git <args>` у `cwd`, повертає stdout як `String`. `None` на
/// будь-яку помилку (spawn-фейл, ненульовий exit) — порт внутрішньої
/// `git()`-хелпер-функції (`worktree-fingerprint.mjs:19-23`), яка кидає, і
/// виклик ловить `catch` на рівні всієї функції.
fn git_stdout(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").current_dir(cwd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Fingerprint поточного стану git-робочого дерева — точний порт
/// `worktreeFingerprint` (`worktree-fingerprint.mjs:14-38`):
///
/// 1. `git rev-parse HEAD` (trim) — commit hash;
/// 2. `git diff HEAD` (як є, без trim) — весь diff tracked-змін;
/// 3. `git ls-files -z --others --exclude-standard` — untracked-файли,
///    NUL-розділені (без C-екранування не-ASCII імен);
/// 4. для кожного untracked-файлу — `git hash-object <file>` (trim),
///    пара `"<file>:<hash>"`, відсортована лексикографічно;
/// 5. `sha256(join('\n', [commitHash, diffText, ...pairs]))`.
///
/// `None`, якщо будь-який крок git не спрацював (не git-репо, файл зник
/// між `ls-files` і `hash-object` тощо) — той самий fail-open контракт, що
/// JS: дедуплікація вимикається, черга не ламається.
pub fn worktree_fingerprint(cwd: &Path) -> Option<String> {
    let commit_hash = git_stdout(cwd, &["rev-parse", "HEAD"])?.trim().to_string();
    let diff_text = git_stdout(cwd, &["diff", "HEAD"])?;
    let untracked_raw = git_stdout(cwd, &["ls-files", "-z", "--others", "--exclude-standard"])?;

    let mut pairs: Vec<String> = Vec::new();
    for file in untracked_raw.split('\0').filter(|f| !f.is_empty()) {
        let hash = git_stdout(cwd, &["hash-object", file])?.trim().to_string();
        pairs.push(format!("{file}:{hash}"));
    }
    pairs.sort();

    let mut raw_lines = vec![commit_hash, diff_text];
    raw_lines.extend(pairs);
    let raw = raw_lines.join("\n");

    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    Some(hex_encode(&hasher.finalize()))
}

/// Ручне hex-кодування — `sha2`'s `GenericArray` не реалізує `LowerHex`
/// напряму (той самий обхід, що `rules-docs`).
fn hex_encode(bytes: &[u8]) -> String {
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo() -> TempDir {
        let tmp = TempDir::new().unwrap();
        git(tmp.path(), &["init", "-q"]);
        git(tmp.path(), &["config", "user.email", "test@example.com"]);
        git(tmp.path(), &["config", "user.name", "Test"]);
        fs::write(tmp.path().join("a.txt"), "one\n").unwrap();
        git(tmp.path(), &["add", "a.txt"]);
        git(tmp.path(), &["commit", "-q", "-m", "init"]);
        tmp
    }

    /// Поза git-репо — `None`, дедуп просто вимкнений, не паніка.
    #[test]
    fn none_outside_git_repo() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(worktree_fingerprint(tmp.path()), None);
    }

    /// Чисте дерево дає стабільний, детермінований fingerprint при повторному
    /// виклику без жодної зміни.
    #[test]
    fn deterministic_on_clean_tree() {
        let tmp = init_repo();
        let a = worktree_fingerprint(tmp.path()).unwrap();
        let b = worktree_fingerprint(tmp.path()).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 64, "sha256 hex — 64 символи");
    }

    /// Модифікація tracked-файлу змінює fingerprint — diff потрапляє у
    /// хеш-джерело.
    #[test]
    fn changes_on_tracked_modification() {
        let tmp = init_repo();
        let before = worktree_fingerprint(tmp.path()).unwrap();
        fs::write(tmp.path().join("a.txt"), "two\n").unwrap();
        let after = worktree_fingerprint(tmp.path()).unwrap();
        assert_ne!(before, after);
    }

    /// Новий untracked-файл змінює fingerprint — `ls-files --others` +
    /// `hash-object` пара потрапляє у хеш-джерело.
    #[test]
    fn changes_on_new_untracked_file() {
        let tmp = init_repo();
        let before = worktree_fingerprint(tmp.path()).unwrap();
        fs::write(tmp.path().join("b.txt"), "new\n").unwrap();
        let after = worktree_fingerprint(tmp.path()).unwrap();
        assert_ne!(before, after);
    }

    /// Untracked-файл з не-ASCII іменем не ламає fingerprint — саме заради
    /// цього JS-версія використовує `-z` (NUL-розділення) замість
    /// C-екранованого виводу за замовчуванням.
    #[test]
    fn handles_non_ascii_untracked_filename() {
        let tmp = init_repo();
        fs::write(tmp.path().join("файл.txt"), "дані\n").unwrap();
        assert!(worktree_fingerprint(tmp.path()).is_some());
    }
}
