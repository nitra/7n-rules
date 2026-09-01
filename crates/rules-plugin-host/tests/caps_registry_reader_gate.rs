//! **Гейт S1** карти `docs/specs/2026-08-30-contract-roadmap-blocked-concerns.md`
//! (§2.2 `azure-pipelines/service_deploy_pipeline`, §2.3 `ci_artifact/consume`,
//! §6 «Гейти, які має принести кожна поверхня») — доводить, для
//! `n-rules:caps/registry-reader@1.0.0`, дослівно ОБИДВІ половини критерію
//! готовності, той самий прийом, що `caps_file_reader_gate.rs`/
//! `caps_llm_consumer_gate.rs` (доккомент цих модулів пояснює «чому один
//! гість, а не два»):
//!
//! - [`declares_world_resolves_registry_through_host_import`] — гість,
//!   оголошений через `declared_worlds`, інстанціюється й `detect()`
//!   повертає РЕАЛЬНУ відповідь `active-domains`/`resolve-ci-artifacts`, що
//!   пройшла крізь host-імпорт, збудований [`StaticRegistryProvider`] над
//!   `rules_core::ci_artifact_registry` — не заглушку.
//! - [`undeclared_world_fails_instantiation_loudly`] — ТОЙ САМИЙ `.wasm`,
//!   завантажений БЕЗ `n-rules:caps/registry-reader@1.0.0` у
//!   `declared_worlds` — інстанціація гучно провалюється.
//!
//! # Що саме доводить перший тест — три властивості з §6 карти одночасно
//!
//! 1. **`none`/`some([])` не зливаються в один стан** —
//!    [`active_domains_none_and_empty_are_distinct`] окремо звіряє, що
//!    `StaticRegistryProvider::new(None, ..)` і
//!    `StaticRegistryProvider::new(Some(vec![]), ..)` дають РІЗНІ,
//!    розрізнювані гостем відповіді.
//! 2. **Host-side колізія `artifact-id` — гучна відмова ДО виклику гостя** —
//!    вхід [`declares_world_resolves_registry_through_host_import`] несе ДВА
//!    candidate-и з ОДНАКОВИМ `artifact-id`, різною `provenance`: гість
//!    НІКОЛИ не бачить жодного з них (`rules_core::ci_artifact_registry::split_collisions`,
//!    викликаний `StaticRegistryProvider`, вирізає обидва ДО того, як host-функція
//!    поверне список).
//! 3. **Шаблон із чужого пакета доїхав дослівно** — той самий вхід несе
//!    ТРЕТІЙ, неколізійний candidate із `package_root`, що НЕ збігається з
//!    `preopen_root` (той самий мотив, що `fs_read_preopen_root.rs`:
//!    consumer-дерево й пакет-джерело — різні корені), а
//!    `template-content`, який дістає гість, — унікальний маркер
//!    [`TEMPLATE_MARKER`], прочитаний host-стороною з ЦЬОГО чужого кореня.
//!
//! # Комбінований world гостя — тимчасовий, лише для цього тесту
//!
//! Той самий прийом і синтаксис, що `caps_file_reader_gate.rs::GATE_WIT` —
//! `include plugin;` + `include n-rules:caps/registry-reader@1.0.0 with {
//! ... }`, дописаний до КОПІЇ реального `wit/`-дерева всередині tempdir.
//! `registry-reader.wit` не оголошує власного `domain-error` (доккомент
//! файлу: `option`, не `result` — немає проміжного стану «виконання»), АЛЕ
//! ОБИДВА world-и (`plugin` і `registry-reader`) роблять `use
//! n-rules:slots/ci-artifact@1.0.0.{descriptor as ci-artifact-descriptor}`
//! — той самий локальний псевдонім двічі, тож `with { ci-artifact-descriptor
//! as … }` потрібен (той самий мотив і синтаксис, що перейменування
//! `domain-error` у `file-reader`/`llm-consumer`-гейтах; звірено
//! `wasm-tools component wit` емпірично цим-таки тестом).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

