//! **Бінарний бік доказу сумісності контракту** — по одному тесту на кожне
//! з двох тверджень, які мажор `4.0.0` (§2.84 реєстру відкритих питань
//! `docs/plans/2026-08-05-open-questions-register.md`) розвів:
//!
//! 1. гість, зібраний проти world ПОПЕРЕДНЬОГО МАЖОРА (`wit-v30/`),
//!    поточним хостом **більше не вантажиться** — і падає гучно, на
//!    інстанціації;
//! 2. гість, зібраний проти замороженої БАЗИ чинного мажора (`wit-v40/`),
//!    вантажиться й працює — інваріант «мінор лінії `4.x` лишається
//!    additive» уперед.
//!
//! # Що тут було до мажора і чому змінилось
//!
//! Файл доводив рівно одне: «v3.0-гість лінкується на v3.1/v3.2-хості без
//! повторної збірки» — бінарний бік additive-мінору. Мажор `4.0.0` це
//! твердження СВІДОМО зробив хибним: три зміни форми типів (§2.83 їх
//! заміряла) ламають інстанціацію будь-якого `3.x`-компонента, а
//! `check_world_version` не встигає навіть спрацювати — відмова настає
//! раніше, на type-checking-у експортів.
//!
//! Тому тест не «полагоджено» й не видалено: він перевернутий. Твердження
//! «пінований гість попереднього мажора не вантажиться» — таке саме
//! перевірюване твердження, як і колишнє, і воно варте гейта РІВНО тому,
//! що альтернатива (мовчазна деградація до якоїсь «сумісної» поведінки)
//! була б значно гіршою за чесну відмову. Заразом тест фіксує, що відмова
//! приходить із ЗРОЗУМІЛОЮ помилкою про невідповідність типів, а не
//! загадковим падінням.
//!
//! # Як будуються гості
//!
//! Обидва — скаффолд зі справжніх шаблонів скіла `wasm-plugin`
//! (`npm/skills/wasm-plugin/template/`), відмінність лише в `__WIT_PATH__`:
//! заморожена копія world-а (`crates/rules-contract/tests/fixtures/wit-v30/`
//! чи `.../wit-v40/`), а не поточний `wit/`. Тобто гість фізично не може
//! знати нічого поза тим world-ом, проти якого зібраний.
//!
//! # Чому шаблон скіла, а не власна міні-фікстура
//!
//! `npm/skills/wasm-plugin/template/` — це те, що реально бере автор
//! стороннього плагіна. Гість, зібраний саме з нього, і є «сторонній
//! плагін, закріплений на версії X» у найточнішому доступному наближенні;
//! власна фікстура доводила б лише те, що ми вміємо написати фікстуру.
//! `include_str!` прив'язує тест до файлів скіла на етапі компіляції —
//! перейменування шаблону валить компіляцію, а не мовчазно вимикає доказ.
//!
//! Структурний (без збірки) бік тих самих двох тверджень —
//! `crates/rules-contract/tests/wit_parity.rs`
//! (`v30_shapes_drifted_exactly_where_major_four_declares` і
//! `every_v40_type_keeps_its_exact_shape_in_current_world`): вони тримають
//! інваріанти за мілісекунди на кожному прогоні, ці — за хвилину, зате
//! наскрізно.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_plugin_host::{PluginHost, ToolResolver};

/// Версія, яку заявляє гість, зібраний проти замороженого v3.0-world.
/// Шаблон скіла вже несе `4.0.0`, тож для v3.0-скаффолда рядок явно
/// підмінюється ([`render`]) — інакше гість брехав би про свою версію.
/// На результат тесту вона все одно не впливає: відмова настає РАНІШЕ за
/// `check_world_version`, на інстанціації, і саме це тест і фіксує.
const V30_WORLD_VERSION: &str = "3.0.0";
/// Версія шаблону скіла = версія поточного world (мажор `4.0.0`).
const V40_WORLD_VERSION: &str = "4.0.0";
const CRATE_NAME: &str = "v30-guest-additive-compat-fixture";
const PLUGIN_ID: &str = "v30-compat/marker-fixture";
const CONCERN_ID: &str = "v30-compat/forbidden-marker";
const CONCERN_REASON: &str = "forbidden-marker";
const MARKER: &str = "FORBIDDEN-MARKER";

const CARGO_TOML_TPL: &str =
    include_str!("../../../npm/skills/wasm-plugin/template/Cargo.toml.tpl");
const LIB_RS_TPL: &str = include_str!("../../../npm/skills/wasm-plugin/template/lib.rs.tpl");
const PLUGIN_TOML_TPL: &str =
    include_str!("../../../npm/skills/wasm-plugin/template/plugin.toml.tpl");
const BUILD_SH: &str = include_str!("../../../npm/skills/wasm-plugin/template/build.sh");

/// Абсолютний шлях до ЗАМОРОЖЕНОЇ фікстури world-а — ключова відмінність
/// від `wasm_plugin_skill_smoke.rs`, який бере поточний `wit/`.
fn frozen_wit_dir(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/tests/fixtures")
        .join(name)
        .canonicalize()
        .unwrap_or_else(|err| panic!("заморожена фікстура world `{name}` має існувати: {err}"))
}

