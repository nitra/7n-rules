//! cspell:ignore EEXIST
//!
//! Глобальна черга `n-rules lint --full` — точний порт
//! `npm/scripts/lib/lint-surface/lint-lock.mjs` +
//! `npm/scripts/lib/lint-surface/progress.mjs`'s `renderProgressLine`
//! (клас A, крок 4 плану `docs/plans/2026-08-31-full-rust-migration-plan.md`,
//! §2.141 реєстру). Портовано ОДНИМ блоком, бо `renderProgressLine` —
//! міжпроцесний контракт: [`render_wait_line`] тут малює прогрес ЧУЖОГО
//! (owner-)прогону з того самого формату `progress.json`, що пише
//! [`ProgressPublisher`] — розбивка на два окремі порти розірвала б
//! контракт (§2.138 реєстру, застереження при плануванні кроку 4).
//!
//! У кожен момент на машині виконується щонайбільше ОДИН full-прогін;
//! наступні чекають у черзі з видимістю (позиція, решта черги, живий
//! прогрес-бар активного прогону — читає `progress.json`). Дельта/scoped/
//! `--no-fix` прогони лока НЕ беруть (короткі, без черги).
//!
//! # Спільний стан у [`global_cache_dir`]
//!
//! - `lock/owner.json` — власник лока (`pid`/`host`/`startedAt`/
//!   `fingerprint`/`cwd`, той самий формат, що [`crate::tool_lock`],
//!   структура [`crate::tool_lock::LockOwner`] спільна для обох локів);
//! - `queue/<enqueuedAt>-<pid>.json` — реєстрація процесів у черзі;
//! - `progress.json` — знімок прогресу активного прогону;
//! - `result.json` — TTL-дедуп: ідентичний повтор `--full` на незміненому
//!   дереві протягом `ttl_ms` пропускається (CLAUDE.md: «Ідентичний повтор
//!   --full на незміненому дереві дедуплюється»).
//!
//! # Що НЕ портовано цим кроком і чому
//!
//! - **Сигнальний cleanup (`SIGINT`/`SIGTERM` → release перед re-raise).**
//!   JS реєструє `process.once('SIGINT'|'SIGTERM', release-and-rekill)`
//!   навколо `runFn` (`with-lock.mjs:172-177`). Тут лок звільняється через
//!   [`Drop`] (як [`crate::tool_lock::ToolLock`]) — гарантія тримається на
//!   нормальному unwind/поверненні, АЛЕ НЕ на дефолтній обробці OS-сигналу
//!   (Rust не unwind-ить на SIGINT за замовчуванням, і `main` тут не має
//!   свого обробника). Явно назване, а не приховане: доки в native-шляху
//!   немає РЕАЛЬНОГО (мутуючого) `--full`-виконавця — цей модуль без
//!   живого споживача (`lint_cmd.rs`'s detect-only native-шлях нічого не
//!   мутує і чергу свідомо не бере, той самий доккомент модуля) — і ризик
//!   не матеріалізується. Якщо/коли native `--full` стане виконавчим,
//!   сигнальний обробник (наприклад через crate `signal-hook`) — окрема
//!   робота, не мовчазний пропуск.
//! - **Живий TTY `MultiBar`** (`progress.mjs`'s `cli-progress`) —
//!   `crates/rules-core/src/lint_progress.rs`'s доккомент.

// Без живого CLI-споживача цим кроком (доккомент модуля): `lint_cmd.rs`'s
// native `--full`-шлях лишається detect-only і свідомо НЕ бере чергу
// («нічого не мутує» — та сама теза, що вже задокументована в
// `lint_cmd.rs`'s «Свідомі розбіжності»). Публічне API готове й покрите
// тестами до моменту, коли native `--full` стане виконавчим — той самий
// патерн, що `codegen_opa_wrapper` (клас A без Rust-споживача, §2.138
// реєстру).
#![allow(dead_code)]

use std::fs;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rules_core::lint_progress::{render_progress_line, ProgressDetail, ProgressSnapshot};
use rules_core::worktree_fingerprint::worktree_fingerprint;

use crate::lock_sys::{current_pid, hostname, is_pid_alive, now_ms};
use crate::tool_lock::LockOwner;

/// Дедлайн очікування в черзі — `WAIT_TIMEOUT_WITH_COVERAGE_MS`
/// (`lint-lock.mjs:55`): full-прогін завжди включає coverage-концерн
/// (мутаційне тестування), тож черга чекає з інженерним запасом ×4 понад
/// базові 45 хв.
const WAIT_TIMEOUT_MS: u64 = 4 * 45 * 60_000;

/// Поріг time-based staleness — `STALE_THRESHOLD_MS` (`lint-lock.mjs:58`).
const STALE_THRESHOLD_MS: u128 = 6 * 3_600_000;

/// Інтервал опитування зайнятого лока — `DEFAULTS.pollInterval` (`with-lock.mjs`).
const POLL_INTERVAL_MS: u64 = 1500;

/// TTL дедуплікації ідентичного повтору на незміненому дереві —
/// `DEFAULTS.ttl` (`with-lock.mjs`, 10 хв).
const TTL_MS: u64 = 600_000;