use rules_contract::detect::DetectBatch;
use rules_contract::slots::ci_artifact::{
    CiArtifactDescriptor, CiArtifactFormat, CiArtifactMergeStrategy, CiArtifactMode,
};
use rules_core::ci_artifact_registry::CiArtifactCandidate;
use rules_plugin_host::{PluginHost, PluginHostError, StaticRegistryProvider, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const CRATE_NAME: &str = "registry-reader-gate-fixture";
const PLUGIN_ID: &str = "registry-reader-gate/probe";
const CONCERN_ID: &str = "registry-reader-gate/probe";
const REGISTRY_READER_WORLD: &str = "n-rules:caps/registry-reader@1.0.0";
/// `path`, з яким гість кличе `active-domains` — маркер, звірений на
/// host-боці неявно (провайдер відповідає на БУДЬ-ЯКий `path`, доккомент
/// `StaticRegistryProvider`), і ЯВНО у [`ACTIVE_DOMAIN`] нижче.
const PROBE_PATH: &str = "services/demo";
const ACTIVE_DOMAIN: &str = "azure-pipelines/service_deploy_pipeline";
/// `target-capability`, з яким гість кличе `resolve-ci-artifacts`.
const TARGET_CAPABILITY: &str = "ci:github";
/// `artifact-id` неколізійного candidate-а, що МАЄ доїхати до гостя.
const CLEAN_ARTIFACT_ID: &str = "lint-demo";
/// `artifact-id` двох колізійних candidate-ів — НЕ має доїхати.
const COLLIDING_ARTIFACT_ID: &str = "collided-demo";
/// Унікальний вміст canonical-шаблону чужого пакета — доводить «прочитав
/// дослівно те», не лише «прочитав щось» (той самий мотив, що
/// `PROBE_CONTENT` у `caps_file_reader_gate.rs`).
const TEMPLATE_MARKER: &str = "MARKER-REGISTRY-READER-GATE-TEMPLATE";

const GATE_WIT: &str = r#"
world registry-reader-gate {
  include plugin;
  include n-rules:caps/registry-reader@1.0.0 with { ci-artifact-descriptor as registry-reader-ci-artifact-descriptor }
}
"#;

const GUEST_CARGO_TOML: &str = r#"[package]
name = "__CRATE_NAME__"
version = "0.1.0"
edition = "2021"
publish = false
license = "Apache-2.0"

[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.60"
"#;

/// Мінімальний гість: заявляє `worlds: ["n-rules:caps/registry-reader@1.0.0"]`
/// і на `detect` кличе ОБИДВА host-імпорти цього world-а, кодуючи обидва
/// результати в ОДНУ діагностику.
const GUEST_LIB_RS: &str = r#"
wit_bindgen::generate!({
    path: "__WIT_PATH__",
    world: "registry-reader-gate",
    generate_all,
});

const CONCERN_KEY: &str = "__CONCERN_ID__";
const PROBE_PATH: &str = "__PROBE_PATH__";
const TARGET_CAPABILITY: &str = "__TARGET_CAPABILITY__";

fn build_manifest() -> Manifest {
    Manifest {
        id: "__PLUGIN_ID__".to_string(),
        version: "0.1.0".to_string(),
        world_version: "5.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![ConcernContribution {
            key: CONCERN_KEY.to_string(),
            scope: ConcernScope::PerFile,
            glob: vec![],
            fix_glob: vec![],
        }],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
        fix_only_concerns: vec![],
        worlds: vec!["n-rules:caps/registry-reader@1.0.0".to_string()],
    }
}

struct GuestPlugin;

impl Guest for GuestPlugin {
    fn describe() -> Manifest {
        build_manifest()
    }

