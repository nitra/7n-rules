//! `HostState` — дані `Store<T>` для одного завантаженого плагіна: WASI-контекст
//! (preopens за capabilities, рішення Е спеки) і наш host-стан (лог-капчур,
//! прогрес-капчур, [`ToolResolver`] — реальний run-tool контур, рішення Д,
//! задача N1).

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use wasmtime::component::ResourceTable;
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use rules_contract::tool::{LogLevel, ScratchFile, ToolRequest, ToolResult};

use crate::caps_file_reader;
use crate::caps_llm_consumer;
use crate::scratch::ScratchDir;
use crate::tool_resolver::ToolResolver;
use crate::wit;

/// Один запис логу, захоплений із host-функції `log` (plugin → host).
#[derive(Debug, Clone)]
pub struct CapturedLog {
    pub level: LogLevel,
    pub message: String,
}

/// Один запис прогресу, захоплений із host-функції `report-progress`
/// (plugin → host) — спека §2 рішення Г: прогрес per-concern, на боці
/// хоста; тут — буфер, який хост дренує після виклику (`LoadedPlugin::take_progress`).
#[derive(Debug, Clone, Copy)]
pub struct CapturedProgress {
    pub done: u32,
    pub total: u32,
}

/// Дані `Store<T>` для одного завантаженого плагіна.
///
/// `logs`/`progress` — `RefCell`, не `Vec` напряму: host-функції отримують
/// лише `&mut self` через `PluginImports`, а `Store`/`Instance`
/// переюзаються між викликами (рішення Г спеки, пул інстансів) — інтерфейс
/// `LoadedPlugin::detect`/`fix` бере `&mut self`, тож прямий `&mut Vec`
/// теж підійшов би, але `RefCell` лишає можливість дренувати буфер без
/// додаткового `&mut` до `HostState` з боку виклику, що спрощує сигнатури
/// `PluginImports`.
pub(crate) struct HostState {
    pub(crate) wasi_ctx: WasiCtx,
    pub(crate) table: ResourceTable,
    pub(crate) logs: RefCell<Vec<CapturedLog>>,
    pub(crate) progress: RefCell<Vec<CapturedProgress>>,
    pub(crate) tool_resolver: Arc<ToolResolver>,
    /// Абсолютний корінь consumer-репо поточного виклику — payload слоту
    /// `repo-root@1` host-функції `host-context` (доккомент `wit/world.wit`
    /// біля `import host-context`). `None` — хост не має контексту (guest
    /// отримує `none` і деградує сам). Виставляється per-виклик через
    /// `LoadedPlugin::set_repo_root` (той самий мотив, що `tool_resolver`:
    /// `LoadedPlugin` кешується per-path, а `cwd` приходить з кожним
    /// napi-викликом окремо).
    pub(crate) repo_root: Option<String>,
    /// Тимчасовий каталог обміну з `exec-tool` — payload слоту
    /// `scratch-dir@1` (зріз 5 контракту v3.1, рішення Б спеки
    /// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`).
    ///
    /// `Option` всередині `RefCell` — ЛІНИВІСТЬ: каталог створюється рівно
    /// тоді, коли гість уперше його попросив (слотом чи запитом зі
    /// `scratch-in`/`scratch-out`), тож концерн, який `exec-tool` не
    /// використовує, не платить за нього жодним зверненням до ФС. Час життя —
    /// один `detect`/`fix`-виклик: `LoadedPlugin` скидає поле і перед, і
    /// після виклику гостя (`Drop` `TempDir` прибирає каталог рекурсивно),
    /// тож шлях не можна кешувати між викликами.
    pub(crate) scratch: RefCell<Option<ScratchDir>>,
    /// Абсолютний корінь, від якого world `n-rules:caps/file-reader@1.0.0`
    /// (`crate::caps_file_reader`, крок 4.1 спеки
    /// `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1) обходить і читає
    /// диск — той самий `preopen_root`, що `PluginHost::build_host_state`
    /// отримує параметром (`src/host.rs`). **Не** WASI-preopen: `list-files`/
    /// `read-file-bytes` — host-import функції, що читають диск НАПРЯМУ
    /// host-процесом, а не guest-syscall крізь WASI-пісочницю, тож окреме
    /// поле, не переюз `capabilities.fs_read`-preopens. `None` — плагін
    /// завантажений без кореня (`PluginHost::load`): `read-file-bytes` тоді
    /// відмовляє типізовано (WIT дає `result`), `list-files` (без каналу
    /// помилки в WIT) повертає порожній перелік і лишає слід у логах —
    /// доккомент [`HostState::list_files`]/[`HostState::read_file_bytes`].
    pub(crate) fs_read_root: Option<PathBuf>,
    /// Реалізація `llm-call` для `n-rules:caps/llm-consumer@1.0.0`
    /// (`crate::caps_llm_consumer`, крок 4.1 спеки
    /// `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1, застосований
    /// ДРУГИЙ раз). `Arc<dyn LlmCaller>`, не пряме `LocalCloud` — той самий
    /// DI-мотив, що `tool_resolver` вище, і той самий, що робить цей світ
    /// тестовним без реального мережевого виклику (доккомент
    /// `caps_llm_consumer::LlmCaller`, «навіщо `pub`»):
    /// `PluginHost::new` кладе сюди [`caps_llm_consumer::RealLlmCaller`],
    /// `PluginHost::new_with_llm_caller` — довільний тестовий двійник.
    pub(crate) llm_caller: std::sync::Arc<dyn caps_llm_consumer::LlmCaller>,
}

