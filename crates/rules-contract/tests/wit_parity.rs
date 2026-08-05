//! Верифікація WIT-визначень (`wit/`) реальним інструментом (задача I1,
//! п.4): парсинг директорії `wit/parser::Resolve::push_dir` і звірка, що
//! `world plugin` існує, потрібні export-и присутні, а пакет `n-rules:slots`
//! резолвиться. Це не проза-документ — `wit-parser` мусить прийняти файли
//! без помилок, інакше тест падає.
//!
//! `wit-parser` — лише dev-dependency (`Cargo.toml`): цей крейт не лінкує
//! embedded wasm-рушій, WIT-файли перевіряються без запуску компонента.

use std::path::PathBuf;

use wit_parser::{Resolve, WorldItem};

fn wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wit")
}

/// Заморожений знімок world v3.0 — фікстура доказу additive-сумісності
/// (доккомент самого файлу пояснює, чому він НЕ оновлюється разом зі світом).
fn frozen_v30_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wit-v30")
}

/// Імена bare-функцій (не інтерфейсів) world-а — той рівень, на якому
/// Component Model звіряє імпорти гостя з тим, що дає `Linker` хоста.
fn world_function_names(dir: PathBuf) -> (Vec<String>, Vec<String>) {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(dir).expect("wit/ парситься");
    let pkg = &resolve.packages[pkg_id];
    let world_id = *pkg.worlds.get("plugin").expect("world `plugin` існує");
    let world = &resolve.worlds[world_id];
    (
        world.imports.keys().filter_map(bare_name).collect(),
        world.exports.keys().filter_map(bare_name).collect(),
    )
}

/// Ім'я bare-функції world-а; `None` для реекспортованого інтерфейсу.
fn bare_name(key: &wit_parser::WorldKey) -> Option<String> {
    match key {
        wit_parser::WorldKey::Name(name) => Some(name.clone()),
        wit_parser::WorldKey::Interface(_) => None,
    }
}

/// `wit/` реально парситься (не проза): жодної помилки резолву,
/// включно з `use n-rules:slots/ci-artifact@1.0.0.{...}` через `wit/deps/`.
#[test]
fn wit_directory_parses_without_errors() {
    let mut resolve = Resolve::new();
    resolve
        .push_dir(wit_dir())
        .expect("wit/ має парситись без помилок");
}

/// Пакет `n-rules:plugin@3.1.0` резолвиться і містить world `plugin`.
#[test]
fn plugin_package_and_world_resolve() {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(wit_dir()).expect("wit/ парситься");
    let pkg = &resolve.packages[pkg_id];
    assert_eq!(pkg.name.namespace, "n-rules");
    assert_eq!(pkg.name.name, "plugin");
    assert_eq!(
        pkg.name.version.as_ref().map(|v| v.to_string()).as_deref(),
        Some("3.1.0")
    );

    let world_id = *pkg
        .worlds
        .get("plugin")
        .expect("пакет n-rules:plugin має містити world `plugin`");
    let world = &resolve.worlds[world_id];
    assert_eq!(world.name, "plugin");
}

/// `describe`/`detect`/`fix` — обов'язкові export-и world `plugin` (спека
/// §3.2 ескіз), плюс мінімальні домени `ecosystem-outdated`/`docgen-render`
/// і host-import-и `report-progress`/`run-tool`/`log`.
#[test]
fn world_plugin_has_required_exports_and_imports() {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(wit_dir()).expect("wit/ парситься");
    let pkg = &resolve.packages[pkg_id];
    let world_id = *pkg.worlds.get("plugin").expect("world `plugin` існує");
    let world = &resolve.worlds[world_id];

    let export_names: Vec<&str> = world
        .exports
        .keys()
        .filter_map(|key| match key {
            wit_parser::WorldKey::Name(n) => Some(n.as_str()),
            wit_parser::WorldKey::Interface(_) => None,
        })
        .collect();
    for required in [
        "describe",
        "detect",
        "fix",
        "ecosystem-outdated",
        "docgen-render",
    ] {
        assert!(
            export_names.contains(&required),
            "export `{required}` відсутній у world plugin (наявні: {export_names:?})"
        );
    }

    let import_names: Vec<&str> = world
        .imports
        .keys()
        .filter_map(|key| match key {
            wit_parser::WorldKey::Name(n) => Some(n.as_str()),
            wit_parser::WorldKey::Interface(_) => None,
        })
        .collect();
    for required in [
        "report-progress",
        "run-tool",
        "log",
        "host-context",
        "exec-tool",
    ] {
        assert!(
            import_names.contains(&required),
            "import `{required}` відсутній у world plugin (наявні: {import_names:?})"
        );
    }

    // `describe`/`detect`/`fix` мають бути функціями (host → plugin), не
    // реекспортованими інтерфейсами.
    for name in ["describe", "detect", "fix"] {
        let key = wit_parser::WorldKey::Name(name.to_string());
        match world.exports.get(&key) {
            Some(WorldItem::Function(_)) => {}
            other => panic!("export `{name}` має бути функцією, отримали {other:?}"),
        }
    }
}

