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
//!
//! # `run-tool` і `exec-tool` — один резолвер, два входи
//!
//! Зріз 5 контракту v3.1 додав [`ToolResolver::exec`] — `run` плюс
//! виконавчий контекст (`cwd`, накладені `env`, scratch-обмін). Це НЕ два
//! механізми: обидва входи ділять ту саму мапу тулів, той самий резолв
//! ([`ToolResolver::resolve`]), той самий таймаут і той самий спавн
//! ([`run_process`], який отримав [`ProcessContext`] із дефолтом «як було»).
//! `run-tool` лишається в контракті назавжди в межах major 3 — v3.0-гості
//! його експортують, і саме тому розширювати ЙОГО сигнатуру не можна
//! (доккомент `wit/world.wit` біля `import exec-tool`).

use std::collections::HashMap;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rules_contract::tool::{ToolOutput, ToolRequest, ToolResult};
use rules_contract::validators::tool::{parse_tool_ref, validate_tool_request};

use crate::scratch::ScratchDir;

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
        match self.resolve(tool) {
            Ok(path) => run_process(path, args, stdin, self.timeout, ProcessContext::default()),
            Err(message) => ToolOutput {
                status: None,
                stdout: String::new(),
                stderr: message,
            },
        }
    }

    /// Виконує `exec-tool` (зріз 5 контракту v3.1, рішення А спеки
    /// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`) — `run`
    /// плюс виконавчий контекст: `cwd`, накладені `env` і двобічний
    /// scratch-обмін.
    ///
    /// # Порядок і фатальність кроків
    ///
    /// 1. **Валідація** запиту (`rules_contract::validators::tool`) — до
    ///    будь-якого IO: невалідний `cwd`/`scratch-in`-шлях чи перевищений
    ///    ліміт означає, що процес НЕ спавниться взагалі.
    /// 2. **Резолв** тула тією самою мапою, що `run` (`exec-tool` нічого не
    ///    добуває — провізіонінг живе в окремій команді `tools ensure`);
    ///    промах — та сама типізована помилка `status: none`.
    /// 3. **Матеріалізація** `scratch-in`. Провал — теж фатальний: тул із
    ///    неповним набором вхідних файлів збрехав би результатом.
    /// 4. **Спавн** із `current_dir`/`envs`.
    /// 5. **Збір** `scratch-out` — НЕ фатальний ні в якому вигляді:
    ///    відсутній файл означає «звіту немає» (доккомент
    ///    [`ScratchDir::collect`]).
    ///
    /// `repo_root` — база для `request.cwd` (payload слоту `repo-root@1`).
    /// `None` означає, що хост не має контексту репо: тоді `cwd` запиту
    /// ІГНОРУЄТЬСЯ, а процес успадковує cwd хост-процесу — та сама
    /// деградація, що в `run-tool`, і саме той випадок, заради якого
    /// `exec-tool` узагалі з'явився (napi-виклик збігається з коренем репо
    /// випадково, `rules-cli` — ні). Мовчазним він не лишається: гість
    /// бачить примітку в `stderr`.
    ///
    /// `scratch` — каталог обміну, який хост уже створив (`None` — створити
    /// не вдалось); запит зі `scratch-in`/`scratch-out` без каталогу —
    /// типізована помилка, а не мовчазне ігнорування полів.
    ///
    /// `pub(crate)`, на відміну від [`Self::run`]: публічна поверхня крейта
    /// — лише `PluginHost`/`LoadedPlugin` (рішення М спеки), а `ScratchDir`
    /// із сигнатури назовні не належить. `run` лишається `pub` як була —
    /// звужувати вже опубліковане API заради симетрії тут нічого не дає.
    pub(crate) fn exec(
        &self,
        request: &ToolRequest,
        repo_root: Option<&Path>,
        scratch: Option<&ScratchDir>,
    ) -> ToolResult {
        if let Err(errors) = validate_tool_request(request) {
            return ToolResult::failed(format!(
                "exec-tool: запит відхилено host-валідатором: {}",
                errors.join("; ")
            ));
        }

        let path = match self.resolve(&request.tool) {
            Ok(path) => path.clone(),
            Err(message) => return ToolResult::failed(message),
        };

        let needs_scratch = !request.scratch_in.is_empty() || !request.scratch_out.is_empty();
        if needs_scratch && scratch.is_none() {
            return ToolResult::failed(
                "exec-tool: запит потребує scratch-каталогу (scratch-in/scratch-out), але хост \
                 не зміг його створити — гість має деградувати сам (слот `scratch-dir@1` теж \
                 повернув би `none`)"
                    .to_string(),
            );
        }
        if let Some(scratch) = scratch {
            if let Err(message) = scratch.materialize(&request.scratch_in) {
                return ToolResult::failed(message);
            }
        }

        let mut context = ProcessContext {
            env: &request.env,
            ..ProcessContext::default()
        };
        let resolved_cwd = repo_root.map(|root| match &request.cwd {
            Some(relative) => root.join(relative),
            None => root.to_path_buf(),
        });
        context.cwd = resolved_cwd.as_deref();

        let output = run_process(
            &path,
            &request.args,
            request.stdin.as_deref(),
            self.timeout,
            context,
        );
        let mut result = ToolResult::from(output);
        if repo_root.is_none() && request.cwd.is_some() {
            result.stderr = append_note(
                result.stderr,
                format!(
                    "exec-tool: `cwd: {}` проігноровано — хост не має контексту кореня репо \
                     (слот `repo-root@1` порожній), процес успадкував cwd хост-процесу",
                    request.cwd.as_deref().unwrap_or_default()
                ),
            );
        }
        if let Some(scratch) = scratch {
            result.scratch_out = scratch.collect(&request.scratch_out);
        }
        result
    }

    /// Спільний резолв `run`/`exec`: рядок декларації → абсолютний шлях
    /// бінаря. `Err` — готовий людиночитний `stderr` типізованої помилки
    /// (`status: none`, доккомент модуля).
    fn resolve(&self, tool: &str) -> Result<&PathBuf, String> {
        let name = parse_tool_ref(tool).name;
        self.tools.get(name).ok_or_else(|| {
            format!(
                "run-tool: тул `{tool}` не задекларовано в ToolResolver (поза мапою, яку \
                 забезпечив ensure-tool контур оркестрації) — плагін може кликати лише \
                 задекларований і ЗАБЕЗПЕЧЕНИЙ хостом tool (рішення Д спеки, enforcement)"
            )
        })
    }
}