impl HostState {
    /// Повертає scratch-каталог, створюючи його при першому запиті
    /// (доккомент поля [`Self::scratch`]). `false` — створити не вдалось
    /// (read-only ФС, вичерпано місце): гість отримає `none` слоту чи
    /// типізовану помилку в `tool-result`, хост не панікує.
    fn ensure_scratch(&self) -> bool {
        let mut slot = self.scratch.borrow_mut();
        if slot.is_none() {
            match ScratchDir::new() {
                Ok(dir) => *slot = Some(dir),
                Err(err) => {
                    self.logs.borrow_mut().push(CapturedLog {
                        level: LogLevel::Warn,
                        message: format!(
                            "scratch-dir@1: не вдалось створити тимчасовий каталог обміну: {err}"
                        ),
                    });
                    return false;
                }
            }
        }
        true
    }
}

impl WasiView for HostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi_ctx,
            table: &mut self.table,
        }
    }
}

// `async fn` на кожному методі — вимога `imports: { default: async }`
// bindgen-конфігу (доккомент `crate::wit`), не реальна асинхронність: жодне
// тіло нижче не `.await`-ить нічого — вся робота лишається синхронною
// (`RefCell`-буфери, `ToolResolver` — блокуючий спавн процесу). Викликач
// (`PluginHost`/`LoadedPlugin`) `block_on`-ить кожен виклик на власному
// `current_thread`-рантаймі (доккомент `PluginHost` у `src/host.rs`), тож
// синхронний блок усередині `async fn` тут коректний і не блокує жоден
// сторонній executor.
impl wit::PluginImports for HostState {
    async fn report_progress(&mut self, done: u32, total: u32) {
        self.progress
            .borrow_mut()
            .push(CapturedProgress { done, total });
    }

    async fn run_tool(
        &mut self,
        tool: String,
        args: Vec<String>,
        stdin: Option<String>,
    ) -> wit::ToolOutput {
        let out = self.tool_resolver.run(&tool, &args, stdin.as_deref());
        wit::ToolOutput {
            status: out.status,
            stdout: out.stdout,
            stderr: out.stderr,
        }
    }

