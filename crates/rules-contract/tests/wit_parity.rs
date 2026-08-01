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

/// `wit/` реально парситься (не проза): жодної помилки резолву,
/// включно з `use n-rules:slots/ci-artifact@1.0.0.{...}` через `wit/deps/`.
#[test]
fn wit_directory_parses_without_errors() {
    let mut resolve = Resolve::new();
    resolve
        .push_dir(wit_dir())
        .expect("wit/ має парситись без помилок");
}

/// Пакет `n-rules:plugin@3.0.0` резолвиться і містить world `plugin`.
#[test]
fn plugin_package_and_world_resolve() {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(wit_dir()).expect("wit/ парситься");
    let pkg = &resolve.packages[pkg_id];
    assert_eq!(pkg.name.namespace, "n-rules");
    assert_eq!(pkg.name.name, "plugin");
    assert_eq!(
        pkg.name.version.as_ref().map(|v| v.to_string()).as_deref(),
        Some("3.0.0")
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
    for required in ["report-progress", "run-tool", "log", "host-context"] {
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
