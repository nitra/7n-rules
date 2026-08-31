//! **Гейт §2.95: `capabilities.fs-read`-preopens резолвляться від КОРЕНЯ
//! ДЕРЕВА, ЩО ЛІНТУЄТЬСЯ, а не від cwd хост-процесу.**
//!
//! # Що ловить цей файл
//!
//! До правки `PluginHost::build_host_state` резолвила кожен
//! `capabilities.fs_read`-шлях від `std::env::current_dir()` ХОСТ-ПРОЦЕСУ,
//! тоді як корінь дерева приходить окремим параметром (`cwd` у
//! `run_wasm_concern`/`run_wasm_concern_fix`, `crates/rules-napi`). Для
//! `lint --path <інше-дерево>` два корені розходяться — і гість читав би
//! чуже дерево МОВЧКИ: імена файлів там ті самі, помилки немає, просто
//! вміст не той. Споживачів `fs_read` наразі немає (усі маніфести лишають
//! його порожнім), тож дефект був латентним: без гейта правка так само
//! тихо протухла б до появи першого споживача.
//!
//! Тому обидва тести цього файлу ганяють ГОСТЯ, який `fs-read` реально
//! заявляє й реально читає диск — єдину форму доказу, у якій «гість бачить
//! саме `cwd`-параметр» є перевірюваним твердженням, а не коментарем.
//!
//! # Чому власне джерело гостя, а не шаблон скіла
//!
//! `wasm_plugin_skill_smoke.rs`/`guest_additive_compat.rs` скаффолдять
//! ШАБЛОН скіла — там предмет тесту саме шаблон. Тут предмет — хост, а
//! потрібен гість із НЕПОРОЖНІМ `fs_read` і читанням файлу; шаблон такого
//! не має й не повинен мати (типовий концерн лишає `fs_read` порожнім).
//! Тож джерело гостя — власне, мінімальне, а спільним лишається те, що
//! справді спільне: `build.sh` скіла (`include_str!` — перейменування
//! валить компіляцію тесту, не мовчазний дрейф) і поточний `wit/`.
//!
//! # Ціна
//!
//! Один `cargo build --target wasm32-wasip2 --release` мінімального крейта
//! на весь файл (усі тести ділять один зібраний компонент через
//! `OnceLock`) — той самий порядок ціни, що вже платять два сусідні
//! скаффолд-тести, і єдиний спосіб мати наскрізний доказ preopen-контуру.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use rules_contract::detect::DetectBatch;
use rules_plugin_host::{PluginHost, PluginHostError, ToolResolver};

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const CRATE_NAME: &str = "fs-read-preopen-root-fixture";
const PLUGIN_ID: &str = "fs-read-gate/preopen-root";
const CONCERN_ID: &str = "fs-read-gate/reads-preopen";
/// Repo-relative тека, яку гість заявляє у `capabilities.fs-read` — і вона
/// ж guest-шлях preopen-у (хост монтує `<корінь>/<rel>` під іменем `<rel>`).
const PREOPEN_DIR: &str = "fs-read-probe";
/// Файл усередині preopen-у, який гість читає й повертає в `message`.
const PROBE_FILE: &str = "fs-read-probe/probe.txt";

const BUILD_SH: &str = include_str!("../../../npm/skills/wasm-plugin/template/build.sh");

/// Мінімальний гість: заявляє `fs-read` і на `detect` віддає ОДНУ
/// діагностику з фактичним вмістом прочитаного файлу (або текстом помилки
/// читання). Саме `message` і робить твердження перевірюваним: вміст
/// унікальний для конкретного дерева, тож «прочитав не те дерево» не може
/// пройти за «прочитав».
const GUEST_LIB_RS: &str = r#"
wit_bindgen::generate!({
    path: "__WIT_PATH__",
    world: "plugin",
    generate_all,
});

const CONCERN_KEY: &str = "__CONCERN_ID__";