    fn detect(_batch: DetectBatch) -> Vec<Diagnostic> {
        let domains_msg = match active_domains(PROBE_PATH) {
            Some(domains) => format!("domains-some:{}", domains.join(",")),
            None => "domains-none".to_string(),
        };
        let artifacts_msg = match resolve_ci_artifacts(TARGET_CAPABILITY) {
            Some(artifacts) => {
                let ids: Vec<String> = artifacts
                    .iter()
                    .map(|a| format!("{}={}", a.descriptor.artifact_id, a.template_content))
                    .collect();
                format!("artifacts-some:{}", ids.join("|"))
            }
            None => "artifacts-none".to_string(),
        };
        vec![Diagnostic {
            reason: "registry-reader-gate-probe".to_string(),
            message: format!("{domains_msg} {artifacts_msg}"),
            file: None,
            severity: Severity::Warn,
            data: None,
        }]
    }

    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(GuestPlugin);
"#;

const BUILD_SH: &str = r#"#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="wasm32-wasip3"

# shellcheck disable=SC1091
source "__FETCH_WASI_SDK__"

export CARGO_TARGET_WASM32_WASIP3_LINKER="$WASI_SDK_COMPONENT_LD"
export RUSTFLAGS="-L native=$WASI_SDK_P3_LIBDIR -C link-arg=$WASI_SDK_REACTOR_CRT"

echo "== cargo build -Z build-std=std,panic_abort --target $TARGET --release (__CRATE_NAME__) =="
cargo build -Z build-std=std,panic_abort --target "$TARGET" --release

WASM_PATH="$SCRIPT_DIR/target/$TARGET/release/__WASM_STEM__.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "не вдалось знайти зібраний компонент: $WASM_PATH" >&2
  exit 1
fi

echo "OK: $WASM_PATH"
"#;

fn real_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/wit")
        .canonicalize()
        .expect("crates/rules-contract/wit має існувати в цьому репозиторії")
}

fn fetch_wasi_sdk_sh() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../wasm-sdk/fetch-wasi-sdk.sh")
        .canonicalize()
        .expect("crates/wasm-sdk/fetch-wasi-sdk.sh має існувати в цьому репозиторії")
}

fn repo_rust_toolchain_toml() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../rust-toolchain.toml")
        .canonicalize()
        .expect("rust-toolchain.toml кореня репозиторію має існувати")
}

fn copy_dir_recursive(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).expect("mkdir призначення копіювання");
    for entry in fs::read_dir(src).expect("read_dir джерела копіювання") {
        let entry = entry.expect("запис read_dir");
        let file_type = entry.file_type().expect("file_type запису");
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path);
        } else {
            fs::copy(entry.path(), &dst_path).expect("копіювання файлу wit-дерева");
        }
    }
}

fn render(template: &str) -> String {
    template
        .replace("__CRATE_NAME__", CRATE_NAME)
        .replace("__WASM_STEM__", &CRATE_NAME.replace('-', "_"))
        .replace("__PLUGIN_ID__", PLUGIN_ID)
        .replace("__CONCERN_ID__", CONCERN_ID)
        .replace("__PROBE_PATH__", PROBE_PATH)
        .replace("__TARGET_CAPABILITY__", TARGET_CAPABILITY)
        .replace("__WIT_PATH__", "wit")
        .replace("__FETCH_WASI_SDK__", &fetch_wasi_sdk_sh().to_string_lossy())
}

fn fixture_wasm() -> &'static Path {
    static WASM: OnceLock<PathBuf> = OnceLock::new();
    WASM.get_or_init(|| {
        let dir = tempfile::tempdir().expect("tempdir має створитись");
        let root = dir.keep();

        fs::write(root.join("Cargo.toml"), render(GUEST_CARGO_TOML))
            .expect("запис Cargo.toml не мав провалитись");
        fs::create_dir_all(root.join("src")).expect("mkdir src не мав провалитись");
        fs::write(root.join("src/lib.rs"), render(GUEST_LIB_RS))
            .expect("запис src/lib.rs не мав провалитись");
        fs::write(root.join("build.sh"), render(BUILD_SH))
            .expect("запис build.sh не мав провалитись");
        fs::copy(repo_rust_toolchain_toml(), root.join("rust-toolchain.toml"))
            .expect("копіювання rust-toolchain.toml не мала провалитись");

        let wit_root = root.join("wit");
        copy_dir_recursive(&real_wit_dir(), &wit_root);
        fs::write(wit_root.join("gate.wit"), GATE_WIT).expect("запис gate.wit");

        let output = Command::new("bash")
            .arg("build.sh")
            .current_dir(&root)
            .env_remove("CARGO_TARGET_DIR")
            .output()
            .expect("запуск `bash build.sh` не мав провалитись (bash відсутній?)");
        assert!(
            output.status.success(),
            "гість-фікстура registry-reader-gate не зібралась:\n--- stdout ---\n{}\n--- stderr ---\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );

        let wasm_path = root
            .join("target/wasm32-wasip3/release")
            .join(format!("{}.wasm", CRATE_NAME.replace('-', "_")));
        assert!(
            wasm_path.is_file(),
            "build.sh відзвітував успіхом, але {} відсутній",
            wasm_path.display()
        );
        wasm_path
    })
    .as_path()
}