/// Мінімальний інтервал між записами `progress.json` — `PUBLISH_MIN_INTERVAL_MS`
/// (`lint-lock.mjs:61`).
const PUBLISH_MIN_INTERVAL_MS: u64 = 500;

/// Інтервал append-рядків черги в не-TTY режимі — `NON_TTY_WAIT_LOG_INTERVAL_MS`
/// (`lint-lock.mjs:64`).
const NON_TTY_WAIT_LOG_INTERVAL_MS: u128 = 10_000;

/// Знімок прогресу вважається живим не довше цього — `PROGRESS_FRESH_MS`
/// (`lint-lock.mjs:67`).
const PROGRESS_FRESH_MS: i64 = 60_000;

/// Версія контракту published snapshot-а — `PROGRESS_SNAPSHOT_VERSION`
/// (`lint-lock.mjs:70`).
const PROGRESS_SNAPSHOT_VERSION: u32 = 2;

/// Частота heartbeat owner-а — `PUBLISH_HEARTBEAT_INTERVAL_MS` (`lint-lock.mjs:73`).
const PUBLISH_HEARTBEAT_INTERVAL_MS: u64 = 5000;

/// Мінімум завершених targets для обережного ETA — `ETA_MIN_COMPLETED_TARGETS`
/// (`lint-lock.mjs:76`).
const ETA_MIN_COMPLETED_TARGETS: u64 = 3;

/// Machine-wide директорія стану лока/черги — порт `GLOBAL_CACHE_DIR`
/// (`lint-lock.mjs:41`): `os.tmpdir()/n-rules/lint-full`, спільна для всіх
/// репо й worktree на цій машині (НЕ `<git-common-dir>`, на відміну від
/// [`crate::tool_lock`]).
pub fn global_cache_dir() -> PathBuf {
    std::env::temp_dir().join("n-rules").join("lint-full")
}

/// Осі виклику lint, що визначають fingerprint дедуп-ключа — порт
/// параметра `variant` (`lint-lock.mjs`).
#[derive(Debug, Clone)]
pub struct LintLockVariant {
    pub cwd: String,
    pub full: bool,
    pub rules: Vec<String>,
    pub no_fix: bool,
}

/// Fingerprint для TTL-дедуплікації — точний порт `lintLockFingerprint`
/// (`lint-lock.mjs:88-96`). `None` (дедуп вимкнено, черга все одно
/// працює), коли `--cwd` не збігається з процесним cwd, або дерево не
/// git-репо.
pub fn lint_lock_fingerprint(
    variant: &LintLockVariant,
    process_cwd: &str,
    get_tree_fp: impl FnOnce() -> Option<String>,
) -> Option<String> {
    if variant.cwd != process_cwd {
        return None;
    }
    let tree_fp = get_tree_fp()?;
    let mut rules_sorted = variant.rules.clone();
    rules_sorted.sort();
    let rules_json = serde_json::to_string(&rules_sorted).ok()?;
    let cwd_json = serde_json::to_string(&variant.cwd).ok()?;
    // Порядок ключів — той самий, що об'єктний літерал JS (`{ cwd, full,
    // noFix, rules }`), бо `JSON.stringify` серіалізує в порядку вставки:
    // тримати ідентичним, а не покладатись на serde_json (яка сортує
    // мапи), щоб fingerprint лишався стабільним артефактом незалежно від
    // реалізації.
    let axes = format!(
        "{{\"cwd\":{cwd_json},\"full\":{},\"noFix\":{},\"rules\":{rules_json}}}",
        variant.full, variant.no_fix
    );
    let raw = format!("{tree_fp}\n{axes}");
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    Some(hex)
}

/// Fingerprint дерева поточного `cwd` — дефолтний `get_tree_fp` для
/// [`lint_lock_fingerprint`] у продукційному коді (тести інʼєктують
/// константу).
pub fn default_tree_fingerprint(cwd: &Path) -> impl FnOnce() -> Option<String> + '_ {
    move || worktree_fingerprint(cwd)
}

// ---------------------------------------------------------------------------
// Progress publisher
// ---------------------------------------------------------------------------

/// Знятий JSON-запис `progress.json` — точний порт `record` (`lint-lock.mjs:132-147`).
#[derive(Debug, Clone, serde::Serialize)]
struct ProgressRecord {
    version: u32,
    pid: i32,
    cwd: String,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
    #[serde(rename = "heartbeatAt")]
    heartbeat_at: i64,
    phase: String,
    step: Option<String>,
    done: u64,
    total: u64,
    found: u64,
    fixed: u64,
    current: String,
    detail: Option<ProgressDetail>,
    #[serde(rename = "etaMs")]
    eta_ms: Option<i64>,
}

/// Знімок, який читає спостерігач з `progress.json` — точний порт полів,
/// які використовує `renderWaitLine`/`readOwnerProgress`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OwnerProgressSnapshot {
    pub version: u32,
    pub pid: i32,
    pub done: u64,
    pub total: u64,
    pub found: u64,
    pub fixed: u64,
    pub current: String,
    pub detail: Option<ProgressDetail>,
    #[serde(rename = "etaMs")]
    pub eta_ms: Option<i64>,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(rename = "heartbeatAt")]
    pub heartbeat_at: i64,
}

