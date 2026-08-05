//! `HostState` — дані `Store<T>` для одного завантаженого плагіна: WASI-контекст
//! (preopens за capabilities, рішення Е спеки) і наш host-стан (лог-капчур,
//! прогрес-капчур, [`ToolResolver`] — реальний run-tool контур, рішення Д,
//! задача N1).

use std::cell::RefCell;
use std::path::Path;
use std::sync::Arc;

use wasmtime::component::ResourceTable;
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use rules_contract::tool::{LogLevel, ScratchFile, ToolRequest, ToolResult};

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

impl wit::PluginImports for HostState {
    fn report_progress(&mut self, done: u32, total: u32) {
        self.progress
            .borrow_mut()
            .push(CapturedProgress { done, total });
    }

    fn run_tool(
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
    fn exec_tool(&mut self, request: wit::ToolRequest) -> wit::ToolResult {
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

    fn log(&mut self, level: wit::LogLevel, message: String) {
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
    fn host_context(&mut self, slot: String) -> Option<String> {
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