/// `active-domains`/`resolve-ci-artifacts` не читають диск консюмер-дерева —
/// порожній tempdir достатній як `preopen_root`.
fn consumer_tree() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir має створитись")
}

/// Дескриптор одного candidate-а (шаблон тесту — `merge_strategy`/`format`/
/// `mode`/`fix` не звіряються гостем, лише `artifact_id`/`template_content`).
fn descriptor(artifact_id: &str) -> CiArtifactDescriptor {
    CiArtifactDescriptor {
        target_capability: TARGET_CAPABILITY.to_string(),
        artifact_id: artifact_id.to_string(),
        target_path: ".github/workflows/demo.yml".to_string(),
        format: CiArtifactFormat::Yaml,
        mode: CiArtifactMode::RequiredFile,
        template: "./template.yml".to_string(),
        merge_strategy: CiArtifactMergeStrategy::DeepSubset,
        fix: true,
    }
}

/// Пакет-джерело ЧУЖОГО плагіна: НЕ той самий корінь, що consumer-дерево
/// (доккомент модуля, пункт 3) — містить лише `template.yml` з
/// [`TEMPLATE_MARKER`].
fn foreign_package_root() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    fs::write(dir.path().join("template.yml"), TEMPLATE_MARKER).expect("запис шаблону");
    dir
}

fn batch() -> DetectBatch {
    DetectBatch {
        concern_id: CONCERN_ID.to_string(),
        files: vec![],
    }
}

/// **Позитивна половина критерію готовності** — доккомент модуля, три
/// властивості одразу: `some(...)` з реальними доменами, host-side колізія
/// вирізає обидва конфліктні candidate-и ДО гостя, і чистий candidate
/// доїжджає з template-content, прочитаним ІЗ ЧУЖОГО кореня.
#[test]
fn declares_world_resolves_registry_through_host_import() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();
    let foreign_root = foreign_package_root();

    let candidates = vec![
        CiArtifactCandidate {
            descriptor: descriptor(CLEAN_ARTIFACT_ID),
            package_root: foreign_root.path().to_path_buf(),
            provenance: "plugin-clean#lint-demo".to_string(),
        },
        CiArtifactCandidate {
            descriptor: descriptor(COLLIDING_ARTIFACT_ID),
            package_root: foreign_root.path().to_path_buf(),
            provenance: "plugin-a#collided-demo".to_string(),
        },
        CiArtifactCandidate {
            descriptor: descriptor(COLLIDING_ARTIFACT_ID),
            package_root: foreign_root.path().to_path_buf(),
            provenance: "plugin-b#collided-demo".to_string(),
        },
    ];
    let provider =
        StaticRegistryProvider::new(Some(vec![ACTIVE_DOMAIN.to_string()]), Some(candidates));

    let mut plugin =
        PluginHost::new_with_registry_provider(ToolResolver::empty(), Arc::new(provider))
            .expect("PluginHost::new_with_registry_provider не мав провалитись")
            .load_in_root_for_worlds(
                wasm,
                PLUGIN_WORLD_VERSION,
                tree.path(),
                &[REGISTRY_READER_WORLD.to_string()],
            )
            .expect(
                "гість, що оголосив n-rules:caps/registry-reader@1.0.0, має інстанціюватись і \
             дістати відповідь",
            );

    let diagnostics = plugin.detect(&batch()).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1, "гість віддає рівно одну діагностику");
    let message = &diagnostics[0].message;

    assert!(
        message.contains(&format!("domains-some:{ACTIVE_DOMAIN}")),
        "active-domains мав повернути реальний домен: {message}"
    );

    let expected_clean = format!("{CLEAN_ARTIFACT_ID}={TEMPLATE_MARKER}");
    assert!(
        message.contains(&expected_clean),
        "чистий candidate мав доїхати з дослівним template-content: {message}"
    );
    assert!(
        !message.contains(COLLIDING_ARTIFACT_ID),
        "колізійний artifact-id НЕ мав доїхати до гостя: {message}"
    );
}

