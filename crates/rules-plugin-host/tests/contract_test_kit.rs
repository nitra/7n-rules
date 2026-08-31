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

mod common;

/// Версія world, під яку зібрана фікстура (`crates/test-plugin-guest`
/// заявляє `world_version: "5.0.0"` — `Manifest`, `src/lib.rs`).
const PLUGIN_WORLD_VERSION: &str = "5.0.0";
/// `concern-id` fs-preopen тест-хука — дзеркало
/// `test_plugin_guest::FS_PROBE_CONCERN_ID` (окремі крейти, дублюється як
/// рядковий літерал: контракт — рядок з `Manifest::concerns`/`DetectBatch`,
/// не Rust-константа, спільна між guest і host-тестом).
const FS_PROBE_CONCERN_ID: &str = "test/guest-echo-fs-probe";
/// `concern-id` run-tool тест-хука (задача N1, п.4) — дзеркало
/// `test_plugin_guest::TOOL_ECHO_CONCERN_ID`.
const TOOL_ECHO_CONCERN_ID: &str = "test/guest-tool-echo";
/// `concern-id` host-context тест-хука (slot-канал host-контексту, доккомент
/// `wit/world.wit` біля `import host-context`, батч 6 §3.5.5) — дзеркало
/// `test_plugin_guest::CONTEXT_ECHO_CONCERN_ID`.
const CONTEXT_ECHO_CONCERN_ID: &str = "test/guest-context-echo";
/// `concern-id` exec-tool тест-хука (зріз 5 контракту v3.1, доккомент
/// `wit/world.wit` біля `import exec-tool`) — дзеркало
/// `test_plugin_guest::EXEC_TOOL_CONCERN_ID`.
const EXEC_TOOL_CONCERN_ID: &str = "test/guest-exec-tool";
/// `concern-id` хука навмисної паніки — дзеркало
/// `test_plugin_guest::PANIC_CONCERN_ID`; потрібен тесту прибирання
/// scratch-каталогу після trap-у гостя.
const PANIC_CONCERN_ID: &str = "test/guest-panic";

/// Абсолютний шлях до зібраного `.wasm`-компонента фікстури
/// (`crates/test-plugin-guest/build.sh`) — `wasm32-wasip3`/`release`,
/// корінь workspace обчислено від `CARGO_MANIFEST_DIR` цього крейта
/// (`crates/rules-plugin-host` — два рівні вгору до кореня).
fn fixture_wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip3/release/test_plugin_guest.wasm")
}

