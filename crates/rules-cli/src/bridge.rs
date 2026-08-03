//! cspell:ignore NDJSON sockaddr nonblocking рантаймом
//!
//! Rust-бік ЗВОРОТНОГО МОСТУ (Р12 спеки
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`): клієнт до
//! довгоживучого node-процесу, який виконує залишок lint-поверхні, ще не
//! портований у Rust. JS-бік — [`npm/scripts/lib/lint-surface/bridge-host.mjs`],
//! там-таки повний опис протоколу й мотивація каналу.
//!
//! # Один процес на прогін
//!
//! Спавн node коштує ~40 мс (вимірювання зрізу 4 фази 8), тож міст
//! піднімається РАЗ на прогін `lint`, а не на концерн: [`Bridge::start`]
//! відкриває unix-сокет, спавнить рантайм і тримає зʼєднання до [`Drop`].
//! Кожен `detect`-виклик несе БАТЧ items (суцільний сегмент плану).
//!
//! # Чому unix-сокет
//!
//! stdout дочірнього процесу зайнятий: концерни туди друкують
//! (`text/cspell-fix`) і навіть спавнять тули з `stdio: 'inherit'`
//! (`k8s/manifests`). Сокет — окремий канал без fd-трюків; stdout/stderr
//! лишаються успадкованими, тож вивід концернів іде користувачу дослівно
//! так само, як під JS-CLI. `std::os::unix::net` — без нових залежностей
//! (Р11 п. 1: бібліотека замість саморобки, тут — сама стандартна
//! бібліотека); Unix-межа збігається з платформною межею продукту (Р1).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

/// Версія протоколу; має збігтись із `BRIDGE_PROTOCOL_VERSION` JS-боку —
/// звірка fail-closed (той самий enforcement-патерн, що `CONTRACT_VERSION`
/// на napi-межі, Р10 спеки).
const PROTOCOL_VERSION: u64 = 1;

/// Шлях JS-виконавця відносно кореня пакета `@7n/rules`.
const HOST_REL: &str = "scripts/lib/lint-surface/bridge-host.mjs";

/// Скільки чекати на приєднання дочірнього процесу до сокета. Щедро —
/// холодний старт bun/node із резолвом плагінів на завантаженій машині
/// буває повільним; дедлайн тут лише щоб не зависнути назавжди, коли
/// рантайм помер до `connect` (fail-closed із зрозумілим текстом).
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(30);

/// Клієнт мосту: живий дочірній процес + відкрите зʼєднання до нього.
#[derive(Debug)]
pub struct Bridge {
    child: Child,
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    socket_path: PathBuf,
    next_id: u64,
}

/// Унікальний шлях сокета. Навмисно короткий і в `/tmp`, а не в
/// `std::env::temp_dir()`: `sockaddr_un.sun_path` обмежений 104 байтами на
/// macOS, а тамтешній `TMPDIR` (`/var/folders/...`) зʼїдає більшу частину
/// бюджету.
fn socket_path_for(pid: u32) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    PathBuf::from(format!("/tmp/n-rules-bridge-{pid}-{nanos:x}.sock"))
}

impl Bridge {
    /// Піднімає міст: сокет + дочірній рантайм + handshake `hello`.
    ///
    /// `package_root` — корінь установленого `@7n/rules` (той самий каскад,
    /// що для делегації, [`crate::js_fallback::package_root`]); `cwd`
    /// дочірнього процесу успадковується від `rules-cli` — дзеркало
    /// JS-CLI, який теж не робить `chdir` під `--cwd`.
    pub fn start(package_root: &Path) -> Result<Self, String> {
        let host = package_root.join(HOST_REL);
        if !host.is_file() {
            return Err(format!(
                "rules-cli: не знайдено JS-виконавця мосту «{}». Native-шлях lint потребує \
                 встановленого @7n/rules із цим файлом.",
                host.display()
            ));
        }
        let socket_path = socket_path_for(std::process::id());
        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path)
            .map_err(|error| format!("rules-cli: не вдалося відкрити сокет мосту: {error}"))?;
        listener.set_nonblocking(true).map_err(|error| {
            format!("rules-cli: сокет мосту не переводиться в nonblocking: {error}")
        })?;

        let mut child = spawn_host(&host, &socket_path)?;
        let stream = match accept_with_deadline(&listener, &mut child) {
            Ok(stream) => stream,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&socket_path);
                return Err(error);
            }
        };
        // Файл сокета більше не потрібен: зʼєднання вже встановлено.
        let _ = std::fs::remove_file(&socket_path);
        stream.set_nonblocking(false).map_err(|error| {
            format!("rules-cli: сокет мосту не повертається в blocking: {error}")
        })?;
        let writer = stream
            .try_clone()
            .map_err(|error| format!("rules-cli: не вдалося продублювати сокет мосту: {error}"))?;

        let mut bridge = Self {
            child,
            reader: BufReader::new(stream),
            writer,
            socket_path,
            next_id: 0,
        };
        let hello = bridge.call("hello", json!({}))?;
        let protocol = hello.get("protocol").and_then(Value::as_u64);
        if protocol != Some(PROTOCOL_VERSION) {
            return Err(format!(
                "rules-cli: несумісна версія протоколу мосту (очікується {PROTOCOL_VERSION}, \
                 отримано {protocol:?}) — онови @7n/rules або перезбери rules-cli."
            ));
        }
        Ok(bridge)
    }

    /// Синхронний request→response. Помилка ОПЕРАЦІЇ (`ok:false`) стає
    /// `Err` — це помилка мосту, не помилка окремого концерну (та
    /// повертається всередині `result`).
    pub fn call(&mut self, op: &str, mut payload: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        if let Some(object) = payload.as_object_mut() {
            object.insert("id".to_string(), json!(id));
            object.insert("op".to_string(), json!(op));
        }
        let mut line = serde_json::to_string(&payload)
            .map_err(|error| format!("rules-cli: запит мосту не серіалізується: {error}"))?;
        line.push('\n');
        self.writer
            .write_all(line.as_bytes())
            .map_err(|error| format!("rules-cli: запис у міст ({op}) впав: {error}"))?;
        self.writer
            .flush()
            .map_err(|error| format!("rules-cli: flush мосту ({op}) впав: {error}"))?;

        let mut response = String::new();
        let read = self
            .reader
            .read_line(&mut response)
            .map_err(|error| format!("rules-cli: читання відповіді мосту ({op}) впало: {error}"))?;
        if read == 0 {
            return Err(format!(
                "rules-cli: міст закрив зʼєднання без відповіді на «{op}» \
                 (дочірній процес упав — див. його вивід вище)."
            ));
        }
        let parsed: Value = serde_json::from_str(response.trim_end())
            .map_err(|error| format!("rules-cli: відповідь мосту ({op}) не JSON: {error}"))?;
        if parsed.get("ok").and_then(Value::as_bool) != Some(true) {
            let detail = parsed
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("без деталей");
            return Err(format!("rules-cli: міст відмовив на «{op}»: {detail}"));
        }
        Ok(parsed
            .get("result")
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new())))
    }
}

impl Drop for Bridge {
    /// Закриває зʼєднання (JS-бік завершується сам по `close`), чекає на
    /// процес і прибирає файл сокета, якщо він ще лишився.
    fn drop(&mut self) {
        let _ = self.writer.shutdown(std::net::Shutdown::Both);
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// Спавнить JS-виконавця першим доступним рантаймом (`bun` → `node`, або
/// примусовий `N_RULES_JS_RUNTIME`) — той самий порядок, що для делегації
/// команд ([`crate::js_fallback`]).
fn spawn_host(host: &Path, socket_path: &Path) -> Result<Child, String> {
    let runtimes = crate::js_fallback::runtimes();
    let mut last_error = None;
    for (i, runtime) in runtimes.iter().enumerate() {
        match Command::new(runtime).arg(host).arg(socket_path).spawn() {
            Ok(child) => return Ok(child),
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && i + 1 < runtimes.len() =>
            {
                last_error = Some(error);
            }
            Err(error) => {
                return Err(format!(
                    "rules-cli: не вдалося запустити {runtime} для мосту: {error}"
                ))
            }
        }
    }
    Err(format!(
        "rules-cli: жоден JS-рантайм не запустився для мосту ({}). Установи bun або node, \
         чи постав N_RULES_JS_RUNTIME.",
        last_error.map_or_else(|| "невідома причина".to_string(), |e| e.to_string())
    ))
}

/// Чекає на `connect` дочірнього процесу, поки той живий і не вичерпано
/// [`ACCEPT_TIMEOUT`]. Смерть процесу — негайна помилка (без цього
/// `accept` висів би до дедлайну на кожній зламаній інсталяції).
fn accept_with_deadline(listener: &UnixListener, child: &mut Child) -> Result<UnixStream, String> {
    let deadline = Instant::now() + ACCEPT_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((stream, _)) => return Ok(stream),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(format!("rules-cli: accept мосту впав: {error}")),
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "rules-cli: JS-виконавець мосту завершився ({status}) не приєднавшись — \
                 див. його вивід вище."
            ));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "rules-cli: JS-виконавець мосту не приєднався за {} с.",
                ACCEPT_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Шлях сокета мусить лишатись у бюджеті `sun_path` (104 байти на
    /// macOS) — це не косметика, а умова того, що `bind` узагалі працює.
    #[test]
    fn socket_path_fits_sun_path_budget() {
        let path = socket_path_for(999_999);
        assert!(
            path.as_os_str().len() < 100,
            "надто довгий шлях сокета: {}",
            path.display()
        );
        assert!(path.starts_with("/tmp"));
    }

    /// Два виклики поспіль дають різні шляхи — паралельні прогони не
    /// відбирають сокет один в одного.
    #[test]
    fn socket_paths_are_unique() {
        assert_ne!(socket_path_for(1), socket_path_for(1));
    }

    /// Відсутній JS-виконавець — зрозуміла помилка, а не паніка/зависання.
    #[test]
    fn start_without_host_file_reports_clear_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let error = Bridge::start(tmp.path()).unwrap_err();
        assert!(error.contains("JS-виконавця мосту"), "{error}");
    }
}
