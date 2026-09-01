//! cspell:ignore gethostname
//!
//! Найнижчий рівень примітивів, спільних для ВСІХ mkdir-based локів у цьому
//! крейті ([`crate::tool_lock`], [`crate::lint_full_lock`]) — прямі
//! відповідники `os.hostname()`/`process.kill(pid, 0)`/`Date.now()` з
//! JS-сторони (`npm/scripts/utils/with-lock.mjs`). Локи різні (різні ключі,
//! директорії стану, пороги — `tool_lock.rs`'s doc-comment явно каже «інший
//! лок» про `lint-lock.mjs`), але системні виклики під ними ідентичні:
//! винесено сюди, щоб `unsafe`-код жив в одному місці, а не дублювався.

use std::process;
use std::time::SystemTime;

/// Імʼя хоста — еквівалент `os.hostname()` у JS-власнику лока. Порожній рядок
/// при збої: тоді перевірка живості PID просто не застосовується (лишається
/// stale-поріг), як і в JS для лока з чужого хоста.
pub(crate) fn hostname() -> String {
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

/// Чи процес живий — еквівалент `process.kill(pid, 0)` (`isPidAlive`,
/// `with-lock.mjs`).
pub(crate) fn is_pid_alive(pid: i32) -> bool {
    // SAFETY: `kill` із сигналом 0 нічого не надсилає, лише перевіряє
    // існування процесу й права на нього; побічних ефектів немає.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Поточний pid як `i32` — того самого типу, що зберігається в `owner.json`
/// (`process.pid` у JS завжди в межах `i32`).
pub(crate) fn current_pid() -> i32 {
    process::id() as i32
}

/// Мілісекунди від epoch — та сама шкала, що `Date.now()` в JS.
pub(crate) fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}
