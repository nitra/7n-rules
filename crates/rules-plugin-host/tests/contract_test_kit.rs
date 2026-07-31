//! Contract-test-kit `rules-plugin-host` (задача I2 фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`) проти
//! РЕАЛЬНОЇ guest-фікстури `crates/test-plugin-guest`.
//!
//! Фікстура НЕ будується автоматично цим тестом (не мовчазний skip, як
//! вимагає задача I2, п.3) — якщо `.wasm` відсутній, [`require_fixture`]
//! панікує з точною командою збірки.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_contract::fix::FixRequest;
use rules_plugin_host::{PluginHost, PluginHostError, ToolResolver};

/// Версія world, під яку зібрана фікстура (`crates/test-plugin-guest`
/// заявляє `world_version: "3.0.0"` — `Manifest`, `src/lib.rs`).
const PLUGIN_WORLD_VERSION: &str = "3.0.0";
/// `concern-id` fs-preopen тест-хука — дзеркало
/// `test_plugin_guest::FS_PROBE_CONCERN_ID` (окремі крейти, дублюється як
/// рядковий літерал: контракт — рядок з `Manifest::concerns`/`DetectBatch`,
/// не Rust-константа, спільна між guest і host-тестом).
const FS_PROBE_CONCERN_ID: &str = "test/guest-echo-fs-probe";
/// `concern-id` run-tool тест-хука (задача N1, п.4) — дзеркало
/// `test_plugin_guest::TOOL_ECHO_CONCERN_ID`.
const TOOL_ECHO_CONCERN_ID: &str = "test/guest-tool-echo";

/// Абсолютний шлях до зібраного `.wasm`-компонента фікстури
/// (`crates/test-plugin-guest/build.sh`) — `wasm32-wasip2`/`release`,
/// корінь workspace обчислено від `CARGO_MANIFEST_DIR` цього крейта
/// (`crates/rules-plugin-host` — два рівні вгору до кореня).
fn fixture_wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip2/release/test_plugin_guest.wasm")
}

/// Падає з чіткою інструкцією збірки, якщо фікстура відсутня — жодного
/// мовчазного `#[ignore]`/skip (задача I2, п.3).
fn require_fixture() -> PathBuf {
    let path = fixture_wasm_path();
    assert!(
        path.is_file(),
        "guest-фікстура contract-test-kit не зібрана: {} відсутній.\n\
         Зберіть її командою: bash crates/test-plugin-guest/build.sh",
        path.display(),
    );
    path
}

/// Хост із порожнім [`ToolResolver`] — більшість тестів цього файлу не
/// кличуть `run-tool` (`test/guest-echo` його не використовує); тести
/// run-tool контуру (задача N1, п.5, нижче) будують власний хост із
/// заповненою мапою.
fn host() -> PluginHost {
    PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись")
}

/// Пише виконуваний shell-скрипт `name` у `dir` з вмістом `body` —
/// спільний хелпер для тестів run-tool контуру (задача N1, п.5): фейковий
/// тул, що ехоїть свої `args`/`stdin`, чи навмисно "зависає" (`sleep`) для
/// таймаут-кейсу. `cfg(unix)` — той самий мотив, що
/// `crates/rules-core/src/scan.rs` (CI цього крейта — лише `ubuntu-latest`,
/// доккомент `.github/workflows/lint-rust.yml`).
#[cfg(unix)]
fn write_executable_script(dir: &std::path::Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    fs::write(&path, body).expect("запис скрипта не мав провалитись");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
        .expect("chmod не мав провалитись");
    path
}

#[test]
fn load_and_describe_returns_expected_manifest() {
    let path = require_fixture();
    let plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на сумісній фікстурі");

    let manifest = plugin.describe();
    assert_eq!(manifest.id, "test/guest-echo");
    assert_eq!(manifest.world_version, PLUGIN_WORLD_VERSION);
    assert!(manifest.concerns.iter().any(|c| c.key == "test/guest-echo"));
    assert!(manifest
        .concerns
        .iter()
        .any(|c| c.key == FS_PROBE_CONCERN_ID));
    // Типовий концерн лишає `fs_read` порожнім (спека §3.2) — саме цей
    // дефолт і перевіряє `fs_probe_without_declared_capability_gets_no_extra_access`.
    assert!(manifest.capabilities.fs_read.is_empty());
    assert!(!manifest.capabilities.network);
}

