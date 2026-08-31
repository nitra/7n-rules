//! **Гейт кроку 4.1** спеки `docs/specs/2026-08-31-plugin-contract-v5.md`
//! §12.1, застосований ДРУГИЙ раз — доводить ОБИДВІ половини критерію
//! готовності дослівно, тепер для `n-rules:caps/llm-consumer@1.0.0`:
//!
//! > гість, зібраний із оголошеним `n-rules:caps/llm-consumer@1.0.0`,
//! > інстанціюється й реально дістає відповідь через host-імпорт
//! > `llm-call`, а гість без оголошення цього імпорту не має.
//!
//! # Як довести «має»/«не має» ОДНИМ гостем
//!
//! Той самий прийом, що `caps_file_reader_gate.rs` (доккомент модуля там
//! пояснює «чому один гість, а не два»): один скомпільований
//! `.wasm`-компонент, чий тип РЕАЛЬНО імпортує `llm-call` (гість зібраний
//! проти комбінованого world, доккомент [`GATE_WIT`]), завантажується
//! двічі:
//!
//! - [`declares_world_gets_response_through_host_import`] —
//!   [`PluginHost::load_in_root_for_worlds`] з `n-rules:caps/llm-consumer@1.0.0`
//!   у `declared_worlds` — інстанціація проходить, і `detect()` повертає
//!   РЕАЛЬНУ відповідь, що пройшла крізь host-імпорт `llm-call` — позитивна
//!   половина.
//! - [`undeclared_world_fails_instantiation_loudly`] — ТОЙ САМИЙ `.wasm`,
//!   [`PluginHost::load_in_root`] (без `declared_worlds`) — `Linker` не має
//!   `llm-call`, інстанціація гучно провалюється, не деградує мовчки.
//!
//! # Чому тут НЕМАЄ реального мережевого виклику моделі
//!
//! Завдання цього кроку прямо забороняє реальний виклик моделі в тестах —
//! «мокай на рівні хоста». [`PluginHost::new_with_llm_caller`] — точка
//! ін'єкції, задокументована саме для цього
//! (`crate::caps_llm_consumer::LlmCaller`, «навіщо `pub`»): [`FakeLlmCaller`]
//! нижче підмінює `caps_llm_consumer::RealLlmCaller` детермінованим,
//! офлайновим двійником — гейт доводить РЕАЛЬНЕ WASM-лінкування й потік
//! даних гість⇄хост, не поведінку конкретного провайдера/моделі (та сама
//! вже проведена мережею тестів `LocalCloud`/`resolve_model` усередині
//! `n7n-llm-lib`, яку цей крейт коректно перевикористовує, а не
//! передублює).
//!
//! # Комбінований world гостя — тимчасовий, лише для цього тесту
//!
//! `include plugin;` + `include n-rules:caps/llm-consumer@1.0.0 with
//! { domain-error as llm-consumer-domain-error }` в ОКРЕМОМУ файлі,
//! дописаному до КОПІЇ реального `wit/`-дерева всередині tempdir — той
//! самий мотив і синтаксис, що `caps_file_reader_gate.rs::GATE_WIT`
//! (перейменування конфліктного локального `domain-error` вже перевірено
//! `wasm-tools component wit` там, до написання ЦЬОГО файлу).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

use rules_contract::detect::DetectBatch;
use rules_plugin_host::{
    LlmCallFuture, LlmCaller, LlmDomainError, PluginHost, PluginHostError, ToolResolver,
};

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const CRATE_NAME: &str = "llm-consumer-gate-fixture";
const PLUGIN_ID: &str = "llm-consumer-gate/probe";
const CONCERN_ID: &str = "llm-consumer-gate/probe";
const LLM_CONSUMER_WORLD: &str = "n-rules:caps/llm-consumer@1.0.0";
/// Промпт, який гість шле через `llm-call` — маркер, звірений у
/// [`FakeLlmCaller::call`], щоб `detect()` доводив «хост реально передав
/// prompt», а не лише «виклик не впав» (той самий мотив маркерів, що
/// `PROBE_CONTENT` у `caps_file_reader_gate.rs`).
const PROBE_PROMPT: &str = "MARKER-LLM-CONSUMER-GATE-PROMPT";
/// Відповідь, яку [`FakeLlmCaller`] повертає на [`PROBE_PROMPT`] — доводить
/// зворотний напрям (хост → гість) тим самим маркерним прийомом.
const FAKE_RESPONSE: &str = "MARKER-LLM-CONSUMER-GATE-RESPONSE";