/// `none`/`some([])` — розрізнювані стани (доккомент модуля, пункт 1):
/// провайдер без реєстру дає `domains-none`/`artifacts-none`, провайдер із
/// ПОРОЖНІМ (але наявним) реєстром — `domains-some:`/`artifacts-some:`
/// (порожній хвіст після кожного `:`), а не той самий текст.
#[test]
fn active_domains_none_and_empty_are_distinct() {
    let wasm = fixture_wasm();

    let none_tree = consumer_tree();
    let none_provider = StaticRegistryProvider::new(None, None);
    let mut none_plugin =
        PluginHost::new_with_registry_provider(ToolResolver::empty(), Arc::new(none_provider))
            .expect("PluginHost::new_with_registry_provider не мав провалитись")
            .load_in_root_for_worlds(
                wasm,
                PLUGIN_WORLD_VERSION,
                none_tree.path(),
                &[REGISTRY_READER_WORLD.to_string()],
            )
            .expect("гість без реєстру все одно має інстанціюватись");
    let none_diagnostics = none_plugin
        .detect(&batch())
        .expect("detect не мав провалитись");
    let none_message = &none_diagnostics[0].message;
    assert!(
        none_message.contains("domains-none"),
        "None-провайдер мав дати `none`, не порожній список: {none_message}"
    );
    assert!(
        none_message.contains("artifacts-none"),
        "None-провайдер мав дати `none` і для ci-artifacts: {none_message}"
    );

    let empty_tree = consumer_tree();
    let empty_provider = StaticRegistryProvider::new(Some(vec![]), Some(vec![]));
    let mut empty_plugin =
        PluginHost::new_with_registry_provider(ToolResolver::empty(), Arc::new(empty_provider))
            .expect("PluginHost::new_with_registry_provider не мав провалитись")
            .load_in_root_for_worlds(
                wasm,
                PLUGIN_WORLD_VERSION,
                empty_tree.path(),
                &[REGISTRY_READER_WORLD.to_string()],
            )
            .expect("гість із порожнім реєстром все одно має інстанціюватись");
    let empty_diagnostics = empty_plugin
        .detect(&batch())
        .expect("detect не мав провалитись");
    let empty_message = &empty_diagnostics[0].message;
    assert!(
        empty_message.contains("domains-some:"),
        "Some(vec![])-провайдер мав дати `some`, не `none`: {empty_message}"
    );
    assert!(
        empty_message.contains("artifacts-some:"),
        "Some(vec![])-провайдер мав дати `some` і для ci-artifacts: {empty_message}"
    );
}

/// **Негативна половина критерію готовності** — ТОЙ САМИЙ `.wasm` (реально
/// імпортує `active-domains`/`resolve-ci-artifacts`), завантажений БЕЗ
/// `n-rules:caps/registry-reader@1.0.0` у `declared_worlds` — `Linker` не
/// має цих імпортів, інстанціація гучно провалюється.
#[test]
fn undeclared_world_fails_instantiation_loudly() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();

    let host = PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись");
    let Err(err) = host.load_in_root(wasm, PLUGIN_WORLD_VERSION, tree.path()) else {
        panic!(
            "гість, що реально імпортує active-domains/resolve-ci-artifacts, НЕ мав \
             інстанціюватись без оголошення n-rules:caps/registry-reader@1.0.0 у declared_worlds"
        );
    };
    assert!(
        matches!(err, PluginHostError::Instantiate(_)),
        "очікувався PluginHostError::Instantiate (брак host-імпорту в лінкері), отримано: {err}"
    );
}
