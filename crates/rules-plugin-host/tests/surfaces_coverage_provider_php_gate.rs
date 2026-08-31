//! **Php-варіант** гейта кроку 6 (доккомент
//! `surfaces_coverage_provider_gate.rs`, оригінальна rust-версія, несе
//! повний доккомент прийому) — той самий механізм, ідентичний тест на
//! ІНШОМУ комбінованому world-і (php-coverage-provider-guest.wit,
//! guest-фікстура тут НЕ споживає реальний `crates/plugin-lang-php`,
//! лише доводить сам контракт «declared_worlds → доступ до
//! collect-coverage» на мінімальній фікстурі, ЯК і rust-версія цього
//! гейта).
//!
//! **Гейт кроку 6** спеки `docs/specs/2026-08-31-plugin-contract-v5.md`
//! §12, «coverage-provider як перша слотова поверхня»: доводить ОБИДВІ
//! половини критерію готовності — «гість, що оголосив world, дає покриття;
//! гість без оголошення — гучна відмова» (преамбула задачі, дзеркало
//! критерію кроку 4.1, `tests/caps_file_reader_gate.rs`).
//!
//! # Дзеркало `caps_file_reader_gate.rs`, з ОДНІЄЮ структурною різницею
//!
//! `file-reader` (крок 4.1) — світ повноважень: гість ІМПОРТУЄ, хост
//! РЕАЛІЗУЄ; «не має» там означало «інстанціація впала» (`Linker` без
//! потрібного імпорту). `coverage-provider` — слотовий world (спека §7):
//! гість ЕКСПОРТУЄ `collect-coverage`, хост його КЛИЧЕ. Той самий
//! скомпільований `.wasm`, що РЕАЛЬНО експортує цю функцію, інстанціюється
//! ОДНАКОВО успішно з `declared_worlds` і без нього (експорт нікуди не
//! дівається — доккомент `crate::surfaces_coverage_provider`: акцесор лише
//! ШУКАЄ потрібний export у вже готовому `Instance`, нічого не лінкує).
//! «Не має» тут — не провал інстанціації, а свідома відмова
//! [`LoadedPlugin::collect_coverage`] СКОРИСТАТИСЯ реально наявним
//! експортом, коли плагін не заявив world у `declared_worlds`
//! (`PluginHostError::SurfaceNotDeclared`) — рівно та половина механізму,
//! заради якої повноваження/поверхні стали world-ами: декларація, а не сам
//! факт наявності коду, вирішує доступ.
//!
//! # Комбінований world — ПОСТІЙНИЙ, не тимчасовий
//!
//! На відміну від `GATE_WIT` у `caps_file_reader_gate.rs` (тимчасовий
//! world, дописаний у копію дерева лише для того тесту), тут гість
//! збирається проти `crates/rules-contract/wit/php-coverage-provider-guest.wit`
//! — ПОСТІЙНОГО файлу цього кроку, того самого, що споживає РЕАЛЬНИЙ
//! `crates/plugin-lang-php`. Копіювання дерева в tempdir тому не потрібне
//! — `wit_bindgen::generate!` цього тестового гостя вказує напряму на
//! `crates/rules-contract/wit` (абсолютний шлях, доккомент [`GUEST_LIB_RS`]).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use rules_contract::coverage::CoverageRequest;
use rules_plugin_host::{PluginHost, PluginHostError, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const CRATE_NAME: &str = "coverage-provider-gate-fixture-php";
const PLUGIN_ID: &str = "coverage-provider-gate-php/probe";
const CONCERN_ID: &str = "coverage-provider-gate-php/probe";
const COVERAGE_PROVIDER_WORLD: &str = "n-rules:surfaces/coverage-provider@1.0.0";
/// `area` каноничного успішного звіту — унікальний маркер, щоб позитивний
/// тест доводив «дані реально пройшли через wasm-межу туди-назад», а не
/// лише «виклик не впав» (той самий мотив, що `PROBE_CONTENT` у
/// `caps_file_reader_gate.rs`).
const REPORT_AREA_MARKER: &str = "GATE-MARKER-Php";
/// `mutation-refresh-files`-тригер, за яким guest навмисно повертає
/// `domain-error::failed` — доводить, що ТИПІЗОВАНИЙ канал помилки
/// [`rules_contract::domain::DomainError`] теж реально доїжджає крізь ABI,
/// не лише щасливий шлях.
const TRIGGER_FAILED: &str = "trigger-failed";

/// Guest-крейт цього гейта: заявляє `worlds: ["n-rules:surfaces/coverage-provider@1.0.0"]`
/// і на `collect-coverage` повертає канонічний звіт із [`REPORT_AREA_MARKER`]
/// у назві виміру (echo `request.cwd`, щоб довести і round-trip входу) —
/// АБО типізовану помилку за [`TRIGGER_FAILED`] у `mutation-refresh-files`.
const GUEST_LIB_RS: &str = r#"
wit_bindgen::generate!({
    path: "__WIT_PATH__",
    world: "php-coverage-provider-guest",
    generate_all,
});

const CONCERN_KEY: &str = "__CONCERN_ID__";
const REPORT_AREA_MARKER: &str = "__REPORT_AREA_MARKER__";
const TRIGGER_FAILED: &str = "__TRIGGER_FAILED__";

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
        worlds: vec!["n-rules:surfaces/coverage-provider@1.0.0".to_string()],
    }
}

