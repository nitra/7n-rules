//! Прогін детекту фікстурою реального wasm-компонента `plugin-lang-js`
//! (задачі N2, Q1 батч 1, Q2 батч 2, Q3 та Q4 батч 4, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5 і
//! `docs/specs/2026-08-01-wasm-ast-strategy.md`) —
//! за зразком `tests/contract_test_kit.rs` (той самий `require_fixture`-мотив:
//! якщо `.wasm` відсутній, тест падає з точною командою збірки, не мовчазним
//! skip). Замінює виведений пілотний golden-тест
//! (`crates/plugin-lang-js-pilot`, видалений цією ж задачею) — покриває усі
//! чотирнадцять концернів у контрибуції цього плагіна.
//!
//! Звіряє реальний end-to-end прогін через [`PluginHost`]: `describe()`
//! декларує всі чотирнадцять концернів з очікуваними `scope`/`glob`,
//! `detect()` на фікстурах з `main.mjs` кожного JS-оригіналу
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
//! `plugins/lang-js/rules/test/no-relative-fs-path/main.mjs`,
//! `plugins/lang-js/rules/js-bun-redis/imports/main.mjs`,
//! `plugins/lang-js/rules/js-mssql/deps/main.mjs`,
//! `plugins/lang-js/rules/js-bun-db/safety/main.mjs`) дає той самий
//! violation, що й JS-оригінали біт-у-біт (`reason`/`message`). П'ять
//! останніх — справжні AST-концерни через `oxc_parser` (задачі Q3 і Q4
//! батч 4 — де-скоуп батчу 2 для js-bun-redis/js-mssql/js-bun-db знято,
//! regex-groundwork замінено AST-портом), не regex-порт — byte-exact parity
//! через ТОЙ САМИЙ движок, що JS-канон. Parity з JS-боку звіряє окремий
//! vitest-тест
//! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs` на цих
//! самих фікстурах.
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
const CONCERN_REDIS_IMPORTS: &str = "js-bun-redis/imports";
const CONCERN_MSSQL_DEPS: &str = "js-mssql/deps";
const CONCERN_BUN_DB_SAFETY: &str = "js-bun-db/safety";
const CONCERN_STORYBOOK_SCOPE: &str = "test/storybook-scope";
const CONCERN_STORYBOOK_HYGIENE: &str = "test/storybook-hygiene";
const CONCERN_STORYBOOK_PAGE_COVERAGE: &str = "test/storybook-page-coverage";
const CONCERN_STORYBOOK_SCAFFOLD: &str = "test/storybook-scaffold";
const CONCERN_STORYBOOK_CI: &str = "test/storybook-ci";
const CONCERN_STORYBOOK_VITEST_CONFIG: &str = "test/storybook-vitest-config";
const CONCERN_BUN_DB_PACKAGE_JSON: &str = "js-bun-db/package_json";
const CONCERN_REDIS_PACKAGE_JSON: &str = "js-bun-redis/package_json";
const CONCERN_MSSQL_PACKAGE_JSON: &str = "js-mssql/package_json";
const CONCERN_RULE_META: &str = "npm-module/rule_meta";
const CONCERN_SKILL_META: &str = "npm-module/skill_meta";
const CONCERN_HEADER_DOC_POINTER: &str = "npm-module/header_doc_pointer";
const CONCERN_PACKAGE_STRUCTURE: &str = "npm-module/package_structure";
const CONCERN_DEP_POLICY: &str = "js/dep-policy";
const CONCERN_BUN_LAYOUT: &str = "bun/layout";
const CONCERN_STYLE_TOOLING: &str = "style/tooling";
const CONCERN_SANDBOX_AWARE_TEST: &str = "test/sandbox-aware-test";
const CONCERN_VITEST_API_CONVENTIONS: &str = "test/vitest-api-conventions";
const CONCERN_VUE_PACKAGES: &str = "vue/packages";

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
fn describe_declares_all_thirty_five_concerns_with_expected_scopes() {
    let path = require_fixture();
    let plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на plugin-lang-js");

    let manifest = plugin.describe();
    assert_eq!(manifest.id, "lang-js/wasm-concerns");
    assert_eq!(manifest.world_version, PLUGIN_WORLD_VERSION);
    assert_eq!(manifest.domains, vec![Domain::Lint]);
    // Задача Q4 батч 4: `js-bun-redis/imports`/`js-mssql/deps`/
    // `js-bun-db/safety` тепер У контрибуції (AST-порти, де-скоуп батчу 2
    // знято — доккомент `crates/plugin-lang-js/src/lib.rs`); батч 5 додає
    // п'ять концернів storybook-сімейства (секція «Батч 5» там само).
    // Батч 6 додає `test/storybook-vitest-config` (розблоковано слотом
    // `repo-root@1` host-контексту) і три rego-порти `*/package_json`
    // (`js-bun-db`, `js-bun-redis`, `js-mssql`) — секція «Батч 6» там само.
    // Батч 7 додає кластер `npm-module/*` (rule_meta, skill_meta,
    // header_doc_pointer, package_structure) і `js/dep-policy` — секція
    // «Батч 7» там само. Батч 8 додає `bun/layout`, `style/tooling`,
    // `test/sandbox-aware-test` і `test/vitest-api-conventions` — секція
    // «Батч 8» там само. Батч 9 додає `vue/packages` — останній придатний
    // до порту концерн lang-js (секція «Батч 9» там само). Зріз 1
    // контракту v3.1 додає `test/stryker_config` — секція «Зріз 1» там
    // само (блокер package-асетів знявся: detect вмісту асетів не читає).
    // Зріз 2 додає `js/check` — вшитий канон oxlint (`include_str!`) плюс
    // рефакторинг рішення Ґ, секція «Зріз 2» там само.
    assert_eq!(manifest.concerns.len(), 35);

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

    // Три AST-концерни батчу 4 (задача Q4) — full-scope, глоби покривають
    // і JS/TS-джерела, і package.json (гейт «кореневий package.json існує»).
    for key in [
        CONCERN_REDIS_IMPORTS,
        CONCERN_MSSQL_DEPS,
        CONCERN_BUN_DB_SAFETY,
    ] {
        let contribution = manifest
            .concerns
            .iter()
            .find(|c| c.key == key)
            .unwrap_or_else(|| panic!("{key} має бути в маніфесті (задача Q4 батч 4)"));
        assert_eq!(contribution.scope, ConcernScope::Full);
        assert!(contribution.glob.iter().any(|g| g.contains("package.json")));
        assert!(contribution.glob.iter().any(|g| g.contains("{js,")));
    }

    // П'ять концернів storybook-сімейства (батч 5) — full-scope, глоби
    // покривають `.n-rules.json` (optOut/detectApps/ignore) і
    // `**/package.json` (workspace-розгортання) — ширші за `concern.json`
    // JS-оригіналів (доккомент `build_manifest` у
    // `crates/plugin-lang-js/src/lib.rs`, секція «Батч 5»).
    for key in [
        CONCERN_STORYBOOK_SCOPE,
        CONCERN_STORYBOOK_HYGIENE,
        CONCERN_STORYBOOK_PAGE_COVERAGE,
        CONCERN_STORYBOOK_SCAFFOLD,
        CONCERN_STORYBOOK_CI,
    ] {
        let contribution = manifest
            .concerns
            .iter()
            .find(|c| c.key == key)
            .unwrap_or_else(|| panic!("{key} має бути в маніфесті (батч 5)"));
        assert_eq!(contribution.scope, ConcernScope::Full);
        assert!(contribution.glob.iter().any(|g| g == ".n-rules.json"));
        assert!(contribution.glob.iter().any(|g| g == "**/package.json"));
    }

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

/// Живий смок пілота fix-контуру contract v3 (порт видаленого
/// `fix-no-bun-test-import.mjs`): detect → fix через РЕАЛЬНИЙ host-виклик
/// (`LoadedPlugin::fix`, включно з host-валідацією плану) — той самий
/// сценарій, що й видалений JS-кейс «T0-fix: fixable import переписується
/// на vitest, тест-код не чіпається».
#[test]
fn fix_no_bun_test_import_builds_rewrite_plan_via_host_call() {
    use rules_contract::fix::{FileEdit, FixRequest};

    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let bun_test = ["bun", "test"].join(":");
    let files = vec![SourceFile {
        path: "tests/foo.test.mjs".to_string(),
        content: format!(
            "import {{ describe, test, expect, beforeEach }} from '{bun_test}'\n\n\
             describe('x', () => {{\n  beforeEach(() => {{}})\n  test('ok', () => expect(1).toBe(1))\n}})\n"
        ),
    }];
    let batch = DetectBatch {
        concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
        files: files.clone(),
    };
    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);

    let request = FixRequest {
        concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
        files: files.clone(),
        diagnostics,
    };
    let plan = plugin.fix(&request).expect("fix не мав провалитись");
    assert_eq!(plan.edits.len(), 1);
    let content = match &plan.edits[0] {
        FileEdit::Write(write) => {
            assert_eq!(write.path, "tests/foo.test.mjs");
            write.content.clone()
        }
        other => panic!("очікували write-edit, отримали {other:?}"),
    };
    assert!(content.contains("from 'vitest'"));
    assert!(!content.contains(&bun_test));
    assert!(content.contains("test('ok', () => expect(1).toBe(1))"));

    // Re-detect по вмісту з плану — канонічний вердикт: порушення закрито.
    let after = plugin
        .detect(&DetectBatch {
            concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
            files: vec![SourceFile {
                path: "tests/foo.test.mjs".to_string(),
                content,
            }],
        })
        .expect("re-detect не мав провалитись");
    assert!(after.is_empty());
}

