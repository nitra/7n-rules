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

/// Заморожений знімок world v4.0 — БАЗА чинного мажора (§2.84). Знятий у
/// момент major-бампу; тримає інваріант «мінор лінії `4.x` лишається
/// additive» уперед, тоді як v3.0-фікстура лишається історичним свідченням
/// того, що мажор реально стався (доккомент блоку `--- Мажор 4.0.0 ---`).
fn frozen_v40_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wit-v40")
}

/// Заморожений знімок world v5.0 — БАЗА чинного мажора (спека
/// `docs/specs/2026-08-31-plugin-contract-v5.md`, §2.109 реєстру відкритих
/// питань). Той самий мотив, що v4.0-фікстура: знятий у момент
/// major-бампу, тримає інваріант «мінор лінії `5.x` лишається additive»
/// уперед, тоді як v4.0-фікстура лишається історичним свідченням того, що
/// мажор реально стався.
fn frozen_v50_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wit-v50")
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

/// Пакет `n-rules:plugin@5.0.0` резолвиться і містить world `plugin`.
#[test]
fn plugin_package_and_world_resolve() {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(wit_dir()).expect("wit/ парситься");
    let pkg = &resolve.packages[pkg_id];
    assert_eq!(pkg.name.namespace, "n-rules");
    assert_eq!(pkg.name.name, "plugin");
    assert_eq!(
        pkg.name.version.as_ref().map(|v| v.to_string()).as_deref(),
        Some("5.0.0")
    );

    let world_id = *pkg
        .worlds
        .get("plugin")
        .expect("пакет n-rules:plugin має містити world `plugin`");
    let world = &resolve.worlds[world_id];
    assert_eq!(world.name, "plugin");
}

