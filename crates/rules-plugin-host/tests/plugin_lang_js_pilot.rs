//! Прогін детекту фікстурою пілотного wasm-компонента `plugin-lang-js-pilot`
//! (задача K фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.2) —
//! за зразком `tests/contract_test_kit.rs` (той самий `require_fixture`-мотив:
//! якщо `.wasm` відсутній, тест падає з точною командою збірки, не мовчазним
//! skip).
//!
//! Звіряє реальний end-to-end прогін через [`PluginHost`]: `describe()`
//! декларує `vue/tfm-translations`, `detect()` на `.vue`-фікстурі з `main.mjs`
//! (`plugins/lang-js/rules/vue/tfm-translations/main.mjs`) дає той самий
//! violation, що й JS-оригінал (reason/message біт-у-біт) — parity з JS-боку
//! звіряє окремий vitest-тест
//! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs` на цих
//! самих фікстурах.

use std::path::PathBuf;
use std::sync::Arc;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_contract::manifest::Domain;
use rules_contract::tool::ToolOutput;
use rules_plugin_host::{PluginHost, RunToolFn};

const PLUGIN_WORLD_VERSION: &str = "3.0.0";
const CONCERN_KEY: &str = "vue/tfm-translations";

/// Абсолютний шлях до зібраного `.wasm`-компонента пілоту
/// (`crates/plugin-lang-js-pilot/build.sh`) — `wasm32-wasip2`/`release`.
fn fixture_wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip2/release/plugin_lang_js_pilot.wasm")
}

fn require_fixture() -> PathBuf {
    let path = fixture_wasm_path();
    assert!(
        path.is_file(),
        "пілотний wasm-компонент не зібраний: {} відсутній.\n\
         Зберіть його командою: bash crates/plugin-lang-js-pilot/build.sh",
        path.display(),
    );
    path
}

/// v3.0 пілот не декларує зовнішніх tools — callback лише документує факт
/// виклику, якби він стався (той самий мотив, що й `contract_test_kit.rs`).
fn stub_run_tool() -> Arc<RunToolFn> {
    Arc::new(
        |_tool: &str, _args: &[String], _stdin: Option<&str>| ToolOutput {
            status: None,
            stdout: String::new(),
            stderr: "run-tool не задекларовано пілотним плагіном".to_string(),
        },
    )
}

fn host() -> PluginHost {
    PluginHost::new(stub_run_tool()).expect("PluginHost::new не мав провалитись")
}

#[test]
fn describe_declares_vue_tfm_translations_with_empty_capabilities() {
    let path = require_fixture();
    let plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на пілотному компоненті");

    let manifest = plugin.describe();
    assert_eq!(manifest.id, "lang-js-pilot/vue-tfm-translations");
    assert_eq!(manifest.world_version, PLUGIN_WORLD_VERSION);
    assert_eq!(manifest.domains, vec![Domain::Lint]);
    assert_eq!(manifest.concerns, vec![CONCERN_KEY.to_string()]);
    assert!(manifest.capabilities.fs_read.is_empty());
    assert!(!manifest.capabilities.network);
}

/// Той самий сценарій, що й JS-тест `tests/tfm-translations.test.mjs`
/// («порушення: імпортує tf, але не оголошує getTr()») — вміст файлу-фікстури
/// тут заданий прямо в тесті (хост уже читає вміст, wasm-плагін диска не
/// бачить, спека §3.2).
#[test]
fn detect_flags_vue_file_importing_tf_without_get_tr() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_KEY.to_string(),
        files: vec![SourceFile {
            path: "Page.vue".to_string(),
            content: "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n"
                .to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "tfm-translations");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert_eq!(diagnostics[0].file.as_deref(), Some("Page.vue"));
    assert!(diagnostics[0].message.contains("getTr"));
    assert!(diagnostics[0].data.is_none());
}

/// Той самий сценарій, що й JS-тест «успіх: використовує tf і оголошує
/// getTr() → без порушень».
#[test]
fn detect_passes_vue_file_with_get_tr_declared() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_KEY.to_string(),
        files: vec![SourceFile {
            path: "Page.vue".to_string(),
            content: "<template>{{ t(`Клиенты`) }}</template>\n<script setup>\n\
                      import { lang, tf as tfm } from '@nitra/tfm'\n\
                      const t = tfm.bind({ tr: getTr() })\n\n\
                      function getTr() {\n  return { Клиенты: { en: 'Customers' } }\n}\n\
                      </script>\n"
                .to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест «не .vue файли не скануються».
#[test]
fn detect_ignores_non_vue_files() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_KEY.to_string(),
        files: vec![SourceFile {
            path: "src/helper.mjs".to_string(),
            content: "import { tf } from '@nitra/tfm'\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

#[test]
fn fix_returns_empty_plan() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let request = rules_contract::fix::FixRequest {
        concern_id: CONCERN_KEY.to_string(),
        files: vec![],
        diagnostics: vec![],
    };
    let plan = plugin.fix(&request).expect("fix не мав провалитись");
    assert!(plan.edits.is_empty());
}