/// Не-fixable import (mock) — fix повертає порожній план, violation
/// лишається (дзеркало видаленого JS-кейсу «не-fixable import лишається
/// недоторканим»).
#[test]
fn fix_no_bun_test_import_returns_empty_plan_for_unfixable_import() {
    use rules_contract::fix::FixRequest;

    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let bun_test = ["bun", "test"].join(":");
    let files = vec![SourceFile {
        path: "tests/foo.test.mjs".to_string(),
        content: format!(
            "import {{ test, mock }} from '{bun_test}'\ntest('x', () => mock(() => 1))\n"
        ),
    }];
    let diagnostics = plugin
        .detect(&DetectBatch {
            concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
            files: files.clone(),
        })
        .expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);

    let plan = plugin
        .fix(&FixRequest {
            concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
            files,
            diagnostics,
        })
        .expect("fix не мав провалитись");
    assert!(plan.edits.is_empty());
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

/// `js-bun-redis/imports` (задача Q4 батч 4): заборонений `import` з
/// `ioredis` — message байт-у-байт як у JS-оригіналу (`main.mjs`,
/// `js-bun-redis: <rel>:<line> — заміни '<mod>' …: <snippet>`).
#[test]
fn detect_redis_imports_flags_ioredis_import_with_exact_message() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_REDIS_IMPORTS.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"name\":\"t\"}\n".to_string(),
            },
            SourceFile {
                path: "src/cache.mjs".to_string(),
                content: "import Redis from 'ioredis'\nexport const r = new Redis()\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "imports");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(diagnostics[0].file.is_none());
    assert_eq!(
        diagnostics[0].message,
        "js-bun-redis: src/cache.mjs:1 — заміни 'ioredis' на Bun native Redis (import { redis } \
         from 'bun', https://bun.com/docs/runtime/redis): import Redis from 'ioredis'"
    );
}

