//! `HostState` — дані `Store<T>` для одного завантаженого плагіна: WASI-контекст
//! (preopens за capabilities, рішення Е спеки) і наш host-стан (лог-капчур,
//! прогрес-капчур, run-tool callback, рішення Д).

use std::cell::RefCell;
use std::sync::Arc;

use wasmtime::component::ResourceTable;
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use rules_contract::tool::{LogLevel, ToolOutput};

use crate::wit;

/// Host-mediated run-tool callback (рішення Д спеки) — плагін сам нічого не
/// спавнить, лише запитує виконання задекларованого в `Manifest::tools`
/// tool-у; реальний ensure-tool контур (перевірка наявності, встановлення)
/// належить оркестрації (поза цією задачею, фаза 7) — тут лише інʼєкція
/// callback-у.
pub type RunToolFn = dyn Fn(&str, &[String], Option<&str>) -> ToolOutput + Send + Sync + 'static;

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
    pub(crate) run_tool: Arc<RunToolFn>,
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
        let out = (self.run_tool)(&tool, &args, stdin.as_deref());
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
}