/// Опції [`ProgressPublisher::new`] — override-и для тестів, той самий
/// набір, що `createProgressPublisher(opts)`.
pub struct ProgressPublisherOptions {
    pub file: PathBuf,
    pub min_interval_ms: u64,
    pub heartbeat_interval_ms: u64,
    /// Ін'єкція годинника (мс від epoch) — тести передають фейковий лічильник.
    pub now: Arc<dyn Fn() -> i64 + Send + Sync>,
}

impl ProgressPublisherOptions {
    pub fn with_file(file: PathBuf) -> Self {
        Self {
            file,
            min_interval_ms: PUBLISH_MIN_INTERVAL_MS,
            heartbeat_interval_ms: PUBLISH_HEARTBEAT_INTERVAL_MS,
            now: Arc::new(|| now_ms() as i64),
        }
    }
}

#[derive(Default)]
struct PublisherState {
    last_write_at: i64,
    last_snap: Option<ProgressRecord>,
    phase_started_at: i64,
}

/// Publisher прогресу активного прогону — точний порт `createProgressPublisher`
/// (`lint-lock.mjs:105-176`). Heartbeat-thread періодично republish-ить
/// останній знімок (owner лишається видимим для процесу в черзі навіть
/// між реальними оновленнями) — еквівалент `setInterval(...).unref()`.
pub struct ProgressPublisher {
    file: PathBuf,
    min_interval_ms: i64,
    now: Arc<dyn Fn() -> i64 + Send + Sync>,
    state: Arc<Mutex<PublisherState>>,
    stop_flag: Arc<AtomicBool>,
    heartbeat_thread: Option<thread::JoinHandle<()>>,
}

impl ProgressPublisher {
    pub fn new(opts: ProgressPublisherOptions) -> Self {
        let state: Arc<Mutex<PublisherState>> = Arc::new(Mutex::new(PublisherState::default()));
        let stop_flag = Arc::new(AtomicBool::new(false));

        let heartbeat_thread = if opts.heartbeat_interval_ms > 0 {
            let state = Arc::clone(&state);
            let stop_flag = Arc::clone(&stop_flag);
            let file = opts.file.clone();
            let interval = Duration::from_millis(opts.heartbeat_interval_ms);
            Some(thread::spawn(move || {
                while !stop_flag.load(Ordering::Relaxed) {
                    thread::sleep(interval);
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }
                    let mut guard = state.lock().unwrap();
                    if let Some(last) = guard.last_snap.clone() {
                        publish_heartbeat(&file, &mut guard, last);
                    }
                }
            }))
        } else {
            None
        };

        Self {
            file: opts.file,
            min_interval_ms: opts.min_interval_ms as i64,
            now: opts.now,
            state,
            stop_flag,
            heartbeat_thread,
        }
    }

    /// Throttled оновлення — точний порт `onUpdate` (`lint-lock.mjs:161-166`).
    pub fn on_update(&self, snap: &ProgressSnapshot) {
        let at = (self.now)();
        let mut guard = self.state.lock().unwrap();
        if at - guard.last_write_at < self.min_interval_ms {
            return;
        }
        guard.last_write_at = at;
        let record = build_record(&mut guard, at, snap, false);
        write_record_best_effort(&self.file, &record);
        guard.last_snap = Some(record);
    }

    /// Зупиняє heartbeat і прибирає стан-файл — точний порт `stop`
    /// (`lint-lock.mjs:167-175`, best-effort: помилка видалення ігнорується).
    pub fn stop(mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.heartbeat_thread.take() {
            let _ = handle.join();
        }
        let _ = fs::remove_file(&self.file);
    }
}

/// Складає й пише heartbeat-запис із останнього знімка — той самий шлях
/// `publish(lastSnap, true)`, викликаний з таймера (`lint-lock.mjs:156-158`).
fn publish_heartbeat(file: &Path, guard: &mut PublisherState, last: ProgressRecord) {
    let at = now_ms() as i64;
    let snap = ProgressSnapshot {
        done: last.done,
        total: last.total,
        found: last.found,
        fixed: last.fixed,
        current: last.current.clone(),
        unit_label: "концернів".to_string(),
        with_fixed: true,
        detail: last.detail.clone(),
    };
    let record = build_record(guard, at, &snap, true);
    write_record_best_effort(file, &record);
    guard.last_snap = Some(record);
}