/// `js-bun-redis/imports`: імпорт у коментарі/рядку — НЕ порушення (AST, не
/// regex — головний мотив батчу 4).
#[test]
fn detect_redis_imports_passes_for_comment_and_string_mentions() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_REDIS_IMPORTS.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"name\":\"t\"}\n".to_string(),
            },
            SourceFile {
                path: "src/cache.mjs".to_string(),
                content: "// import Redis from 'ioredis'\nconst s = \"require('redis')\"\nexport const y = s\n"
                    .to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// `js-mssql/deps` (задача Q4 батч 4): версія нижче мінімуму — message
/// байт-у-байт (включно з `JSON.stringify`-лапками навколо діапазону).
#[test]
fn detect_mssql_deps_flags_low_version_with_exact_message() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_MSSQL_DEPS.to_string(),
        files: vec![SourceFile {
            path: "package.json".to_string(),
            content: "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^10.0.0\"}}\n".to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "deps");
    assert_eq!(
        diagnostics[0].message,
        "js-mssql: package.json: dependencies.mssql \"^10.0.0\" — має бути >=12.5.0 (js-mssql.mdc)"
    );
}

/// `js-mssql/deps`: singleton pool на рівні модуля + tagged `query` — чисто.
#[test]
fn detect_mssql_deps_passes_for_singleton_and_tagged_query() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_MSSQL_DEPS.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}\n".to_string(),
            },
            SourceFile {
                path: "src/db.ts".to_string(),
                content: "const pool = new sql.ConnectionPool(config)\nexport async function findUser(userId) {\n  return pool.request().query`SELECT * FROM users WHERE id = ${userId}`\n}\n"
                    .to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

/// `js-bun-db/safety` (задача Q4 батч 4): `new SQL(...)` всередині функції —
/// message байт-у-біт як у `scanFileForBunSqlPatterns`.
#[test]
fn detect_bun_db_safety_flags_per_request_sql_with_exact_message() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_BUN_DB_SAFETY.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"name\":\"t\"}\n".to_string(),
            },
            SourceFile {
                path: "src/db.ts".to_string(),
                content: "import { SQL } from 'bun'\nexport function getUser(id) {\n  const db = new SQL(process.env.DATABASE_URL)\n  return db`SELECT * FROM users WHERE id = ${id}`\n}\n"
                    .to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "safety");
    assert_eq!(
        diagnostics[0].message,
        "js-bun-db: src/db.ts:3 — не створюй new SQL(...) всередині функцій; тримай singleton на \
         рівні модуля (js-bun-db.mdc): new SQL(process.env.DATABASE_URL)"
    );
}

/// `js-bun-db/safety`: tagged template з `.join(',')` у `IN (...)` — ЧОТИРИ
/// діагностики (2 dynamic-list + 2 not_var-guard, дубль-обхід tagged —
/// точне дзеркало live-прогону JS-оригіналу, доккомент
/// `crates/plugin-lang-js/src/lib.rs`, секція «Батч 4»).
#[test]
fn detect_bun_db_safety_tagged_join_yields_js_identical_duplicates() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_BUN_DB_SAFETY.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"name\":\"t\"}\n".to_string(),
            },
            SourceFile {
                path: "src/db.ts".to_string(),
                content: "import { sql } from 'bun'\nexport async function findMany(ids) {\n  return sql`SELECT * FROM users WHERE id IN (${ids.join(',')})`\n}\n"
                    .to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 4);
    assert_eq!(diagnostics[0].message, diagnostics[1].message);
    assert!(diagnostics[0]
        .message
        .contains("заборонено підставляти у SQL динамічні списки"));
    assert_eq!(diagnostics[2].message, diagnostics[3].message);
    assert!(diagnostics[2]
        .message
        .contains("значення для IN (...) у template literal треба винести"));
}

