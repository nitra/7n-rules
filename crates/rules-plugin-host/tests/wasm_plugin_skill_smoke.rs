//! CI-смок скіла `wasm-plugin` (мітигація §3.6 спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`: «скіл пінить
//! версії і має власний smoke-тест у CI — scaffold → build → detect на
//! фікстурі»). Живе в `rules-plugin-host` (не окремий workflow) — цей крейт
//! уже покритий `cargo test --workspace` у `lint-rust.yml`, де toolchain
//! `wasm32-wasip2` і `wasm-tools` уже встановлені для інших guest-фікстур
//! (`crates/test-plugin-guest`, `crates/plugin-lang-js`) — нуль нових
//! рядків workflow.
//!
//! Тест ДЕТЕРМІНОВАНО (без LLM) проганяє той самий конвеєр, що описує скіл
//! (`npm/skills/wasm-plugin/SKILL.md`, крок 1 «scaffold»):
//! 1. Бере шаблони `npm/skills/wasm-plugin/template/{Cargo.toml,lib.rs,plugin.toml}.tpl`
//!    (та сама сировина, що читає LLM-агент) — `include_str!` прив'язує тест
//!    до реальних файлів скіла на етапі компіляції (перейменування/видалення
//!    шаблону валить компіляцію тесту, не мовчазний дрейф).
//! 2. Підставляє плейсхолдери й пише результат у ІЗОЛЬОВАНИЙ `tempfile::tempdir()`
//!    (поза деревом цього репозиторію — жодного конфлікту з кореневим
//!    `[workspace]`, доккомент `Cargo.toml` кореня репо про вкладені
//!    workspace-и тут не застосовний: tempdir не має жодного предка з
//!    `Cargo.toml`).
//! 3. Копіює `template/build.sh` (літерально, без плейсхолдерів — той самий
//!    файл, що бере LLM-агент) у tempdir і запускає його — доводить, що
//!    build.sh реально працює на СВІЖОЗІБРАНОМУ standalone-крейті, не лише
//!    на крейтах-членах цього workspace.
//! 4. Завантажує зібраний `.wasm` через [`PluginHost`] (реальний хост, не
//!    заглушка) і жене `detect` на фікстурі з порушенням і без — та сама
//!    `require_fixture`-філософія `contract_test_kit.rs`/
//!    `plugin_lang_js.rs`: якщо збірка провалилась, тест панікує з
//!    повним stdout/stderr `cargo build`, не мовчазним skip.
//!
//! WIT-шлях підставляється як АБСОЛЮТНИЙ (`crates/rules-contract/wit` цього
//! репозиторію) — у реальному first-party скаффолді (крейт живе під
//! `crates/<name>/`) шлях відносний (`../rules-contract/wit`, той самий, що
//! в `crates/plugin-lang-js`); тут крейт свідомо стоїть ПОЗА
//! workspace-деревом (п.2 вище), тож відносний шлях не мав би сенсу —
//! SKILL.md документує обидві форми (крок 1).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_contract::manifest::Domain;
use rules_plugin_host::{PluginHost, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "3.0.0";
const CRATE_NAME: &str = "wasm-plugin-skill-smoke-fixture";
const PLUGIN_ID: &str = "skill-smoke/marker-fixture";
const CONCERN_ID: &str = "skill-smoke/forbidden-marker";
const CONCERN_REASON: &str = "forbidden-marker";
const MARKER: &str = "FORBIDDEN-MARKER";

const CARGO_TOML_TPL: &str =
    include_str!("../../../npm/skills/wasm-plugin/template/Cargo.toml.tpl");
const LIB_RS_TPL: &str = include_str!("../../../npm/skills/wasm-plugin/template/lib.rs.tpl");
const PLUGIN_TOML_TPL: &str =
    include_str!("../../../npm/skills/wasm-plugin/template/plugin.toml.tpl");
const BUILD_SH: &str = include_str!("../../../npm/skills/wasm-plugin/template/build.sh");

/// Абсолютний шлях до `crates/rules-contract/wit` РЕАЛЬНОГО репозиторію
/// (не tempdir-скаффолда) — доккомент модуля пояснює, чому тут абсолютний
/// шлях, не `../rules-contract/wit`.
fn real_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/wit")
        .canonicalize()
        .expect("crates/rules-contract/wit має існувати в цьому репозиторії")
}

