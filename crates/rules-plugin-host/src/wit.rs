//! Автогенеровані Component Model біндінги `n-rules:plugin@3.0.0`
//! (`wasmtime::component::bindgen!` на `crates/rules-contract/wit/`, задача
//! I2 фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.1).
//!
//! Модуль навмисно приватний (`mod wit` без `pub`, лише `pub(crate)`) —
//! рішення М спеки: вузький публічний trait `rules-plugin-host` повністю
//! інкапсулює wasmtime, тож жоден тип цього модуля не перетинає межу крейта.
//! Конверсія в/із публічних DTO `rules-contract` — `crate::convert`.

wasmtime::component::bindgen!({
    path: "../rules-contract/wit",
    world: "plugin",
});
