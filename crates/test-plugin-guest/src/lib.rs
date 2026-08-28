//! Мінімальна guest-фікстура contract-test-kit `crates/rules-plugin-host`
//! (задача I2 фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`): реалізує
//! `n-rules:plugin` з одним lint-концерном `test/guest-echo` — по одній
//! діагностиці на кожен файл вхідного батчу, без реального аналізу вмісту
//! (лише перевірка ABI/серіалізації DTO і host-функцій `log`/
//! `report-progress`/`run-tool`/`exec-tool`/`host-context`).
//!
//! Фікстура заявляє `world_version: "3.0.0"` і після зрізу 5 контракту v3.1
//! — свідомо: negotiation major-only, тож цей рядок додатково фіксує, що
//! хост v3.1 приймає плагін, який заявляє стару мінорну версію. Сам
//! компонент при цьому збирається з ПОТОЧНОГО world
//! (`../rules-contract/wit`) і реально кличе `exec-tool` — доказ
//! «v3.0-гість лінкується без змін» живе окремо, на замороженій копії
//! world-а (`crates/rules-plugin-host/tests/v30_guest_additive_compat.rs`).

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

/// `concern-id` fix-контуру (активація host-виклику `export fix`, доккомент
/// `wit/world.wit` біля `export fix`): `fix()` повертає детермінований
/// НЕПОРОЖНІЙ план — по одному `write`-edit-у на кожен файл запиту, чий
/// вміст містить `BROKEN` (замінюється на `FIXED`), плюс `delete`-edit для
/// кожної діагностики з `reason == "guest-delete"` і заповненим `file` —
/// contract-test-kit звіряє обидві гілки `file-edit` на одному виклику.
const FIX_REWRITE_CONCERN_ID: &str = "test/guest-fix-rewrite";

/// `concern-id` host-context тест-хука (slot-канал host-контексту, доккомент
/// `wit/world.wit` біля `import host-context`, батч 6 §3.5.5): кличе
/// `host-context("repo-root@1")` і `host-context("no-such-slot@1")` та
/// повертає ОДНУ діагностику з обома результатами в `data` —
/// contract-test-kit звіряє режим guest-а З викликом імпорту (значення при
/// виставленому `LoadedPlugin::set_repo_root`, `null` без нього, `null` для
/// невідомого слоту — skip-not-crash). Режим guest-а БЕЗ виклику фіксує
/// template-guest скіла (`tests/wasm_plugin_skill_smoke.rs`) — він
/// компілюється без жодної згадки `host-context` і інстанціюється тим самим
/// linker-ом без змін.
const CONTEXT_ECHO_CONCERN_ID: &str = "test/guest-context-echo";

/// `concern-id` `exec-tool` тест-хука (зріз 5 контракту v3.1, рішення А/Б
/// спеки `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`): бере шлях
/// зі слоту `scratch-dir@1`, кличе `exec-tool` з УСІМА полями контексту
/// одночасно (`cwd`, накладений `env`, `scratch-in`, `scratch-out`) і
/// повертає ОДНУ діагностику з усім, що побачив. Один хук замість чотирьох —
/// свідомо: контекст має працювати РАЗОМ, а часткові хуки не спіймали б
/// взаємодію (напр. тул, який читає `scratch-in` відносно свого `cwd`).
/// contract-test-kit підмінює `ToolResolver` і `repo-root@1` між прогонами,
/// щоб пройти й помилкову гілку (тул поза мапою → `status: none`).
const EXEC_TOOL_CONCERN_ID: &str = "test/guest-exec-tool";

/// `concern-id`, чий `detect` бере scratch-каталог і НАВМИСНО панікує —
/// contract-test-kit звіряє, що каталог не переживає trap гостя (виклик
/// повертає `Err`, а `LoadedPlugin` усе одно прибрав за собою). Шлях
/// каталогу тест дізнається окремим, успішним викликом
/// [`EXEC_TOOL_CONCERN_ID`] — паніка нічого повернути не може.
const PANIC_CONCERN_ID: &str = "test/guest-panic";

/// `concern-id`, чий `fix()` навмисно повертає план із `..`-шляхом
/// (`../escape.txt`) — contract-test-kit звіряє, що host-валідатор
/// (`rules-contract::validators::fix`) відхиляє такий план типізовано
/// (`PluginHostError::InvalidContractData`), не застосовуючи його.
const FIX_ESCAPE_CONCERN_ID: &str = "test/guest-fix-escape";