/// Обчислює новий `ProgressRecord` — точний порт тіла `publish`
/// (`lint-lock.mjs:120-148`), винесений в окрему функцію, щоб і
/// [`ProgressPublisher::on_update`], і heartbeat-гілка йшли одним шляхом.
fn build_record(
    guard: &mut PublisherState,
    at: i64,
    snap: &ProgressSnapshot,
    heartbeat: bool,
) -> ProgressRecord {
    let detail_label = snap.detail.as_ref().map(|d| d.label.clone());
    if !heartbeat
        && (guard.last_snap.is_none()
            || guard.last_snap.as_ref().map(|s| &s.current) != Some(&snap.current)
            || guard.last_snap.as_ref().and_then(|s| s.step.clone()) != detail_label)
    {
        guard.phase_started_at = at;
    }
    let completed = snap.detail.as_ref().map(|d| d.done).unwrap_or(0);
    let total_detail = snap.detail.as_ref().map(|d| d.total).unwrap_or(0);
    let remaining = total_detail.saturating_sub(completed);
    let elapsed = if guard.phase_started_at > 0 { at - guard.phase_started_at } else { 0 };
    let eta_ms = if !heartbeat
        && snap.detail.is_some()
        && completed >= ETA_MIN_COMPLETED_TARGETS
        && remaining > 0
        && elapsed > 0
    {
        Some(((elapsed as f64 / completed as f64) * remaining as f64).round() as i64)
    } else {
        guard.last_snap.as_ref().and_then(|s| s.eta_ms)
    };
    ProgressRecord {
        version: PROGRESS_SNAPSHOT_VERSION,
        pid: current_pid(),
        cwd: std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        updated_at: if heartbeat { guard.last_snap.as_ref().map(|s| s.updated_at).unwrap_or(at) } else { at },
        heartbeat_at: at,
        phase: snap.current.clone(),
        step: detail_label,
        done: snap.done,
        total: snap.total,
        found: snap.found,
        fixed: snap.fixed,
        current: snap.current.clone(),
        detail: snap.detail.clone(),
        eta_ms,
    }
}

/// Best-effort запис — помилка ігнорується (`lint-lock.mjs:149-154`: «без
/// стан-файлу процеси в черзі просто не побачать бар»).
fn write_record_best_effort(file: &Path, record: &ProgressRecord) {
    if let Some(parent) = file.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(json) = serde_json::to_string(record) {
        let _ = fs::write(file, json);
    }
}

/// Читає знімок прогресу активного прогону — точний порт `readOwnerProgress`
/// (`lint-lock.mjs:216-226`): `None`, якщо файла нема, він належить не
/// власнику лока, версія/поле неповні, або запис застарілий.
pub fn read_owner_progress(owner_pid: i32, progress_file: &Path) -> Option<OwnerProgressSnapshot> {
    let text = fs::read_to_string(progress_file).ok()?;
    let snap: OwnerProgressSnapshot = serde_json::from_str(&text).ok()?;
    if snap.pid != owner_pid {
        return None;
    }
    if snap.version != PROGRESS_SNAPSHOT_VERSION {
        return None;
    }
    if now_ms() as i64 - snap.heartbeat_at > PROGRESS_FRESH_MS {
        return None;
    }
    Some(snap)
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/// Запис у черзі — точний порт полів `queue/<enqueuedAt>-<pid>.json`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QueueEntry {
    pub pid: i32,
    pub cwd: String,
    #[serde(rename = "enqueuedAt")]
    pub enqueued_at: u128,
}

/// Список живих учасників черги у порядку постановки — точний порт
/// `listQueue` (`lint-lock.mjs:184-207`): записи мертвих PID прибираються
/// по дорозі (best-effort).
fn list_queue(queue_dir: &Path) -> Vec<QueueEntry> {
    let mut entries = Vec::new();
    let Ok(read_dir) = fs::read_dir(queue_dir) else {
        return entries;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let parsed = fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str::<QueueEntry>(&text).ok());
        match parsed {
            Some(e) if is_pid_alive(e.pid) => entries.push(e),
            _ => {
                let _ = fs::remove_file(&path);
            }
        }
    }
    entries.sort_by_key(|e| e.enqueued_at);
    entries
}

/// Базове імʼя шляху — еквівалент `path.basename` для `renderWaitLine`.
fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Форматує короткий ETA — точний порт `formatEta` (`lint-lock.mjs:258-262`).
fn format_eta(ms: i64) -> String {
    let seconds = (ms as f64 / 1000.0).round().max(1.0) as i64;
    if seconds < 60 {
        format!("{seconds} с")
    } else {
        format!("{} хв", (seconds as f64 / 60.0).ceil() as i64)
    }
}

/// Рядок стану черги — точний порт `renderWaitLine` (`lint-lock.mjs:236-251`).
pub fn render_wait_line(owner: &LockOwner, queue: &[QueueEntry], snap: Option<&OwnerProgressSnapshot>) -> String {
    let my_pid = current_pid();
    let my_idx = queue.iter().position(|e| e.pid == my_pid);
    let pos = my_idx.unwrap_or(queue.len()) + 1;
    let owner_dir = if owner.cwd.is_empty() { String::new() } else { format!(" ({})", basename(&owner.cwd)) };
    let eta = match snap {
        Some(s) if s.eta_ms.is_some() && now_ms() as i64 - s.updated_at <= PROGRESS_FRESH_MS => {
            format!(" · ETA ≈ {}", format_eta(s.eta_ms.unwrap()))
        }
        _ => String::new(),
    };
    let bar = match snap {
        Some(s) => {
            let progress_snap = ProgressSnapshot {
                done: s.done,
                total: s.total,
                found: s.found,
                fixed: s.fixed,
                current: s.current.clone(),
                unit_label: "концернів".to_string(),
                with_fixed: true,
                detail: s.detail.clone(),
            };
            format!(" · {}{eta}", render_progress_line(&progress_snap))
        }
        None => String::new(),
    };
    let others: Vec<String> = queue
        .iter()
        .filter(|e| e.pid != my_pid)
        .map(|e| format!("pid {} ({})", e.pid, basename(&e.cwd)))
        .collect();
    let tail = if others.is_empty() { String::new() } else { format!(" · чекають: {}", others.join(", ")) };
    format!(
        "⏳ lint --full у черзі #{pos}/{} · працює pid {}{owner_dir}{bar}{tail}",
        pos.max(queue.len()),
        owner.pid
    )
}

