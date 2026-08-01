//! `HostState` — дані `Store<T>` для одного завантаженого плагіна: WASI-контекст
//! (preopens за capabilities, рішення Е спеки) і наш host-стан (лог-капчур,
//! прогрес-капчур, [`ToolResolver`] — реальний run-tool контур, рішення Д,
//! задача N1).

use std::cell::RefCell;
use std::sync::Arc;

use wasmtime::component::ResourceTable;
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use rules_contract::tool::LogLevel;

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

    fn log(&mut self, level: wit::LogLevel, message: String) {
        self.logs.borrow_mut().push(CapturedLog {
            level: crate::convert::log_level_from_wit(level),
            message,
        });
    }

    /// Slot-канал host-контексту (доккомент `wit/world.wit` біля
    /// `import host-context`): відомий лише `repo-root@1`; невідомий slot →
    /// `None` (skip-not-crash — guest мусить деградувати, не панікувати).
    fn host_context(&mut self, slot: String) -> Option<String> {
        match slot.as_str() {
            "repo-root@1" => self.repo_root.clone(),
            _ => None,
        }
    }
}
