//! Прогін детекту фікстурою реального wasm-компонента `plugin-lang-js`
//! (задача N2, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5) —
//! за зразком `tests/contract_test_kit.rs` (той самий `require_fixture`-мотив:
//! якщо `.wasm` відсутній, тест падає з точною командою збірки, не мовчазним
//! skip). Замінює виведений пілотний golden-тест
//! (`crates/plugin-lang-js-pilot`, видалений цією ж задачею) — покриває ОБИ
//! концерни цього плагіна.
//!
//! Звіряє реальний end-to-end прогін через [`PluginHost`]: `describe()`
//! декларує обидва концерни з очікуваними `scope`/`glob`, `detect()` на
//! фікстурах з `main.mjs` обох JS-оригіналів
//! (`plugins/lang-js/rules/vue/tfm-translations/main.mjs`,
//! `plugins/lang-js/rules/style/gap/main.mjs`) дає той самий violation, що й
//! JS-оригінали (reason/message біт-у-біт) — parity з JS-боку звіряє окремий
//! vitest-тест
//! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs` на цих
//! самих фікстурах.
//!
//! `detect()` на WIT-рівні не розрізняє per-file/full-scope (це виключно
//! host(napi)-бічна турбота, `crates/rules-napi::run_wasm_concern`) — тому
//! golden-тест `style/gap` просто передає весь batch файлів напряму, без
//! походу через napi full-scope-побудову.

use std::path::PathBuf;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_contract::manifest::{ConcernScope, Domain};
use rules_plugin_host::{PluginHost, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "3.0.0";
const CONCERN_TFM: &str = "vue/tfm-translations";
const CONCERN_GAP: &str = "style/gap";

/// Абсолютний шлях до зібраного `.wasm`-компонента (`crates/plugin-lang-js/build.sh`)
/// — `wasm32-wasip2`/`release`.
fn fixture_wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip2/release/plugin_lang_js.wasm")
}

fn require_fixture() -> PathBuf {
    let path = fixture_wasm_path();
    assert!(
        path.is_file(),
        "wasm-компонент plugin-lang-js не зібраний: {} відсутній.\n\
         Зберіть його командою: bash crates/plugin-lang-js/build.sh",
        path.display(),
    );
    path
}

/// v3.0 плагін не декларує зовнішніх tools — порожній резолвер (кожен
/// `run-tool`-виклик, якби він стався, отримав би типізовану помилку в
/// `tool-output`).
fn host() -> PluginHost {
    PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись")
}

#[test]
fn describe_declares_both_concerns_with_expected_scopes() {
    let path = require_fixture();
    let plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на plugin-lang-js");

    let manifest = plugin.describe();
    assert_eq!(manifest.id, "lang-js/wasm-concerns");
    assert_eq!(manifest.world_version, PLUGIN_WORLD_VERSION);
    assert_eq!(manifest.domains, vec![Domain::Lint]);
    assert_eq!(manifest.concerns.len(), 2);

    let tfm = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_TFM)
        .expect("vue/tfm-translations має бути в маніфесті");
    assert_eq!(tfm.scope, ConcernScope::PerFile);

    let gap = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_GAP)
        .expect("style/gap має бути в маніфесті");
    assert_eq!(gap.scope, ConcernScope::Full);
    assert!(gap.glob.iter().any(|g| g.contains("vue")));
    assert!(gap.glob.iter().any(|g| g.contains("scss")));
    assert!(gap.glob.iter().any(|g| g.contains("css")));

    assert!(manifest.capabilities.fs_read.is_empty());
    assert!(!manifest.capabilities.network);
}

/// Той самий сценарій, що й JS-тест `tests/tfm-translations.test.mjs`
/// («порушення: імпортує tf, але не оголошує getTr()»).
#[test]
fn detect_flags_vue_file_importing_tf_without_get_tr() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_TFM.to_string(),
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
        concern_id: CONCERN_TFM.to_string(),
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
fn detect_tfm_ignores_non_vue_files() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_TFM.to_string(),
        files: vec![SourceFile {
            path: "src/helper.mjs".to_string(),
            content: "import { tf } from '@nitra/tfm'\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест `style/gap` «exit 0 — n-gap-md
/// використано і визначено».
#[test]
fn detect_gap_passes_when_used_class_is_defined() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_GAP.to_string(),
        files: vec![
            SourceFile {
                path: "src/Row.vue".to_string(),
                content: "<template><div class=\"row n-gap-md\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".n-gap-md {\n  gap: 16px;\n}\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест `style/gap` «exit 1 — n-gap-lg
/// використано, але не визначено».
#[test]
fn detect_gap_flags_used_but_undefined_class() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_GAP.to_string(),
        files: vec![
            SourceFile {
                path: "src/Row.vue".to_string(),
                content: "<template><div class=\"row n-gap-lg\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".n-gap-sm {\n  gap: 8px;\n}\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "missing-gap-style");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(diagnostics[0].file.is_none());
    assert!(diagnostics[0].message.contains("n-gap-lg"));
}

/// Той самий сценарій, що й JS-тест `style/gap` «exit 0 — n-gap-* взагалі не
/// використовується».
#[test]
fn detect_gap_passes_when_class_never_used() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_GAP.to_string(),
        files: vec![SourceFile {
            path: "src/Row.vue".to_string(),
            content: "<template><div class=\"row q-gutter-md\" /></template>\n".to_string(),
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
        concern_id: CONCERN_TFM.to_string(),
        files: vec![],
        diagnostics: vec![],
    };
    let plan = plugin.fix(&request).expect("fix не мав провалитись");
    assert!(plan.edits.is_empty());
}