// ---------------------------------------------------------------------------
// Lock acquisition
// ---------------------------------------------------------------------------

/// Узятий full-лок; знімається (`rm -rf` каталогу) у [`Drop`] — той самий
/// патерн, що [`crate::tool_lock::ToolLock`].
struct FullLintLockGuard {
    lock_dir: PathBuf,
}

impl Drop for FullLintLockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.lock_dir);
    }
}

enum Attempt {
    Acquired(FullLintLockGuard),
    Retry,
    Busy(LockOwner),
}

fn try_acquire_once(lock_dir: &Path, cwd: &str, fingerprint: Option<String>) -> Result<Attempt, String> {
    let owner_file = lock_dir.join("owner.json");
    match fs::create_dir(lock_dir) {
        Ok(()) => {
            let owner = LockOwner { pid: current_pid(), host: hostname(), started_at: now_ms(), fingerprint, cwd: cwd.to_string() };
            let json = serde_json::to_string(&owner).map_err(|e| format!("owner.json не серіалізується: {e}"))?;
            fs::write(&owner_file, json).map_err(|e| format!("не вдалося записати {}: {e}", owner_file.display()))?;
            return Ok(Attempt::Acquired(FullLintLockGuard { lock_dir: lock_dir.to_path_buf() }));
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("не вдалося створити лок {}: {error}", lock_dir.display())),
    }

    let Ok(text) = fs::read_to_string(&owner_file) else {
        let _ = fs::remove_dir_all(lock_dir);
        return Ok(Attempt::Retry);
    };
    let Ok(owner) = serde_json::from_str::<LockOwner>(&text) else {
        let _ = fs::remove_dir_all(lock_dir);
        return Ok(Attempt::Retry);
    };
    let same_host = !owner.host.is_empty() && owner.host == hostname();
    let stale = now_ms().saturating_sub(owner.started_at) > STALE_THRESHOLD_MS || (same_host && !is_pid_alive(owner.pid));
    if !stale {
        return Ok(Attempt::Busy(owner));
    }
    eprintln!("🧹 lint --full: знайдено застарілий лок — очищаю");
    let _ = fs::remove_dir_all(lock_dir);
    Ok(Attempt::Retry)
}

/// `result.json` для TTL-дедупу — точний порт запису, який пише `withLock`
/// після успішного `runFn` (`with-lock.mjs:182`).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct LockResult {
    #[serde(rename = "finishedAt")]
    finished_at: u128,
    #[serde(rename = "exitCode")]
    exit_code: i32,
    fingerprint: Option<String>,
}

/// Чи можна пропустити повторний прогін — точний порт `shouldDedup`
/// (`with-lock.mjs:50-54`).
fn should_dedup(result: &LockResult, fingerprint: &Option<String>, ttl_ms: u64) -> bool {
    if result.exit_code != 0 {
        return false;
    }
    let Some(fp) = fingerprint else { return false };
    if result.fingerprint.as_deref() != Some(fp.as_str()) {
        return false;
    }
    now_ms().saturating_sub(result.finished_at) < ttl_ms as u128
}

/// Опції [`with_global_lint_lock`] — override-и для тестів, дзеркало
/// параметра `opts` (`withGlobalLintLock`/`withLock`).
pub struct GlobalLintLockOptions {
    pub cache_dir: PathBuf,
    pub queue_dir: PathBuf,
    pub progress_file: PathBuf,
    pub ttl_ms: u64,
    pub stale_threshold_ms: u128,
    pub wait_timeout_ms: u64,
    pub poll_interval_ms: u64,
    pub fingerprint: Option<String>,
    pub is_tty: bool,
    pub log: Arc<dyn Fn(&str) + Send + Sync>,
}

impl GlobalLintLockOptions {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            queue_dir: cache_dir.join("queue"),
            progress_file: cache_dir.join("progress.json"),
            cache_dir,
            ttl_ms: TTL_MS,
            stale_threshold_ms: STALE_THRESHOLD_MS,
            wait_timeout_ms: WAIT_TIMEOUT_MS,
            poll_interval_ms: POLL_INTERVAL_MS,
            fingerprint: None,
            is_tty: std::io::stderr().is_terminal(),
            log: Arc::new(|s| eprint!("{s}")),
        }
    }
}

