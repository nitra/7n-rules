//! Автогенеровані Component Model біндінги `n-rules:caps/file-reader@1.0.0`
//! (`wasmtime::component::bindgen!` на `crates/rules-contract/wit`, крок 4.1
//! спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1, п.1: «окремий
//! приватний модуль, той самий прийом, що [`crate::wit`]»).
//!
//! Породжує НЕЗАЛЕЖНИЙ `Host`-трейт (`file_reader::Host`) і власну
//! `add_to_linker_imports` — той самий факт, що доккомент
//! `crate::world_linker` довів експериментом ДО написання цього модуля:
//! кілька викликів `bindgen!` в одному крейті для РІЗНИХ world дають
//! незалежні модулі, і їхні `add_to_linker_imports` можна викликати
//! вибірково на СПІЛЬНИЙ `Linker<HostState>`.
//!
//! `imports: { default: async }` — той самий мотив, що `crate::wit`: цей
//! `Engine` має `wasm_component_model_async(true)` (спека, розділ 10.1),
//! тож `Store`/`Linker` викликаються виключно через
//! `instantiate_async`/`call_async` — ОДНОРІДНО для ВСІХ прилінкованих
//! host-функцій, незалежно від того, чи конкретна функція реально
//! суспендиться.
wasmtime::component::bindgen!({
    path: "../rules-contract/wit",
    world: "n-rules:caps/file-reader@1.0.0",
    imports: { default: async },
});

use std::path::Path;

/// Реалізація `list-files` (`FileReaderImports::list_files`,
/// `crate::host_state`): фільтрує [`rules_core::concerns::cursor_ignore::walk_repo`]
/// за `globs` тим самим двигуном ([`globset`]), що
/// `crates/rules-napi::build_full_scope_files` — ОДИН обхід дерева на весь
/// хост, не друга реалізація (спека §12.1: «переважно перевикористовує, а
/// не пише заново»). `!`-префікс — виключення (та сама конвенція, що
/// `concern-contribution.glob`).
///
/// WIT `list-files` не має каналу помилки (`-> list<string>`, не
/// `result<...>`) — на відміну від `read-file-bytes` нижче, тут немає
/// способу повернути гостю типізовану відмову. Невалідний glob-патерн чи
/// відсутність будь-якого матчу тому дають порожній/звужений перелік, не
/// трап: той самий tolerant-парсинг, що вже приймає
/// `build_full_scope_files` для недовіреного (плагінного) входу.
pub(crate) fn list_files_under_root(root: &Path, globs: &[String]) -> Vec<String> {
    let mut builder = globset::GlobSetBuilder::new();
    let mut exclude_builder = globset::GlobSetBuilder::new();
    let mut has_excludes = false;
    for pattern in globs {
        match pattern.strip_prefix('!') {
            Some(negated) => {
                if let Ok(glob) = globset::Glob::new(negated) {
                    exclude_builder.add(glob);
                    has_excludes = true;
                }
            }
            None => {
                if let Ok(glob) = globset::Glob::new(pattern) {
                    builder.add(glob);
                }
            }
        }
    }
    let Ok(set) = builder.build() else {
        return Vec::new();
    };
    let excludes = if has_excludes {
        exclude_builder.build().ok()
    } else {
        None
    };
    rules_core::concerns::cursor_ignore::walk_repo(root)
        .into_iter()
        .filter(|f| set.is_match(f))
        .filter(|f| !excludes.as_ref().is_some_and(|ex| ex.is_match(f)))
        .collect()
}
