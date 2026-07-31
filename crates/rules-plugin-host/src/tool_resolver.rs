//! `ToolResolver` — реальний run-tool контур (задача N1, рішення Д спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`): плагін
//! декларує `tools = ["shellcheck@^0.9"]` у маніфесті й кличе host-функцію
// cspell:ignore pgid форкнуті
//! `run-tool`; хост-бік — ЦЕЙ тип — резолвить назву тула (без версійного
//! суфікса) в абсолютний шлях бінаря й виконує його через
//! `std::process::Command` (без tokio — синхронна N-API поверхня, доккомент
//! `crates/rules-napi/src/lib.rs`).
//!
//! # Версійна політика — НЕ тут
//!
//! `Manifest::tools`-записи мають вигляд `"shellcheck@^0.9"` (semver-діапазон
//! декларації), але `ToolResolver` парсить лише ІМ'Я (частину до `@`) —
//! версійний діапазон він ігнорує повністю. Це свідоме рішення: інсталяція
//! конкретної (канонічної, закріпленої в `tool-pins.json`) версії — робота
//! `ensure-tool`-контуру на JS-боці (`npm/scripts/lib/ensure-tool.mjs`,
//! `ensureToolAsync`), який будує мапу «ім'я тула → шлях» ще ДО того, як вона
//! потрапляє сюди (`npm/scripts/lib/lint-surface/wasm-plugins.mjs`). Якщо
//! колись знадобиться перевіряти, що встановлена версія задовольняє
//! semver-діапазон декларації — це окрема задача, не розширення цього типу.
//!
//! # Політика помилок
//!
//! Тул поза мапою (не задекларований і не забезпечений хостом) — типізована
//! помилка ВСЕРЕДИНІ `tool-output` (`status: none`, людиночитний `stderr`),
//! НЕ паніка й не `Result::Err` на рівні виклику `detect`/`fix`: WIT-контракт
//! `run-tool` не має варіанту помилки (сигнатура завжди повертає
//! `tool-output`), тож guest сам вирішує, як зреагувати на порожній/помилковий
//! вивід — той самий skip-not-crash дух, що й решта контракту (рішення З
//! спеки).

use std::collections::HashMap;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rules_contract::tool::ToolOutput;

/// Дефолтний таймаут одного виклику `run-tool` (задача N1: «розумний
/// таймаут», задокументований тут). 120с — щедрий запас для типових
/// CLI-лінтерів (shellcheck, eslint тощо), які на практиці
/// завершуються за секунди-десятки секунд; batch-контракт v3.0 (рішення Г
/// спеки) — один виклик на концерн на прогін, довгоживучих tool-процесів
/// тут не очікується. Тести з дешевшим таймаутом інʼєктують власне значення
/// через [`ToolResolver::with_timeout`].
pub const DEFAULT_TOOL_TIMEOUT: Duration = Duration::from_secs(120);

/// Крок опитування `Child::try_wait()` у циклі таймауту (доккомент
/// [`wait_with_timeout`]) — досить дрібний, щоб не додавати відчутної
/// затримки понад реальний час виконання тула, досить великий, щоб не
/// навантажувати CPU busy-loop-ом.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Host-mediated run-tool резолвер (рішення Д спеки): мапа «ім'я тула (без
/// версійного суфікса декларації) → абсолютний шлях бінаря», яку будує
/// оркестрація (ensure-tool контур, JS-бік) ДО передачі сюди. Тул поза
/// мапою — типізована помилка в `tool-output`, не паніка (доккомент модуля).
pub struct ToolResolver {
    tools: HashMap<String, PathBuf>,
    timeout: Duration,
}

impl ToolResolver {
    /// Будує резолвер із готової мапи «ім'я тула → шлях» і дефолтним
    /// таймаутом ([`DEFAULT_TOOL_TIMEOUT`]).
    pub fn new(tools: HashMap<String, PathBuf>) -> Self {
        Self::with_timeout(tools, DEFAULT_TOOL_TIMEOUT)
    }

    /// Порожній резолвер — жоден `run-tool`-виклик не матиме резолвленого
    /// тула (кожен поверне типізовану помилку в `tool-output`). Дефолт
    /// napi-мосту, коли JS-виклик не передав `toolPaths`
    /// (`crates/rules-napi/src/lib.rs`).
    pub fn empty() -> Self {
        Self::new(HashMap::new())
    }

    /// Той самий конструктор, що [`Self::new`], але з явним таймаутом —
    /// потрібен тестам, які інʼєктують короткий таймаут на процес, що свідомо
    /// не завершується (`sleep`-скрипт contract-test-kit).
    pub fn with_timeout(tools: HashMap<String, PathBuf>, timeout: Duration) -> Self {
        Self { tools, timeout }
    }