    /// Host-mediated spawn ІЗ ВИКОНАВЧИМ КОНТЕКСТОМ (зріз 5 контракту v3.1,
    /// рішення А спеки
    /// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`): `run-tool`
    /// плюс `cwd`/`env`/scratch-обмін. Уся логіка — у
    /// [`ToolResolver::exec`]; тут лише міст WIT ⇄ DTO і ліниве створення
    /// scratch-каталогу.
    ///
    /// # Trust boundary (рішення З спеки) — фіксуємо вголос
    ///
    /// Спавнений тул виконується **з правами хост-процесу, ПОЗА
    /// wasm-пісочницею**, і **МОЖЕ писати в репо** (`stylelint --fix` саме
    /// так і працює). Ані `capabilities.fs-read`, ані
    /// `capabilities.network`, ані відсутність WASI-preopens до нього не
    /// застосовуються взагалі: пісочниця обмежує wasm-код гостя, а не
    /// процес, який гість попросив запустити. Хост звужує рівно три речі —
    /// ЯКИЙ бінарник (лише задекларований у `manifest.tools` і забезпечений
    /// ensure-tool контуром), ЗВІДКИ він стартує (`cwd` валідується як
    /// безпечний repo-relative) і ЩО потрапляє у scratch (шляхи без `..`,
    /// ліміти розміру). Усе інше — аргументи, env, те, що тул реально
    /// робить із диском і мережею — поза контролем хоста.
    ///
    /// Тобто **межа довіри плагіна — його пін (`url` + `sha256`), а не
    /// пісочниця**; ревʼю піна = ревʼю прав. Enforcement свідомо НЕ
    /// додається: він неможливий без власного sandbox-шару навколо спавна
    /// (ізоляція процесу засобами трьох різних ОС) — це не бюджет v3.1.
    /// Той самий текст стоїть у WIT (`record tool-result`) — щоб автор
    /// плагіна прочитав його ще до того, як напише перший `exec-tool`.
    async fn exec_tool(&mut self, request: wit::ToolRequest) -> wit::ToolResult {
        let request = ToolRequest {
            tool: request.tool,
            args: request.args,
            stdin: request.stdin,
            cwd: request.cwd,
            env: request.env,
            scratch_in: request
                .scratch_in
                .into_iter()
                .map(|file| ScratchFile {
                    path: file.path,
                    content: file.content,
                })
                .collect(),
            scratch_out: request.scratch_out,
        };
        let needs_scratch = !request.scratch_in.is_empty() || !request.scratch_out.is_empty();
        if needs_scratch {
            self.ensure_scratch();
        }
        let repo_root = self.repo_root.clone();
        let scratch = self.scratch.borrow();
        let result = self.tool_resolver.exec(
            &request,
            repo_root.as_deref().map(Path::new),
            scratch.as_ref(),
        );
        to_wit_tool_result(result)
    }

    async fn log(&mut self, level: wit::LogLevel, message: String) {
        self.logs.borrow_mut().push(CapturedLog {
            level: crate::convert::log_level_from_wit(level),
            message,
        });
    }

    /// Slot-канал host-контексту (доккомент `wit/world.wit` біля
    /// `import host-context`): відомі `repo-root@1` і `scratch-dir@1`;
    /// невідомий slot → `None` (skip-not-crash — guest мусить деградувати,
    /// не панікувати).
    ///
    /// `scratch-dir@1` — ЄДИНИЙ слот із side-effect-ом: перший запит
    /// створює тимчасовий каталог (доккомент поля [`HostState::scratch`] і
    /// `wit/world.wit`). Провал створення теж дає `None` — гість не
    /// відрізняє «немає каталогу» від «немає слоту», і в обох випадках має
    /// деградувати однаково.
    async fn host_context(&mut self, slot: String) -> Option<String> {
        match slot.as_str() {
            "repo-root@1" => self.repo_root.clone(),
            "scratch-dir@1" => {
                if !self.ensure_scratch() {
                    return None;
                }
                self.scratch
                    .borrow()
                    .as_ref()
                    .map(|dir| dir.path().to_string_lossy().into_owned())
            }
            _ => None,
        }
    }
}

