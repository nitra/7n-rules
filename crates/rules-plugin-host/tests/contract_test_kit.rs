//! Contract-test-kit `rules-plugin-host` (задача I2 фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`) проти
//! РЕАЛЬНОЇ guest-фікстури `crates/test-plugin-guest`.
//!
//! Фікстура НЕ будується автоматично цим тестом (не мовчазний skip, як
//! вимагає задача I2, п.3) — якщо `.wasm` відсутній, [`require_fixture`]
//! панікує з точною командою збірки.

use std::path::PathBuf;
use std::sync::Arc;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_contract::fix::FixRequest;
use rules_contract::tool::ToolOutput;
use rules_plugin_host::{PluginHost, PluginHostError, RunToolFn};

/// Версія world, під яку зібрана фікстура (`crates/test-plugin-guest`
/// заявляє `world_version: "3.0.0"` — `Manifest`, `src/lib.rs`).
const PLUGIN_WORLD_VERSION: &str = "3.0.0";
/// `concern-id` fs-preopen тест-хука — дзеркало
/// `test_plugin_guest::FS_PROBE_CONCERN_ID` (окремі крейти, дублюється як
/// рядковий літерал: контракт — рядок з `Manifest::concerns`/`DetectBatch`,
/// не Rust-константа, спільна між guest і host-тестом).
const FS_PROBE_CONCERN_ID: &str = "test/guest-echo-fs-probe";

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

/// `run-tool` callback для тестів — v3.0-заглушка (рішення Д спеки): жоден
/// тест цього файлу не викликає `run-tool` із guest-фікстури (`test/guest-echo`
/// його не використовує), тож callback лише документує факт виклику, якби
/// він стався.
fn stub_run_tool() -> Arc<RunToolFn> {
    Arc::new(
        |_tool: &str, _args: &[String], _stdin: Option<&str>| ToolOutput {
            status: None,
            stdout: String::new(),
            stderr: "run-tool не задекларовано в contract-test-kit".to_string(),
        },
    )
}

fn host() -> PluginHost {
    PluginHost::new(stub_run_tool()).expect("PluginHost::new не мав провалитись")
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
    assert!(manifest.concerns.iter().any(|c| c == "test/guest-echo"));
    assert!(manifest.concerns.iter().any(|c| c == FS_PROBE_CONCERN_ID));
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