/// Падає з чіткою інструкцією збірки, якщо фікстура відсутня чи застаріла —
/// жодного мовчазного `#[ignore]`/skip (задача I2, п.3), і жодної мовчазної
/// звірки зі СТАРИМ артефактом ([`common::require_fresh_fixture`]).
fn require_fixture() -> PathBuf {
    common::require_fresh_fixture(
        &fixture_wasm_path(),
        "guest-фікстура contract-test-kit",
        "test-plugin-guest",
        "bash crates/test-plugin-guest/build.sh",
    )
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

/// Сумісність активації host-виклику `fix` (доккомент `wit/world.wit` біля
/// `export fix`): плагін БЕЗ власної fix-логіки для концерну (заглушка)
/// повертає порожній план = «нічого не чинити» — та сама поведінка, що до
/// активації fix-контуру, жодного version bump не потрібно.
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

/// `concern-id` fix-хука рерайту — дзеркало
/// `test_plugin_guest::FIX_REWRITE_CONCERN_ID` (той самий мотив рядкового
/// літерала, що [`FS_PROBE_CONCERN_ID`]).
const FIX_REWRITE_CONCERN_ID: &str = "test/guest-fix-rewrite";
/// `concern-id` fix-хука з `..`-шляхом у плані — дзеркало
/// `test_plugin_guest::FIX_ESCAPE_CONCERN_ID`.
const FIX_ESCAPE_CONCERN_ID: &str = "test/guest-fix-escape";

/// Host-виклик `fix` повертає непорожній валідний план: `write` з повним
/// новим вмістом на файл із `BROKEN`, `delete` для діагностики
/// `guest-delete` — обидві гілки `file-edit` конвертуються з WIT у DTO.
#[test]
fn fix_rewrite_hook_returns_write_and_delete_edits() {
    use rules_contract::detect::SourceFile;
    use rules_contract::diagnostic::Diagnostic;
    use rules_contract::fix::FileEdit;

    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let request = FixRequest {
        concern_id: FIX_REWRITE_CONCERN_ID.to_string(),
        files: vec![
            SourceFile {
                path: "src/a.txt".to_string(),
                content: "line BROKEN here".to_string(),
            },
            SourceFile {
                path: "src/ok.txt".to_string(),
                content: "все гаразд".to_string(),
            },
        ],
        diagnostics: vec![Diagnostic {
            reason: "guest-delete".to_string(),
            message: "зайвий файл".to_string(),
            file: Some("src/extra.txt".to_string()),
            severity: Severity::Warn,
            data: None,
        }],
    };

    let plan = plugin.fix(&request).expect("fix не мав провалитись");
    assert_eq!(plan.edits.len(), 2);
    match &plan.edits[0] {
        FileEdit::Write(write) => {
            assert_eq!(write.path, "src/a.txt");
            assert_eq!(write.content, "line FIXED here");
        }
        other => panic!("очікували write-edit, отримали {other:?}"),
    }
    match &plan.edits[1] {
        FileEdit::Delete { path } => assert_eq!(path, "src/extra.txt"),
        other => panic!("очікували delete-edit, отримали {other:?}"),
    }
}

/// План із `..`-шляхом відхиляється host-валідатором
/// (`rules-contract::validators::fix`, переюз safe-path перевірки слоту
/// `ci.artifact@1`) типізовано — [`PluginHostError::InvalidContractData`],
/// план НЕ повертається оркестрації навіть частково.
#[test]
fn fix_plan_with_path_escape_is_rejected_typed() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let request = FixRequest {
        concern_id: FIX_ESCAPE_CONCERN_ID.to_string(),
        files: vec![],
        diagnostics: vec![],
    };
    match plugin.fix(&request) {
        Err(PluginHostError::InvalidContractData(message)) => {
            assert!(
                message.contains("fix-plan відхилено"),
                "повідомлення мало назвати відхилення плану: {message}"
            );
            assert!(
                message.contains("../escape.txt"),
                "повідомлення мало вказати проблемний шлях: {message}"
            );
        }
        Err(other) => panic!("очікували InvalidContractData, отримали {other:?}"),
        Ok(_) => panic!("план із ..-шляхом мав бути відхилений"),
    }
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

// --- host-context контур (slot-канал host-контексту, батч 6 §3.5.5) ---
//
// `test/guest-context-echo` (`crates/test-plugin-guest/src/lib.rs`) кличе
// `host-context("repo-root@1")` і `host-context("no-such-slot@1")` та
// відображає обидва результати у `data` однієї діагностики. Це — режим
// guest-а З викликом нового імпорту; режим guest-а БЕЗ виклику (уже
// пінований плагін, зібраний до появи `import host-context`) фіксує
// template-guest скіла (`tests/wasm_plugin_skill_smoke.rs`): він не
// референсить імпорт зовсім і інстанціюється тим самим linker-ом без змін —
// саме тому додавання host-імпорту НЕ є breaking-зміною контракту
// (доккомент `wit/world.wit` біля `import host-context`).

/// Слот `repo-root@1` віддає значення, виставлене
/// `LoadedPlugin::set_repo_root`, а невідомий слот — `none` (skip-not-crash).
#[test]
fn host_context_repo_root_slot_round_trips_when_set() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();
    plugin.set_repo_root(Some("/consumer/repo".to_string()));

    let batch = DetectBatch {
        concern_id: CONTEXT_ECHO_CONCERN_ID.to_string(),
        files: vec![],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("context-echo detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "context-echo");
    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("context-echo діагностика повинна мати заповнений data");
    assert_eq!(
        data.get("repo_root"),
        Some(&serde_json::Value::String("/consumer/repo".to_string())),
        "слот repo-root@1 мав віддати виставлений корінь: {data:?}"
    );
    assert_eq!(
        data.get("unknown_slot"),
        Some(&serde_json::Value::Null),
        "невідомий слот МАЄ віддавати none, не панікувати: {data:?}"
    );
}

/// Без `set_repo_root` слот `repo-root@1` — `none`: guest мусить деградувати
/// сам (доккомент `wit/world.wit`), хост не вигадує контекст.
#[test]
fn host_context_repo_root_slot_defaults_to_none() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONTEXT_ECHO_CONCERN_ID.to_string(),
        files: vec![],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("context-echo detect не мав провалитись без repo_root");
    assert_eq!(diagnostics.len(), 1);
    let data = diagnostics[0].data.as_ref().unwrap();
    assert_eq!(data.get("repo_root"), Some(&serde_json::Value::Null));
    assert_eq!(data.get("unknown_slot"), Some(&serde_json::Value::Null));
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

// --- exec-tool контур (зріз 5 контракту v3.1, рішення А/Б спеки
// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`) -----------------
//
// Гілки, які має покривати host-бік `exec-tool`: повний виконавчий контекст
// РАЗОМ (`cwd` + накладений `env` + двобічний scratch-обмін),
// незадекларований тул (типізована помилка, не паніка) і час життя
// scratch-каталогу (штатний вихід і trap гостя).

/// Фейковий тул `exec-tool`-хука гостя: перший аргумент — шлях
/// scratch-каталогу (гість бере його зі слоту `scratch-dir@1` і кладе туди
/// САМ — placeholder-підстановки контракт не має), другий — ехо. Скрипт
/// друкує накладену змінну середовища й свій `pwd`, читає підкладений
/// `scratch-in` і пише звіт, який хост забере за `scratch-out`-глобом.
#[cfg(unix)]
const EXEC_TOOL_SCRIPT: &str = "#!/bin/sh\n\
     echo \"probe=$N_EXEC_TOOL_PROBE rest=$2 pwd=$(pwd)\"\n\
     cat \"$1/input.txt\" > \"$1/report.out\"\n";

/// Хост із резолвленим `echo-tool` для `exec-tool`-тестів.
#[cfg(unix)]
fn exec_tool_host(dir: &std::path::Path) -> PluginHost {
    let script = write_executable_script(dir, "echo-tool", EXEC_TOOL_SCRIPT);
    let mut tools = HashMap::new();
    tools.insert("echo-tool".to_string(), script);
    PluginHost::new(ToolResolver::new(tools)).expect("PluginHost::new не мав провалитись")
}

/// Витягує шлях scratch-каталогу з `data` діагностики `exec-tool`-хука.
#[cfg(unix)]
fn scratch_dir_from(diagnostics: &[rules_contract::diagnostic::Diagnostic]) -> String {
    diagnostics[0]
        .data
        .as_ref()
        .expect("exec-tool діагностика повинна мати заповнений data")
        .get("scratch_dir")
        .and_then(|value| value.as_str())
        .expect("слот scratch-dir@1 мав віддати шлях")
        .to_string()
}

/// Наскрізний `exec-tool`: усі поля виконавчого контексту працюють РАЗОМ на
/// одному виклику — процес стартує в `<repo-root>/nested`, бачить накладену
/// змінну середовища, читає матеріалізований `scratch-in` і віддає звіт,
/// який хост збирає за глобом `*.out`.
#[cfg(unix)]
#[test]
fn exec_tool_applies_cwd_env_and_round_trips_scratch() {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let host = exec_tool_host(dir.path());

    let repo = tempfile::tempdir().expect("tempdir має створитись");
    fs::create_dir_all(repo.path().join("nested")).expect("mkdir не мав провалитись");

    let path = require_fixture();
    let mut plugin = host.load(&path, PLUGIN_WORLD_VERSION).unwrap();
    plugin.set_repo_root(Some(repo.path().to_string_lossy().into_owned()));

    let batch = DetectBatch {
        concern_id: EXEC_TOOL_CONCERN_ID.to_string(),
        files: vec![],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("exec-tool detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "exec-tool");

    let message = &diagnostics[0].message;
    assert!(
        message.contains("probe=42"),
        "`env` мав накластись поверх успадкованого середовища: {message:?}"
    );
    assert!(
        message.contains("rest=hello"),
        "аргументи мали дійти до тула як є: {message:?}"
    );
    assert!(
        message.trim_end().ends_with("nested"),
        "процес мав стартувати в <repo-root>/nested (поле `cwd`): {message:?}"
    );

    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("exec-tool діагностика повинна мати заповнений data");
    assert_eq!(data.get("status"), Some(&serde_json::Value::from(0)));
    assert_eq!(
        data.get("scratch_out").and_then(|value| value.as_str()),
        Some("report.out=from-guest"),
        "хост мав зібрати звіт тула за глобом і віддати його гостю: {data:?}"
    );
    assert_eq!(data.get("has_error"), Some(&serde_json::Value::Bool(false)));
}

/// Незадекларований (не резолвлений) тул — ТА САМА типізована помилка, що
/// вже дає `run-tool`: `status: none`, людиночитний `stderr`, жодної паніки
/// й жодного `Err` на рівні `detect`.
#[test]
fn exec_tool_missing_from_resolver_returns_typed_error_in_diagnostic() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: EXEC_TOOL_CONCERN_ID.to_string(),
        files: vec![],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("exec-tool detect не мав провалитись навіть без резолвленого тула");
    assert_eq!(diagnostics.len(), 1);
    let data = diagnostics[0].data.as_ref().unwrap();
    assert_eq!(data.get("status"), Some(&serde_json::Value::Null));
    assert_eq!(data.get("has_error"), Some(&serde_json::Value::Bool(true)));
    assert_eq!(
        data.get("scratch_out").and_then(|value| value.as_str()),
        Some(""),
        "промах резолву не має нічого збирати зі scratch"
    );
}

/// Слот `scratch-dir@1` віддає РЕАЛЬНИЙ каталог, який існує під час виклику
/// гостя й ЗНИКАЄ після повернення, а наступний виклик отримує НОВИЙ шлях —
/// контракт «каталог живе рівно один `detect`/`fix`-виклик» (доккомент
/// `wit/world.wit`).
#[cfg(unix)]
#[test]
fn scratch_dir_slot_lives_exactly_one_call() {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let host = exec_tool_host(dir.path());

    let path = require_fixture();
    let mut plugin = host.load(&path, PLUGIN_WORLD_VERSION).unwrap();
    let batch = DetectBatch {
        concern_id: EXEC_TOOL_CONCERN_ID.to_string(),
        files: vec![],
    };

    let first = plugin.detect(&batch).expect("detect не мав провалитись");
    let first_dir = scratch_dir_from(&first);
    assert!(
        !PathBuf::from(&first_dir).exists(),
        "scratch-каталог {first_dir} мав зникнути одразу після повернення з detect"
    );

    let second = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_ne!(
        first_dir,
        scratch_dir_from(&second),
        "другий виклик того самого (закешованого) плагіна мав отримати НОВИЙ каталог"
    );
}

/// Trap гостя (паніка всередині `detect`) не лишає scratch-каталог на
/// диску: `LoadedPlugin` прибирає його НАВКОЛО виклику, а не лише в
/// happy-path гілці.
///
/// Шлях каталогу того самого виклику, що тріпнув, тест дізнається з ЛОГІВ
/// (guest-хук логує його перед панікою — повернути нема як) — `take_logs`
/// дренує буфер `Store` уже після невдалого виклику.
///
/// Тест заразом фіксує задокументовану поведінку Component Model: після
/// trap-у інстанс ОТРУЄНИЙ (`cannot enter component instance`), тобто
/// плагін після паніки більше не викликається. Це не наслідок
/// scratch-контуру, але саме воно пояснює, чому прибирання НЕ можна
/// відкладати «до наступного виклику» — наступного може не бути.
#[cfg(unix)]
#[test]
fn scratch_dir_is_removed_even_when_guest_traps() {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let host = exec_tool_host(dir.path());

    let path = require_fixture();
    let mut plugin = host.load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let probe = plugin
        .detect(&DetectBatch {
            concern_id: EXEC_TOOL_CONCERN_ID.to_string(),
            files: vec![],
        })
        .expect("detect не мав провалитись");
    let probe_dir = scratch_dir_from(&probe);
    let _ = plugin.take_logs();

    let err = plugin
        .detect(&DetectBatch {
            concern_id: PANIC_CONCERN_ID.to_string(),
            files: vec![],
        })
        .expect_err("хук навмисної паніки мав повернути типізовану помилку виконання");
    assert!(matches!(err, PluginHostError::Execution { .. }), "{err:?}");
    assert!(
        !PathBuf::from(&probe_dir).exists(),
        "каталог попереднього виклику мав зникнути"
    );

    let trapped_dir = plugin
        .take_logs()
        .into_iter()
        .find_map(|log| {
            log.message
                .strip_prefix("panic-hook: scratch-dir=")
                .map(str::to_string)
        })
        .expect("guest-хук мав залогувати свій scratch-каталог перед панікою");
    assert!(
        !trapped_dir.is_empty(),
        "слот `scratch-dir@1` мав віддати шлях і всередині виклику, що тріпнув"
    );
    assert!(
        !PathBuf::from(&trapped_dir).exists(),
        "scratch-каталог {trapped_dir} виклику, що тріпнув, мав бути прибраний хостом"
    );

    let poisoned = plugin.detect(&DetectBatch {
        concern_id: EXEC_TOOL_CONCERN_ID.to_string(),
        files: vec![],
    });
    assert!(
        poisoned.is_err(),
        "після trap-у інстанс отруєний — Component Model не пускає в нього повторно"
    );
}