/// Підставляє плейсхолдери шаблону — той самий набір токенів, що описує
/// SKILL.md крок 1 («заповни плейсхолдери»).
fn render(template: &str, wit_path: &Path) -> String {
    template
        .replace("__CRATE_NAME__", CRATE_NAME)
        .replace("__PLUGIN_ID__", PLUGIN_ID)
        .replace("__CONCERN_ID__", CONCERN_ID)
        .replace("__CONCERN_REASON__", CONCERN_REASON)
        .replace("__MARKER__", MARKER)
        .replace("__WIT_PATH__", &wit_path.to_string_lossy())
}

/// Скаффолдить мінімальний плагін у свіжому `tempdir` за шаблонами скіла,
/// збирає його `wasm32-wasip2`-компонентом через `template/build.sh` і
/// повертає абсолютний шлях до зібраного `.wasm`.
///
/// Панікує з повним `cargo build`-виводом при будь-якій невдачі (той самий
/// fail-closed мотив, що `require_fixture` у сусідніх тестах цього крейта)
/// — жодного мовчазного skip: якщо скіл описує неробочий конвеєр, цей тест
/// має провалитись голосно.
fn scaffold_and_build() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let root = dir.path();

    fs::write(
        root.join("Cargo.toml"),
        render(CARGO_TOML_TPL, &real_wit_dir()),
    )
    .expect("запис Cargo.toml не мав провалитись");
    fs::create_dir_all(root.join("src")).expect("mkdir src не мав провалитись");
    fs::write(root.join("src/lib.rs"), render(LIB_RS_TPL, &real_wit_dir()))
        .expect("запис src/lib.rs не мав провалитись");
    fs::write(
        root.join("plugin.toml"),
        render(PLUGIN_TOML_TPL, &real_wit_dir()),
    )
    .expect("запис plugin.toml не мав провалитись");
    fs::write(root.join("build.sh"), BUILD_SH).expect("запис build.sh не мав провалитись");

    let output = Command::new("bash")
        .arg("build.sh")
        .current_dir(root)
        .output()
        .expect("запуск `bash build.sh` не мав провалитись (bash відсутній?)");

    assert!(
        output.status.success(),
        "template/build.sh провалився на щойно згенерованому фікстура-крейті — конвеєр скіла НЕ робочий:\n\
         --- stdout ---\n{}\n--- stderr ---\n{}",
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

/// Наскрізний прогін: scaffold → build → describe/detect через реальний
/// [`PluginHost`] — доводить, що інструкції скіла (шаблони +
/// `template/build.sh`) дають робочий wasm-компонент, сумісний з
/// `n-rules:plugin@3.0.0`. Смок-фікстура не декларує зовнішніх tools —
/// порожній резолвер.
#[test]
fn scaffold_build_and_detect_pipeline_is_functional() {
    let (_tempdir, wasm_path) = scaffold_and_build();

    let host = PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись");
    let mut plugin = host
        .load(&wasm_path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на щойно зібраному компоненті");

    let manifest = plugin.describe();
    assert_eq!(manifest.id, PLUGIN_ID);
    assert_eq!(manifest.world_version, PLUGIN_WORLD_VERSION);
    assert_eq!(manifest.domains, vec![Domain::Lint]);
    assert_eq!(manifest.concerns.len(), 1);
    assert_eq!(manifest.concerns[0].key, CONCERN_ID);
    assert!(manifest.capabilities.fs_read.is_empty());
    assert!(!manifest.capabilities.network);

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
    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");

    assert_eq!(
        diagnostics.len(),
        1,
        "фікстура-порушення мала знайтись рівно один раз: {diagnostics:?}"
    );
    assert_eq!(diagnostics[0].reason, CONCERN_REASON);
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert_eq!(diagnostics[0].file.as_deref(), Some("violating.txt"));
    assert!(diagnostics[0].message.contains(MARKER));
}