#[test]
fn detect_returns_one_diagnostic_per_file_with_expected_shape() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: "test/guest-echo".to_string(),
        files: vec![
            SourceFile {
                path: "a.rs".to_string(),
                content: "fn a() {}".to_string(),
            },
            SourceFile {
                path: "b/c.rs".to_string(),
                content: "fn c() {}".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), batch.files.len());
    for (diagnostic, file) in diagnostics.iter().zip(&batch.files) {
        assert_eq!(diagnostic.reason, "guest-echo");
        assert_eq!(diagnostic.severity, Severity::Warn);
        assert_eq!(diagnostic.file.as_deref(), Some(file.path.as_str()));
        assert!(diagnostic.message.contains(&file.path));
        // Echo-концерн не заповнює `data` — конверсія `option<string>` →
        // `Option<serde_json::Value>` (доккомент `rules_contract::diagnostic`)
        // звіряється окремо у `fs_probe_...`, де `data` заповнений.
        assert!(diagnostic.data.is_none());
    }
}

#[test]
fn fix_returns_empty_plan() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let request = FixRequest {
        concern_id: "test/guest-echo".to_string(),
        files: vec![],
        diagnostics: vec![],
    };
    let plan = plugin.fix(&request).expect("fix не мав провалитись");
    assert!(plan.edits.is_empty());
}

#[test]
fn log_capture_collects_guest_log_calls() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    // `load()` уже викликав `describe()` на реальному `Store` (доккомент
    // `PluginHost::load`) — лог-капчур має містити цей виклик.
    let logs_after_load = plugin.take_logs();
    assert!(
        logs_after_load
            .iter()
            .any(|l| l.message.contains("describe()")),
        "лог-капчур після load() мав містити запис про describe(): {logs_after_load:?}"
    );

    let batch = DetectBatch {
        concern_id: "test/guest-echo".to_string(),
        files: vec![SourceFile {
            path: "x.rs".to_string(),
            content: String::new(),
        }],
    };
    plugin.detect(&batch).unwrap();
    let logs_after_detect = plugin.take_logs();
    assert!(
        logs_after_detect
            .iter()
            .any(|l| l.message.contains("detect()")),
        "лог-капчур після detect() мав містити запис про detect(): {logs_after_detect:?}"
    );

    // `take_logs` дренує буфер — повторний виклик без нової активності
    // повертає порожній список.
    assert!(plugin.take_logs().is_empty());
}

#[test]
fn incompatible_world_version_is_typed_skip_not_crash_error() {
    let path = require_fixture();
    // `LoadedPlugin` (Ok-варіант) навмисно не реалізує `Debug` (тримає
    // wasmtime `Store`/`Instance`, рішення М спеки — вузький публічний
    // trait), тож `Result::expect_err` тут недоступний — match напряму.
    match host().load(&path, "99.0.0") {
        Err(PluginHostError::IncompatibleVersion { found, expected }) => {
            assert_eq!(found, PLUGIN_WORLD_VERSION);
            assert_eq!(expected, "99.0.0");
        }
        Err(other) => panic!("очікували PluginHostError::IncompatibleVersion, отримали {other:?}"),
        Ok(_) => panic!("несумісна major-версія (99 vs 3) мала провалитись типізовано"),
    }
}

/// Спрощена форма fs-тесту (задача I2, п.3 — задокументоване обмеження):
/// повноцінний позитивний тест «preopen дійсно відкриває шлях» вимагав би
/// координації guest-шляху з реальними файлами відносно cwd тестового
/// бінаря (нестабільно між `cargo test` invocation-ами) — замість цього тест
/// звіряє єдиний детермінований інваріант: коли `Manifest::capabilities.fs_read`
/// порожній (типовий концерн, звірено в `load_and_describe_...`), `PluginHost`
/// не відкриє жодного preopen-шляху для цього плагіна, тож guest не отримує
/// файловий доступ понад задекларований — будь-яка спроба читання ФС
/// провалюється незалежно від того, що реально є на хості.
#[test]
fn fs_probe_without_declared_capability_gets_no_extra_access() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: FS_PROBE_CONCERN_ID.to_string(),
        files: vec![],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("fs-probe detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);

    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("fs-probe діагностика повинна мати заповнений data (JSON-конверсія)");
    assert_eq!(
        data.get("fs_probe_readable"),
        Some(&serde_json::Value::Bool(false)),
        "без preopen-шляхів читання ФС з guest-а МАЄ провалюватись: {data:?}"
    );
}