/// [`rules_contract::version::PLUGIN_WORLD_VERSION`] — те, що хост очікує
/// від гостя, а `package n-rules:plugin@…` — те, проти чого гість реально
/// збирається. Дві правди про одну версію, і до мажора `4.0.0` вони
/// РОЗІЙШЛИСЬ: константа лишалась `"3.1.0"`, коли пакет уже був `3.2.0`.
/// Наслідків не було (negotiation major-only), але саме такий мовчазний
/// дрейф ховає версію контракту від людини — тож тепер він механічно
/// неможливий.
#[test]
fn plugin_world_version_matches_wit_package() {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(wit_dir()).expect("wit/ парситься");
    let package_version = resolve.packages[pkg_id]
        .name
        .version
        .as_ref()
        .map(|v| v.to_string())
        .expect("пакет n-rules:plugin мусить нести версію");
    assert_eq!(
        rules_contract::version::PLUGIN_WORLD_VERSION,
        package_version,
        "константа PLUGIN_WORLD_VERSION розійшлась із `package n-rules:plugin@…` — \
         хост очікував би від гостя не ту версію, проти якої той збирається"
    );
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
/// (`crates/rules-plugin-host/tests/guest_additive_compat.rs`).
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

// --- Структурний additive-гейт (§2.83): імен НЕДОСТАТНЬО ------------------
//
// `every_v30_world_item_survives_in_current_world` вище звіряє лише ІМЕНА
// bare-імпортів/експортів. Замір (задача «форма типів контракту», §2.83)
// показав, що цього мало: три різні зміни ФОРМИ типів лишали набір імен
// незмінним, гейт світився зеленим — і при цьому ЖОДЕН уже піно́ваний гість
// не інстанціювався поточним хостом. Виміряні відмови wasmtime:
//
// | зміна форми                                    | помилка інстанціації           |
// |------------------------------------------------|--------------------------------|
// | новий case у `variant file-edit`                 | type-checking export func `fix`: type mismatch for field edits: expected variant of 3 cases, found 2 cases |
// | нове поле в `record concern-contribution`        | type-checking export func `describe`: type mismatch for field concerns: expected record of 4 fields, found 3 fields |
// | нове поле в `record manifest`                    | type-checking export func `describe`: expected record of 9 fields, found 8 fields |
//
// Component Model НЕ має width-subtyping для record-ів і НЕ приймає variant
// із меншим числом case-ів там, де хост очікує більше: будь-яка зміна форми
// типу, що перетинає межу гість↔хост, — MAJOR, не мінор.
//
// --- Що сталося з цим гейтом на мажорі `4.0.0` (§2.84) --------------------
//
// Гейт стеріг інваріант «форма типів v3.0 не змінюється НІКОЛИ» — і мажор
// `4.0.0` порушив його свідомо, рівно тими трьома змінами, які §2.83
// заміряла. «Полагодити» падіння оновленням v3.0-фікстури означало б
// викинути гейт: після такого оновлення він доводив би лише «поточний world
// дорівнює сам собі».
//
// Тому гейт РОЗДІЛЕНО на два, за двома різними твердженнями, які він
// плутав в одному:
//
// 1. `v30_shapes_drifted_exactly_where_major_four_declares` — історичне
//    твердження: відносно v3.0 форма змінилась РІВНО у трьох названих
//    типах, і major при цьому бампнуто. Четверта тиха зміна форми (чи
//    зміна форми БЕЗ major-бампу) валить цей тест — тобто заміряний факт
//    §2.83 лишається під охороною, а не переїжджає в прозу.
// 2. `every_v40_type_keeps_its_exact_shape_in_current_world` — те саме
//    твердження, що стеріг старий гейт, але відносно НОВОЇ бази
//    (`tests/fixtures/wit-v40/`): мінор лінії `4.x` мусить лишити форму
//    типів незмінною. Сьогодні він тавтологічно зелений (фікстура — знімок
//    цього ж world); змістовним він стає з першою ж правкою world після
//    бампу, і саме тому заводиться ЗАРАЗ, а не «коли знадобиться».
//
// Падіння будь-якого з двох означає «зміна вимагає major-бампу
// `n-rules:plugin`», а не «оновіть фікстуру».
//
// --- Той самий хід повторився на мажорі `5.0.0` (§2.109) ------------------
//
// `manifest.worlds` (спека `docs/specs/2026-08-31-plugin-contract-v5.md`
// §8) повторив РІВНО той самий структурний факт для ОДНОГО поля: гейт
// (2) вище (`every_v40_type_keeps_its_exact_shape_in_current_world`)
// упіймав дрейф форми `manifest` і був так само переосмислений —
// перейменований на `v40_shapes_drifted_exactly_where_major_five_declares`
// (нова роль (1): історичне свідчення), плюс заведений `every_v50_type_
// keeps_its_exact_shape_in_current_world` (нова роль (2), нова база
// `tests/fixtures/wit-v50/`). Той самий цикл повториться на кожному
// наступному мажорі: попередня «роль (2)» стає новою «роль (1)», а нова
// «роль (2)» заводиться зі свіжою фікстурою.

/// Канонічний рендер типу для порівняння між ДВОМА різними `Resolve`
/// (індекси арен у них різні, тож `Debug` непридатний).
///
/// Іменований тип, що належить самому world-у `plugin`, рендериться ІМЕНЕМ
/// (його власну структуру звіряє окремий запис мапи); усе інше —
/// розкривається структурно, тож дрейф типів сусіднього пакета
/// (`n-rules:slots`, `ci-artifact-descriptor`) теж ловиться.
fn render_type(resolve: &Resolve, world: wit_parser::WorldId, ty: &wit_parser::Type) -> String {
    match ty {
        wit_parser::Type::Id(id) => {
            let def = &resolve.types[*id];
            let own_world = matches!(def.owner, wit_parser::TypeOwner::World(w) if w == world);
            match (&def.name, own_world) {
                (Some(name), true) => name.clone(),
                _ => render_typedef(resolve, world, def),
            }
        }
        primitive => format!("{primitive:?}").to_lowercase(),
    }
}

/// Канонічний рендер ТІЛА типу — те, що Component Model реально звіряє при
/// інстанціації: набір і порядок полів record-а, case-ів variant/enum-а,
/// елементів list/option/result/tuple.
fn render_typedef(
    resolve: &Resolve,
    world: wit_parser::WorldId,
    def: &wit_parser::TypeDef,
) -> String {
    use wit_parser::TypeDefKind;
    let r = |t: &wit_parser::Type| render_type(resolve, world, t);
    match &def.kind {
        TypeDefKind::Record(rec) => {
            let fields: Vec<String> = rec
                .fields
                .iter()
                .map(|f| format!("{}: {}", f.name, r(&f.ty)))
                .collect();
            format!("record {{ {} }}", fields.join(", "))
        }
        TypeDefKind::Variant(var) => {
            let cases: Vec<String> = var
                .cases
                .iter()
                .map(|c| match &c.ty {
                    Some(t) => format!("{}({})", c.name, r(t)),
                    None => c.name.clone(),
                })
                .collect();
            format!("variant {{ {} }}", cases.join(", "))
        }
        TypeDefKind::Enum(en) => {
            let cases: Vec<&str> = en.cases.iter().map(|c| c.name.as_str()).collect();
            format!("enum {{ {} }}", cases.join(", "))
        }
        TypeDefKind::Flags(fl) => {
            let names: Vec<&str> = fl.flags.iter().map(|f| f.name.as_str()).collect();
            format!("flags {{ {} }}", names.join(", "))
        }
        TypeDefKind::Tuple(tup) => {
            let items: Vec<String> = tup.types.iter().map(r).collect();
            format!("tuple<{}>", items.join(", "))
        }
        TypeDefKind::Option(t) => format!("option<{}>", r(t)),
        TypeDefKind::List(t) => format!("list<{}>", r(t)),
        TypeDefKind::Result(res) => format!(
            "result<{}, {}>",
            res.ok.as_ref().map(&r).unwrap_or_else(|| "_".to_string()),
            res.err.as_ref().map(&r).unwrap_or_else(|| "_".to_string())
        ),
        // Аліас (`use ... .{descriptor as ci-artifact-descriptor}`) —
        // розкривається у структуру цілі: дрейф `n-rules:slots` теж ловиться.
        TypeDefKind::Type(t) => r(t),
        TypeDefKind::Resource => "resource".to_string(),
        TypeDefKind::Handle(_) => "handle".to_string(),
        // Свідомо гучно: нова категорія типів у контракті мусить приїхати
        // сюди явним рішенням, а не мовчки випасти з гейта.
        other => panic!(
            "render_typedef: незнана категорія типу {other:?} — додайте гілку, \
             інакше структурний гейт мовчки перестане її покривати"
        ),
    }
}

/// Мапа «ім'я типу world-а `plugin` → канонічна структура».
fn world_type_shapes(dir: PathBuf) -> std::collections::BTreeMap<String, String> {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(dir).expect("wit/ парситься");
    let world_id = *resolve.packages[pkg_id]
        .worlds
        .get("plugin")
        .expect("world `plugin` існує");
    // Типи, оголошені в тілі world-а, приїжджають у `imports` як
    // `WorldItem::Type` під `WorldKey::Name` — окремого поля `types` у
    // `wit_parser::World` немає.
    let world = &resolve.worlds[world_id];
    world
        .imports
        .iter()
        .chain(world.exports.iter())
        .filter_map(|(key, item)| match (key, item) {
            (wit_parser::WorldKey::Name(name), WorldItem::Type { id, .. }) => Some((
                name.clone(),
                render_typedef(&resolve, world_id, &resolve.types[*id]),
            )),
            _ => None,
        })
        .collect()
}

/// Major-компонента версії пакета `n-rules:plugin` у переданій `wit`-теці.
fn world_major(dir: PathBuf) -> u64 {
    let mut resolve = Resolve::new();
    let (pkg_id, _) = resolve.push_dir(dir).expect("wit/ парситься");
    resolve.packages[pkg_id]
        .name
        .version
        .as_ref()
        .expect("пакет n-rules:plugin мусить нести версію")
        .major
}

/// **Історичний гейт мажора `4.0.0`** (доккомент блоку вище, п.1): відносно
/// замороженого v3.0 форма змінилась РІВНО у трьох типах, які цей мажор
/// назвав — і major при цьому реально бампнуто.
///
/// Тест навмисно двобічний. `assert_eq!` на МНОЖИНІ типів, що дрейфували,
/// ловить четверту тиху зміну форми (вона розширить множину) І «випадкове»
/// повернення форми назад (звузить); окрема перевірка major-компоненти
/// ловить зміну форми БЕЗ бампу. Жодне з двох не мовчить.
#[test]
fn v30_shapes_drifted_exactly_where_major_four_declares() {
    let frozen = world_type_shapes(frozen_v30_wit_dir());
    let current = world_type_shapes(wit_dir());

    // Гейт мусить реально покривати типи межі гість↔хост, а не порожню мапу.
    for required in [
        "manifest",
        "concern-contribution",
        "file-edit",
        "diagnostic",
    ] {
        assert!(
            frozen.contains_key(required),
            "фікстура v3.0 має містити тип `{required}` — інакше гейт його не покриває \
             (наявні: {:?})",
            frozen.keys().collect::<Vec<_>>()
        );
    }

    for name in frozen.keys() {
        assert!(
            current.contains_key(name),
            "тип `{name}` був у world v3.0 і ЗНИК із поточного. Мажор `4.0.0` міняв форму \
             трьох типів, а не видаляв типи — видалення тут не задекларовано жодним рішенням"
        );
    }

    let drifted: std::collections::BTreeSet<&str> = frozen
        .iter()
        .filter(|(name, shape)| current.get(*name) != Some(*shape))
        .map(|(name, _)| name.as_str())
        .collect();
    let declared: std::collections::BTreeSet<&str> =
        ["concern-contribution", "file-edit", "manifest"]
            .into_iter()
            .collect();
    assert_eq!(
        drifted, declared,
        "множина типів, чия форма розійшлась із замороженим world v3.0, не збігається з тією, \
         яку задекларував мажор `4.0.0` (доккомент `wit/world.wit`, версійний блок). Зайвий тип \
         тут = ЧЕТВЕРТА зміна форми, що приїхала мовчки: Component Model не має width-subtyping, \
         тож вона так само ламає інстанціацію вже пінованих гостей і так само вимагає бампу \
         major. Фікстуру `wit-v30/` НЕ оновлювати — вона історичний знімок, а не дзеркало \
         поточного world"
    );

    assert!(
        world_major(wit_dir()) > world_major(frozen_v30_wit_dir()),
        "форма типів розійшлась із v3.0, але major-компонента `n-rules:plugin` не бампнута — \
         рівно той мовчазний breaking-реліз, який цей гейт має робити неможливим"
    );
}

/// **Історичний гейт мажора `5.0.0`** (доккомент блоку вище, п.1, ТОЙ САМИЙ
/// хід, що вже стерігся при `4.0.0` — доккомент `wit/world.wit`, версійний
/// блок `5.0.0`, і `v30_shapes_drifted_exactly_where_major_four_declares`
/// вище): відносно замороженого v4.0 форма змінилась РІВНО в одному типі —
/// `manifest` (нове поле `worlds`, спека
/// `docs/specs/2026-08-31-plugin-contract-v5.md` §8, §2.109 реєстру
/// відкритих питань) — і major при цьому реально бампнуто.
///
/// Це те саме твердження, що доти стеріг
/// `every_v40_type_keeps_its_exact_shape_in_current_world` (свіжо заведений
/// разом із мажором `4.0.0`, і тепер сам порушений мажором `5.0.0` —
/// доккомент `wit/world.wit` пояснює, чому свідомо): гейт «форма типів v4.0
/// не змінюється НІКОЛИ» протримався РІВНО до першої правки world після
/// нього, і саме для цього заводився. «Полагодити» падіння оновленням
/// v4.0-фікстури означало б викинути гейт — замість цього він
/// переосмислений тим самим ходом, що вже пройшов v3.0 → v4.0: v4.0-фікстура
/// лишається історичним доказом (цей тест), а нова база (`wit-v50/`) тримає
/// exact-shape інваріант уперед для мінорів лінії `5.x`
/// (`every_v50_type_keeps_its_exact_shape_in_current_world` нижче).
#[test]
fn v40_shapes_drifted_exactly_where_major_five_declares() {
    let frozen = world_type_shapes(frozen_v40_wit_dir());
    let current = world_type_shapes(wit_dir());

    for required in [
        "manifest",
        "concern-contribution",
        "file-edit",
        "write-bytes-file",
        "diagnostic",
    ] {
        assert!(
            frozen.contains_key(required),
            "фікстура v4.0 має містити тип `{required}` — інакше гейт його не покриває \
             (наявні: {:?})",
            frozen.keys().collect::<Vec<_>>()
        );
    }

    for name in frozen.keys() {
        assert!(
            current.contains_key(name),
            "тип `{name}` був у world v4.0 і ЗНИК із поточного. Мажор `5.0.0` (цей коміт) міняв \
             форму РІВНО одного типу (`manifest`), а не видаляв типи — видалення тут не \
             задекларовано жодним рішенням"
        );
    }

    let drifted: std::collections::BTreeSet<&str> = frozen
        .iter()
        .filter(|(name, shape)| current.get(*name) != Some(*shape))
        .map(|(name, _)| name.as_str())
        .collect();
    let declared: std::collections::BTreeSet<&str> = ["manifest"].into_iter().collect();
    assert_eq!(
        drifted, declared,
        "множина типів, чия форма розійшлась із замороженим world v4.0, не збігається з тією, \
         яку задекларував мажор `5.0.0` (доккомент `wit/world.wit`, версійний блок `5.0.0`, \
         `crates/rules-contract/src/version.rs`). Зайвий тип тут = НЕЗАДЕКЛАРОВАНА зміна \
         форми, що приїхала мовчки: Component Model не має width-subtyping, тож вона так само \
         ламає інстанціацію вже пінованих гостей і так само вимагає бампу major. Фікстуру \
         `wit-v40/` НЕ оновлювати — вона історичний знімок, а не дзеркало поточного world"
    );

    assert!(
        world_major(wit_dir()) > world_major(frozen_v40_wit_dir()),
        "форма типів розійшлась із v4.0, але major-компонента `n-rules:plugin` не бампнута — \
         рівно той мовчазний breaking-реліз, який цей гейт має робити неможливим"
    );
}

/// **Additive-гейт лінії `5.x`** (доккомент блоку вище, п.2): кожен
/// іменований тип замороженого world v5.0 присутній у поточному world-і з
/// ІДЕНТИЧНОЮ структурою.
///
/// Те саме твердження, що доти стеріг `every_v40_type_keeps_its_exact_shape_in_current_world`,
/// лише з новою базою. Сьогодні він зелений тавтологічно (фікстура знята з
/// цього ж world) — і це нормально: гейт заводиться в момент бампу саме для
/// того, щоб перша ж правка world після нього не проїхала мовчки.
#[test]
fn every_v50_type_keeps_its_exact_shape_in_current_world() {
    let frozen = world_type_shapes(frozen_v50_wit_dir());
    let current = world_type_shapes(wit_dir());

    for required in [
        "manifest",
        "concern-contribution",
        "file-edit",
        "write-bytes-file",
        "diagnostic",
    ] {
        assert!(
            frozen.contains_key(required),
            "фікстура v5.0 має містити тип `{required}` — інакше гейт його не покриває \
             (наявні: {:?})",
            frozen.keys().collect::<Vec<_>>()
        );
    }

    for (name, frozen_shape) in &frozen {
        match current.get(name) {
            None => panic!(
                "тип `{name}` був у world v5.0 і зник із поточного — зміна НЕ additive, \
                 потрібен major-бамп `n-rules:plugin`"
            ),
            Some(current_shape) => assert_eq!(
                current_shape, frozen_shape,
                "форма типу `{name}` змінилась відносно замороженого world v5.0. \
                 Component Model не має width-subtyping: уже піно́ваний гість НЕ \
                 інстанціюється (виміряно §2.83 — `expected record of N fields, found N-1 \
                 fields` / `expected variant of N cases, found N-1 cases`). Це MAJOR-зміна \
                 `n-rules:plugin`, а не мінор; фікстуру НЕ оновлювати"
            ),
        }
    }
}
