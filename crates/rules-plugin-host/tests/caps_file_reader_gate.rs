//! **Гейт кроку 4.1** спеки `docs/specs/2026-08-31-plugin-contract-v5.md`
//! §12.1: доводить ОБИДВІ половини критерію готовності дослівно —
//!
//! > гість, зібраний із оголошеним `n-rules:caps/file-reader@1.0.0`,
//! > інстанціюється й реально читає файл через host-імпорт, а гість без
//! > оголошення цього імпорту не має.
//!
//! # Як довести «має»/«не має» ОДНИМ гостем
//!
//! Один і той самий скомпільований `.wasm`-компонент, чий тип РЕАЛЬНО
//! імпортує `list-files`/`read-file-bytes` (гість зібраний проти
//! комбінованого world, доккомент [`GATE_WIT`]), завантажується двічі:
//!
//! - [`declares_world_reads_file_through_host_import`] —
//!   [`PluginHost::load_in_root_for_worlds`] з `n-rules:caps/file-reader@1.0.0`
//!   у `declared_worlds`: `crate::world_linker` розширює `Linker`
//!   `add_to_linker_imports` цього world-а (реєстр `KNOWN_CAPABILITY_WORLDS`,
//!   `src/world_linker.rs`), інстанціація проходить, і `detect()` повертає
//!   ДІЙСНИЙ вміст `probe.txt`, прочитаний через `read-file-bytes` —
//!   позитивна половина.
//! - [`undeclared_world_fails_instantiation_loudly`] — ТОЙ САМИЙ `.wasm`,
//!   [`PluginHost::load_in_root`] (без `declared_worlds`): `Linker` не має
//!   `list-files`/`read-file-bytes`, компонент, що реально їх імпортує, НЕ
//!   інстанціюється — `PluginHostError::Instantiate` («гість без оголошення
//!   цього імпорту не має», доккомент модуля [`crate::world_linker`]: «зайві
//!   імпорти лінкера не шкодять» — тут навпаки, БРАК потрібного гучно
//!   валить, не мовчки деградує).
//!
//! # Чому один гість, а не два
//!
//! Гість, зібраний БЕЗ file-reader (звичайний `world: "plugin"`, як
//! `crates/test-plugin-guest`), інстанціюється завжди — незалежно від
//! `declared_worlds` — бо структурно НЕ має цих імпортів; це вже перевірено
//! кожним іншим тестом цього крейта й нічого нового не доводить. Друга
//! половина критерію («не має») стає цікавою лише тоді, коли гість МАВ БИ
//! мати доступ (реально імпортує ці функції), а хост його не дав — рівно
//! той сценарій, що [`undeclared_world_fails_instantiation_loudly`] і
//! відтворює.
//!
//! # Комбінований world гостя — тимчасовий, лише для цього тесту
//!
//! Гість цього файлу зібраний проти WIT-world, якого НЕМАЄ в
//! `crates/rules-contract/wit/` — `include plugin;` + `include
//! n-rules:caps/file-reader@1.0.0;` (перейменування `domain-error`,
//! доккомент [`GATE_WIT`]) в ОКРЕМОМУ файлі, дописаному до КОПІЇ реального
//! `wit/`-дерева всередині tempdir (`copy_real_wit_tree`) — той самий
//! мотив, що вже застосовує `fs_read_preopen_root.rs` (не займає
//! /`crates/rules-contract/wit/world.wit`, поза дозволеною зоною цього
//! кроку). WIT `include` перевірено `wasm-tools component wit` окремо
//! (доккомент [`GATE_WIT`]) ДО написання цього файлу — тут лише
//! відтворення вже підтвердженого синтаксису.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use rules_contract::detect::DetectBatch;
use rules_plugin_host::{PluginHost, PluginHostError, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const CRATE_NAME: &str = "file-reader-gate-fixture";
const PLUGIN_ID: &str = "file-reader-gate/probe";
const CONCERN_ID: &str = "file-reader-gate/probe";
const FILE_READER_WORLD: &str = "n-rules:caps/file-reader@1.0.0";
/// Файл усередині кореня-консюмера, який гість читає через
/// `read-file-bytes` і перелічує через `list-files`.
const PROBE_FILE: &str = "probe.txt";
/// Вміст [`PROBE_FILE`] — унікальний рядок, щоб `detect()` доводив «гість
/// прочитав файл», а не «виклик не впав» (той самий мотив маркерів, що
/// `fs_read_preopen_root.rs`).
const PROBE_CONTENT: &str = "MARKER-FILE-READER-GATE";

/// Комбінований world гостя цього файлу — доккомент модуля, розділ
/// «Комбінований world». `include plugin;` тягне ВСІ імпорти/експорти
/// ядрового world (щоб `describe`/`detect`/`fix`/… лишались валідними
/// експортами для `PluginHost`, а `log`/`run-tool`/… — доступними
/// імпортами), `include n-rules:caps/file-reader@1.0.0` — два host-імпорти
/// під тест. Обидва world-и оголошують ВЛАСНИЙ `variant domain-error` у
/// своєму тілі (не в спільному інтерфейсі — доккомент
/// `crates/rules-contract/wit/deps/caps/file-reader.wit`), тож при
/// об'єднанні `wasm-tools`/`wit-bindgen` бачать два одноіменних локальних
/// типи — потрібне явне перейменування ОДНОГО з них (`with { domain-error
/// as file-reader-domain-error }`), інакше парсер відхиляє директорію
/// («import of `domain-error` shadows previously imported items»; звірено
/// `wasm-tools component wit` ДО написання цього тесту).
const GATE_WIT: &str = r#"
world file-reader-gate {
  include plugin;
  include n-rules:caps/file-reader@1.0.0 with { domain-error as file-reader-domain-error }
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

/// Мінімальний гість: заявляє `worlds: ["n-rules:caps/file-reader@1.0.0"]`
/// і на `detect` кличе ОБИДВА host-імпорти цього world-а — `list-files`
/// (перелік) і `read-file-bytes` (вміст) — і повертає ОДНУ діагностику з
/// результатом обох, щоб непорожній/очікуваний `message` доводив реальне
/// читання, а не лише «виклик не впав» (той самий мотив, що
/// `fs_read_preopen_root.rs::GUEST_LIB_RS`).
const GUEST_LIB_RS: &str = r#"
wit_bindgen::generate!({
    path: "__WIT_PATH__",
    world: "file-reader-gate",
    generate_all,
});

const CONCERN_KEY: &str = "__CONCERN_ID__";
const PROBE_FILE: &str = "__PROBE_FILE__";

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
        worlds: vec!["n-rules:caps/file-reader@1.0.0".to_string()],
    }
}

