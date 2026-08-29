//! `rules-plugin-host` — embedded wasmtime-хост для `n-rules:plugin@4.0.0`
//! (задача I2 фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`).
//!
//! # Вузький публічний trait (рішення М спеки)
//!
//! Публічна поверхня — лише [`PluginHost`]/[`LoadedPlugin`] і DTO
//! `rules-contract`; жоден wasmtime/wit-bindgen тип сюди не просочується
//! (Component Model API нестабілізований між minor-релізами wasmtime —
//! мітигація в тому, щоб правки при його зламі лишались локальними цьому
//! крейту, спека §3.6). Публічний потік:
//!
//! ```ignore
//! let host = PluginHost::new(tool_resolver)?;
//! let mut plugin = host.load(path, PLUGIN_WORLD_VERSION)?;
//! let manifest = plugin.describe();
//! let diagnostics = plugin.detect(&batch)?;
//! ```
//!
//! # Пул інстансів
//!
//! `Store`/`Instance` переюзаються між викликами того самого плагіна
//! (найпростіший варіант reuse — рішення Г спеки); крос-плагінний пул
//! свідомо відкладено (`PluginHost::load` документує двофазну
//! інстанціацію).

mod convert;
mod error;
mod host;
mod host_state;
mod loaded_plugin;
mod rego_engine;
mod scratch;
mod tool_resolver;
mod wit;

pub use error::PluginHostError;
pub use host::PluginHost;
pub use host_state::{CapturedLog, CapturedProgress};
pub use loaded_plugin::LoadedPlugin;
pub use tool_resolver::{ToolResolver, DEFAULT_TOOL_TIMEOUT};