/// Виконує `run_fn` під глобальним локом full-прогонів — точний порт
/// `withGlobalLintLock` (`lint-lock.mjs:316-332`) + серцевина `withLock`
/// (`with-lock.mjs:107-190`), спеціалізована під `onWaitTimeout: 'fail'`
/// (лишається fail-closed завжди, не параметризовано — той самий контракт,
/// що JS-виклик для цього ключа).
///
/// Non-full варіант виконується одразу, без лока й без створення
/// `cache_dir` — [`LintLockVariant::full`] гейтує все.
pub fn with_global_lint_lock(
    variant: &LintLockVariant,
    run_fn: impl FnOnce() -> i32,
    opts: GlobalLintLockOptions,
) -> Result<i32, String> {
    if !variant.full {
        return Ok(run_fn());
    }

    fs::create_dir_all(&opts.cache_dir).map_err(|e| format!("не вдалося створити {}: {e}", opts.cache_dir.display()))?;
    let lock_dir = opts.cache_dir.join("lock");
    let result_file = opts.cache_dir.join("result.json");

    let deadline = Instant::now() + Duration::from_millis(opts.wait_timeout_ms);
    let mut waiting = false;
    let mut queue_file: Option<PathBuf> = None;
    let mut last_append_at: u128 = 0;

    let end_wait = |waiting: &mut bool, queue_file: &Option<PathBuf>, opts: &GlobalLintLockOptions| {
        if !*waiting {
            return;
        }
        *waiting = false;
        if let Some(qf) = queue_file {
            let _ = fs::remove_file(qf);
        }
        if opts.is_tty {
            (opts.log)("\r\u{1B}[2K");
        }
    };

    let guard = loop {
        if Instant::now() >= deadline {
            end_wait(&mut waiting, &queue_file, &opts);
            return Err(format!(
                "lint --full: не вдалося взяти лок за {} хв — fail-closed",
                opts.wait_timeout_ms / 60_000
            ));
        }
        match try_acquire_once(&lock_dir, &variant.cwd, opts.fingerprint.clone())? {
            Attempt::Acquired(guard) => {
                end_wait(&mut waiting, &queue_file, &opts);
                break guard;
            }
            Attempt::Retry => continue,
            Attempt::Busy(owner) => {
                if !waiting {
                    waiting = true;
                    let qf = opts.queue_dir.join(format!("{}-{}", now_ms(), current_pid()));
                    let qf = qf.with_extension("json");
                    if fs::create_dir_all(&opts.queue_dir).is_ok() {
                        let entry = QueueEntry { pid: current_pid(), cwd: variant.cwd.clone(), enqueued_at: now_ms() };
                        if let Ok(json) = serde_json::to_string(&entry) {
                            let _ = fs::write(&qf, json);
                        }
                    }
                    queue_file = Some(qf);
                    last_append_at = 0;
                }
                let line = render_wait_line(&owner, &list_queue(&opts.queue_dir), read_owner_progress(owner.pid, &opts.progress_file).as_ref());
                if opts.is_tty {
                    (opts.log)(&format!("\r\u{1B}[2K{line}"));
                } else {
                    let now = now_ms();
                    if last_append_at == 0 || now.saturating_sub(last_append_at) >= NON_TTY_WAIT_LOG_INTERVAL_MS {
                        last_append_at = now;
                        (opts.log)(&format!("{line}\n"));
                    }
                }
                thread::sleep(Duration::from_millis(opts.poll_interval_ms));
            }
        }
    };

    if let Ok(text) = fs::read_to_string(&result_file) {
        if let Ok(result) = serde_json::from_str::<LockResult>(&text) {
            if should_dedup(&result, &opts.fingerprint, opts.ttl_ms) {
                drop(guard);
                return Ok(0);
            }
        }
    }

    let code = run_fn();
    let result = LockResult { finished_at: now_ms(), exit_code: code, fingerprint: opts.fingerprint.clone() };
    if let Ok(json) = serde_json::to_string(&result) {
        let _ = fs::write(&result_file, json);
    }
    drop(guard);
    Ok(code)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn variant(cwd: &str) -> LintLockVariant {
        LintLockVariant { cwd: cwd.to_string(), full: true, rules: vec![], no_fix: false }
    }

    const TREE_FP: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn fingerprint_null_when_cwd_mismatches_process_cwd() {
        assert!(lint_lock_fingerprint(&variant("/somewhere/else"), "/actual/cwd", || Some(TREE_FP.to_string())).is_none());
    }

    #[test]
    fn fingerprint_null_outside_git_repo() {
        assert!(lint_lock_fingerprint(&variant("/repo"), "/repo", || None).is_none());
    }

    #[test]
    fn fingerprint_stable_for_same_variant_and_tree() {
        let a = lint_lock_fingerprint(&variant("/repo"), "/repo", || Some(TREE_FP.to_string())).unwrap();
        let b = lint_lock_fingerprint(&variant("/repo"), "/repo", || Some(TREE_FP.to_string())).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn fingerprint_ignores_rules_order() {
        let mut v1 = variant("/repo");
        v1.rules = vec!["js".into(), "text".into()];
        let mut v2 = variant("/repo");
        v2.rules = vec!["text".into(), "js".into()];
        let a = lint_lock_fingerprint(&v1, "/repo", || Some(TREE_FP.to_string())).unwrap();
        let b = lint_lock_fingerprint(&v2, "/repo", || Some(TREE_FP.to_string())).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn fingerprint_changes_with_no_fix_or_rules() {
        let base = lint_lock_fingerprint(&variant("/repo"), "/repo", || Some(TREE_FP.to_string())).unwrap();
        let mut v_no_fix = variant("/repo");
        v_no_fix.no_fix = true;
        let with_no_fix = lint_lock_fingerprint(&v_no_fix, "/repo", || Some(TREE_FP.to_string())).unwrap();
        assert_ne!(base, with_no_fix);

        let mut v_rules = variant("/repo");
        v_rules.rules = vec!["js".into()];
        let with_rules = lint_lock_fingerprint(&v_rules, "/repo", || Some(TREE_FP.to_string())).unwrap();
        assert_ne!(base, with_rules);
    }

    #[test]
    fn fingerprint_changes_with_different_tree() {
        let a = lint_lock_fingerprint(&variant("/repo"), "/repo", || Some(TREE_FP.to_string())).unwrap();
        let b = lint_lock_fingerprint(&variant("/repo"), "/repo", || Some("b".repeat(64))).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn non_full_variant_runs_immediately_without_cache_dir() {
        let tmp = TempDir::new().unwrap();
        let cache_dir = tmp.path().join("lock-state");
        let mut v = variant("/repo");
        v.full = false;
        let mut opts = GlobalLintLockOptions::new(cache_dir.clone());
        opts.log = Arc::new(|_| {});
        let code = with_global_lint_lock(&v, || 5, opts).unwrap();
        assert_eq!(code, 5);
        assert!(!cache_dir.exists());
    }

    #[test]
    fn sequential_full_runs_release_lock() {
        let tmp = TempDir::new().unwrap();
        let cache_dir = tmp.path().join("lock-state");
        let v = variant("/repo");
        let opts1 = GlobalLintLockOptions { fingerprint: None, log: Arc::new(|_| {}), ..GlobalLintLockOptions::new(cache_dir.clone()) };
        assert_eq!(with_global_lint_lock(&v, || 0, opts1).unwrap(), 0);
        let opts2 = GlobalLintLockOptions { fingerprint: None, log: Arc::new(|_| {}), ..GlobalLintLockOptions::new(cache_dir) };
        assert_eq!(with_global_lint_lock(&v, || 42, opts2).unwrap(), 42);
    }

    #[test]
    fn dead_owner_lock_is_reclaimed_immediately() {
        let tmp = TempDir::new().unwrap();
        let cache_dir = tmp.path().join("lock-state");
        let lock_dir = cache_dir.join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        let owner = LockOwner { pid: 999_999_999, host: hostname(), started_at: now_ms(), fingerprint: None, cwd: "/repo".into() };
        fs::write(lock_dir.join("owner.json"), serde_json::to_string(&owner).unwrap()).unwrap();
        let v = variant("/repo");
        let opts = GlobalLintLockOptions { fingerprint: None, log: Arc::new(|_| {}), ..GlobalLintLockOptions::new(cache_dir) };
        let code = with_global_lint_lock(&v, || 7, opts).unwrap();
        assert_eq!(code, 7);
    }

    #[test]
    fn foreign_live_owner_waits_then_fails_closed_with_queue_line() {
        let tmp = TempDir::new().unwrap();
        let cache_dir = tmp.path().join("lock-state");
        let lock_dir = cache_dir.join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        let owner = LockOwner { pid: current_pid(), host: "other-host".into(), started_at: now_ms(), fingerprint: None, cwd: "/some/repo".into() };
        fs::write(lock_dir.join("owner.json"), serde_json::to_string(&owner).unwrap()).unwrap();

        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let lines_clone = Arc::clone(&lines);
        let v = variant("/repo");
        let mut opts = GlobalLintLockOptions::new(cache_dir);
        opts.wait_timeout_ms = 60;
        opts.poll_interval_ms = 10;
        opts.fingerprint = None;
        opts.is_tty = false;
        opts.log = Arc::new(move |s| lines_clone.lock().unwrap().push(s.to_string()));

        let result = with_global_lint_lock(&v, || 0, opts);
        assert!(result.is_err(), "мусить fail-closed на таймауті");
        let joined = lines.lock().unwrap().join("");
        assert!(joined.contains("lint --full у черзі #1/1"), "{joined}");
        assert!(joined.contains(&format!("працює pid {} (repo)", current_pid())), "{joined}");
    }

    #[test]
    fn progress_publisher_throttles_and_stop_removes_file() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("progress.json");
        let opts = ProgressPublisherOptions { file: file.clone(), min_interval_ms: 60_000, heartbeat_interval_ms: 0, now: Arc::new(|| now_ms() as i64) };
        let publisher = ProgressPublisher::new(opts);
        publisher.on_update(&ProgressSnapshot::new(3, 12, 5, 1, "js/eslint"));
        let text = fs::read_to_string(&file).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["pid"], current_pid());
        assert_eq!(value["done"], 3);
        assert_eq!(value["total"], 12);
        assert_eq!(value["found"], 5);
        assert_eq!(value["fixed"], 1);
        assert_eq!(value["current"], "js/eslint");
        assert!(value["updatedAt"].as_i64().unwrap() > 0);

        // другий update у межах minIntervalMs — файл не перезаписується
        publisher.on_update(&ProgressSnapshot::new(4, 12, 6, 2, "text/oxfmt"));
        let value2: serde_json::Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(value2["done"], 3);

        publisher.stop();
        assert!(!file.exists());
    }

    #[test]
    fn progress_publisher_versioned_snapshot_has_phase_detail_and_eta() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("progress.json");
        let now = Arc::new(Mutex::new(10_000_i64));
        let now_clone = Arc::clone(&now);
        let opts = ProgressPublisherOptions {
            file: file.clone(),
            min_interval_ms: 0,
            heartbeat_interval_ms: 0,
            now: Arc::new(move || *now_clone.lock().unwrap()),
        };
        let publisher = ProgressPublisher::new(opts);
        let snap1 = ProgressSnapshot::new(2, 12, 0, 0, "k8s/manifest").with_detail(ProgressDetail {
            label: "kubescape".into(),
            done: 2,
            total: 8,
            current: "jobs/foo/k8s/qa".into(),
        });
        publisher.on_update(&snap1);
        let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(value["version"], 2);
        assert_eq!(value["phase"], "k8s/manifest");
        assert_eq!(value["step"], "kubescape");
        assert!(value["etaMs"].is_null());

        *now.lock().unwrap() += 6000;
        let snap2 = ProgressSnapshot::new(2, 12, 0, 0, "k8s/manifest").with_detail(ProgressDetail {
            label: "kubescape".into(),
            done: 3,
            total: 8,
            current: "jobs/foo/k8s/release".into(),
        });
        publisher.on_update(&snap2);
        let value2: serde_json::Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert!(value2["etaMs"].as_i64().unwrap() > 0);
        publisher.stop();
    }

    #[test]
    fn read_owner_progress_rejects_stale_or_incomplete_snapshot() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("progress.json");
        fs::write(&file, serde_json::json!({"pid": current_pid(), "version": 1, "heartbeatAt": now_ms() as i64, "etaMs": 1}).to_string()).unwrap();
        assert!(read_owner_progress(current_pid(), &file).is_none());

        fs::write(
            &file,
            serde_json::json!({
                "pid": current_pid(), "version": 2, "heartbeatAt": (now_ms() as i64) - 61_000,
                "done": 0, "total": 0, "found": 0, "fixed": 0, "current": "", "updatedAt": now_ms() as i64
            })
            .to_string(),
        )
        .unwrap();
        assert!(read_owner_progress(current_pid(), &file).is_none());
    }

    #[test]
    fn render_wait_line_contains_position_owner_bar_and_rest_of_queue() {
        let owner = LockOwner { pid: 111, host: String::new(), started_at: 0, fingerprint: None, cwd: "/repos/cursor".into() };
        let queue = vec![
            QueueEntry { pid: 222, cwd: "/repos/other".into(), enqueued_at: 1 },
            QueueEntry { pid: current_pid(), cwd: "/repos/mine".into(), enqueued_at: 2 },
        ];
        let snap = OwnerProgressSnapshot {
            version: 2,
            pid: 111,
            done: 5,
            total: 12,
            found: 47,
            fixed: 32,
            current: "js/eslint".into(),
            detail: None,
            eta_ms: None,
            updated_at: now_ms() as i64,
            heartbeat_at: now_ms() as i64,
        };
        let line = render_wait_line(&owner, &queue, Some(&snap));
        assert!(line.contains("у черзі #2/2"), "{line}");
        assert!(line.contains("працює pid 111 (cursor)"), "{line}");
        assert!(line.contains("5/12 концернів · знайдено 47 · виправлено 32 · js/eslint"), "{line}");
        assert!(line.contains("чекають: pid 222 (other)"), "{line}");
    }

    #[test]
    fn render_wait_line_without_snapshot_has_no_bar() {
        let owner = LockOwner { pid: 111, host: String::new(), started_at: 0, fingerprint: None, cwd: String::new() };
        let line = render_wait_line(&owner, &[], None);
        assert!(line.contains("у черзі #1/1"), "{line}");
        assert!(line.contains("працює pid 111"), "{line}");
        assert!(!line.contains('['), "{line}");
    }

    #[test]
    fn render_wait_line_shows_phase_detail_and_eta() {
        let owner = LockOwner { pid: 111, host: String::new(), started_at: 0, fingerprint: None, cwd: "/repos/owner".into() };
        let snap = OwnerProgressSnapshot {
            version: 2,
            pid: 111,
            done: 5,
            total: 12,
            found: 0,
            fixed: 0,
            current: "k8s/manifest".into(),
            detail: Some(ProgressDetail { label: "kubescape".into(), done: 47, total: 133, current: "jobs/foo/k8s/tr".into() }),
            eta_ms: Some(120_000),
            updated_at: now_ms() as i64,
            heartbeat_at: now_ms() as i64,
        };
        let line = render_wait_line(&owner, &[], Some(&snap));
        assert!(line.contains("k8s/manifest"), "{line}");
        assert!(line.contains("kubescape 47/133"), "{line}");
        assert!(line.contains("jobs/foo/k8s/tr"), "{line}");
        assert!(line.contains("ETA ≈ 2 хв"), "{line}");
    }
}