struct GuestPlugin;

impl Guest for GuestPlugin {
    fn describe() -> Manifest {
        build_manifest()
    }

    fn detect(_batch: DetectBatch) -> Vec<Diagnostic> {
        let listed = list_files(&[PROBE_FILE.to_string()]);
        let message = match read_file_bytes(PROBE_FILE) {
            Ok(bytes) => format!(
                "read-ok:{} listed={}",
                String::from_utf8_lossy(&bytes),
                listed.join(",")
            ),
            Err(FileReaderDomainError::Failed(msg)) => format!("read-err:{msg}"),
            Err(FileReaderDomainError::NotSupported) => "read-err:not-supported".to_string(),
        };
        vec![Diagnostic {
            reason: "file-reader-gate-probe".to_string(),
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
/// самий мотив, що `fs_read_preopen_root.rs::real_wit_dir`.
fn real_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/wit")
        .canonicalize()
        .expect("crates/rules-contract/wit має існувати в цьому репозиторії")
}

/// Абсолютний шлях до спільного добувача WASI SDK
/// (`crates/wasm-sdk/fetch-wasi-sdk.sh`, доккомент
/// `crates/test-plugin-guest/build.sh`) — тим самим прийомом, що
/// [`real_wit_dir`].
fn fetch_wasi_sdk_sh() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../wasm-sdk/fetch-wasi-sdk.sh")
        .canonicalize()
        .expect("crates/wasm-sdk/fetch-wasi-sdk.sh має існувати в цьому репозиторії")
}

/// Абсолютний шлях до кореневого `rust-toolchain.toml` цього репозиторію
/// (пін nightly під `-Z build-std`, доккомент файла) — копіюється в
/// tempdir-скаффолд НИЖЧЕ (`fixture_wasm`), бо `rustup` шукає його по
/// предках cwd, а tempdir лежить ПОЗА деревом репозиторію (`/tmp`, не
/// підкаталог) і жодного предка з цим файлом не має.
fn repo_rust_toolchain_toml() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../rust-toolchain.toml")
        .canonicalize()
        .expect("rust-toolchain.toml кореня репозиторію має існувати")
}

/// Рекурсивно копіює `src` (тека) у `dst` (створюється за потреби) —
/// без нової залежності: увесь `crates/rules-contract/wit/` — це
/// world.wit + `deps/<pkg>/*.wit`, кілька файлів, ручна рекурсія
/// достатня й не вимагає `walkdir`.
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
        .replace("__PROBE_FILE__", PROBE_FILE)
        .replace("__WIT_PATH__", &render_wit_path())
        .replace("__FETCH_WASI_SDK__", &fetch_wasi_sdk_sh().to_string_lossy())
}