fn build_manifest() -> Manifest {
    Manifest {
        id: "__PLUGIN_ID__".to_string(),
        version: "0.1.0".to_string(),
        world_version: "5.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![ConcernContribution {
            key: CONCERN_KEY.to_string(),
            scope: ConcernScope::Full,
            glob: vec![],
            fix_glob: vec![],
        }],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            fs_read: vec!["__PREOPEN_DIR__".to_string()],
            network: false,
        },
        tools: vec![],
        fix_only_concerns: vec![],
        // Фікстура свідомо не оголошує жодного світу повноважень: порожній
        // список і є перевіркою, що ЯДРОВИЙ шлях лишається робочим без них.
        // (`KNOWN_CAPABILITY_WORLDS` уже НЕ порожній — там `file-reader`,
        // `llm-consumer` і `coverage-provider`, — тож саме порожнеча тут
        // несе сенс, а не збіг зі станом реєстру.)
        worlds: vec![],
    }
}

struct GuestPlugin;

impl Guest for GuestPlugin {
    fn describe() -> Manifest {
        build_manifest()
    }

    fn detect(_batch: DetectBatch) -> Vec<Diagnostic> {
        let message = match std::fs::read_to_string("__PROBE_FILE__") {
            Ok(content) => format!("read-ok: {}", content.trim()),
            Err(err) => format!("read-err: {err}"),
        };
        vec![Diagnostic {
            reason: "fs-read-probe".to_string(),
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

/// Абсолютний шлях до `crates/rules-contract/wit` цього репозиторію —
/// скаффолд живе в tempdir поза деревом, тож відносний шлях сенсу не має
/// (той самий мотив, що в `wasm_plugin_skill_smoke.rs`).
fn real_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rules-contract/wit")
        .canonicalize()
        .expect("crates/rules-contract/wit має існувати в цьому репозиторії")
}

fn render(template: &str) -> String {
    template
        .replace("__CRATE_NAME__", CRATE_NAME)
        .replace("__PLUGIN_ID__", PLUGIN_ID)
        .replace("__CONCERN_ID__", CONCERN_ID)
        .replace("__PREOPEN_DIR__", PREOPEN_DIR)
        .replace("__PROBE_FILE__", PROBE_FILE)
        .replace("__WIT_PATH__", &real_wit_dir().to_string_lossy())
}

/// Скаффолдить і збирає гостя РАЗ на весь тестовий бінар (усі тести
/// беруть той самий `.wasm`). `tempfile::TempDir` тут свідомо «протікає»
/// (`TempDir::keep`): артефакт мусить пережити всі тести файлу, а прибирання
/// tempdir-ів — справа ОС; альтернатива (збірка на кожен тест) коштувала б
/// удвічі більше без жодної нової гарантії.
///
/// Панікує з повним виводом `cargo build` — жодного мовчазного skip (та
/// сама `require_fixture`-філософія сусідніх тестів крейта).
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
        fs::write(root.join("build.sh"), BUILD_SH).expect("запис build.sh не мав провалитись");

        let output = Command::new("bash")
            .arg("build.sh")
            .current_dir(&root)
            // Той самий мотив, що в `wasm_plugin_skill_smoke.rs`: успадкований
            // `CARGO_TARGET_DIR` поклав би артефакт у спільний target
            // розробника, а перевірка нижче шукала б його в tempdir.
            .env_remove("CARGO_TARGET_DIR")
            .output()
            .expect("запуск `bash build.sh` не мав провалитись (bash відсутній?)");
        assert!(
            output.status.success(),
            "гість-фікстура fs-read не зібралась:\n--- stdout ---\n{}\n--- stderr ---\n{}",
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
        wasm_path
    })
    .as_path()
}

/// Дерево-«консюмер» із унікальним вмістом probe-файлу — саме за цим
/// рядком тест і відрізняє «гість прочитав ЦЕ дерево» від «гість прочитав
/// щось».
fn consumer_tree(marker: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    fs::create_dir_all(dir.path().join(PREOPEN_DIR)).expect("mkdir preopen-теки");
    fs::write(dir.path().join(PROBE_FILE), marker).expect("запис probe-файлу");
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

/// **Головний гейт.** Корінь дерева (`load_in_root`) НЕ збігається з cwd
/// тестового процесу (він — `crates/rules-plugin-host`, і теки
/// `fs-read-probe/` там немає й бути не має), і гість читає рівно те, що
/// лежить у переданому корені.
///
/// До правки цей самий виклик не дійшов би навіть до `detect`: хост
/// намагався б відкрити `<cwd процесу>/fs-read-probe` і впав би
/// `PluginHostError::Preopen`. Тобто тест червоний на старому коді й
/// зелений на новому — і лишається єдиним місцем, де твердження «preopen
/// іде від cwd-ПАРАМЕТРА» перевіряється, а не декларується.
#[test]
fn preopen_resolves_against_call_root_not_process_cwd() {
    let wasm = fixture_wasm();
    let process_cwd = std::env::current_dir().expect("cwd процесу");
    let tree = consumer_tree("MARKER-FROM-CALL-ROOT");
    assert_ne!(
        tree.path(),
        process_cwd.as_path(),
        "фікстура має лежати ПОЗА cwd процесу — інакше тест не розрізняє два корені"
    );
    assert!(
        !process_cwd.join(PREOPEN_DIR).exists(),
        "у cwd тестового процесу не має бути теки `{PREOPEN_DIR}` — інакше старий (хибний) \
         резолв теж «спрацював би», і гейт нічого не ловив би"
    );

    let mut plugin = host()
        .load_in_root(wasm, PLUGIN_WORLD_VERSION, tree.path())
        .expect("load_in_root не мав провалитись: preopen-тека є в переданому корені");
    assert_eq!(
        plugin.preopen_root(),
        Some(tree.path()),
        "інстанс має памʼятати корінь, на який відкриті його preopens"
    );

    let diagnostics = plugin.detect(&batch()).expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1, "гість віддає рівно одну діагностику");
    assert_eq!(
        diagnostics[0].message, "read-ok: MARKER-FROM-CALL-ROOT",
        "гість мав прочитати probe-файл САМЕ з переданого кореня: {diagnostics:?}"
    );
}

/// Два різні дерева — два різні вмісти: доказ, що корінь не «прилипає» до
/// процесу чи до `PluginHost`, а справді береться з параметра кожного
/// завантаження (регрес на будь-яке майбутнє кешування кореня «перший
/// виграв»).
#[test]
fn two_roots_give_two_different_reads() {
    let wasm = fixture_wasm();
    let first = consumer_tree("TREE-ONE");
    let second = consumer_tree("TREE-TWO");
    let host = host();

    let mut plugin_one = host
        .load_in_root(wasm, PLUGIN_WORLD_VERSION, first.path())
        .expect("перше дерево");
    let mut plugin_two = host
        .load_in_root(wasm, PLUGIN_WORLD_VERSION, second.path())
        .expect("друге дерево");

    assert_eq!(
        plugin_one.detect(&batch()).expect("detect #1")[0].message,
        "read-ok: TREE-ONE"
    );
    assert_eq!(
        plugin_two.detect(&batch()).expect("detect #2")[0].message,
        "read-ok: TREE-TWO"
    );
}

/// Відносний корінь — типізована відмова, не «дорезолвимо від cwd
/// процесу»: саме такий мовчазний дорезолв і був вадою.
#[test]
fn relative_root_is_refused_loudly() {
    let wasm = fixture_wasm();
    let Err(err) = host().load_in_root(wasm, PLUGIN_WORLD_VERSION, Path::new("some/relative"))
    else {
        panic!("відносний корінь не має прийматись");
    };
    assert!(
        matches!(err, PluginHostError::RelativePreopenRoot { .. }),
        "очікувався RelativePreopenRoot, отримано: {err}"
    );
}

/// Завантаження БЕЗ кореня (`load`) плагіна, що заявляє `fs-read`:
/// `describe()` працює (ensure-tool контур і мапа концернів кореня не
/// потребують), а перший же `detect` падає типізовано — замість тихого
/// «гість нічого не знайшов», нерозрізненного з «у дереві чисто».
#[test]
fn rootless_load_refuses_guest_calls_instead_of_reading_nothing() {
    let wasm = fixture_wasm();
    let mut plugin = host()
        .load(wasm, PLUGIN_WORLD_VERSION)
        .expect("describe-шлях лишається робочим і без кореня");
    assert_eq!(plugin.describe().capabilities.fs_read, vec![PREOPEN_DIR]);
    assert_eq!(plugin.preopen_root(), None);

    let Err(err) = plugin.detect(&batch()) else {
        panic!("detect без кореня має падати, а не читати порожню пісочницю");
    };
    assert!(
        matches!(err, PluginHostError::FsReadRootUnbound { .. }),
        "очікувався FsReadRootUnbound, отримано: {err}"
    );
    let message = err.to_string();
    assert!(
        message.contains(PLUGIN_ID) && message.contains(PREOPEN_DIR),
        "повідомлення має називати плагін і заявлені шляхи: {message}"
    );
}
