//! Автогенеровані Component Model біндінги `n-rules:plugin@3.2.0`
//! (`wasmtime::component::bindgen!` на `crates/rules-contract/wit/`, задача
//! I2 фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.1).
//!
//! Модуль навмисно приватний (`mod wit` без `pub`, лише `pub(crate)`) —
//! рішення М спеки: вузький публічний trait `rules-plugin-host` повністю
//! інкапсулює wasmtime, тож жоден тип цього модуля не перетинає межу крейта.
//! Конверсія в/із публічних DTO `rules-contract` — `crate::convert`.
//!
//! `with: { "rego-engine": … }` (реєстр §2.66) — мапить WIT-resource
//! `rego-engine` на наш власний Rust-тип [`crate::rego_engine::RegoEngineState`]
//! (тонка обгортка `rules_rego_engine::RegoEngine`, доккомент того модуля)
//! замість типу-маркера за замовчуванням, який синтезував би сам
//! `wit-bindgen` — той самий прийом, що довів мінімальний resource-приклад
//! до порту (доккомент `wit/world.wit` біля версійного блоку `3.2.0`).

wasmtime::component::bindgen!({
    path: "../rules-contract/wit",
    world: "plugin",
    with: {
        "rego-engine": crate::rego_engine::RegoEngineState,
    },
});