// --- run-tool контур (задача N1, п.5) ---
//
// `test/guest-tool-echo` (`crates/test-plugin-guest/src/lib.rs`) кличе
// `run-tool("echo-tool", ["hello"], None)` і повертає ОДНУ діагностику з
// `tool-output` — три сценарії нижче звіряють усі гілки `ToolResolver`:
// резолвлений реальний процес, тул поза мапою (типізована помилка, не
// паніка), таймаут (примусове вбивство процесу, що не завершується сам).

#[cfg(unix)]
#[test]
fn run_tool_reaches_resolved_fake_tool_binary() {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let script = write_executable_script(
        dir.path(),
        "echo-tool",
        "#!/bin/sh\necho \"args:$*\"\ncat >/dev/null\nexit 0\n",
    );
    let mut tools = HashMap::new();
    tools.insert("echo-tool".to_string(), script);
    let host =
        PluginHost::new(ToolResolver::new(tools)).expect("PluginHost::new не мав провалитись");

    let path = require_fixture();
    let mut plugin = host.load(&path, PLUGIN_WORLD_VERSION).unwrap();
    let batch = DetectBatch {
        concern_id: TOOL_ECHO_CONCERN_ID.to_string(),
        files: vec![],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("tool-echo detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "tool-echo");
    assert!(
        diagnostics[0].message.contains("args:hello"),
        "діагностика мала відобразити stdout резолвленого фейкового тула: {:?}",
        diagnostics[0].message
    );
    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("tool-echo діагностика повинна мати заповнений data");
    assert_eq!(data.get("ok"), Some(&serde_json::Value::Bool(true)));
}

#[test]
fn run_tool_missing_from_resolver_returns_typed_error_in_diagnostic() {
    // Порожній ToolResolver — "echo-tool" не резолвлений, `run-tool` МАЄ
    // повернути типізовану помилку в `tool-output` (не паніку, доккомент
    // `ToolResolver::run`), яку guest-фікстура відображає в діагностиці.
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: TOOL_ECHO_CONCERN_ID.to_string(),
        files: vec![],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("tool-echo detect не мав провалитись навіть без резолвленого тула");
    assert_eq!(diagnostics.len(), 1);
    assert!(
        diagnostics[0].message.contains("error="),
        "діагностика мала відобразити гілку помилки: {:?}",
        diagnostics[0].message
    );
    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("tool-echo діагностика повинна мати заповнений data");
    assert_eq!(data.get("ok"), Some(&serde_json::Value::Bool(false)));
    assert_eq!(data.get("status"), Some(&serde_json::Value::Null));
}

#[cfg(unix)]
#[test]
fn run_tool_timeout_kills_process_and_reports_typed_error() {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    // Скрипт свідомо "зависає" довше за інʼєктований таймаут — доводить,
    // що `ToolResolver` реально вбиває процес, а не чекає його природного
    // завершення.
    let script = write_executable_script(dir.path(), "echo-tool", "#!/bin/sh\nsleep 5\n");
    let mut tools = HashMap::new();
    tools.insert("echo-tool".to_string(), script);
    let host = PluginHost::new(ToolResolver::with_timeout(
        tools,
        Duration::from_millis(150),
    ))
    .expect("PluginHost::new не мав провалитись");

    let path = require_fixture();
    let mut plugin = host.load(&path, PLUGIN_WORLD_VERSION).unwrap();
    let batch = DetectBatch {
        concern_id: TOOL_ECHO_CONCERN_ID.to_string(),
        files: vec![],
    };

    let start = Instant::now();
    let diagnostics = plugin.detect(&batch).expect(
        "tool-echo detect не мав провалитись на таймауті — контракт повертає помилку в tool-output",
    );
    assert!(
        start.elapsed() < Duration::from_secs(3),
        "інʼєктований 150мс-таймаут мав перервати detect() задовго до природного sleep 5"
    );
    assert_eq!(diagnostics.len(), 1);
    assert!(
        diagnostics[0].message.contains("таймаут"),
        "діагностика мала відобразити таймаут-помилку: {:?}",
        diagnostics[0].message
    );
    let data = diagnostics[0].data.as_ref().unwrap();
    assert_eq!(data.get("ok"), Some(&serde_json::Value::Bool(false)));
}