// Реалізація `n-rules:caps/file-reader@1.0.0` (крок 4.1 спеки
// `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1, п.3 — «уся
// семантика» цього кроку): окремий `Host`-трейт `crate::caps_file_reader`
// (доккомент модуля), реалізований на ТОМУ САМОМУ `HostState`, що
// `wit::PluginImports` вище — той самий приймач, лише інший трейт, лінкер
// поєднує обидва вибірково (`crate::world_linker`).
impl caps_file_reader::FileReaderImports for HostState {
    /// `list-files` — переліковує шляхи під [`Self::fs_read_root`], без
    /// вмісту (доккомент [`caps_file_reader::list_files_under_root`]).
    /// Порожній корінь (плагін завантажений без `PluginHost::load_in_root`)
    /// — WIT не дає каналу помилки для цієї функції (`-> list<string>`),
    /// тож єдина чесна відповідь — порожній перелік, а слід лишається в
    /// логах (той самий формат, що [`Self::ensure_scratch`] пише при
    /// провалі створення scratch-каталогу).
    async fn list_files(&mut self, globs: Vec<String>) -> Result<Vec<String>, caps_file_reader::DomainError> {
        let Some(root) = self.fs_read_root.clone() else {
            // Раніше тут був warn + порожній перелік — бо WIT не давав каналу
            // помилки. Порожній результат при збої НЕ відрізнити від «нічого
            // не знайшлось», і саме це правила проєкту називають вадою; форму
            // WIT виправлено (доккомент `file-reader.wit`), тож відмова тепер
            // типізована, як і в `read-file-bytes`.
            return Err(caps_file_reader::DomainError::Failed(
                "n-rules:caps/file-reader: list-files викликано без кореня preopen-ів \
                 (потрібен PluginHost::load_in_root*)"
                    .to_string(),
            ));
        };
        Ok(caps_file_reader::list_files_under_root(&root, &globs))
    }

    /// `read-file-bytes` — вміст ОДНОГО файлу байтами. На відміну від
    /// [`Self::list_files`], WIT дає канал помилки (`result<list<u8>,
    /// domain-error>`), тож і відсутній корінь, і небезпечний шлях
    /// (`..`-сегменти, ведучий `/`), і відсутній на диску файл — усі три
    /// типізовані відмови, не порожній/мовчазний результат (правило
    /// проєкту «мовчазний пропуск — вада»).
    async fn read_file_bytes(
        &mut self,
        path: String,
    ) -> Result<Vec<u8>, caps_file_reader::DomainError> {
        let Some(root) = self.fs_read_root.clone() else {
            return Err(caps_file_reader::DomainError::Failed(format!(
                "n-rules:caps/file-reader: read-file-bytes(`{path}`) викликано без кореня \
                 preopen-ів — вантажте плагін через PluginHost::load_in_root"
            )));
        };
        if !rules_contract::validators::ci_artifact::is_safe_repo_relative_path(&path) {
            return Err(caps_file_reader::DomainError::Failed(format!(
                "шлях `{path}` не є безпечним repo-relative шляхом (без `..`-сегментів, без \
                 ведучого `/`) — читання поза коренем репо заборонено"
            )));
        }
        std::fs::read(root.join(&path)).map_err(|err| {
            caps_file_reader::DomainError::Failed(format!("не вдалось прочитати `{path}`: {err}"))
        })
    }
}

// Реалізація `n-rules:caps/llm-consumer@1.0.0` (крок 4.1 спеки
// `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1, застосований ДРУГИЙ
// раз): окремий `Host`-трейт `crate::caps_llm_consumer`, реалізований на
// ТОМУ САМОМУ `HostState` — той самий приймач, лінкер поєднує обидва
// вибірково (`crate::world_linker`). Уся семантика (тир, таксономія
// помилок) живе в `crate::caps_llm_consumer` (доккомент модуля); тут —
// лише міст WIT ⇄ [`caps_llm_consumer::LlmCaller`].
impl caps_llm_consumer::LlmConsumerImports for HostState {
    async fn llm_call(
        &mut self,
        request: caps_llm_consumer::LlmRequest,
    ) -> Result<caps_llm_consumer::LlmResponse, caps_llm_consumer::DomainError> {
        let text = self.llm_caller.call(request.prompt).await?;
        Ok(caps_llm_consumer::LlmResponse { text })
    }
}

/// Конверсія DTO → WIT для `exec-tool` (зворотний бік — прямо в тілі
/// [`HostState::exec_tool`]): окрема функція, бо `scratch-out` вимагає
/// поелементного мапінгу, і вбудований у виклик він губився б серед
/// trust-boundary доккомента.
fn to_wit_tool_result(result: ToolResult) -> wit::ToolResult {
    wit::ToolResult {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        scratch_out: result
            .scratch_out
            .into_iter()
            .map(|file| wit::ScratchFile {
                path: file.path,
                content: file.content,
            })
            .collect(),
    }
}
