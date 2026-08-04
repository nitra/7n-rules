//! cspell:ignore gethostname EEXIST ESRCH
//!
//! Міжпроцесний лок навколо встановлення зовнішнього тула — Rust-бік ТОГО
//! САМОГО лока, який бере JS (`installWithCrossProcessLock` у
//! `npm/scripts/lib/ensure-tool.mjs` поверх `withLock`, ADR 260716-1354).
//!
//! «Той самий» — буквально: збігаються ключ (`ensure-tool/<toolId>`),
//! обчислення каталогу стану (`<git-common-dir>/n-rules/<key>`, fallback
//! `node_modules/.cache/n-rules/<key>` — порт `resolveLockCacheDir`) і
//! протокол (`mkdir`-лок + `owner.json` + перевірка живості PID +
//! stale-поріг). Інакше два «локи» різних мов просто не бачили б один одного,
//! і паралельні `tools ensure` та `lint`, що дійшов до `ensureToolAsync`,
//! однаково тупцювали б по спільному `brew`/кешу бінарників.
//!
//! # Що НЕ портовано і чому
//!
//! Fingerprint-дедуп і `result.json` (`shouldDedup`) — у JS вони для цього
//! ключа вимкнені (`getFingerprint: () => null`): механізм призначений для
//! повторних CLI-команд на незмінному дереві, а тут потрібна сама лише
//! взаємовиключність. `onWaitTimeout: 'fail'` дзеркалиться — після
//! [`WAIT_TIMEOUT`] лок не береться «без локу», а повертається помилка.
//!
//! # Пастка: делегований install лока НЕ бере
//!
//! GitHub-Release шлях делегується в JS-`ensureToolAsync`, який САМ бере цей
//! лок. Якби Rust тримав лок під час делегації — самоблокування на 20 хв і
//! fail-closed. Тому [`acquire`] викликається лише навколо нативного
//! (brew/scoop) install (див. `tools_cmd`).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime};

/// Скільки чекати на звільнення лока перед fail-closed — `DEFAULTS.waitTimeout`
/// (`with-lock.mjs`), 20 хв.
const WAIT_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Вік лока, після якого він вважається протермінованим незалежно від PID —
/// `DEFAULTS.staleThreshold` (`with-lock.mjs`), 30 хв.
const STALE_THRESHOLD_MS: u128 = 30 * 60 * 1000;

/// Інтервал опитування зайнятого лока — `DEFAULTS.pollInterval`.
const POLL_INTERVAL: Duration = Duration::from_millis(1500);

/// Узятий лок; знімається (`rm -rf` каталогу) у [`Drop`], як `release()` у
/// `finally` JS-версії.
#[derive(Debug)]
pub struct ToolLock {
    lock_dir: PathBuf,
}

impl Drop for ToolLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.lock_dir);
    }
}

/// Каталог стану лока для ключа — порт `resolveLockCacheDir`
/// (`npm/scripts/utils/lock-cache-dir.mjs`): стан спільний для головного
/// checkout-у і всіх linked-worktree, бо `--git-common-dir` з будь-якого з
/// них вказує на той самий `.git`.
pub fn lock_cache_dir(key: &str, cwd: &Path) -> PathBuf {
    let common_dir = Command::new("git")
        .arg("rev-parse")
        .arg("--git-common-dir")
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|dir| !dir.is_empty());
    match common_dir {
        // `--git-common-dir` буває відносним (`.git` з кореня) і абсолютним
        // (linked worktree) — `join` дає той самий абсолютний шлях в обох
        // випадках, як `resolve(cwd, commonDir)` у JS.
        Some(dir) => cwd.join(dir).join("n-rules").join(key),
        None => cwd.join("node_modules/.cache/n-rules").join(key),
    }
}

/// Власник лока з `owner.json` — рівно ті поля, що пише JS.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct LockOwner {
    pid: i32,
    host: String,
    #[serde(rename = "startedAt")]
    started_at: u128,
    /// Завжди `null` для цього ключа (дедуп вимкнено) — поле тримається лише
    /// заради сумісності формату з JS-читачем.
    fingerprint: Option<String>,
    cwd: String,
}

