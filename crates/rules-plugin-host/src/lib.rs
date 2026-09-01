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

mod caps_file_reader;
mod caps_llm_consumer;
mod caps_registry_reader;
mod convert;
// `pub` (на відміну від решти модулів цього списку) — доккомент
// `crate::docgen_scan`: жоден wasmtime/wit-bindgen тип сюди не
// просочується (рішення М спеки лишається неушкодженим), але БЕЗ жодного
// консюмера (docgen-stage — майбутня робота) `pub` — єдиний спосіб не
// зробити [`docgen_scan::list_docgen_candidate_paths`] «мертвим кодом» у
// значенні лінтера: той самий прийом, що `crates/plugin-docgen`'s
// `pub mod scan;`.
pub mod docgen_scan;
mod error;
mod host;
mod host_state;
mod loaded_plugin;
mod rego_engine;
mod scratch;
mod surfaces_coverage_provider;
mod tool_resolver;
mod wit;
mod world_linker;

pub use caps_llm_consumer::{BoxFuture as LlmCallFuture, DomainError as LlmDomainError, LlmCaller};
pub use caps_registry_reader::{
    BoxFuture as RegistryProviderFuture, RegistryCiArtifactCandidate, RegistryProvider,
    StaticRegistryProvider,
};
pub use error::PluginHostError;
pub use host::PluginHost;
pub use host_state::{CapturedLog, CapturedProgress};
pub use loaded_plugin::LoadedPlugin;
pub use tool_resolver::{ToolResolver, DEFAULT_TOOL_TIMEOUT};