/// `concern-id` `scope: full` fix-регресії (задача fix/napi-empty-fix-batch,
/// `crates/rules-napi/src/lib.rs::ambiguous_empty_fix_batch_err`) —
/// ЄДИНИЙ `Full`-scope концерн цієї фікстури (решта — `PerFile`, доккомент
/// `describe()` нижче). Потрібен, щоб `cargo test -p rules-napi` міг
/// перевірити гілку `build_full_scope_files` (concern з `scope: full` і
/// порожнім `target_files`) БЕЗ збірки важчого `plugin-lang-js.wasm`
/// (реальний `js/check`) — `fix()` тут дзеркалить [`fix_rewrite_plan`]
/// (та сама `BROKEN` → `FIXED` семантика), тож непорожній `edits` доводить,
/// що host реально резолвнув файли з диска через full-scope glob-обхід, а
/// не просто не впав.
const FIX_FULL_SCOPE_CONCERN_ID: &str = "test/guest-fix-full-scope";

/// `concern-id` `scope: per-file` З НЕПОРОЖНІМ `glob` — detect-дзеркало
/// [`FIX_FULL_SCOPE_CONCERN_ID`] (§2.65,
/// `crates/rules-napi/src/lib.rs::build_detect_batch_files`). Решта
/// `PerFile`-концернів цієї фікстури декларує ПОРОЖНІЙ glob, тобто перевіряє
/// протилежну гілку («хост не має з чого будувати batch — падай гучно»);
/// цей — штатний full-прогін `per-file`-концерну: `detect()` для нього
/// падає у дефолтну echo-гілку (одна діагностика на КОЖЕН файл батчу), тож
/// непорожній результат при виклику `runWasmConcern(..., files: None)`
/// доводить, що хост реально обійшов диск за цим glob-ом, а не просто «не
/// впав». ДО §2.65 той самий виклик тихо повертав `{"violations": []}`.
const DETECT_PER_FILE_GLOB_CONCERN_ID: &str = "test/guest-detect-per-file-glob";