/// Спільна фікстура батчу 5: мінімальне монорепо з Vue-бібліотекою
/// `packages/ui` у скоупі Storybook (peerDependencies.vue + 3 `.vue`) —
/// дзеркало `writeVueLibraryPkg` (`storybook-scope/tests/scope.test.mjs`).
fn storybook_scope_fixture_files() -> Vec<SourceFile> {
    let mut files = vec![
        SourceFile {
            path: "package.json".to_string(),
            content: "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}\n".to_string(),
        },
        SourceFile {
            path: "packages/ui/package.json".to_string(),
            content: "{\"name\":\"ui\",\"peerDependencies\":{\"vue\":\"^3.6.0\"}}\n".to_string(),
        },
    ];
    for i in 0..3 {
        files.push(SourceFile {
            path: format!("packages/ui/src/components/Comp{i}.vue"),
            content: "<template><div/></template>\n".to_string(),
        });
    }
    files
}

/// `test/storybook-scope`: застарілий optOut → `stale-opt-out` (той самий
/// сценарій, що JS-тест «storybook.optOut на неіснуючий пакет»).
#[test]
fn detect_storybook_scope_flags_stale_opt_out() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let mut files = storybook_scope_fixture_files();
    files.push(SourceFile {
        path: ".n-rules.json".to_string(),
        content: "{\"storybook\":{\"optOut\":[\"packages/ghost\"]}}\n".to_string(),
    });
    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_SCOPE.to_string(),
        files,
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "stale-opt-out");
    assert_eq!(
        diagnostics[0].message,
        ".n-rules.json storybook.optOut містить 'packages/ghost' — такого workspace-пакета немає \
         (застаріле opt-out, storybook.mdc)"
    );
}

/// `test/storybook-hygiene`: undeclared third-party import у `.vue`
/// бібліотеки → `undeclared-import` з byte-exact повідомленням JS-оригіналу.
#[test]
fn detect_storybook_hygiene_flags_undeclared_import() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let mut files = storybook_scope_fixture_files();
    files.push(SourceFile {
        path: "packages/ui/src/components/Picker.vue".to_string(),
        content: "<script setup>\nimport Datepicker from '@vuepic/vue-datepicker'\n</script>\n"
            .to_string(),
    });
    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_HYGIENE.to_string(),
        files,
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "undeclared-import");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert_eq!(
        diagnostics[0].message,
        "[undeclared-import] packages/ui/src/components/Picker.vue: import \
         '@vuepic/vue-datepicker' — пакет '@vuepic/vue-datepicker' відсутній у \
         dependencies/peerDependencies packages/ui (storybook.mdc hygiene)"
    );
}

/// `test/storybook-page-coverage`: сторінка app-пакета без stories поряд →
/// warn `page-missing-story` (хвиля 2a, лише за `detectApps: true`).
#[test]
fn detect_storybook_page_coverage_warns_page_without_story() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_PAGE_COVERAGE.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}\n".to_string(),
            },
            SourceFile {
                path: ".n-rules.json".to_string(),
                content: "{\"storybook\":{\"detectApps\":true}}\n".to_string(),
            },
            SourceFile {
                path: "packages/demo/package.json".to_string(),
                content: "{\"name\":\"demo\",\"dependencies\":{\"vue\":\"^3.6.0\"}}\n".to_string(),
            },
            SourceFile {
                path: "packages/demo/src/pages/task/[id].vue".to_string(),
                content: "<template><div/></template>\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "page-missing-story");
    assert_eq!(diagnostics[0].severity, Severity::Warn);
    assert_eq!(
        diagnostics[0].message,
        "[page-coverage] packages/demo/src/pages/task/[id].vue: немає жодної *.stories.js поряд — \
         сторінка app-проєкту без smoke-story (storybook.mdc, хвиля 2a)"
    );
}

/// `test/storybook-scaffold`: бібліотека у скоупі без жодного canon-файлу —
/// пʼять діагностик у порядку JS-оригіналу (main → preview → empty-vite →
/// vitest.setup → scripts.storybook).
#[test]
fn detect_storybook_scaffold_reports_missing_canon_files() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_SCAFFOLD.to_string(),
        files: storybook_scope_fixture_files(),
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    let reasons: Vec<&str> = diagnostics.iter().map(|d| d.reason.as_str()).collect();
    assert_eq!(
        reasons,
        vec![
            "missing-main-js",
            "missing-preview-js",
            "missing-empty-vite-config",
            "missing-vitest-setup-js",
            "missing-storybook-script",
        ]
    );
    assert_eq!(
        diagnostics[4].message,
        "[packages/ui] package.json#scripts.storybook має бути 'storybook dev -p 6006 --no-open' \
         (зараз: відсутній) — storybook.mdc"
    );
}

/// `test/storybook-ci`: бібліотека у скоупі без обох `.github`-файлів — дві
/// діагностики (composite action + workflow).
#[test]
fn detect_storybook_ci_reports_missing_repo_canon_files() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_CI.to_string(),
        files: storybook_scope_fixture_files(),
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 2);
    assert_eq!(diagnostics[0].reason, "missing-playwright-action");
    assert_eq!(
        diagnostics[0].file.as_deref(),
        Some(".github/actions/setup-playwright-chromium/action.yml")
    );
    assert_eq!(diagnostics[1].reason, "missing-storybook-workflow");
    assert_eq!(
        diagnostics[1].file.as_deref(),
        Some(".github/workflows/lint-storybook.yml")
    );
}