/// Виконавчий контекст процесу (зріз 5 контракту v3.1) — те, чого бракувало
/// `run-tool`. Дефолт (`cwd: None`, порожній `env`) — рівно поведінка
/// `run-tool`: процес успадковує cwd і env хост-процесу.
#[derive(Default)]
struct ProcessContext<'a> {
    /// Абсолютний робочий каталог процесу; `None` — успадкований від хоста.
    cwd: Option<&'a Path>,
    /// Змінні, які накладаються ПОВЕРХ успадкованого env (`Command::envs`
    /// не очищає середовище — саме та семантика, яку описує WIT).
    env: &'a [(String, String)],
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
fn run_process(
    path: &Path,
    args: &[String],
    stdin: Option<&str>,
    timeout: Duration,
    context: ProcessContext<'_>,
) -> ToolOutput {
    let mut command = Command::new(path);
    command.args(args);
    if let Some(cwd) = context.cwd {
        command.current_dir(cwd);
    }
    // `envs` НАКЛАДАЄ пари поверх успадкованого середовища (на відміну від
    // `env_clear` + `envs`) — доккомент WIT `tool-request.env`.
    command.envs(context.env.iter().map(|(k, v)| (k, v)));
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

    #[cfg(unix)]
    fn resolver_with(name: &str, script: PathBuf) -> ToolResolver {
        let mut tools = HashMap::new();
        tools.insert(name.to_string(), script);
        ToolResolver::new(tools)
    }

    /// Мапа тулів індексується ІМЕНЕМ — і схема резолву (`path:`), і
    /// semver-суфікс декларації відрізаються ДО пошуку
    /// (`rules_contract::validators::tool::parse_tool_ref`, єдина точка
    /// розбору для host- і JS-боку).
    #[cfg(unix)]
    #[test]
    fn resolve_strips_scheme_and_semver_suffix() {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let script = write_executable_script(dir.path(), "bun", "#!/bin/sh\nexit 0\n");
        let resolver = resolver_with("bun", script);

        assert!(resolver.resolve("bun").is_ok());
        assert!(resolver.resolve("path:bun").is_ok());
        assert!(resolver.resolve("path:bun@^1.2").is_ok());
        assert!(resolver.resolve("pinned:bun").is_ok());
        assert!(resolver.resolve("path:bunx").is_err());
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

    /// `exec-tool` без контексту ≡ `run-tool` (доккомент WIT біля
    /// `import exec-tool`): той самий вивід, порожній `scratch-out`.
    #[cfg(unix)]
    #[test]
    fn exec_without_context_matches_run_tool() {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let script = write_executable_script(
            dir.path(),
            "echo-tool",
            "#!/bin/sh\necho \"args:$*\"\ncat >/dev/null\nexit 0\n",
        );
        let resolver = resolver_with("echo-tool", script);

        let run = resolver.run("echo-tool", &["a".to_string()], None);
        let exec = resolver.exec(
            &ToolRequest {
                tool: "echo-tool".to_string(),
                args: vec!["a".to_string()],
                ..ToolRequest::default()
            },
            None,
            None,
        );
        assert_eq!(exec.status, run.status);
        assert_eq!(exec.stdout, run.stdout);
        assert!(exec.scratch_out.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn exec_sets_current_dir_relative_to_repo_root() {
        let bin_dir = tempfile::tempdir().expect("tempdir має створитись");
        let script = write_executable_script(bin_dir.path(), "pwd-tool", "#!/bin/sh\npwd\n");
        let resolver = resolver_with("pwd-tool", script);

        let repo = tempfile::tempdir().expect("tempdir має створитись");
        fs::create_dir_all(repo.path().join("npm")).expect("mkdir не мав провалитись");

        let result = resolver.exec(
            &ToolRequest {
                tool: "pwd-tool".to_string(),
                cwd: Some("npm".to_string()),
                ..ToolRequest::default()
            },
            Some(repo.path()),
            None,
        );
        assert_eq!(result.status, Some(0));
        assert!(
            result.stdout.trim().ends_with("npm"),
            "процес мав стартувати в <repo>/npm, отримали {:?}",
            result.stdout
        );
    }

    #[cfg(unix)]
    #[test]
    fn exec_overlays_env_on_top_of_inherited_environment() {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let script = write_executable_script(
            dir.path(),
            "env-tool",
            "#!/bin/sh\necho \"custom=$N_EXEC_TOOL_PROBE path_present=$([ -n \"$PATH\" ] && echo yes || echo no)\"\n",
        );
        let resolver = resolver_with("env-tool", script);

        let result = resolver.exec(
            &ToolRequest {
                tool: "env-tool".to_string(),
                env: vec![("N_EXEC_TOOL_PROBE".to_string(), "42".to_string())],
                ..ToolRequest::default()
            },
            None,
            None,
        );
        assert_eq!(result.stdout.trim(), "custom=42 path_present=yes");
    }

    /// Двобічний scratch-обмін на одному виклику: тул читає підкладений
    /// `scratch-in` і пише звіт, який хост забирає за `scratch-out`-глобом.
    #[cfg(unix)]
    #[test]
    fn exec_round_trips_scratch_in_and_out() {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let script = write_executable_script(
            dir.path(),
            "scratch-tool",
            "#!/bin/sh\ncat \"$1/input.txt\" > \"$1/report.json\"\n",
        );
        let resolver = resolver_with("scratch-tool", script);
        let scratch = ScratchDir::new().expect("scratch-каталог має створитись");

        let result = resolver.exec(
            &ToolRequest {
                tool: "scratch-tool".to_string(),
                args: vec![scratch.path().to_string_lossy().into_owned()],
                scratch_in: vec![rules_contract::tool::ScratchFile {
                    path: "input.txt".to_string(),
                    content: "{\"ok\":true}".to_string(),
                }],
                scratch_out: vec!["*.json".to_string()],
                ..ToolRequest::default()
            },
            None,
            Some(&scratch),
        );
        assert_eq!(result.status, Some(0));
        assert_eq!(result.scratch_out.len(), 1);
        assert_eq!(result.scratch_out[0].path, "report.json");
        assert_eq!(result.scratch_out[0].content, "{\"ok\":true}");
    }

    /// Невалідний запит відхиляється ДО спавна — той самий `status: none`,
    /// що й незадекларований тул.
    #[cfg(unix)]
    #[test]
    fn exec_rejects_escaping_cwd_before_spawning() {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let marker = dir.path().join("spawned");
        let script = write_executable_script(
            dir.path(),
            "marker-tool",
            &format!("#!/bin/sh\ntouch {}\n", marker.display()),
        );
        let resolver = resolver_with("marker-tool", script);

        let result = resolver.exec(
            &ToolRequest {
                tool: "marker-tool".to_string(),
                cwd: Some("../../etc".to_string()),
                ..ToolRequest::default()
            },
            Some(dir.path()),
            None,
        );
        assert!(result.status.is_none());
        assert!(result.stderr.contains("cwd"), "{}", result.stderr);
        assert!(!marker.exists(), "процес не мав спавнитись узагалі");
    }

    #[test]
    fn exec_missing_tool_returns_typed_error_not_panic() {
        let result = ToolResolver::empty().exec(
            &ToolRequest {
                tool: "path:bun".to_string(),
                ..ToolRequest::default()
            },
            None,
            None,
        );
        assert!(result.status.is_none());
        assert!(result.stderr.contains("не задекларовано"));
        assert!(result.scratch_out.is_empty());
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