/// Комбінований world гостя цього файлу — доккомент модуля, розділ
/// «Комбінований world». Перейменування `domain-error` — той самий мотив,
/// що `caps_file_reader_gate.rs::GATE_WIT`: обидва world-и (`plugin` і
/// `llm-consumer`) оголошують власний локальний `variant domain-error` у
/// своєму тілі, тож об'єднання вимагає явного `with`.
const GATE_WIT: &str = r#"
world llm-consumer-gate {
  include plugin;
  include n-rules:caps/llm-consumer@1.0.0 with { domain-error as llm-consumer-domain-error }
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

/// Мінімальний гість: заявляє `worlds: ["n-rules:caps/llm-consumer@1.0.0"]`
/// і на `detect` кличе `llm-call` з [`PROBE_PROMPT`], повертаючи ОДНУ
/// діагностику з результатом — той самий мотив, що
/// `caps_file_reader_gate.rs::GUEST_LIB_RS`.
const GUEST_LIB_RS: &str = r#"
wit_bindgen::generate!({
    path: "__WIT_PATH__",
    world: "llm-consumer-gate",
    generate_all,
});

const CONCERN_KEY: &str = "__CONCERN_ID__";
const PROBE_PROMPT: &str = "__PROBE_PROMPT__";

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
        worlds: vec!["n-rules:caps/llm-consumer@1.0.0".to_string()],
    }
}

struct GuestPlugin;

impl Guest for GuestPlugin {
    fn describe() -> Manifest {
        build_manifest()
    }

    fn detect(_batch: DetectBatch) -> Vec<Diagnostic> {
        let message = match llm_call(&LlmRequest {
            prompt: PROBE_PROMPT.to_string(),
        }) {
            Ok(response) => format!("llm-ok:{}", response.text),
            Err(LlmConsumerDomainError::Failed(msg)) => format!("llm-err:{msg}"),
            Err(LlmConsumerDomainError::NotSupported) => "llm-err:not-supported".to_string(),
        };
        vec![Diagnostic {
            reason: "llm-consumer-gate-probe".to_string(),
            message,
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

/// Абсолютний шлях до `crates/rules-contract/wit` цього репозиторію — той
/// самий мотив, що `caps_file_reader_gate.rs::real_wit_dir`.
fn real_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/wit")
        .canonicalize()
        .expect("crates/rules-contract/wit має існувати в цьому репозиторії")
}

/// Абсолютний шлях до спільного добувача WASI SDK — той самим прийомом,
/// що [`real_wit_dir`].
fn fetch_wasi_sdk_sh() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../wasm-sdk/fetch-wasi-sdk.sh")
        .canonicalize()
        .expect("crates/wasm-sdk/fetch-wasi-sdk.sh має існувати в цьому репозиторії")
}

/// Абсолютний шлях до кореневого `rust-toolchain.toml` (пін nightly під
/// `-Z build-std`) — копіюється в tempdir-скаффолд, бо tempdir лежить поза
/// деревом репозиторію.
fn repo_rust_toolchain_toml() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../rust-toolchain.toml")
        .canonicalize()
        .expect("rust-toolchain.toml кореня репозиторію має існувати")
}

/// Рекурсивно копіює `src` (тека) у `dst` — той самий мотив, що
/// `caps_file_reader_gate.rs::copy_dir_recursive`.
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
        .replace("__PROBE_PROMPT__", PROBE_PROMPT)
        .replace("__WIT_PATH__", &render_wit_path())
        .replace("__FETCH_WASI_SDK__", &fetch_wasi_sdk_sh().to_string_lossy())
}

/// `wit/` живе всередині ТОГО САМОГО tempdir, що й гість — той самий мотив,
/// що `caps_file_reader_gate.rs::render_wit_path`.
fn render_wit_path() -> String {
    "wit".to_string()
}

