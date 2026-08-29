//! Host-golden тест `plugin-ci-azure` — ШОСТИЙ first-party wasm-гість
//! (перший — `plugin-lang-js`, потім `plugin-lang-python`/`plugin-lang-rust`/
//! `plugin-lang-php`, пʼятий — `plugin-ci-github`, доккомент того тестового
//! файлу пояснює форму). Перевіряє `describe()`/`detect()`/`fix()` на
//! РЕАЛЬНОМУ зібраному `.wasm` через `PluginHost` — той самий рівень, що
//! `plugin_lang_php.rs`; парність із JS-каноном (`ruleId/concernId`-порт)
//! перевіряє ОКРЕМИЙ шар — `wasm-plugin-parity-ci-azure.test.mjs`, крізь
//! РЕАЛЬНИЙ napi-міст (`runWasmConcern`/`runWasmConcernFix`), доккомент
//! того файлу.
//!
//! Обидва концерни цієї хвилі (`azure-pipelines/lint_pipeline` — чистий
//! rego-детект, `azure-pipelines/vscode_extensions` — rego-детект +
//! T0-фіксатор) НЕ декларують `tools` — жоден `exec-tool`/`run-tool`-виклик
//! тут не потрібен, `ToolResolver::empty()` достатній для обох.

use std::path::PathBuf;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::fix::{FileEdit, FixRequest};
use rules_plugin_host::{PluginHost, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "3.2.0";
const CONCERN_LINT_PIPELINE: &str = "azure-pipelines/lint_pipeline";
const CONCERN_VSCODE_EXTENSIONS: &str = "azure-pipelines/vscode_extensions";

/// Абсолютний шлях до зібраного `.wasm`-компонента
/// (`crates/plugin-ci-azure/build.sh`) — той самий, що використовує
/// `wasm-plugin-parity-ci-azure.test.mjs`.
fn fixture_wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/wasm32-wasip2/release/plugin_ci_azure.wasm")
}

fn require_fixture() -> PathBuf {
    let path = fixture_wasm_path();
    assert!(
        path.is_file(),
        "wasm-компонент plugin-ci-azure не зібраний: {} відсутній.\n\
         Зберіть його командою: bash crates/plugin-ci-azure/build.sh",
        path.display(),
    );
    path
}

fn host() -> PluginHost {
    PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись")
}

fn sf(path: &str, content: &str) -> SourceFile {
    SourceFile {
        path: path.to_string(),
        content: content.to_string(),
    }
}

#[test]
fn describe_returns_three_concerns() {
    let path = require_fixture();
    let plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("завантаження plugin_ci_azure.wasm не мало провалитись");
    let manifest = plugin.describe();
    assert_eq!(manifest.id, "ci-azure/wasm-concerns");
    assert_eq!(manifest.world_version, "3.2.0");
    assert_eq!(manifest.concerns.len(), 3);
    let keys: Vec<&str> = manifest.concerns.iter().map(|c| c.key.as_str()).collect();
    assert!(keys.contains(&CONCERN_LINT_PIPELINE));
    assert!(keys.contains(&CONCERN_VSCODE_EXTENSIONS));
    // ДРУГА хвиля — walkGlob-концерн (detect-порт; T0-фікс лишається за
    // JS-каноном, доккомент `crates/plugin-ci-azure/src/lib.rs`).
    assert!(keys.contains(&"azure-pipelines/service_deploy_pipeline"));
    assert!(!manifest.capabilities.network);
    assert!(manifest.capabilities.fs_read.is_empty());
}

#[test]
fn lint_pipeline_missing_file_gives_policy_file_missing() {
    let path = require_fixture();
    let mut plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("завантаження plugin_ci_azure.wasm не мало провалитись");
    let batch = DetectBatch {
        concern_id: CONCERN_LINT_PIPELINE.to_string(),
        files: vec![],
    };
    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "policy-file-missing");
}

#[test]
fn lint_pipeline_walk_builtin_resolves_deny_through_real_wasm_component() {
    // Регресійний якір саме на "graph"-фіт `rules-rego-engine` (доккомент
    // `crates/plugin-ci-azure/src/lib.rs`, розділ «Друга пастка: walk()»):
    // без нього host-import `rego-engine` дав би `rego-engine-error`, не
    // `policy-deny`, на КОЖНОМУ виклику цього концерну.
    let path = require_fixture();
    let mut plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("завантаження plugin_ci_azure.wasm не мало провалитись");
    let batch = DetectBatch {
        concern_id: CONCERN_LINT_PIPELINE.to_string(),
        files: vec![sf("azure-pipelines.yml", "steps:\n  - script: echo build\n")],
    };
    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "policy-deny");
    assert!(diagnostics[0].message.contains("n-rules lint"));
}

#[test]
fn lint_pipeline_clean_pipeline_gives_no_diagnostics() {
    let path = require_fixture();
    let mut plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("завантаження plugin_ci_azure.wasm не мало провалитись");
    let batch = DetectBatch {
        concern_id: CONCERN_LINT_PIPELINE.to_string(),
        files: vec![sf(
            "azure-pipelines.yml",
            "steps:\n  - script: bunx n-rules lint --no-fix --full\n",
        )],
    };
    let diagnostics = plugin.detect(&batch).expect("detect не мав провалитись");
    assert!(diagnostics.is_empty());
}

#[test]
fn vscode_extensions_fix_cycle_through_real_wasm_component() {
    let path = require_fixture();
    let mut plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("завантаження plugin_ci_azure.wasm не мало провалитись");

    let before_batch = DetectBatch {
        concern_id: CONCERN_VSCODE_EXTENSIONS.to_string(),
        files: vec![],
    };
    let before = plugin.detect(&before_batch).expect("detect не мав провалитись");
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].reason, "policy-file-missing");

    let fix_request = FixRequest {
        concern_id: CONCERN_VSCODE_EXTENSIONS.to_string(),
        files: vec![],
        diagnostics: before,
    };
    let plan = plugin.fix(&fix_request).expect("fix не мав провалитись");
    assert_eq!(plan.edits.len(), 1);
    let FileEdit::Write(write) = &plan.edits[0] else {
        panic!("очікував write-edit");
    };
    assert_eq!(write.path, ".vscode/extensions.json");
    assert!(write.content.contains("ms-azure-devops.azure-pipelines"));

    let after_batch = DetectBatch {
        concern_id: CONCERN_VSCODE_EXTENSIONS.to_string(),
        files: vec![sf(".vscode/extensions.json", &write.content)],
    };
    let after = plugin.detect(&after_batch).expect("detect не мав провалитись");
    assert!(after.is_empty());
}