/// `test/storybook-vitest-config` (батч 6): бібліотека у скоупі без жодного
/// `vitest.config.*` — одна діагностика `vitest-config-missing`; `data`
/// містить `rootDir`/`type`, але НЕ `vitestConfigPath` (файлу ще немає).
#[test]
fn detect_storybook_vitest_config_reports_missing_config() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_VITEST_CONFIG.to_string(),
        files: storybook_scope_fixture_files(),
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "vitest-config-missing");
    assert_eq!(
        diagnostics[0].file.as_deref(),
        Some("packages/ui/vitest.config.mjs")
    );
    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("data має бути присутнім");
    assert_eq!(data["rootDir"], "packages/ui");
    assert_eq!(data["type"], "library");
}

/// `test/storybook-vitest-config` (батч 6): БЕЗ `set_repo_root` слот
/// `repo-root@1` віддає `none` — задокументована деградація доккомента
/// секції «Батч 6» (`crates/plugin-lang-js/src/lib.rs`): `vitestConfigPath`
/// стає repo-relative замість абсолютного, детекція не падає. У проді
/// `run_wasm_concern` завжди виставляє корінь (`crates/rules-napi`), тож
/// саме цей тест фіксує поведінку хоста БЕЗ контексту.
#[test]
fn detect_storybook_vitest_config_degrades_without_repo_root_slot() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let mut files = storybook_scope_fixture_files();
    files.push(SourceFile {
        path: "packages/ui/vitest.config.mjs".to_string(),
        content: "import { defineConfig } from 'vitest/config'\n\
                  export default defineConfig({ test: { globals: true } })\n"
            .to_string(),
    });
    files.push(SourceFile {
        path: "packages/ui/vitest.stryker.config.mjs".to_string(),
        content: "export default {}\n".to_string(),
    });

    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_VITEST_CONFIG.to_string(),
        files,
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 2);
    assert_eq!(diagnostics[0].reason, "unit-project-missing");
    assert_eq!(diagnostics[1].reason, "storybook-project-missing");
    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("data має бути присутнім");
    assert_eq!(data["vitestConfigPath"], "packages/ui/vitest.config.mjs");
}

/// `test/storybook-vitest-config` (батч 6): той самий батч, але зі
/// встановленим слотом `repo-root@1` — `vitestConfigPath` стає абсолютним
/// (саме цього потребує JS-фіксер `fix-storybook-vitest-config.mjs`).
#[test]
fn detect_storybook_vitest_config_uses_repo_root_slot_for_absolute_path() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();
    plugin.set_repo_root(Some("/repo".to_string()));

    let mut files = storybook_scope_fixture_files();
    files.push(SourceFile {
        path: "packages/ui/vitest.config.mjs".to_string(),
        content: "import { defineConfig } from 'vitest/config'\n\
                  export default defineConfig({ test: { globals: true } })\n"
            .to_string(),
    });
    files.push(SourceFile {
        path: "packages/ui/vitest.stryker.config.mjs".to_string(),
        content: "export default {}\n".to_string(),
    });

    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_VITEST_CONFIG.to_string(),
        files,
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    let data = diagnostics[0]
        .data
        .as_ref()
        .expect("data має бути присутнім");
    assert_eq!(
        data["vitestConfigPath"],
        "/repo/packages/ui/vitest.config.mjs"
    );
}

/// `test/storybook-vitest-config` (батч 6): відсутній лише ізольований
/// stryker-конфіг поруч із канонічним `vitest.config.mjs`.
#[test]
fn detect_storybook_vitest_config_reports_missing_stryker_config() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let mut files = storybook_scope_fixture_files();
    files.push(SourceFile {
        path: "packages/ui/vitest.config.mjs".to_string(),
        content: "import { defineConfig } from 'vitest/config'\n\
                  import { playwright } from '@vitest/browser-playwright'\n\
                  export default defineConfig({ test: { projects: [\n\
                  { name: 'unit' },\n\
                  { name: 'storybook', test: { browser: { instances: [{ browser: 'chromium' }], \
                  provider: playwright() } }, plugins: [storybookTest({ configDir: '.storybook' \
                  })] }\n\
                  ] } })\n"
            .to_string(),
    });

    let batch = DetectBatch {
        concern_id: CONCERN_STORYBOOK_VITEST_CONFIG.to_string(),
        files,
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "stryker-config-missing");
    assert_eq!(
        diagnostics[0].file.as_deref(),
        Some("packages/ui/vitest.stryker.config.mjs")
    );
}

/// `js-bun-db/package_json` (батч 6, rego-порт): обидві deny-залежності —
/// дві діагностики `policy-deny` у лексикографічному порядку повідомлень.
#[test]
fn detect_bun_db_package_json_flags_denied_dependencies() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_BUN_DB_PACKAGE_JSON.to_string(),
        files: vec![SourceFile {
            path: "package.json".to_string(),
            content: "{\"dependencies\":{\"pg-format\":\"^1.0.0\",\"mysql2\":\"^3.0.0\"}}\n"
                .to_string(),
        }],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 2);
    assert!(diagnostics
        .iter()
        .all(|d| d.reason == "policy-deny" && d.file.as_deref() == Some("package.json")));
    assert!(diagnostics[0].message.starts_with("dependencies.mysql2"));
    assert!(diagnostics[1].message.starts_with("dependencies.pg-format"));
}

