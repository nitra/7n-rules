//! **Доказ additive-сумісності v3.0 → v3.1, бінарний бік** (зріз 5
//! контракту v3.1, рішення Ж спеки
//! `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`).
//!
//! # Що саме тут доводиться
//!
//! Твердження «`exec-tool` — additive, v3.0-гість працює без змін» можна
//! написати в доккоменті, а можна перевірити. Цей тест:
//!
//! 1. скаффолдить справжній guest-крейт із шаблонів скіла `wasm-plugin` —
//!    але з `__WIT_PATH__`, що вказує на **заморожену копію world v3.0**
//!    (`crates/rules-contract/tests/fixtures/wit-v30/`), а не на поточний
//!    `wit/`. Тобто гість фізично не може знати про `exec-tool`: у
//!    згенерованому для нього коді цієї функції немає;
//! 2. збирає його `wasm32-wasip2`-компонентом тим самим `build.sh`;
//! 3. завантажує **поточним (v3.1) [`PluginHost`]** і жене `describe` +
//!    `detect`.
//!
//! Успіх означає рівно те, що обіцяє WIT: компонент, чий component-type —
//! підмножина того, що дає `Linker` v3.1-хоста, лінкується й виконується без
//! повторної збірки. Провал означає, що мінор зламав уже піновані плагіни.
//!
//! # Чому шаблон скіла, а не власна міні-фікстура
//!
//! `npm/skills/wasm-plugin/template/` — це те, що реально бере автор
//! стороннього плагіна. Гість, зібраний саме з нього, і є «сторонній плагін,
//! закріплений на v3.0» у найточнішому доступному наближенні; власна фікстура
//! доводила б лише те, що ми вміємо написати фікстуру. `include_str!`
//! прив'язує тест до файлів скіла на етапі компіляції — перейменування
//! шаблону валить компіляцію, а не мовчазно вимикає доказ.
//!
//! Структурний (без збірки) бік того самого доказу —
//! `crates/rules-contract/tests/wit_parity.rs`
//! (`every_v30_world_item_survives_in_current_world`): він тримає інваріант
//! за мілісекунди на кожному прогоні, цей — за хвилину, зате наскрізно.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_plugin_host::{PluginHost, ToolResolver};

/// Версія, яку заявляє зібраний із шаблону гість (`world_version` шаблону) — саме
/// стара, v3.0: negotiation major-only, тож v3.1-хост має її прийняти.
const V30_WORLD_VERSION: &str = "3.0.0";
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

/// Абсолютний шлях до ЗАМОРОЖЕНОГО world v3.0 — ключова відмінність від
/// `wasm_plugin_skill_smoke.rs`, який бере поточний `wit/`.
fn frozen_v30_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/tests/fixtures/wit-v30")
        .canonicalize()
        .expect("заморожена фікстура world v3.0 має існувати")
}

fn render(template: &str, wit_path: &Path) -> String {
    template
        .replace("__CRATE_NAME__", CRATE_NAME)
        .replace("__PLUGIN_ID__", PLUGIN_ID)
        .replace("__CONCERN_ID__", CONCERN_ID)
        .replace("__CONCERN_REASON__", CONCERN_REASON)
        .replace("__MARKER__", MARKER)
        .replace("__WIT_PATH__", &wit_path.to_string_lossy())
}

/// Скаффолдить і збирає гостя проти замороженого v3.0-world у ізольованому
/// tempdir (поза деревом цього репозиторію — жодного конфлікту з кореневим
/// `[workspace]`). Панікує з повним виводом `cargo build`, не мовчазним skip.
fn scaffold_and_build_v30_guest() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let root = dir.path();
    let wit = frozen_v30_wit_dir();

    fs::write(root.join("Cargo.toml"), render(CARGO_TOML_TPL, &wit))
        .expect("запис Cargo.toml не мав провалитись");
    fs::create_dir_all(root.join("src")).expect("mkdir src не мав провалитись");
    fs::write(root.join("src/lib.rs"), render(LIB_RS_TPL, &wit))
        .expect("запис src/lib.rs не мав провалитись");
    fs::write(root.join("plugin.toml"), render(PLUGIN_TOML_TPL, &wit))
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
        "гість проти ЗАМОРОЖЕНОГО world v3.0 не зібрався — це вже означає, що мінор зачепив \
         старий контракт:\n--- stdout ---\n{}\n--- stderr ---\n{}",
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

/// v3.0-гість, який фізично не знає про `exec-tool`, інстанціюється
/// поточним v3.1-хостом і відпрацьовує `describe`/`detect` без жодної зміни
/// у своєму коді (доккомент модуля).
#[test]
fn v30_guest_loads_and_detects_on_v31_host() {
    let (_tempdir, wasm_path) = scaffold_and_build_v30_guest();

    let host = PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись");
    let mut plugin = host.load(&wasm_path, V30_WORLD_VERSION).expect(
        "v3.1-хост мав завантажити v3.0-гостя без змін — саме це й означає \
         additive-сумісність мінору",
    );

    let manifest = plugin.describe();
    assert_eq!(manifest.id, PLUGIN_ID);
    assert_eq!(
        manifest.world_version, V30_WORLD_VERSION,
        "гість заявляє стару мінорну версію — negotiation major-only мусить її прийняти"
    );

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
        .expect("detect v3.0-гостя не мав провалитись на v3.1-хості");

    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert_eq!(diagnostics[0].reason, CONCERN_REASON);
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert_eq!(diagnostics[0].file.as_deref(), Some("violating.txt"));
}