/// Рядки шаблону, які існують ЛИШЕ в мажорі `4.0.0` — при скаффолді проти
/// замороженого v3.0-world вони прибираються (доккомент [`render`]).
///
/// Список навмисно дослівний, а не regex: він мусить розійтися з шаблоном
/// ГУЧНО ([`downgrade_to_v30`] це перевіряє), а не тихо перестати
/// спрацьовувати на переформатованому рядку.
const V40_ONLY_TEMPLATE_LINES: [&str; 4] = [
    "            fix_glob: vec![],\n",
    "        fix_only_concerns: vec![],\n",
    "fix_glob = []\n",
    "fix_only_concerns = []\n",
];

/// Опускає рендер шаблону до форми контракту `3.x`.
///
/// Шаблон скіла живе на ПОТОЧНОМУ мажорі (він шипиться авторам плагінів і
/// мусить бути актуальним), а цьому тесту потрібен гість, зібраний проти
/// замороженого world-а попереднього мажора — з полями `4.0.0` він просто
/// не скомпілюється (`ConcernContribution` того world-а їх не має).
///
/// Тому рендер «опускається»: заявлена `world_version` і рядки з
/// [`V40_ONLY_TEMPLATE_LINES`]. Кожна підміна перевіряється — якщо шаблон
/// переформатують, тест впаде на цій перевірці, а не мовчки збере гостя не
/// тієї форми (і не «доведе» сумісність, якої немає).
fn downgrade_to_v30(rendered: String) -> String {
    let mut out = rendered;
    let from = format!("\"{V40_WORLD_VERSION}\"");
    if out.contains(&from) {
        out = out.replace(&from, &format!("\"{V30_WORLD_VERSION}\""));
    }
    for line in V40_ONLY_TEMPLATE_LINES {
        // Рядок може бути відсутнім: кожен шаблон містить лише свою
        // підмножину (Rust-рядки — у `lib.rs.tpl`, TOML-ключі — у
        // `plugin.toml.tpl`, `build.sh` — жодного).
        out = out.replace(line, "");
    }
    out
}

/// Рендер шаблону скіла під конкретну заморожену версію world-а
/// (доккомент [`downgrade_to_v30`]).
fn render(template: &str, wit_path: &Path, world_version: &str) -> String {
    let rendered = template
        .replace("__CRATE_NAME__", CRATE_NAME)
        .replace("__PLUGIN_ID__", PLUGIN_ID)
        .replace("__CONCERN_ID__", CONCERN_ID)
        .replace("__CONCERN_REASON__", CONCERN_REASON)
        .replace("__MARKER__", MARKER)
        .replace("__WIT_PATH__", &wit_path.to_string_lossy());
    if world_version == V40_WORLD_VERSION {
        return rendered;
    }
    downgrade_to_v30(rendered)
}

/// Кожен рядок [`V40_ONLY_TEMPLATE_LINES`] реально присутній у шаблонах —
/// інакше «опускання» до v3.0 мовчки перестало б щось робити, і тест
/// перевіряв би не те, що обіцяє.
#[test]
fn every_v40_only_template_line_is_actually_in_the_templates() {
    let all = format!("{LIB_RS_TPL}{PLUGIN_TOML_TPL}");
    for line in V40_ONLY_TEMPLATE_LINES {
        assert!(
            all.contains(line),
            "рядок {line:?} зник із шаблонів скіла — `downgrade_to_v30` більше не опускає \
             рендер до контракту 3.x, і v3.0-скаффолд збирався б не тією формою"
        );
    }
}