/// `wit/` живе всередині ТОГО САМОГО tempdir, що й гість (`fixture_wasm`
/// пише його ПОРУЧ із `Cargo.toml`, тобто `<root>/wit`) — `wit_bindgen::generate!`
/// резолвить `path` відносно кореня крейта (де лежить `Cargo.toml`), НЕ
/// відносно `src/lib.rs`, тож правильний відносний шлях звідси — `"wit"`,
/// не `"../wit"`.
fn render_wit_path() -> String {
    "wit".to_string()
}

/// Скаффолдить і збирає гостя РАЗ на весь тестовий бінар (обидва тести
/// цього файлу ділять той самий `.wasm`) — той самий прийом, що
/// `fs_read_preopen_root.rs::fixture_wasm`: `TempDir::keep` (артефакт
/// мусить пережити обидва тести), панікує з повним виводом `cargo build`
/// (жодного мовчазного skip).
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

        // Копія реального `wit/` + ОДИН новий файл (`gate.wit`, доккомент
        // GATE_WIT) — комбінований world живе лише тут, поза
        // `crates/rules-contract/wit/` (доккомент модуля).
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
            "гість-фікстура file-reader-gate не зібралась:\n--- stdout ---\n{}\n--- stderr ---\n{}",
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

/// Дерево-«консюмер»: РІВНО [`PROBE_FILE`] з унікальним вмістом
/// [`PROBE_CONTENT`] — окремий tempdir на кожен тест (незалежний від
/// `fixture_wasm`, який ділиться між тестами; корінь читання — ні).
fn consumer_tree() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    fs::write(dir.path().join(PROBE_FILE), PROBE_CONTENT).expect("запис probe-файлу");
    dir
}

fn host() -> PluginHost {
    PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись")
}

fn batch() -> DetectBatch {
    DetectBatch {
        concern_id: CONCERN_ID.to_string(),
        files: vec![],
    }
}

/// **Позитивна половина критерію готовності** (доккомент модуля): гість,
/// оголошений через `declared_worlds`, інстанціюється й `detect()`
/// повертає РЕАЛЬНИЙ вміст [`PROBE_FILE`], прочитаний host-імпортом
/// `read-file-bytes` (плюс перелік від `list-files`) — не заглушку й не
/// порожній результат.
#[test]
fn declares_world_reads_file_through_host_import() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();

    let mut plugin = host()
        .load_in_root_for_worlds(
            wasm,
            PLUGIN_WORLD_VERSION,
            tree.path(),
            &[FILE_READER_WORLD.to_string()],
        )
        .expect(
            "гість, що оголосив n-rules:caps/file-reader@1.0.0, має інстанціюватись і читати файл",
        );

    let diagnostics = plugin.detect(&batch()).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1, "гість віддає рівно одну діагностику");
    let message = &diagnostics[0].message;
    assert!(
        message.contains(&format!("read-ok:{PROBE_CONTENT}")),
        "read-file-bytes мав повернути справжній вміст probe-файлу: {message}"
    );
    assert!(
        message.contains(&format!("listed={PROBE_FILE}")),
        "list-files мав перелічити probe-файл: {message}"
    );
}

/// **Негативна половина критерію готовності** (доккомент модуля): ТОЙ
/// САМИЙ `.wasm` (реально імпортує `list-files`/`read-file-bytes`),
/// завантажений БЕЗ `n-rules:caps/file-reader@1.0.0` у `declared_worlds`
/// (`PluginHost::load_in_root`, не `_for_worlds`) — `Linker` не має цих
/// імпортів, інстанціація гучно провалюється
/// (`PluginHostError::Instantiate`), а не мовчки деградує до «гість без
/// доступу до файлів».
#[test]
fn undeclared_world_fails_instantiation_loudly() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();

    let Err(err) = host().load_in_root(wasm, PLUGIN_WORLD_VERSION, tree.path()) else {
        panic!(
            "гість, що реально імпортує list-files/read-file-bytes, НЕ мав інстанціюватись без \
             оголошення n-rules:caps/file-reader@1.0.0 у declared_worlds"
        );
    };
    assert!(
        matches!(err, PluginHostError::Instantiate(_)),
        "очікувався PluginHostError::Instantiate (брак host-імпорту в лінкері), отримано: {err}"
    );
}