/// Скаффолдить і збирає гостя РАЗ на весь тестовий бінар (обидва тести
/// цього файлу ділять той самий `.wasm`) — той самий прийом, що
/// `caps_file_reader_gate.rs::fixture_wasm`.
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
            "гість-фікстура llm-consumer-gate не зібралась:\n--- stdout ---\n{}\n--- stderr ---\n{}",
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

/// Дерево-«консюмер»: `llm-call` не читає диск, тож ПОРОЖНІЙ tempdir
/// достатній як `preopen_root` (`load_in_root*` вимагає абсолютний корінь
/// незалежно від того, чи конкретний world його реально використовує).
fn consumer_tree() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir має створитись")
}

/// Офлайновий двійник [`LlmCaller`] («мокай на рівні хоста», доккомент
/// модуля): звіряє, що `prompt`, який дістав ХОСТ, — рівно [`PROBE_PROMPT`],
/// що ГІСТЬ надіслав через `llm-call` (доводить напрям гість→хост), і
/// повертає [`FAKE_RESPONSE`] (доводить напрям хост→гість) — без жодного
/// HTTP-виклику чи звернення до `n7n-llm-lib`.
struct FakeLlmCaller;

impl LlmCaller for FakeLlmCaller {
    fn call(&self, prompt: String) -> LlmCallFuture<'static, Result<String, LlmDomainError>> {
        Box::pin(async move {
            assert_eq!(
                prompt, PROBE_PROMPT,
                "хост мав передати РІВНО той prompt, що надіслав гість"
            );
            Ok(FAKE_RESPONSE.to_string())
        })
    }
}

fn host_with_fake_llm() -> PluginHost {
    PluginHost::new_with_llm_caller(ToolResolver::empty(), Arc::new(FakeLlmCaller))
        .expect("PluginHost::new_with_llm_caller не мав провалитись")
}

fn batch() -> DetectBatch {
    DetectBatch {
        concern_id: CONCERN_ID.to_string(),
        files: vec![],
    }
}

/// **Позитивна половина критерію готовності** (доккомент модуля): гість,
/// оголошений через `declared_worlds`, інстанціюється й `detect()`
/// повертає РЕАЛЬНУ відповідь [`FAKE_RESPONSE`], що пройшла крізь
/// host-імпорт `llm-call` (не заглушку й не порожній результат).
#[test]
fn declares_world_gets_response_through_host_import() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();

    let mut plugin = host_with_fake_llm()
        .load_in_root_for_worlds(
            wasm,
            PLUGIN_WORLD_VERSION,
            tree.path(),
            &[LLM_CONSUMER_WORLD.to_string()],
        )
        .expect(
            "гість, що оголосив n-rules:caps/llm-consumer@1.0.0, має інстанціюватись і дістати \
             відповідь",
        );

    let diagnostics = plugin.detect(&batch()).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1, "гість віддає рівно одну діагностику");
    assert_eq!(
        diagnostics[0].message,
        format!("llm-ok:{FAKE_RESPONSE}"),
        "llm-call мав повернути відповідь FakeLlmCaller крізь host-імпорт"
    );
}

/// **Негативна половина критерію готовності** (доккомент модуля): ТОЙ
/// САМИЙ `.wasm` (реально імпортує `llm-call`), завантажений БЕЗ
/// `n-rules:caps/llm-consumer@1.0.0` у `declared_worlds`
/// (`PluginHost::load_in_root`, не `_for_worlds`) — `Linker` не має цього
/// імпорту, інстанціація гучно провалюється
/// (`PluginHostError::Instantiate`), а не мовчки деградує до «гість без
/// доступу до моделі».
#[test]
fn undeclared_world_fails_instantiation_loudly() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();

    let Err(err) = host_with_fake_llm().load_in_root(wasm, PLUGIN_WORLD_VERSION, tree.path())
    else {
        panic!(
            "гість, що реально імпортує llm-call, НЕ мав інстанціюватись без оголошення \
             n-rules:caps/llm-consumer@1.0.0 у declared_worlds"
        );
    };
    assert!(
        matches!(err, PluginHostError::Instantiate(_)),
        "очікувався PluginHostError::Instantiate (брак host-імпорту в лінкері), отримано: {err}"
    );
}