/// **Additive-сумісність v3.0 → v3.1, структурний бік** (рішення Ж спеки
/// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`): КОЖЕН
/// bare-import і bare-export замороженого world-а v3.0
/// (`tests/fixtures/wit-v30/`) присутній у поточному world-і.
///
/// Це і є формальне визначення «additive» для Component Model: гість
/// лінкується, якщо його component-type — ПІДМНОЖИНА того, що дає `Linker`
/// хоста. Тест тримає інваріант без збірки wasm (мілісекунди замість
/// хвилини); бінарний бік того самого доказу — реальний гість, зібраний із
/// цієї ж фікстури й завантажений v3.1-хостом
/// (`crates/rules-plugin-host/tests/v30_guest_additive_compat.rs`).
///
/// Падіння цього тесту означає НЕ «оновіть фікстуру», а «зміна world-а
/// зламала вже піновані плагіни» — доккомент фікстури каже те саме.
#[test]
fn every_v30_world_item_survives_in_current_world() {
    let (v30_imports, v30_exports) = world_function_names(frozen_v30_wit_dir());
    let (current_imports, current_exports) = world_function_names(wit_dir());

    assert!(
        !v30_imports.is_empty() && !v30_exports.is_empty(),
        "фікстура v3.0 має містити і імпорти, і експорти — інакше тест нічого не доводить"
    );
    for import in &v30_imports {
        assert!(
            current_imports.contains(import),
            "import `{import}` був у world v3.0, але зник із поточного — зміна НЕ additive \
             (наявні: {current_imports:?})"
        );
    }
    for export in &v30_exports {
        assert!(
            current_exports.contains(export),
            "export `{export}` був у world v3.0, але зник із поточного — зміна НЕ additive \
             (наявні: {current_exports:?})"
        );
    }
    assert!(
        !v30_imports.iter().any(|name| name == "exec-tool"),
        "заморожена фікстура v3.0 не має знати про `exec-tool` — інакше вона не грає роль \
         плагіна, закріпленого до цього мінору"
    );
}

/// Пакет `n-rules:slots@1.0.0` резолвиться окремо від `n-rules:plugin` і
/// містить інтерфейс `ci-artifact` із record `descriptor` (рішення Л:
/// незалежний цикл версіонування слот-payload-ів).
#[test]
fn slots_package_resolves_with_ci_artifact_interface() {
    let mut resolve = Resolve::new();
    resolve.push_dir(wit_dir()).expect("wit/ парситься");

    let slots_pkg = resolve
        .packages
        .iter()
        .map(|(_, pkg)| pkg)
        .find(|pkg| pkg.name.namespace == "n-rules" && pkg.name.name == "slots")
        .expect("пакет n-rules:slots резолвиться поряд із n-rules:plugin");
    assert_eq!(
        slots_pkg
            .name
            .version
            .as_ref()
            .map(|v| v.to_string())
            .as_deref(),
        Some("1.0.0")
    );

    let interface_id = *slots_pkg
        .interfaces
        .get("ci-artifact")
        .expect("пакет n-rules:slots має містити interface `ci-artifact`");
    let interface = &resolve.interfaces[interface_id];
    let descriptor_id = *interface
        .types
        .get("descriptor")
        .expect("interface ci-artifact має містити record `descriptor`");
    let descriptor_ty = &resolve.types[descriptor_id];
    assert!(
        matches!(descriptor_ty.kind, wit_parser::TypeDefKind::Record(_)),
        "descriptor має бути WIT record-ом"
    );
}