struct GuestPlugin;

impl Guest for GuestPlugin {
    fn describe() -> Manifest {
        build_manifest()
    }

    fn detect(_batch: DetectBatch) -> Vec<Diagnostic> {
        vec![]
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

    fn collect_coverage(
        request: CoverageRequest,
    ) -> Result<CoverageReport, CoverageDomainError> {
        if request
            .mutation_refresh_files
            .iter()
            .any(|f| f == TRIGGER_FAILED)
        {
            return Err(CoverageDomainError::Failed(
                "guest: withheld coverage on purpose (gate probe)".to_string(),
            ));
        }
        Ok(CoverageReport {
            areas: vec![CoverageArea {
                area: format!("{REPORT_AREA_MARKER}:{}", request.cwd),
                lines: CoverageCounts {
                    covered: 7,
                    total: 10,
                },
                functions: CoverageCounts {
                    covered: 2,
                    total: 3,
                },
                mutation: MutationCounts {
                    caught: 4,
                    total: 5,
                },
                survived_files: vec!["src/lib.rs".to_string()],
            }],
        })
    }
}

export!(GuestPlugin);
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
/// самий мотив, що `caps_file_reader_gate.rs::real_wit_dir`. Вставляється
/// В GUEST_LIB_RS АБСОЛЮТНИМ рядком (не копіюється в tempdir — доккомент
/// модуля, розділ «Комбінований world — ПОСТІЙНИЙ»): `php-coverage-provider-guest`
/// уже живе тут постійно, копіювання додало б лише зайвий крок.
fn real_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/wit")
        .canonicalize()
        .expect("crates/rules-contract/wit має існувати в цьому репозиторії")
}

/// Абсолютний шлях до спільного добувача WASI SDK — той самий мотив, що
/// `caps_file_reader_gate.rs::fetch_wasi_sdk_sh`.
fn fetch_wasi_sdk_sh() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../wasm-sdk/fetch-wasi-sdk.sh")
        .canonicalize()
        .expect("crates/wasm-sdk/fetch-wasi-sdk.sh має існувати в цьому репозиторії")
}

/// Абсолютний шлях до кореневого `rust-toolchain.toml` — той самий мотив,
/// що `caps_file_reader_gate.rs::repo_rust_toolchain_toml`.
fn repo_rust_toolchain_toml() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../rust-toolchain.toml")
        .canonicalize()
        .expect("rust-toolchain.toml кореня репозиторію має існувати")
}

