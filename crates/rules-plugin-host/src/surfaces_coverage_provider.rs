//! Автогенеровані Component Model біндінги
//! `n-rules:surfaces/coverage-provider@1.0.0`
//! (`wasmtime::component::bindgen!` на `crates/rules-contract/wit`, крок 6
//! спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12, «перша слотова
//! поверхня»).
//!
//! # Чому цей модуль — дзеркало `caps_file_reader`, а не його клон
//!
//! `caps_file_reader` (крок 4.1, §12.1) довів ІМПОРТНУ половину механізму:
//! гість ІМПОРТУЄ функції, хост їх РЕАЛІЗУЄ (`Host`-трейт,
//! `add_to_linker_imports`). `coverage-provider` — слотовий world (спека
//! §7): гість ЕКСПОРТУЄ `collect-coverage`, а хост його КЛИЧЕ — рівно
//! протилежний напрям, той самий напрям, що вже несе ядровий
//! `wit::Plugin` (`describe`/`detect`/`fix`, `crate::wit`) для КОЖНОГО
//! гостя. Тому тут не `Host`-трейт/`add_to_linker_imports`, а типізований
//! акцесор `CoverageProvider::new(&mut store, &instance)` — той самий
//! прийом, що `wit::Plugin::new`, застосований до ІНШОГО world.
//!
//! # Технічна передумова — доведена ДО написання цього модуля
//!
//! `wit::Plugin::new(&mut store, &instance)` (`src/host.rs`) уже доводить,
//! що типізований bindgen-акцесор шукає в `Instance` ЛИШЕ ІМЕНОВАНІ
//! екземпляри свого власного world, толерантно ігноруючи будь-які інші
//! export/import, які реально несе компонент. `coverage-provider` world не
//! має ЖОДНОГО import-у (лише один export), тож немає симетричного
//! експерименту з `world_linker`, який довести — але СИМЕТРИЧНИЙ бік
//! (експорт, не імпорт) того самого факту вже неявно працює для `wit::Plugin`
//! на КОЖНОМУ реальному гості цього репозиторію: жоден із шести не має
//! точнісінько тих самих export-ів, що голий `world plugin` (усі несуть ще
//! й `ecosystem-outdated`/`docgen-render`-заглушки в ТОМУ САМОМУ world,
//! не є контрприкладом тут), а `wit::Plugin::new` однаково резолвиться.
//! Гейт цього кроку (`tests/surfaces_coverage_provider_gate.rs`) —
//! перший РЕАЛЬНИЙ доказ саме для ДРУГОГО, окремо-зареєстрованого world.
//!
//! `exports: { default: async }` — той самий мотив, що `crate::wit`: цей
//! `Engine` має `wasm_component_model_async(true)` (спека, розділ 10.1),
//! тож усі виклики `Instance` цього `Engine` — виключно через
//! `instantiate_async`/`call_async`, незалежно від world-а.
wasmtime::component::bindgen!({
    path: "../rules-contract/wit",
    world: "n-rules:surfaces/coverage-provider@1.0.0",
    exports: { default: async },
});
