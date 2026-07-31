//! Мінімальна guest-фікстура contract-test-kit `crates/rules-plugin-host`
//! (задача I2 фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`): реалізує
//! `n-rules:plugin@3.0.0` з одним lint-концерном `test/guest-echo` — по
//! одній діагностиці на кожен файл вхідного батчу, без реального аналізу
//! вмісту (лише перевірка ABI/серіалізації DTO і host-функцій `log`/
//! `report-progress`/`run-tool`).

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

/// `concern-id`, за яким `detect` замість echo-діагностик пробує пряме
/// читання ФС (`std::fs::read_to_string`) — окремий, детермінований тест-хук
/// для WASI preopen-контуру (задача I2, п.3 contract-test-kit): маніфест
/// НІКОЛИ не декларує `fs-read` (лишається порожнім, як типовий концерн,
/// спека §3.2), тож `PluginHost` ніколи не відкриє жодного preopen-шляху для
/// цього плагіна — спроба читання МАЄ провалюватись незалежно від того, що
/// реально є на хості (WASI-пісочниця без preopens не бачить жодного шляху
/// зовсім, тож результат детермінований і не залежить від cwd/фікстур на
/// диску — просте й надійне альтернативне рішення позитивному
/// («preopen дійсно відкриває шлях») тесту, який вимагав би координації
/// guest-шляху з реальними файлами відносно cwd тестового бінаря;
/// задокументовано в contract-test-kit `crates/rules-plugin-host/tests/`).
const FS_PROBE_CONCERN_ID: &str = "test/guest-echo-fs-probe";

/// `concern-id`, що перевіряє host-mediated run-tool контур (задача N1,
/// п.4, спека §2 рішення Д): кличе `run-tool("echo-tool", ["hello"], None)`
/// і повертає ОДНУ діагностику, що відображає `tool-output` — успішну
/// (тул резолвлений `ToolResolver`-ом хоста, `status == Some(0)`, `stdout`
/// містить echo) чи помилкову (тул поза мапою чи таймаут, `status: none`,
/// `stderr` — людиночитний текст помилки `ToolResolver`) гілку. Маніфест
/// декларує `"echo-tool"` у `tools` (доккомент модуля `ToolResolver`:
/// версійний суфікс тут не потрібен, семантика — «ім'я без діапазону»)
/// — contract-test-kit (`crates/rules-plugin-host/tests/contract_test_kit.rs`)
/// тестує ОБИДВІ гілки, підмінюючи `ToolResolver` між прогонами.
const TOOL_ECHO_CONCERN_ID: &str = "test/guest-tool-echo";

/// Guest-реалізація world `plugin` — концерн-заглушка `test/guest-echo`,
/// fs-preopen тест-хук `test/guest-echo-fs-probe` і run-tool тест-хук
/// `test/guest-tool-echo`.
struct GuestEcho;

impl Guest for GuestEcho {
    fn describe() -> Manifest {
        log(LogLevel::Info, "test-plugin-guest: describe()");
        Manifest {
            id: "test/guest-echo".to_string(),
            version: "0.1.0".to_string(),
            world_version: "3.0.0".to_string(),
            domains: vec![Domain::Lint],
            concerns: vec![
                ConcernContribution {
                    key: "test/guest-echo".to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
                ConcernContribution {
                    key: FS_PROBE_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
                ConcernContribution {
                    key: TOOL_ECHO_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
            ],
            ci_artifacts: vec![],
            capabilities: Capabilities {
                // Навмисно порожньо — типовий концерн лишає `fs-read`
                // порожнім (спека §3.2, вміст файлів хост передає inline у
                // `DetectBatch`); `FS_PROBE_CONCERN_ID` перевіряє саме
                // ЦЕЙ дефолт (preopen-ів немає, доккомент вище).
                fs_read: vec![],
                network: false,
            },
            tools: vec!["echo-tool".to_string()],
        }
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        if batch.concern_id == FS_PROBE_CONCERN_ID {
            return vec![fs_probe_diagnostic()];
        }
        if batch.concern_id == TOOL_ECHO_CONCERN_ID {
            return vec![tool_echo_diagnostic()];
        }
        let total = batch.files.len() as u32;
        let mut diagnostics = Vec::with_capacity(batch.files.len());
        for (index, file) in batch.files.iter().enumerate() {
            report_progress(index as u32 + 1, total);
            diagnostics.push(Diagnostic {
                reason: "guest-echo".to_string(),
                message: format!("guest-echo: {}", file.path),
                file: Some(file.path.clone()),
                severity: Severity::Warn,
                data: None,
            });
        }
        log(
            LogLevel::Info,
            &format!("test-plugin-guest: detect() опрацював {total} файл(ів)"),
        );
        diagnostics
    }

    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

/// Один спробний `std::fs::read_to_string` за довільним відносним шляхом —
/// доккомент [`FS_PROBE_CONCERN_ID`] пояснює, чому результат детермінований
/// (порожній `capabilities.fs_read` ⇒ `PluginHost` не відкриє жодного
/// preopen-шляху для цього плагіна, тож читання МАЄ провалюватись). `data`
/// — вручну зібраний JSON-рядок (без `serde_json` — крейт не тягне цю
/// залежність для однієї діагностики), формат узгоджений із тестом
/// contract-test-kit, що його парсить.
fn fs_probe_diagnostic() -> Diagnostic {
    let readable = std::fs::read_to_string("anything.txt").is_ok();
    Diagnostic {
        reason: "fs-probe".to_string(),
        message: "fs-probe: спроба читання поза preopens".to_string(),
        file: None,
        severity: Severity::Warn,
        data: Some(format!("{{\"fs_probe_readable\":{readable}}}")),
    }
}

/// Один `run-tool("echo-tool", ["hello"], None)` — доккомент
/// [`TOOL_ECHO_CONCERN_ID`] пояснює обидві гілки (успіх/помилка), які тут
/// зводяться в одну діагностику. `data` — вручну зібраний JSON-рядок (той
/// самий мотив, що [`fs_probe_diagnostic`]): `status` — код завершення чи
/// `null`, `ok` — чи `status == Some(0)`.
fn tool_echo_diagnostic() -> Diagnostic {
    let output = run_tool("echo-tool", &["hello".to_string()], None);
    let ok = output.status == Some(0);
    let message = if ok {
        format!("tool-echo: stdout={}", output.stdout.trim())
    } else {
        format!("tool-echo: error={}", output.stderr)
    };
    let status_json = match output.status {
        Some(code) => code.to_string(),
        None => "null".to_string(),
    };
    Diagnostic {
        reason: "tool-echo".to_string(),
        message,
        file: None,
        severity: Severity::Warn,
        data: Some(format!("{{\"status\":{status_json},\"ok\":{ok}}}")),
    }
}

export!(GuestEcho);