    /// Виконує `run-tool`: резолвить `tool` (обрізаючи semver-суфікс
    /// декларації, доккомент модуля) у мапі; відсутній запис — типізована
    /// помилка в `tool-output` (`status: none`), не паніка. Резолвлений тул
    /// запускається через [`run_process`] з `self.timeout`.
    pub fn run(&self, tool: &str, args: &[String], stdin: Option<&str>) -> ToolOutput {
        let name = tool_name(tool);
        match self.tools.get(name) {
            Some(path) => run_process(path, args, stdin, self.timeout),
            None => ToolOutput {
                status: None,
                stdout: String::new(),
                stderr: format!(
                    "run-tool: тул `{tool}` не задекларовано в ToolResolver (поза мапою, яку \
                     забезпечив ensure-tool контур оркестрації) — плагін може кликати лише \
                     задекларований і ЗАБЕЗПЕЧЕНИЙ хостом tool (рішення Д спеки, enforcement)"
                ),
            },
        }
    }
}

/// Ім'я тула без версійного суфікса декларації (`"shellcheck@^0.9"` →
/// `"shellcheck"`); без `@` — рядок повертається як є.
fn tool_name(tool: &str) -> &str {
    tool.split('@').next().unwrap_or(tool)
}

/// Результат очікування завершення дочірнього процесу — розрізняє звичайний
/// вихід, таймаут (процес вбито примусово) і помилку самого `wait`-виклику
/// (рідкісна ОС-аномалія), щоб [`run_process`] міг сформувати точний
/// людиночитний `stderr` для кожного випадку.
enum WaitOutcome {
    Exited(ExitStatus),
    TimedOut,
    WaitFailed(std::io::Error),
}

/// Опитувальний (без tokio) цикл очікування дочірнього процесу з таймаутом:
/// `Child::try_wait()` не блокує, тож цикл `sleep`ить [`POLL_INTERVAL`] між
/// перевірками. При перевищенні `timeout` — примусовий `kill()` + фінальний
/// `wait()` (звільняє zombie-процес), результат — [`WaitOutcome::TimedOut`].
fn wait_with_timeout(child: &mut Child, timeout: Duration) -> WaitOutcome {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return WaitOutcome::Exited(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    kill_process_tree(child);
                    let _ = child.wait();
                    return WaitOutcome::TimedOut;
                }
                thread::sleep(POLL_INTERVAL);
            }
            Err(err) => return WaitOutcome::WaitFailed(err),
        }
    }
}

/// Вбиває дочірній процес РАЗОМ з усіма його нащадками при таймауті.
///
/// `Child::kill()` (не-unix гілка) сигналить лише ПРЯМОМУ нащадку — якщо
/// той форкнув власних дітей замість `exec`-заміни себе (типово для
/// shell-обгорток на кшталт `#!/bin/sh\nsleep 5`, коли шелл НЕ
/// tail-call-оптимізує останню команду), "онуки" лишаються живими, тримаючи
/// відкритим WRITE-кінець stdout/stderr pipe — reader-потоки [`run_process`]
/// блокуються в `read_to_end` аж до природного завершення онука, а не до
/// таймауту (емпірично підтверджено при розробці: без group-kill
/// таймаут-тест чекав повні 5с скрипта замість інʼєктованих 150мс).
///
/// Unix-гілка: `command.process_group(0)` при spawn (`run_process`) робить
/// дочірній процес лідером НОВОЇ process group (`pgid == pid`) — усі
/// нащадки успадковують той самий pgid; сигнал НЕГАТИВНОМУ pid
/// (`kill(-pid, SIGKILL)`, POSIX-семантика «уся група») вбиває їх разом.
fn kill_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id() as libc::pid_t;
        // SAFETY: `kill(2)` — чиста FFI-операція над PID, без розділюваної
        // памʼяті чи інваріантів Rust, які можна порушити; `-pid` — валідний
        // POSIX-запит "сигнал усій process group", `pid` гарантовано > 0
        // (`Child::id()` завжди повертає живий/нещодавно живий PID процесу,
        // яким володіє цей `Child`).
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    {
        // Win-x64 platform-матриця (рішення О спеки) — окрема задача;
        // до неї `Child::kill()` лишається best-effort фолбеком (вбиває
        // прямого нащадка, не всю групу).
        let _ = child.kill();
    }
}