/// `js-bun-redis/package_json` (батч 6, rego-порт): deny-пакет у вкладеному
/// `package.json` — `file` лишається repo-relative шляхом файлу батчу.
#[test]
fn detect_redis_package_json_flags_denied_dependency_in_nested_package() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_REDIS_PACKAGE_JSON.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"name\":\"root\"}\n".to_string(),
            },
            SourceFile {
                path: "packages/api/package.json".to_string(),
                content: "{\"dependencies\":{\"ioredis\":\"^5.0.0\"}}\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "policy-deny");
    assert_eq!(
        diagnostics[0].file.as_deref(),
        Some("packages/api/package.json")
    );
    assert!(diagnostics[0].message.contains("Bun native Redis"));
}

/// `js-mssql/package_json` (батч 6, rego-порт): нижча за мінімум версія —
/// одна діагностика з `%q`-формою діапазону; `workspace:` і `>= 12.5.0` —
/// тиша.
#[test]
fn detect_mssql_package_json_checks_minimum_version() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_MSSQL_PACKAGE_JSON.to_string(),
        files: vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\"dependencies\":{\"mssql\":\"^10.0.0\"}}\n".to_string(),
            },
            SourceFile {
                path: "packages/ok/package.json".to_string(),
                content: "{\"dependencies\":{\"mssql\":\"^12.5.0\"}}\n".to_string(),
            },
            SourceFile {
                path: "packages/ws/package.json".to_string(),
                content: "{\"dependencies\":{\"mssql\":\"workspace:*\"}}\n".to_string(),
            },
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "policy-deny");
    assert_eq!(
        diagnostics[0].message,
        "dependencies.mssql має бути >= 12.5.0 (зараз \"^10.0.0\") (js-mssql.mdc)"
    );
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

// ---------------------------------------------------------------------
// Батч 7 (§3.5.5): кластер `npm-module/*` + `js/dep-policy` — golden-тести
// через РЕАЛЬНИЙ `PluginHost` (unit-тести крейта ганяють ті самі чисті
// функції на host-таргеті; тут доводиться, що вони так само працюють
// всередині wasm-компонента за справжнім ABI).

/// Мінімальний конструктор елемента батча.
fn batch_file(path: &str, content: &str) -> SourceFile {
    SourceFile {
        path: path.to_string(),
        content: content.to_string(),
    }
}

#[test]
fn detect_rule_meta_validates_rule_metadata_from_batch() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_RULE_META.to_string(),
        files: vec![
            batch_file("npm/rules/a-ok/main.mdc", "# ok\n"),
            batch_file("npm/rules/a-ok/main.json", "{\"auto\":\"завжди\"}"),
            batch_file(
                "npm/rules/b-bad/main.json",
                "{\"auto\":{\"predicate\":\"nope\"}}",
            ),
            batch_file("npm/rules/c-nojson/main.mdc", "# c\n"),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    let messages: Vec<&str> = diagnostics.iter().map(|d| d.message.as_str()).collect();
    assert_eq!(
        messages,
        vec![
            "rules/b-bad: відсутній main.mdc — обов'язковий (scripts.mdc)",
            "rules/b-bad: main.json — невідомий predicate \"nope\" (немає в RULE_PREDICATES)",
            "rules/c-nojson: відсутній або невалідний main.json",
        ]
    );
    assert_eq!(diagnostics[0].reason, "rule_meta");
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(diagnostics[0].file.is_none());
}

#[test]
fn detect_skill_meta_validates_skill_metadata_from_batch() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_SKILL_META.to_string(),
        files: vec![
            batch_file("npm/skills/n-lint/main.json", "{\"worktree\":false}"),
            batch_file(
                "npm/skills/n-taze/main.json",
                "{\"worktree\":true,\"requireRoot\":false}",
            ),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "skill_meta");
    assert_eq!(
        diagnostics[0].message,
        "skills/n-taze: requireRoot:false суперечить worktree:true \
         (worktree вже вимагає кореня — прибери поле)"
    );
}

#[test]
fn detect_header_doc_pointer_flags_narrative_jsdoc_next_to_docs() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_HEADER_DOC_POINTER.to_string(),
        files: vec![
            batch_file("npm/rules/n-js/js/docs/scan.md", "# scan\n"),
            batch_file(
                "npm/rules/n-js/js/scan.mjs",
                "/**\n * Огляд.\n * Деталі.\n */\nexport const x = 1\n",
            ),
            // pointer поряд з docs — без порушення.
            batch_file("npm/rules/n-js/js/docs/ok.md", "# ok\n"),
            batch_file(
                "npm/rules/n-js/js/ok.mjs",
                "/** @see ./docs/ok.md */\nexport const y = 1\n",
            ),
            // Наратив БЕЗ docs поряд — теж без порушення.
            batch_file(
                "npm/rules/n-js/js/free.mjs",
                "/**\n * Огляд.\n * Деталі.\n */\nexport const z = 1\n",
            ),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "header_doc_pointer");
    assert_eq!(
        diagnostics[0].message,
        "npm/rules/n-js/js/scan.mjs: docs/scan.md вже описує поведінку — \
         module-level JSDoc має бути pointer (≤1 рядок, зараз 2)"
    );
}

