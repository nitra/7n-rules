//! Прогін детекту фікстурою реального wasm-компонента `plugin-lang-js`
//! (задачі N2, Q1 батч 1, Q2 батч 2 та Q3 — де-скоуп до byte-exact-парних
//! концернів, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5 і
//! `docs/specs/2026-08-01-wasm-ast-strategy.md`) —
//! за зразком `tests/contract_test_kit.rs` (той самий `require_fixture`-мотив:
//! якщо `.wasm` відсутній, тест падає з точною командою збірки, не мовчазним
//! skip). Замінює виведений пілотний golden-тест
//! (`crates/plugin-lang-js-pilot`, видалений цією ж задачею) — покриває усі
//! одинадцять концернів у контрибуції цього плагіна.
//!
//! Звіряє реальний end-to-end прогін через [`PluginHost`]: `describe()`
//! декларує всі одинадцять концернів з очікуваними `scope`/`glob`, `detect()`
//! на фікстурах з `main.mjs` кожного JS-оригіналу
//! (`plugins/lang-js/rules/vue/tfm-translations/main.mjs`,
//! `plugins/lang-js/rules/style/gap/main.mjs`,
//! `plugins/lang-js/rules/test/vitest-config-pool-forks/main.mjs`,
//! `plugins/lang-js/rules/test/no-process-chdir/main.mjs`,
//! `plugins/lang-js/rules/style/admin_table/main.mjs`,
//! `plugins/lang-js/rules/style/quasar_fixes/main.mjs`,
//! `plugins/lang-js/rules/test/location/main.mjs`,
//! `plugins/lang-js/rules/test/no-console-store-restore/main.mjs`,
//! `plugins/lang-js/rules/test/no-bun-test-import/main.mjs`,
//! `plugins/lang-js/rules/js/utils_imports/main.mjs`,
//! `plugins/lang-js/rules/test/no-relative-fs-path/main.mjs`) дає той самий
//! violation, що й JS-оригінали біт-у-біт (`reason`/`message`). Останні два
//! — справжні AST-концерни через `oxc_parser` (задача Q3), не regex-порт —
//! byte-exact parity через ТОЙ САМИЙ движок, що JS-канон. Parity з JS-боку
//! звіряє окремий vitest-тест
//! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs` на цих
//! самих фікстурах.
//!
//! `js-bun-redis/imports`/`js-bun-db/safety`/`js-mssql/deps` — СВІДОМО БЕЗ
//! контрибуції (рішення оркестратора, доккомент секції «Регекс-наближення»
//! `crates/plugin-lang-js/src/lib.rs`): їхні detect-функції — groundwork,
//! недосяжні через `describe()`, тож немає golden-тестів тут (unit-рівневі
//! тести на самих функціях лишаються в `crates/plugin-lang-js/src/lib.rs`).
//!
//! `detect()` на WIT-рівні не розрізняє per-file/full-scope (це виключно
//! host(napi)-бічна турбота, `crates/rules-napi::run_wasm_concern`) — тому
//! golden-тести whole-batch концернів (`style/gap` і решта) просто передають
//! весь batch файлів напряму, без походу через napi full-scope-побудову.