/// Імʼя хоста — еквівалент `os.hostname()` у JS-власнику лока. Порожній рядок
/// при збої: тоді перевірка живості PID просто не застосовується (лишається
/// stale-поріг), як і в JS для лока з чужого хоста.
fn hostname() -> String {
    let mut buf = vec![0_u8; 256];
    // SAFETY: буфер валідний і достатньо великий; `gethostname` пише не більше
    // `buf.len()` байтів і сам термінує рядок нулем при успіху.
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    if rc != 0 {
        return String::new();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

/// Чи процес живий — еквівалент `process.kill(pid, 0)` (`isPidAlive`).
fn is_pid_alive(pid: i32) -> bool {
    // SAFETY: `kill` із сигналом 0 нічого не надсилає, лише перевіряє
    // існування процесу й права на нього; побічних ефектів немає.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Мілісекунди від epoch — та сама шкала, що `Date.now()` в `owner.json`.
fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Результат однієї спроби взяти лок — порт `tryAcquireOnce`.
enum Attempt {
    Acquired,
    /// Лок був битий/протермінований і прибраний — пробуй негайно ще раз.
    Retry,
    /// Лок тримає живий власник.
    Busy(LockOwner),
}

/// Одна спроба: `mkdir` лок-каталогу; при `EEXIST` — розбір `owner.json` і
/// вирішення «живий власник чи протермінований».
fn try_acquire_once(lock_dir: &Path, cwd: &Path) -> Result<Attempt, String> {
    let owner_file = lock_dir.join("owner.json");
    match fs::create_dir(lock_dir) {
        Ok(()) => {
            let owner = LockOwner {
                pid: std::process::id() as i32,
                host: hostname(),
                started_at: now_ms(),
                fingerprint: None,
                cwd: cwd.to_string_lossy().into_owned(),
            };
            let json = serde_json::to_string(&owner)
                .map_err(|error| format!("owner.json не серіалізується: {error}"))?;
            fs::write(&owner_file, json).map_err(|error| {
                format!("не вдалося записати {}: {error}", owner_file.display())
            })?;
            return Ok(Attempt::Acquired);
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(format!(
                "не вдалося створити лок {}: {error}",
                lock_dir.display()
            ))
        }
    }

    let Ok(text) = fs::read_to_string(&owner_file) else {
        // Битий/недописаний owner.json — прибираємо й пробуємо знову (JS так само).
        let _ = fs::remove_dir_all(lock_dir);
        return Ok(Attempt::Retry);
    };
    let Ok(owner) = serde_json::from_str::<LockOwner>(&text) else {
        let _ = fs::remove_dir_all(lock_dir);
        return Ok(Attempt::Retry);
    };

    let same_host = !owner.host.is_empty() && owner.host == hostname();
    let stale = now_ms().saturating_sub(owner.started_at) > STALE_THRESHOLD_MS
        || (same_host && !is_pid_alive(owner.pid));
    if !stale {
        return Ok(Attempt::Busy(owner));
    }
    eprintln!(
        "🧹 лок {}: знайдено застарілий — очищаю",
        lock_dir.display()
    );
    let _ = fs::remove_dir_all(lock_dir);
    Ok(Attempt::Retry)
}

/// Бере лок за ключем (`ensure-tool/<toolId>`), чекаючи на звільнення до
/// [`WAIT_TIMEOUT`]. Таймаут — помилка (fail-closed, як `onWaitTimeout: 'fail'`
/// у JS-виклику), а не «біжу без лока».
pub fn acquire(key: &str, cwd: &Path) -> Result<ToolLock, String> {
    let cache_dir = lock_cache_dir(key, cwd);
    let lock_dir = cache_dir.join("lock");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("не вдалося створити {}: {error}", cache_dir.display()))?;

    let deadline = Instant::now() + WAIT_TIMEOUT;
    let mut announced = false;
    loop {
        match try_acquire_once(&lock_dir, cwd)? {
            Attempt::Acquired => return Ok(ToolLock { lock_dir }),
            Attempt::Retry => continue,
            Attempt::Busy(owner) => {
                if !announced {
                    announced = true;
                    eprintln!("⏳ {key}: чекаю, лок тримає pid {}…", owner.pid);
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "{key}: не вдалося взяти лок за {} хв — fail-closed",
                WAIT_TIMEOUT.as_secs() / 60
            ));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use tempfile::TempDir;

    use super::*;

    /// Поза git-репо каталог стану падає на per-checkout `node_modules/.cache`
    /// — та сама гілка, що в JS, коли `git rev-parse` не спрацював.
    #[test]
    fn cache_dir_falls_back_outside_git_repo() {
        let tmp = TempDir::new().unwrap();
        let dir = lock_cache_dir("ensure-tool/hk", tmp.path());
        assert!(
            dir.ends_with("node_modules/.cache/n-rules/ensure-tool/hk"),
            "{dir:?}"
        );
    }

    /// У git-репо стан лягає під `<git-common-dir>/n-rules/<key>` — саме те,
    /// що робить лок спільним для всіх worktree одного репо.
    #[test]
    fn cache_dir_uses_git_common_dir() {
        let tmp = TempDir::new().unwrap();
        assert!(Command::new("git")
            .arg("init")
            .arg("-q")
            .current_dir(tmp.path())
            .status()
            .unwrap()
            .success());
        let dir = lock_cache_dir("ensure-tool/hk", tmp.path());
        assert!(dir.ends_with(".git/n-rules/ensure-tool/hk"), "{dir:?}");
    }

    /// Лок береться і знімається у `Drop`; повторне взяття після цього
    /// проходить одразу.
    #[test]
    fn lock_is_released_on_drop() {
        let tmp = TempDir::new().unwrap();
        let lock_dir = lock_cache_dir("ensure-tool/test-drop", tmp.path()).join("lock");
        {
            let _guard = acquire("ensure-tool/test-drop", tmp.path()).unwrap();
            assert!(lock_dir.is_dir());
        }
        assert!(!lock_dir.exists());
        let _again = acquire("ensure-tool/test-drop", tmp.path()).unwrap();
    }

    /// Лок від ЖИВОГО власника (наш власний pid) читається як `Busy` — це та
    /// гілка, що змушує другий процес чекати замість паралельного install.
    #[test]
    fn live_owner_makes_lock_busy() {
        let tmp = TempDir::new().unwrap();
        let lock_dir = tmp.path().join("lock");
        let _guard = try_acquire_once(&lock_dir, tmp.path()).unwrap();
        assert!(matches!(
            try_acquire_once(&lock_dir, tmp.path()).unwrap(),
            Attempt::Busy(_)
        ));
    }

    /// Лок від мертвого pid на цьому ж хості прибирається — інакше впалий
    /// install блокував би машину до stale-порогу.
    #[test]
    fn dead_owner_lock_is_reclaimed() {
        let tmp = TempDir::new().unwrap();
        let lock_dir = tmp.path().join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        let owner = LockOwner {
            // PID 1 живий завжди, тож беремо свідомо неможливий (`kill` дасть ESRCH).
            pid: i32::MAX,
            host: hostname(),
            started_at: now_ms(),
            fingerprint: None,
            cwd: tmp.path().to_string_lossy().into_owned(),
        };
        fs::write(
            lock_dir.join("owner.json"),
            serde_json::to_string(&owner).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            try_acquire_once(&lock_dir, tmp.path()).unwrap(),
            Attempt::Retry
        ));
        assert!(!lock_dir.exists());
    }

    /// Протермінований лок (старший за stale-поріг) прибирається навіть при
    /// живому pid — дзеркало другої половини умови `stale` в JS.
    #[test]
    fn expired_lock_is_reclaimed_even_with_live_pid() {
        let tmp = TempDir::new().unwrap();
        let lock_dir = tmp.path().join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        let owner = LockOwner {
            pid: std::process::id() as i32,
            host: hostname(),
            started_at: now_ms() - STALE_THRESHOLD_MS - 1,
            fingerprint: None,
            cwd: tmp.path().to_string_lossy().into_owned(),
        };
        fs::write(
            lock_dir.join("owner.json"),
            serde_json::to_string(&owner).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            try_acquire_once(&lock_dir, tmp.path()).unwrap(),
            Attempt::Retry
        ));
    }

    /// Формат `owner.json` мусить лишатись читабельним для JS-боку: ключі
    /// саме ті, що читає `tryAcquireOnce` (`pid`/`host`/`startedAt`).
    #[test]
    fn owner_json_keeps_js_field_names() {
        let tmp = TempDir::new().unwrap();
        let lock_dir = tmp.path().join("lock");
        let _guard = try_acquire_once(&lock_dir, tmp.path()).unwrap();
        let text = fs::read_to_string(lock_dir.join("owner.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(value.get("pid").is_some());
        assert!(value.get("host").is_some());
        assert!(value.get("startedAt").is_some());
        assert!(value.get("cwd").is_some());
    }
}