fn render(template: &str) -> String {
    template
        .replace("__CRATE_NAME__", CRATE_NAME)
        .replace("__WASM_STEM__", &CRATE_NAME.replace('-', "_"))
        .replace("__PLUGIN_ID__", PLUGIN_ID)
        .replace("__CONCERN_ID__", CONCERN_ID)
        .replace("__REPORT_AREA_MARKER__", REPORT_AREA_MARKER)
        .replace("__TRIGGER_FAILED__", TRIGGER_FAILED)
        .replace(
            "__WIT_PATH__",
            &real_wit_dir().to_string_lossy().replace('\\', "\\\\"),
        )
        .replace("__FETCH_WASI_SDK__", &fetch_wasi_sdk_sh().to_string_lossy())
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

        let output = Command::new("bash")
            .arg("build.sh")
            .current_dir(&root)
            .env_remove("CARGO_TARGET_DIR")
            .output()
            .expect("запуск `bash build.sh` не мав провалитись (bash відсутній?)");
        assert!(
            output.status.success(),
            "гість-фікстура coverage-provider-gate не зібралась:\n--- stdout ---\n{}\n--- stderr ---\n{}",
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

fn host() -> PluginHost {
    PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись")
}

/// **Позитивна половина критерію готовності**: гість, оголошений через
/// `declared_worlds`, дає РЕАЛЬНИЙ звіт покриття — `area` несе
/// [`REPORT_AREA_MARKER`] і echo `cwd` запиту, підтверджуючи, що дані
/// пройшли туди-назад крізь wasm-межу, а не отримані заглушкою.
#[test]
fn declares_world_collects_coverage_through_guest_export() {
    let wasm = fixture_wasm();

    let mut plugin = host()
        .load_for_worlds(
            wasm,
            PLUGIN_WORLD_VERSION,
            &[COVERAGE_PROVIDER_WORLD.to_string()],
        )
        .expect("гість, що оголосив coverage-provider, має інстанціюватись");

    let request = CoverageRequest {
        cwd: "consumer-repo-root".to_string(),
        mutation_refresh_files: vec![],
    };
    let report = plugin
        .collect_coverage(&request)
        .expect("collect-coverage мав повернути звіт, не помилку");

    assert_eq!(report.areas.len(), 1, "гість віддає рівно один вимір");
    let area = &report.areas[0];
    assert_eq!(
        area.area,
        format!("{REPORT_AREA_MARKER}:consumer-repo-root"),
        "area має нести маркер і echo cwd — доказ реального round-trip"
    );
    assert_eq!(area.lines.covered, 7);
    assert_eq!(area.mutation.total, 5);
    assert_eq!(area.survived_files, vec!["src/lib.rs".to_string()]);
}

/// Той самий гість, той самий позитивний шлях — але з `TRIGGER_FAILED` у
/// `mutation-refresh-files`: доводить, що ТИПІЗОВАНИЙ канал помилки
/// (`domain-error::failed`) теж реально доїжджає крізь ABI, не лише
/// щасливий шлях (доккомент [`TRIGGER_FAILED`]).
#[test]
fn declares_world_typed_error_from_guest_reaches_host() {
    let wasm = fixture_wasm();

    let mut plugin = host()
        .load_for_worlds(
            wasm,
            PLUGIN_WORLD_VERSION,
            &[COVERAGE_PROVIDER_WORLD.to_string()],
        )
        .expect("гість, що оголосив coverage-provider, має інстанціюватись");

    let request = CoverageRequest {
        cwd: "consumer-repo-root".to_string(),
        mutation_refresh_files: vec![TRIGGER_FAILED.to_string()],
    };
    let err = plugin
        .collect_coverage(&request)
        .expect_err("guest навмисно повертає domain-error::failed за TRIGGER_FAILED");
    assert!(
        matches!(err, PluginHostError::Execution { function: "collect-coverage", .. }),
        "очікувався PluginHostError::Execution(collect-coverage), отримано: {err}"
    );
    assert!(
        err.to_string().contains("withheld coverage on purpose"),
        "повідомлення помилки має нести текст guest-а: {err}"
    );
}

/// **Негативна половина критерію готовності**: ТОЙ САМИЙ `.wasm` (реально
/// ЕКСПОРТУЄ `collect-coverage` — позитивний тест це вже довів),
/// завантажений БЕЗ `n-rules:surfaces/coverage-provider@1.0.0` у
/// `declared_worlds` (`PluginHost::load`, не `_for_worlds`). Інстанціація
/// проходить (експорт нікуди не дівається — доккомент модуля), але
/// [`LoadedPlugin::collect_coverage`] відмовляє ГУЧНО, типізовано
/// (`PluginHostError::SurfaceNotDeclared`) — не мовчки повертає порожній
/// звіт (правило проєкту, доккомент [`crate`]).
#[test]
fn undeclared_world_refuses_to_call_export_loudly() {
    let wasm = fixture_wasm();

    let mut plugin = host()
        .load(wasm, PLUGIN_WORLD_VERSION)
        .expect("гість інстанціюється й без declared_worlds — експорт нікуди не дівається");

    let request = CoverageRequest {
        cwd: "consumer-repo-root".to_string(),
        mutation_refresh_files: vec![],
    };
    let err = plugin
        .collect_coverage(&request)
        .expect_err("плагін, що НЕ заявив coverage-provider у declared_worlds, не має віддати звіт");
    match err {
        PluginHostError::SurfaceNotDeclared {
            plugin_id,
            world,
            function,
        } => {
            assert_eq!(plugin_id, PLUGIN_ID);
            assert_eq!(world, COVERAGE_PROVIDER_WORLD);
            assert_eq!(function, "collect-coverage");
        }
        other => panic!("очікував SurfaceNotDeclared, отримав {other:?}"),
    }
}
