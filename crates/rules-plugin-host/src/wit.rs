//! Автогенеровані Component Model біндінги `n-rules:plugin@4.0.0`
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

//!
//! `imports`/`exports: { default: async }` (спека
//! `docs/specs/2026-08-31-plugin-contract-v5.md`, розділ 10.1) — усі
//! host-функції ядрового світу (`report-progress`/`log`/`host-context`/
//! `run-tool`/`exec-tool`/`rego-engine`) і guest-експорти
//! (`describe`/`detect`/`fix`/…) генеруються як `async fn`. Причина — НЕ в
//! тому, що ці функції реально асинхронні (жодна не суспендиться): гість,
//! скомпільований під `wasm32-wasip3`, лінкується проти
//! `wasmtime_wasi::p3` (`component-model-async`), а wasmtime вимагає
//! однорідного async-виклику для ВСІХ функцій компонента, щойно `Config`
//! має `wasm_component_model_async(true)` — `Store`/`Linker` того самого
//! `Engine` викликаються через `instantiate_async`/`call_async` незалежно
//! від того, чи конкретна функція семантично блокується (доведено спайком
//! перед цією правкою: `wasmtime_wasi::p2::add_to_linker_sync` і
//! `wasmtime_wasi::p3::add_to_linker` реєструються на ОДНОМУ async-лінкері
//! й обидва встигають задовольнити `instantiate_async`).
wasmtime::component::bindgen!({
    path: "../rules-contract/wit",
    world: "plugin",
    with: {
        "rego-engine": crate::rego_engine::RegoEngineState,
    },
    imports: { default: async },
    exports: { default: async },
});