use std::path::PathBuf;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::diagnostic::Severity;
use rules_contract::manifest::{ConcernScope, Domain};
use rules_plugin_host::{PluginHost, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "3.0.0";
const CONCERN_TFM: &str = "vue/tfm-translations";
const CONCERN_GAP: &str = "style/gap";
const CONCERN_POOL_FORKS: &str = "test/vitest-config-pool-forks";
const CONCERN_NO_PROCESS_CHDIR: &str = "test/no-process-chdir";
const CONCERN_ADMIN_TABLE: &str = "style/admin_table";
const CONCERN_QUASAR_FIXES: &str = "style/quasar_fixes";
const CONCERN_LOCATION: &str = "test/location";
const CONCERN_NO_CONSOLE_STORE_RESTORE: &str = "test/no-console-store-restore";
const CONCERN_NO_BUN_TEST_IMPORT: &str = "test/no-bun-test-import";
const CONCERN_UTILS_IMPORTS: &str = "js/utils_imports";
const CONCERN_NO_RELATIVE_FS_PATH: &str = "test/no-relative-fs-path";

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
fn describe_declares_all_eleven_concerns_with_expected_scopes() {
    let path = require_fixture();
    let plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на plugin-lang-js");

    let manifest = plugin.describe();
    assert_eq!(manifest.id, "lang-js/wasm-concerns");
    assert_eq!(manifest.world_version, PLUGIN_WORLD_VERSION);
    assert_eq!(manifest.domains, vec![Domain::Lint]);
    // Де-скоуп (рішення оркестратора): `js-bun-redis/imports`/
    // `js-bun-db/safety`/`js-mssql/deps` НЕ в контрибуції (groundwork,
    // доккомент модуля вище й `crates/plugin-lang-js/src/lib.rs`).
    assert_eq!(manifest.concerns.len(), 11);

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

    let pool_forks = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_POOL_FORKS)
        .expect("test/vitest-config-pool-forks має бути в маніфесті");
    assert_eq!(pool_forks.scope, ConcernScope::Full);
    assert!(pool_forks.glob.iter().any(|g| g == "vitest.config.mjs"));
    assert!(pool_forks.glob.iter().any(|g| g == "vitest.config.js"));

    let no_process_chdir = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_NO_PROCESS_CHDIR)
        .expect("test/no-process-chdir має бути в маніфесті");
    assert_eq!(no_process_chdir.scope, ConcernScope::Full);
    assert!(no_process_chdir.glob.iter().any(|g| g.contains("test.mjs")));
    assert!(no_process_chdir.glob.iter().any(|g| g.contains("test.js")));

    let admin_table = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_ADMIN_TABLE)
        .expect("style/admin_table має бути в маніфесті");
    assert_eq!(admin_table.scope, ConcernScope::Full);
    assert!(admin_table.glob.iter().any(|g| g.contains("vue")));

    let quasar_fixes = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_QUASAR_FIXES)
        .expect("style/quasar_fixes має бути в маніфесті");
    assert_eq!(quasar_fixes.scope, ConcernScope::Full);
    assert!(quasar_fixes.glob.iter().any(|g| g.contains("vue")));

    let location = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_LOCATION)
        .expect("test/location має бути в маніфесті");
    assert_eq!(location.scope, ConcernScope::Full);
    assert!(location.glob.iter().any(|g| g.contains("test.mjs")));

    let no_console = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_NO_CONSOLE_STORE_RESTORE)
        .expect("test/no-console-store-restore має бути в маніфесті");
    assert_eq!(no_console.scope, ConcernScope::Full);
    assert!(no_console.glob.iter().any(|g| g.contains("test.mjs")));

    let no_bun_test = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_NO_BUN_TEST_IMPORT)
        .expect("test/no-bun-test-import має бути в маніфесті");
    assert_eq!(no_bun_test.scope, ConcernScope::Full);
    assert!(no_bun_test.glob.iter().any(|g| g.contains("test.mjs")));

    let utils_imports = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_UTILS_IMPORTS)
        .expect("js/utils_imports має бути в маніфесті (задача Q3, AST через oxc_parser)");
    assert_eq!(utils_imports.scope, ConcernScope::Full);
    assert!(utils_imports.glob.iter().any(|g| g.contains("utils")));

    let no_relative_fs_path = manifest
        .concerns
        .iter()
        .find(|c| c.key == CONCERN_NO_RELATIVE_FS_PATH)
        .expect("test/no-relative-fs-path має бути в маніфесті (задача Q3, AST через oxc_parser)");
    assert_eq!(no_relative_fs_path.scope, ConcernScope::Full);
    assert!(no_relative_fs_path
        .glob
        .iter()
        .any(|g| g.contains("test.mjs")));

    // `js-bun-redis/imports`/`js-bun-db/safety`/`js-mssql/deps` — свідомо
    // ВІДСУТНІ в маніфесті (де-скоуп, доккомент модуля вище).
    assert!(!manifest
        .concerns
        .iter()
        .any(|c| c.key == "js-bun-redis/imports"
            || c.key == "js-bun-db/safety"
            || c.key == "js-mssql/deps"));

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