/// Запускає бінарник `path` з `args`/опційним `stdin`, захоплює
/// stdout/stderr/exit-code у [`ToolOutput`], з таймаутом `timeout`.
///
/// stdin пишеться і stdout/stderr читаються у ОКРЕМИХ потоках, паралельно з
/// очікуванням процесу на головному потоці — класична пастка
/// `std::process::Command` (задокументована офіційно для
/// `Child::wait_with_output`): якщо тул одночасно й багато читає зі stdin, і
/// багато пише в stdout/stderr, послідовне «спочатку записати весь stdin,
/// потім прочитати вивід» може зависнути в deadlock на переповненому pipe-буфері.
/// Тут та сама логіка відтворена вручну (не `wait_with_output`), бо потрібен
/// ще й таймаут, якого `wait_with_output` не підтримує.
fn run_process(path: &Path, args: &[String], stdin: Option<&str>, timeout: Duration) -> ToolOutput {
    let mut command = Command::new(path);
    command.args(args);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(unix)]
    {
        // Нова process group (pgid == pid дочірнього процесу) — доккомент
        // [`kill_process_tree`] пояснює, навіщо: без цього таймаут вбиває
        // лише прямого нащадка, а форкнуті "онуки" (не exec-замінений
        // shell-скрипт) лишаються живими й тримають pipe відкритим.
        command.process_group(0);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            return ToolOutput {
                status: None,
                stdout: String::new(),
                stderr: format!("run-tool: не вдалось запустити `{}`: {err}", path.display()),
            };
        }
    };

    // Пишемо stdin в окремому потоці — `pipe` дропається наприкінці замикання
    // (навіть коли `stdin` — `None`), що коректно закриває дескриптор і
    // сигналить дочірньому процесу EOF, замість вічного очікування вводу.
    let stdin_payload = stdin.map(str::to_owned);
    let stdin_handle = child.stdin.take().map(|mut pipe| {
        thread::spawn(move || {
            if let Some(data) = stdin_payload {
                let _ = pipe.write_all(data.as_bytes());
            }
        })
    });
    let stdout_handle = child.stdout.take().map(|mut pipe| {
        thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    });
    let stderr_handle = child.stderr.take().map(|mut pipe| {
        thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    });

    let outcome = wait_with_timeout(&mut child, timeout);

    if let Some(handle) = stdin_handle {
        let _ = handle.join();
    }
    let stdout_bytes = stdout_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();
    let stderr_bytes = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();
    let stdout = String::from_utf8_lossy(&stdout_bytes).into_owned();
    let captured_stderr = String::from_utf8_lossy(&stderr_bytes).into_owned();

    match outcome {
        WaitOutcome::Exited(status) => ToolOutput {
            status: status.code(),
            stdout,
            stderr: captured_stderr,
        },
        WaitOutcome::TimedOut => ToolOutput {
            status: None,
            stdout,
            stderr: append_note(
                captured_stderr,
                format!(
                    "run-tool: `{}` перевищив таймаут {}с — процес примусово вбито",
                    path.display(),
                    timeout.as_secs()
                ),
            ),
        },
        WaitOutcome::WaitFailed(err) => ToolOutput {
            status: None,
            stdout,
            stderr: append_note(
                captured_stderr,
                format!(
                    "run-tool: очікування завершення `{}` провалилось: {err}",
                    path.display()
                ),
            ),
        },
    }
}

/// Дописує службову примітку в кінець захопленого `stderr` (з переносом
/// рядка, якщо там уже щось є) — так помилка таймауту/wait-збою не втрачає
/// реальний вивід тула, якщо той щось встиг написати до примусового вбивства.
fn append_note(mut stderr: String, note: String) -> String {
    if !stderr.is_empty() {
        stderr.push('\n');
    }
    stderr.push_str(&note);
    stderr
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[cfg(unix)]
    fn write_executable_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        fs::write(&path, body).expect("запис скрипта не мав провалитись");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
            .expect("chmod не мав провалитись");
        path
    }

    #[test]
    fn tool_name_strips_semver_suffix() {
        assert_eq!(tool_name("shellcheck@^0.9"), "shellcheck");
        assert_eq!(tool_name("shellcheck"), "shellcheck");
        assert_eq!(tool_name("eslint@>=8 <9"), "eslint");
    }

    #[test]
    fn run_missing_tool_returns_typed_error_not_panic() {
        let resolver = ToolResolver::empty();
        let out = resolver.run("shellcheck@^0.9", &["-h".to_string()], None);
        assert!(out.status.is_none());
        assert!(out.stdout.is_empty());
        assert!(out.stderr.contains("shellcheck@^0.9"));
        assert!(out.stderr.contains("не задекларовано"));
    }

    #[cfg(unix)]
    #[test]
    fn run_resolved_tool_captures_stdout_stderr_and_exit_code() {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let script = write_executable_script(
            dir.path(),
            "echo-tool",
            "#!/bin/sh\necho \"args:$*\"\ncat >/dev/null\necho \"err\" >&2\nexit 3\n",
        );
        let mut tools = HashMap::new();
        tools.insert("echo-tool".to_string(), script);
        let resolver = ToolResolver::new(tools);

        let out = resolver.run("echo-tool", &["a".to_string(), "b".to_string()], Some("hi"));
        assert_eq!(out.status, Some(3));
        assert_eq!(out.stdout, "args:a b\n");
        assert_eq!(out.stderr, "err\n");
    }

    #[cfg(unix)]
    #[test]
    fn run_resolved_tool_times_out_and_kills_process() {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let script = write_executable_script(dir.path(), "slow-tool", "#!/bin/sh\nsleep 5\n");
        let mut tools = HashMap::new();
        tools.insert("slow-tool".to_string(), script);
        let resolver = ToolResolver::with_timeout(tools, Duration::from_millis(150));

        let start = Instant::now();
        let out = resolver.run("slow-tool", &[], None);
        assert!(
            start.elapsed() < Duration::from_secs(3),
            "таймаут мав перервати процес задовго до природного завершення sleep 5"
        );
        assert!(out.status.is_none());
        assert!(out.stderr.contains("таймаут"));
    }
}