/// Guest-реалізація world `plugin` — концерн-заглушка `test/guest-echo`,
/// fs-preopen тест-хук `test/guest-echo-fs-probe`, run-tool тест-хук
/// `test/guest-tool-echo`, exec-tool тест-хук `test/guest-exec-tool`
/// (зріз 5 контракту v3.1), trap-хук `test/guest-panic` і fix-хуки
/// `test/guest-fix-rewrite`/`test/guest-fix-escape`/`test/guest-fix-full-scope`.
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
                ConcernContribution {
                    key: CONTEXT_ECHO_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
                ConcernContribution {
                    key: EXEC_TOOL_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
                ConcernContribution {
                    key: PANIC_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
                ConcernContribution {
                    key: FIX_REWRITE_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
                ConcernContribution {
                    key: FIX_ESCAPE_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec![],
                },
                ConcernContribution {
                    key: FIX_FULL_SCOPE_CONCERN_ID.to_string(),
                    scope: ConcernScope::Full,
                    glob: vec!["**/*.marker".to_string()],
                },
                ConcernContribution {
                    key: DETECT_PER_FILE_GLOB_CONCERN_ID.to_string(),
                    scope: ConcernScope::PerFile,
                    glob: vec!["**/*.marker".to_string()],
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
        if batch.concern_id == CONTEXT_ECHO_CONCERN_ID {
            return vec![context_echo_diagnostic()];
        }
        if batch.concern_id == EXEC_TOOL_CONCERN_ID {
            return vec![exec_tool_diagnostic()];
        }
        if batch.concern_id == PANIC_CONCERN_ID {
            // Навмисний trap гостя (доккомент [`PANIC_CONCERN_ID`]): беремо
            // scratch-каталог ДО паніки — щоб він точно був створений і хосту
            // було що прибирати — і ЛОГУЄМО його шлях. Лог — єдиний канал,
            // яким тест може дізнатись цей шлях: повернути його нема як
            // (паніка не повертає), а `take_logs` дренує буфер `Store` вже
            // ПІСЛЯ невдалого виклику.
            let scratch = host_context("scratch-dir@1").unwrap_or_default();
            log(
                LogLevel::Info,
                &format!("panic-hook: scratch-dir={scratch}"),
            );
            panic!("test-plugin-guest: навмисна паніка тест-хука");
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

    fn fix(request: FixRequest) -> FixPlan {
        if request.concern_id == FIX_REWRITE_CONCERN_ID
            || request.concern_id == FIX_FULL_SCOPE_CONCERN_ID
        {
            return fix_rewrite_plan(&request);
        }
        if request.concern_id == FIX_ESCAPE_CONCERN_ID {
            // Навмисно невалідний план (доккомент [`FIX_ESCAPE_CONCERN_ID`])
            // — host МАЄ відхилити його ДО передачі оркестрації.
            return FixPlan {
                edits: vec![FileEdit::Write(WriteFile {
                    path: "../escape.txt".to_string(),
                    content: "escape".to_string(),
                })],
            };
        }
        // Дефолт для решти концернів — порожній план («нічого не чинити»):
        // саме ця заглушка гарантує сумісність активації host-виклику fix
        // для плагінів без власної fix-логіки (доккомент `wit/world.wit`
        // біля `export fix`; contract-test-kit: `fix_returns_empty_plan`).
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

/// Детермінований непорожній план для [`FIX_REWRITE_CONCERN_ID`] (доккомент
/// константи): `write` на кожен файл із `BROKEN` у вмісті (заміна на
/// `FIXED`), `delete` на кожну діагностику з `reason == "guest-delete"` і
/// заповненим `file`. Файли без `BROKEN` пропускаються — план лишається
/// мінімальним (той самий контракт «порожній план = нічого не чинити»).
fn fix_rewrite_plan(request: &FixRequest) -> FixPlan {
    let mut edits = Vec::new();
    for file in &request.files {
        if file.content.contains("BROKEN") {
            edits.push(FileEdit::Write(WriteFile {
                path: file.path.clone(),
                content: file.content.replace("BROKEN", "FIXED"),
            }));
        }
    }
    for diagnostic in &request.diagnostics {
        if diagnostic.reason == "guest-delete" {
            if let Some(path) = &diagnostic.file {
                edits.push(FileEdit::Delete(path.clone()));
            }
        }
    }
    FixPlan { edits }
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

/// Один виклик `exec-tool` з УСІМА полями виконавчого контексту одразу —
/// доккомент [`EXEC_TOOL_CONCERN_ID`] пояснює, навіщо один хук замість
/// чотирьох.
///
/// Шлях scratch-каталогу гість бере зі слоту `scratch-dir@1` і САМ кладе
/// його першим аргументом тула — placeholder-підстановки в аргументах
/// контракт свідомо не має (рішення Б спеки), тож ось як це виглядає з боку
/// автора плагіна. `data` — вручну зібраний JSON-рядок (той самий мотив, що
/// [`fs_probe_diagnostic`]).
fn exec_tool_diagnostic() -> Diagnostic {
    let scratch_dir = host_context("scratch-dir@1");
    let result = exec_tool(&ToolRequest {
        tool: "echo-tool".to_string(),
        args: vec![scratch_dir.clone().unwrap_or_default(), "hello".to_string()],
        stdin: None,
        cwd: Some("nested".to_string()),
        env: vec![("N_EXEC_TOOL_PROBE".to_string(), "42".to_string())],
        scratch_in: vec![ScratchFile {
            path: "input.txt".to_string(),
            content: "from-guest".to_string(),
        }],
        scratch_out: vec!["*.out".to_string()],
    });
    let status_json = match result.status {
        Some(code) => code.to_string(),
        None => "null".to_string(),
    };
    let scratch_dir_json = match &scratch_dir {
        Some(value) => format!("\"{value}\""),
        None => "null".to_string(),
    };
    let collected = result
        .scratch_out
        .iter()
        .map(|file| format!("{}={}", file.path, file.content))
        .collect::<Vec<_>>()
        .join(",");
    Diagnostic {
        reason: "exec-tool".to_string(),
        message: format!("exec-tool: stdout={}", result.stdout.trim()),
        file: None,
        severity: Severity::Warn,
        data: Some(format!(
            "{{\"status\":{status_json},\"scratch_dir\":{scratch_dir_json},\
             \"scratch_out\":\"{collected}\",\"has_error\":{}}}",
            !result.stderr.trim().is_empty()
        )),
    }
}

/// Один виклик `host-context` для відомого (`repo-root@1`) і невідомого
/// (`no-such-slot@1`) слотів — доккомент [`CONTEXT_ECHO_CONCERN_ID`]
/// пояснює обидва режими, які contract-test-kit звіряє на цій діагностиці.
/// `data` — вручну зібраний JSON-рядок (той самий мотив, що
/// [`fs_probe_diagnostic`]); значення слоту екранується як JSON-рядок
/// найпростішим способом (шляхи фікстур не містять лапок і зворотних слешів —
/// достатньо огорнути в лапки, спецсимволи в тест-кіті не використовуються).
fn context_echo_diagnostic() -> Diagnostic {
    let repo_root = host_context("repo-root@1");
    let unknown = host_context("no-such-slot@1");
    let repo_root_json = match &repo_root {
        Some(value) => format!("\"{value}\""),
        None => "null".to_string(),
    };
    let unknown_json = match &unknown {
        Some(value) => format!("\"{value}\""),
        None => "null".to_string(),
    };
    Diagnostic {
        reason: "context-echo".to_string(),
        message: format!(
            "context-echo: repo_root={}",
            repo_root.as_deref().unwrap_or("<none>")
        ),
        file: None,
        severity: Severity::Warn,
        data: Some(format!(
            "{{\"repo_root\":{repo_root_json},\"unknown_slot\":{unknown_json}}}"
        )),
    }
}

export!(GuestEcho);