/// Той самий сценарій, що й JS-тест `test/vitest-config-pool-forks`
/// «успіх: config з pool: 'forks' → exit 0».
#[test]
fn detect_pool_forks_passes_when_config_has_pool_forks() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_POOL_FORKS.to_string(),
        files: vec![SourceFile {
            path: "vitest.config.js".to_string(),
            content: "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { pool: 'forks' } })\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест «порушення: vitest.config.mjs з
/// pool: 'threads' → exit 1».
#[test]
fn detect_pool_forks_flags_config_with_other_pool() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_POOL_FORKS.to_string(),
        files: vec![SourceFile {
            path: "vitest.config.mjs".to_string(),
            content: "export default { test: { pool: 'threads' } }\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "vitest-config-pool-forks");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(diagnostics[0].file.is_none());
}

/// Той самий сценарій, що й JS-тест «успіх: vitest.config.{mjs,js}
/// відсутній — skip → exit 0».
#[test]
fn detect_pool_forks_passes_when_no_config_present() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_POOL_FORKS.to_string(),
        files: vec![],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест `test/no-process-chdir` «порушення:
/// тест із process.chdir(dir) → exit 1».
#[test]
fn detect_no_process_chdir_flags_forbidden_call() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_NO_PROCESS_CHDIR.to_string(),
        files: vec![SourceFile {
            path: "tests/foo.test.mjs".to_string(),
            content: "import { test } from \"vitest\"\ntest(\"bad\", () => { process.chdir(\"/tmp\") })\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "process-chdir-in-test");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert_eq!(diagnostics[0].file.as_deref(), Some("tests/foo.test.mjs"));
    assert!(diagnostics[0].data.is_some());
}

/// Той самий сценарій, що й JS-тест «успіх: тест без забороненого виклику
/// → exit 0».
#[test]
fn detect_no_process_chdir_passes_without_forbidden_call() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_NO_PROCESS_CHDIR.to_string(),
        files: vec![SourceFile {
            path: "tests/foo.test.mjs".to_string(),
            content: "import { test } from \"vitest\"\ntest(\"ok\", () => {})\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест `style/admin_table` «exit 0 —
/// n-admin-table використано і визначено».
#[test]
fn detect_admin_table_passes_when_used_class_is_defined() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_ADMIN_TABLE.to_string(),
        files: vec![
            SourceFile {
                path: "src/Table.vue".to_string(),
                content: "<template><q-table class=\"n-admin-table\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".n-admin-table {\n  height: 100%;\n}\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест «exit 1 — n-admin-table використано,
/// але не визначено».
#[test]
fn detect_admin_table_flags_used_but_undefined_class() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_ADMIN_TABLE.to_string(),
        files: vec![
            SourceFile {
                path: "src/Table.vue".to_string(),
                content: "<template><q-table class=\"n-admin-table\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".other { color: red; }\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "missing-admin-table-style");
    assert!(diagnostics[0].file.is_none());
}

/// Той самий сценарій, що й JS-тест `style/quasar_fixes` «exit 0 —
/// q-scroll-area використано і фікс визначено».
#[test]
fn detect_quasar_fixes_passes_when_used_fix_is_defined() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_QUASAR_FIXES.to_string(),
        files: vec![
            SourceFile {
                path: "src/List.vue".to_string(),
                content: "<template><q-scroll-area /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".q-scrollarea {\n  display: flex;\n}\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест «exit 1 — q-tooltip використано, але
/// фікс відсутній».
#[test]
fn detect_quasar_fixes_flags_used_but_undefined_fix() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_QUASAR_FIXES.to_string(),
        files: vec![
            SourceFile {
                path: "src/Btn.vue".to_string(),
                content: "<template><q-btn><q-tooltip>hi</q-tooltip></q-btn></template>\n"
                    .to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".other { color: red; }\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "missing-quasar-fix");
    assert!(diagnostics[0].message.contains("q-tooltip"));
    assert!(diagnostics[0].file.is_none());
}

/// Той самий сценарій, що й JS-тест `test/location` «успіх: усі
/// *.test.mjs у tests/ → exit 0».
#[test]
fn detect_location_passes_when_test_is_inside_tests_dir() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_LOCATION.to_string(),
        files: vec![
            SourceFile {
                path: "rules/foo/js/bar/check.mjs".to_string(),
                content: "export function check() {}\n".to_string(),
            },
            SourceFile {
                path: "rules/foo/js/bar/tests/check.test.mjs".to_string(),
                content: "import { test } from \"vitest\"\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест «порушення: тест поряд із джерелом →
/// exit 1».
#[test]
fn detect_location_flags_test_next_to_source() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_LOCATION.to_string(),
        files: vec![
            SourceFile {
                path: "rules/foo/js/bar/check.mjs".to_string(),
                content: "export function check() {}\n".to_string(),
            },
            SourceFile {
                path: "rules/foo/js/bar/check.test.mjs".to_string(),
                content: "import { test } from \"vitest\"\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "location");
    assert!(diagnostics[0].file.is_none());
}

/// Той самий сценарій, що й JS-тест `test/no-console-store-restore`
/// «порушення: console.log = fn → exit 1».
#[test]
fn detect_no_console_store_restore_flags_direct_assignment() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let assign = ["console.lo", "g ="].join("");
    let batch = DetectBatch {
        concern_id: CONCERN_NO_CONSOLE_STORE_RESTORE.to_string(),
        files: vec![SourceFile {
            path: "tests/bad.test.mjs".to_string(),
            content: format!("const orig = {assign} fn\n"),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "no-console-store-restore");
    assert!(diagnostics[0].file.is_none());
}

/// Той самий сценарій, що й JS-тест «успіх: vi.spyOn(console, 'log') не
/// вважається порушенням → exit 0».
#[test]
fn detect_no_console_store_restore_passes_for_spy_on() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_NO_CONSOLE_STORE_RESTORE.to_string(),
        files: vec![SourceFile {
            path: "tests/ok.test.mjs".to_string(),
            content: "vi.spyOn(console, \"log\").mockReturnValue()\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест `test/no-bun-test-import` «порушення:
/// import з bun:test (test, expect) → 1 violation, fixable».
#[test]
fn detect_no_bun_test_import_flags_fixable_import() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let bun_test = ["bun", "test"].join(":");
    let batch = DetectBatch {
        concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
        files: vec![SourceFile {
            path: "tests/foo.test.mjs".to_string(),
            content: format!("import {{ test, expect }} from '{bun_test}'\ntest('ok', () => expect(1).toBe(1))\n"),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "bun-test-import");
    assert_eq!(diagnostics[0].file.as_deref(), Some("tests/foo.test.mjs"));
    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("data має бути присутнім");
    assert_eq!(data.get("fixable").and_then(|v| v.as_bool()), Some(true));
    let specifiers: Vec<String> = data
        .get("specifiers")
        .and_then(|v| v.as_array())
        .expect("specifiers має бути масивом")
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(specifiers, vec!["test".to_string(), "expect".to_string()]);
}

/// Той самий сценарій, що й JS-тест «успіх: import з vitest → без violations».
#[test]
fn detect_no_bun_test_import_passes_for_vitest_import() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
        files: vec![SourceFile {
            path: "tests/foo.test.mjs".to_string(),
            content: "import { describe, test, expect } from 'vitest'\ntest('ok', () => {})\n"
                .to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

// --- js/utils_imports (задача Q3, AST-концерн через oxc_parser) ---
// Фікстури дзеркалять `plugins/lang-js/rules/js/utils_imports/tests/utils_imports.test.mjs`.

/// Той самий сценарій, що й JS-тест «utils/ з забороненим ../ імпортом →
/// exit 1».
#[test]
fn detect_utils_imports_flags_parent_relative_import() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_UTILS_IMPORTS.to_string(),
        files: vec![SourceFile {
            path: "utils/bad.mjs".to_string(),
            content: "import { config } from '../lib/config.mjs'\nexport const x = config\n"
                .to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "utils_imports");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(diagnostics[0].file.is_none());
    assert!(diagnostics[0].message.contains("../lib/config.mjs"));
}

/// Той самий сценарій, що й JS-тест «utils/ з bare package import → exit 0».
#[test]
fn detect_utils_imports_passes_for_bare_package_import() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_UTILS_IMPORTS.to_string(),
        files: vec![SourceFile {
            path: "utils/fmt.mjs".to_string(),
            content: "import { parse } from 'yaml'\nexport const p = parse\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест «файл у utils/__fixtures__/ ігнорується».
#[test]
fn detect_utils_imports_ignores_fixtures_subdir() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_UTILS_IMPORTS.to_string(),
        files: vec![SourceFile {
            path: "utils/__fixtures__/data.mjs".to_string(),
            content: "import { x } from '../../other.mjs'\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

// --- test/no-relative-fs-path (задача Q3, AST-концерн через oxc_parser) ---
// Фікстури дзеркалять
// `plugins/lang-js/rules/test/no-relative-fs-path/tests/no-relative-fs-path.test.mjs`.

const NO_RELATIVE_FS_PATH_HEAD: &str =
    "import { writeFile, copyFile, mkdir } from 'node:fs/promises'\n";

/// Той самий сценарій, що й JS-тест «порушення: writeFile('foo.json', …) →
/// exit 1».
#[test]
fn detect_no_relative_fs_path_flags_relative_first_arg() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_NO_RELATIVE_FS_PATH.to_string(),
        files: vec![SourceFile {
            path: "tests/foo.test.mjs".to_string(),
            content: format!(
                "{NO_RELATIVE_FS_PATH_HEAD}await writeFile('foo.json', 'x', 'utf8')\n"
            ),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "no-relative-fs-path");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(diagnostics[0].file.is_none());
    assert!(diagnostics[0].message.contains("writeFile"));
    assert!(diagnostics[0].message.contains("1-й аргумент"));
}

/// Той самий сценарій, що й JS-тест «успіх: тест з join(dir, …) → exit 0».
#[test]
fn detect_no_relative_fs_path_passes_when_join_used() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_NO_RELATIVE_FS_PATH.to_string(),
        files: vec![SourceFile {
            path: "tests/foo.test.mjs".to_string(),
            content: format!(
                "{NO_RELATIVE_FS_PATH_HEAD}await writeFile(join(dir, 'foo.json'), 'x', 'utf8')\n"
            ),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// Той самий сценарій, що й JS-тест «не-тестові файли не скануються».
#[test]
fn detect_no_relative_fs_path_ignores_non_test_files() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_NO_RELATIVE_FS_PATH.to_string(),
        files: vec![SourceFile {
            path: "src/helper.mjs".to_string(),
            content: format!(
                "{NO_RELATIVE_FS_PATH_HEAD}export async function fn() {{ await writeFile('any.json', 'x') }}\n"
            ),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

// `js-bun-redis/imports`/`js-bun-db/safety`/`js-mssql/deps` — БЕЗ golden-
// тестів тут (де-скоуп, доккомент модуля вище): недосяжні через `describe()`,
// їхні unit-тести лишаються в `crates/plugin-lang-js/src/lib.rs`.

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