#[test]
fn detect_package_structure_reports_missing_pieces_in_canonical_order() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_PACKAGE_STRUCTURE.to_string(),
        files: vec![batch_file("readme.md", "# x\n")],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    let messages: Vec<&str> = diagnostics.iter().map(|d| d.message.as_str()).collect();
    assert_eq!(
        messages,
        vec![
            "package.json не існує",
            "npm/ директорія не існує",
            "npm/package.json не існує — створи package.json для npm модуля",
            "Без .js під npm/src потрібен npm/tsconfig.emit-types.json \
             (див. npm-module.mdc: emit через tsconfig, без штучного src/index.js)",
            "Очікується hk.pkl або .config/hk.pkl з pre-commit і tsc (npm-module.mdc)",
            ".github/workflows/ не існує",
            "Відсутній .github/workflows/npm-publish.yml (npm-module.mdc: npm publish)",
        ]
    );
    assert!(diagnostics.iter().all(|d| d.reason == "package_structure"));
}

#[test]
fn detect_package_structure_flags_tests_inside_published_files() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_PACKAGE_STRUCTURE.to_string(),
        files: vec![
            batch_file("package.json", "{\"workspaces\":[\"npm\"]}"),
            batch_file(
                "npm/package.json",
                "{\"types\":\"./types/index.d.ts\",\"files\":[\"lib\",\"!**/*.test.mjs\"]}",
            ),
            batch_file("npm/types/index.d.ts", "export {}\n"),
            batch_file("npm/tsconfig.emit-types.json", "{}\n"),
            batch_file("npm/lib/ok.mjs", "export const ok = 1\n"),
            batch_file("npm/lib/util.test.mjs", "export const t = 1\n"),
            batch_file(
                "npm/lib/sneaky.mjs",
                "import { describe } from 'vitest'\nexport const s = describe\n",
            ),
            batch_file(
                "hk.pkl",
                "[\"pre-commit\"] bunx -p typescript tsc -p npm/tsconfig.emit-types.json\n\
                 [\"npm-changelog\"] N_RULES_CHANGELOG_AUTOFIX=1 lint changelog\n",
            ),
            batch_file(".github/workflows/npm-publish.yml", "name: publish\n"),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert!(
        diagnostics[0]
            .message
            .starts_with("npm/lib/sneaky.mjs: імпорт test-фреймворку \"vitest\""),
        "фактично: {}",
        diagnostics[0].message
    );
}

#[test]
fn detect_dep_policy_flags_banned_specifiers_only_in_real_import_positions() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_DEP_POLICY.to_string(),
        files: vec![
            batch_file(
                "src/noise.mjs",
                "// import x from 'ua-parser-js'\nexport const s = \"ua-parser-js\"\n",
            ),
            batch_file(
                "src/hit.mjs",
                "import UAParser from 'ua-parser-js'\nexport const p = UAParser\n",
            ),
            batch_file(
                "src/req.cjs",
                "const f = require('@nitra/as-integrations-fastify')\nmodule.exports = f\n",
            ),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 2);
    assert!(diagnostics.iter().all(|d| d.reason == "dep-policy"));
    assert!(diagnostics[0]
        .message
        .starts_with("src/hit.mjs: заборонений"));
    assert!(diagnostics[1].message.contains("@as-integrations/fastify"));
}

// --- батч 8: bun/layout, style/tooling, test/sandbox-aware-test,
//     test/vitest-api-conventions ---

#[test]
fn detect_bun_layout_passes_on_canonical_bun_root() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_BUN_LAYOUT.to_string(),
        files: vec![
            batch_file("bun.lock", ""),
            batch_file("bunfig.toml", "[install]\nlinker = \"hoisted\"\n"),
            batch_file("package.json", "{ \"name\": \"app\" }\n"),
        ],
    };

    assert!(plugin
        .detect(&batch)
        .expect("detect не мав провалитись")
        .is_empty());
}

#[test]
fn detect_bun_layout_flags_foreign_lockfiles_and_missing_bun_artifacts() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_BUN_LAYOUT.to_string(),
        files: vec![
            batch_file("package-lock.json", "{}\n"),
            // Каталог `.yarn/` реконструюється з батча — файл під ним.
            batch_file(".yarn/install-state.gz", ""),
            batch_file("package.json", "{}\n"),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    let messages: Vec<&str> = diagnostics.iter().map(|d| d.message.as_str()).collect();
    assert_eq!(
        messages,
        vec![
            "Знайдено заборонений файл: package-lock.json — видали його",
            "Знайдено директорію .yarn — видали її",
            "Відсутній bun.lock — запусти bun i",
            "Відсутній bunfig.toml — створи з [install] linker = \"hoisted\" (bun.mdc)",
        ]
    );
    assert!(diagnostics.iter().all(|d| d.reason == "layout"));
}

#[test]
fn detect_style_tooling_passes_with_config_and_dist_ignore() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_STYLE_TOOLING.to_string(),
        files: vec![
            batch_file(
                "package.json",
                "{ \"stylelint\": { \"extends\": \"@nitra/stylelint-config\" } }\n",
            ),
            batch_file(".stylelintignore", "dist/\n"),
        ],
    };

    assert!(plugin
        .detect(&batch)
        .expect("detect не мав провалитись")
        .is_empty());
}