/// Скаффолдить і збирає гостя проти ЗАМОРОЖЕНОГО world-а у ізольованому
/// tempdir (поза деревом цього репозиторію — жодного конфлікту з кореневим
/// `[workspace]`). Панікує з повним виводом `cargo build`, не мовчазним skip.
fn scaffold_and_build_guest(fixture: &str, world_version: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let root = dir.path();
    let wit = frozen_wit_dir(fixture);

    let lib_rs = render(LIB_RS_TPL, &wit, world_version);
    assert!(
        lib_rs.contains(&format!("\"{world_version}\"")),
        "шаблон `lib.rs.tpl` не містить заявленої world-версії `{world_version}` — підміна у \
         `render` перестала працювати, і гість збирався б із чужою версією в маніфесті"
    );

    fs::write(
        root.join("Cargo.toml"),
        render(CARGO_TOML_TPL, &wit, world_version),
    )
    .expect("запис Cargo.toml не мав провалитись");
    fs::create_dir_all(root.join("src")).expect("mkdir src не мав провалитись");
    fs::write(root.join("src/lib.rs"), lib_rs).expect("запис src/lib.rs не мав провалитись");
    fs::write(
        root.join("plugin.toml"),
        render(PLUGIN_TOML_TPL, &wit, world_version),
    )
    .expect("запис plugin.toml не мав провалитись");
    fs::write(root.join("build.sh"), BUILD_SH).expect("запис build.sh не мав провалитись");

    let output = Command::new("bash")
        .arg("build.sh")
        .current_dir(root)
        // Скидаємо `CARGO_TARGET_DIR`, успадкований від запуску тестів:
        // інакше артефакт скаффолда осів би у СПІЛЬНОМУ target-каталозі
        // розробника, а не в цьому tempdir, і перевірка нижче шукала б його
        // не там. Фікстура має бути повністю ізольованою — інакше вона
        // залежить від env машини, на якій її запустили.
        .env_remove("CARGO_TARGET_DIR")
        .output()
        .expect("запуск `bash build.sh` не мав провалитись (bash відсутній?)");
    assert!(
        output.status.success(),
        "гість проти ЗАМОРОЖЕНОГО world `{fixture}` не зібрався — фікстура чи шаблон скіла \
         розійшлись:\n--- stdout ---\n{}\n--- stderr ---\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );

    let wasm_path = root
        .join("target/wasm32-wasip2/release")
        .join(format!("{}.wasm", CRATE_NAME.replace('-', "_")));
    assert!(
        wasm_path.is_file(),
        "build.sh відзвітував успіхом, але {} відсутній",
        wasm_path.display()
    );
    (dir, wasm_path)
}

/// **Мажор реально ламає пінованих гостей попереднього мажора** (доккомент
/// модуля, твердження 1).
///
/// Гість зібраний проти замороженого world v3.0, тобто його component-type
/// несе СТАРУ форму `manifest`/`concern-contribution`/`file-edit`. Поточний
/// (`4.0.0`) хост його не інстанціює — і тест фіксує не лише сам факт
/// відмови, а й те, що вона:
///
/// - настає на ЗАВАНТАЖЕННІ, а не пізніше, під час `detect`/`fix` (пізня
///   відмова означала б, що хост устиг щось зробити з несумісним гостем);
/// - пояснює причину — у тексті помилки видно невідповідність типів, а не
///   голий код.
///
/// Це і є той стан, який доккомент `wit/world.wit` описує як «не
/// деградація, а плагін не вантажиться». Якщо тест колись ПРОЙДЕ (гість
/// завантажиться) — значить хтось повернув старій формі сумісність, і це
/// треба помітити, а не проґавити.
#[test]
fn v30_guest_no_longer_instantiates_on_current_major_host() {
    let (_tempdir, wasm_path) = scaffold_and_build_guest("wit-v30", V30_WORLD_VERSION);

    let host = PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись");
    // `expect_err` тут неможливий — `LoadedPlugin` не `Debug` (він тримає
    // живий wasmtime `Store`), тож Result розбирається вручну.
    let Err(err) = host.load(&wasm_path, V40_WORLD_VERSION) else {
        panic!(
            "гість попереднього МАЖОРА не має завантажуватись: Component Model не має \
             width-subtyping, а мажор 4.0.0 змінив форму трьох типів межі гість↔хост"
        );
    };

    // Помилка мусить бути ЧИТНОЮ: розбіжність типів, не загадкове падіння.
    let text = format!("{err:?}");
    let lower = text.to_lowercase();
    assert!(
        lower.contains("type mismatch")
            || lower.contains("type-checking")
            || lower.contains("expected"),
        "відмова має пояснювати невідповідність типів, отримали: {text}"
    );
}

/// **База мажора лишається завантажуваною** (доккомент модуля, твердження 2).
///
/// Гість зібраний проти замороженого world v4.0 — знімка контракту в момент
/// бампу. Сьогодні цей тест дублює `wasm_plugin_skill_smoke.rs` (фікстура
/// збігається з живим `wit/`), і це нормально: змістовним він стає з першою
/// ж правкою world після мажора, коли має довести, що вона additive.
#[test]
fn v40_guest_loads_and_detects_on_current_host() {
    let (_tempdir, wasm_path) = scaffold_and_build_guest("wit-v40", V40_WORLD_VERSION);

    let host = PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись");
    let mut plugin = host.load(&wasm_path, V40_WORLD_VERSION).expect(
        "хост мав завантажити гостя, зібраного проти замороженої бази чинного мажора — \
         інакше правка world після бампу вже НЕ additive",
    );

    let manifest = plugin.describe();
    assert_eq!(manifest.id, PLUGIN_ID);
    assert_eq!(manifest.world_version, V40_WORLD_VERSION);

    let batch = DetectBatch {
        concern_id: CONCERN_ID.to_string(),
        files: vec![
            SourceFile {
                path: "violating.txt".to_string(),
                content: format!("рядок із {MARKER} усередині"),
            },
            SourceFile {
                path: "clean.txt".to_string(),
                content: "тут немає нічого забороненого".to_string(),
            },
        ],
    };
    let diagnostics = plugin
        .detect(&batch)
        .expect("detect гостя не мав провалитись на поточному хості");

    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert_eq!(diagnostics[0].reason, CONCERN_REASON);
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert_eq!(diagnostics[0].file.as_deref(), Some("violating.txt"));
}