#[test]
fn detect_style_tooling_flags_missing_config_and_ignore() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_STYLE_TOOLING.to_string(),
        files: vec![batch_file("package.json", "{ \"name\": \"app\" }\n")],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 2);
    assert!(diagnostics.iter().all(|d| d.reason == "tooling"));
    assert!(diagnostics[0]
        .message
        .starts_with("Немає конфігу stylelint"));
    assert_eq!(
        diagnostics[1].message,
        ".stylelintignore не існує — створи з вмістом: dist/"
    );
}

#[test]
fn detect_sandbox_aware_test_flags_unguarded_deep_navigation() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_SANDBOX_AWARE_TEST.to_string(),
        files: vec![
            batch_file(
                "tests/deep.test.mjs",
                "import { join } from 'node:path'\n\
                 const root = join(import.meta.dirname, '..', '..', '..', '..')\n",
            ),
            batch_file(
                "tests/guarded.test.mjs",
                "import { join } from 'node:path'\n\
                 const root = join(import.meta.dirname, '..', '..', '..', '..')\n\
                 await withTmpDir(async dir => {})\n",
            ),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "sandbox-aware-test");
    assert!(diagnostics[0].file.is_none());
    assert!(
        diagnostics[0]
            .message
            .starts_with("tests/deep.test.mjs: import.meta deep navigation"),
        "фактично: {}",
        diagnostics[0].message
    );
}

#[test]
fn detect_vitest_api_conventions_flags_to_be_with_literal_argument() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let batch = DetectBatch {
        concern_id: CONCERN_VITEST_API_CONVENTIONS.to_string(),
        files: vec![
            batch_file(
                "tests/api.test.mjs",
                "expect(a).toBe({ x: 1 })\nexpect(b).toBe(['x'].join('\\n'))\n",
            ),
            batch_file("src/api.mjs", "expect(c).toBe([1])\n"),
        ],
    };

    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "vitest-api-conventions");
    assert_eq!(diagnostics[0].file.as_deref(), Some("tests/api.test.mjs"));
    assert!(
        diagnostics[0]
            .message
            .starts_with("tests/api.test.mjs:1: expect(...).toBe(...)"),
        "фактично: {}",
        diagnostics[0].message
    );
}

/// Батч 9: `vue/packages` — сукупний прогін по чистому Vue-пакету (жодної
/// діагностики) і по пакету з трьома різними класами порушень.
#[test]
fn detect_vue_packages_flags_vue_import_node_import_and_esbuild() {
    let path = require_fixture();
    let mut plugin = host().load(&path, PLUGIN_WORLD_VERSION).unwrap();

    let clean_files = vec![
        batch_file(
            "package.json",
            "{\"name\":\"app\",\"dependencies\":{\"vue\":\"^3.6.0\"},\
             \"devDependencies\":{\"vitest\":\"1\",\"@vitest/coverage-v8\":\"1\",\
             \"@stryker-mutator/vitest-runner\":\"1\"}}",
        ),
        batch_file(
            ".vscode/extensions.json",
            "{\"recommendations\":[\"Vue.volar\"]}",
        ),
        batch_file("jsconfig.json", "{}"),
        batch_file(
            "src/vite-env.d.ts",
            "/// <reference types=\"vite/client\" />\n",
        ),
        batch_file(
            "vite.config.js",
            "export default { css: { transformer: 'lightningcss' }, \
             plugins: [VueMacros({}), AutoImport({ imports: ['vue'] })] }\n",
        ),
    ];

    assert!(plugin
        .detect(&DetectBatch {
            concern_id: CONCERN_VUE_PACKAGES.to_string(),
            files: clean_files.clone(),
        })
        .expect("detect не мав провалитись")
        .is_empty());

    let mut dirty = clean_files;
    dirty.push(batch_file(
        "src/Page.vue",
        "<template><div /></template>\n<script setup>\nimport { ref } from 'vue'\n</script>\n",
    ));
    dirty.push(batch_file(
        "src/Fs.vue",
        "<script setup>\nimport { readFile } from 'node:fs/promises'\n</script>\n",
    ));
    dirty.push(batch_file("docs/build.md", "esbuild ще тут\n"));

    let diagnostics = plugin
        .detect(&DetectBatch {
            concern_id: CONCERN_VUE_PACKAGES.to_string(),
            files: dirty,
        })
        .expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 3);
    assert!(diagnostics.iter().all(|d| d.reason == "packages"));
    assert!(diagnostics.iter().all(|d| d.file.is_none()));
    assert_eq!(
        diagnostics[0].message,
        "[корінь] src/Page.vue:2 — прибери явний value-імпорт з 'vue' \
         (unplugin-auto-import): import { ref } from 'vue'"
    );
    assert!(
        diagnostics[1]
            .message
            .starts_with("[корінь] src/Fs.vue:2 — імпорт Node-нативного модуля 'node:fs/promises'"),
        "фактично: {}",
        diagnostics[1].message
    );
    assert_eq!(
        diagnostics[2].message,
        "[корінь] docs/build.md:1 — знайдено 'esbuild'. Замінити на 'rolldown'. \
         Фрагмент: esbuild ще тут"
    );
}
