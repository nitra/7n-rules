//! **Гейт кроку 7** порядку реалізації спеки
//! `docs/specs/2026-08-31-plugin-contract-v5.md` §12 («docgen як гість»),
//! ПЕРША фаза (карта — `docs/specs/2026-08-31-recon-docgen-surface.md`):
//! доводить ОБИДВІ половини критерію готовності §12.1 для РЕАЛЬНОГО
//! першого гостя `docgen`, дзеркало `caps_llm_consumer_gate.rs`:
//!
//! > гість, зібраний із оголошеним `n-rules:caps/llm-consumer@1.0.0`,
//! > інстанціюється й реально дістає відповідь через host-імпорт
//! > `llm-call`, а гість без оголошення цього імпорту не має.
//!
//! # Чому цей файл НЕ скаффолдить гостя в tempdir (на відміну від
//! `caps_llm_consumer_gate.rs`)
//!
//! `caps_llm_consumer_gate.rs` генерує ОДНОРАЗОВОГО тестового гостя в
//! tempdir, бо той гість — чиста тестова фікстура без продуктивної ролі.
//! `crates/plugin-docgen` — НАВПАКИ: постійний first-party крейт, зібраний
//! і версіонований цим репозиторієм (той самий статус, що
//! `crates/plugin-lang-rust`/`crates/plugin-lang-js`), з РЕАЛЬНО портованою
//! логікою (`docgen/judge`, `docs/specs/2026-08-31-recon-docgen-surface.md`
//! §3-4). Тому цей гейт просто збирає крейт НА МІСЦІ (`bash
//! crates/plugin-docgen/build.sh`) — той самий прийом, що
//! `crates/test-plugin-guest/build.sh` для контракт-тест-кіту, а не
//! породжує тимчасову копію.
//!
//! # Чому тут НЕМАЄ реального мережевого виклику моделі
//!
//! Той самий принцип, що `caps_llm_consumer_gate.rs` (доккомент того
//! файлу): [`PluginHost::new_with_llm_caller`] — точка ін'єкції,
//! [`FakeLlmCaller`] нижче підмінює `RealLlmCaller` детермінованим,
//! офлайновим двійником. Гейт доводить РЕАЛЬНЕ WASM-лінкування й потік
//! даних гість⇄хост крізь ПОРТОВАНУ (не тестову-заглушкову) логіку
//! `docgen/judge` — `parse_doc_verdict`/`judge_messages`/`judge_doc`
//! (`crates/plugin-docgen/src/lib.rs`), не поведінку конкретної моделі.
//!
//! [`FakeLlmCaller`] повертає ВАЛІДНИЙ verdict-JSON
//! (`{"verdict":"inaccurate","confidence":0.95,"reason":"..."}"`) — це
//! доводить, що гість реально: (а) побудував `prompt` з JSON-пари
//! (джерело, дока) з батчу, (б) передав його крізь `llm-call`, (в)
//! розпарсив JSON-відповідь ([`parse_doc_verdict`]) і (г) відобразив
//! `judge_fails_doc(true)` у `Diagnostic` з правильним `reason`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_plugin_host::{
    LlmCallFuture, LlmCaller, LlmDomainError, PluginHost, PluginHostError, ToolResolver,
};

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const CONCERN_ID: &str = "docgen/judge";
const LLM_CONSUMER_WORLD: &str = "n-rules:caps/llm-consumer@1.0.0";

/// Валідний verdict-JSON, який [`FakeLlmCaller`] повертає на КОЖЕН
/// `llm-call` — доводить, що гість реально пройшов
/// `judge_messages`→`llm_call`→`parse_doc_verdict`→`judge_fails_doc`, не
/// заглушку.
const FAKE_VERDICT_JSON: &str =
    r#"{"verdict":"inaccurate","confidence":0.95,"reason":"claims a return type the source does not have"}"#;

/// Директорія реального крейта `crates/plugin-docgen` цього репозиторію —
/// той самий мотив, що `real_wit_dir` у `caps_llm_consumer_gate.rs`, але
/// тут вказує на ПОСТІЙНИЙ крейт, не на копію wit-дерева.
fn plugin_docgen_crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../plugin-docgen")
        .canonicalize()
        .expect("crates/plugin-docgen має існувати в цьому репозиторії")
}

/// Збирає `crates/plugin-docgen` через його ВЛАСНИЙ `build.sh` (той самий
/// прийом, що `crates/test-plugin-guest/build.sh`) РАЗ на весь тестовий
/// бінар і повертає шлях до зібраного `.wasm`, розпарсений з останнього
/// рядка `OK: <шлях>` виводу скрипта (`build.sh` друкує його саме в цьому
/// форматі).
fn fixture_wasm() -> &'static Path {
    static WASM: OnceLock<PathBuf> = OnceLock::new();
    WASM.get_or_init(|| {
        let crate_dir = plugin_docgen_crate_dir();
        let output = Command::new("bash")
            .arg("build.sh")
            .current_dir(&crate_dir)
            .output()
            .expect("запуск `bash crates/plugin-docgen/build.sh` не мав провалитись");
        assert!(
            output.status.success(),
            "crates/plugin-docgen не зібрався:\n--- stdout ---\n{}\n--- stderr ---\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        let ok_line = stdout
            .lines()
            .find(|line| line.starts_with("OK: "))
            .expect("build.sh мав надрукувати рядок \"OK: <шлях>\"");
        let wasm_path = PathBuf::from(ok_line.trim_start_matches("OK: "));
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
/// достатній (`load_in_root*` вимагає абсолютний корінь незалежно від
/// того, чи конкретний world його реально використовує) — той самий мотив,
/// що `caps_llm_consumer_gate.rs::consumer_tree`.
fn consumer_tree() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir має створитись")
}

/// Офлайновий двійник [`LlmCaller`] («мокай на рівні хоста», доккомент
/// модуля): повертає [`FAKE_VERDICT_JSON`] незалежно від prompt-у, але
/// звіряє, що переданий prompt реально несе І джерело, І доку з батчу
/// (доводить, що `judge_messages` реально об'єднав обидва тексти в один
/// `prompt`, не лише один із них).
struct FakeLlmCaller;

impl LlmCaller for FakeLlmCaller {
    fn call(&self, prompt: String) -> LlmCallFuture<'static, Result<String, LlmDomainError>> {
        Box::pin(async move {
            assert!(
                prompt.contains("fn suspicious() -> bool"),
                "prompt мав нести вміст джерела з батчу, отримано: {prompt}"
            );
            assert!(
                prompt.contains("Returns nothing and never fails."),
                "prompt мав нести вміст доки з батчу, отримано: {prompt}"
            );
            Ok(FAKE_VERDICT_JSON.to_string())
        })
    }
}

fn host_with_fake_llm() -> PluginHost {
    PluginHost::new_with_llm_caller(ToolResolver::empty(), Arc::new(FakeLlmCaller))
        .expect("PluginHost::new_with_llm_caller не мав провалитись")
}

/// Батч з ОДНИМ файлом — JSON-пара (джерело, дока), демонстраційна форма
/// цього кроку (доккомент `crates/plugin-docgen/src/lib.rs`, «Що НЕ
/// портовано»: `file-reader` тут не задіяний, пара приходить готовою).
/// Джерело каже `bool`, дока БРЕШЕ («Returns nothing») — навмисно
/// неточна пара, щоб [`FakeLlmCaller`] мав підставу повернути
/// `inaccurate`.
fn judge_batch() -> DetectBatch {
    let pair = serde_json::json!({
        "source": "fn suspicious() -> bool { true }",
        "doc": "Returns nothing and never fails.",
    });
    DetectBatch {
        concern_id: CONCERN_ID.to_string(),
        files: vec![SourceFile {
            path: "src/suspicious.rs".to_string(),
            content: pair.to_string(),
        }],
    }
}

/// **Позитивна половина критерію готовності** (доккомент модуля): гість,
/// оголошений через `declared_worlds`, інстанціюється й `detect()` реально
/// пройшов `judge_messages`→`llm-call`→`parse_doc_verdict`→
/// `judge_fails_doc`, повернувши ОДНУ діагностику з verdict-ом
/// [`FakeLlmCaller`].
#[test]
fn declares_world_gets_verdict_through_host_import() {
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
            "гість docgen/judge, що оголосив n-rules:caps/llm-consumer@1.0.0, має \
             інстанціюватись і дістати verdict",
        );

    let diagnostics = plugin
        .detect(&judge_batch())
        .expect("detect не мав провалитись");
    assert_eq!(diagnostics.len(), 1, "гість має видати РІВНО одну діагностику");
    assert_eq!(diagnostics[0].reason, "docgen-judge-verdict");
    assert_eq!(diagnostics[0].file.as_deref(), Some("src/suspicious.rs"));
    assert!(
        diagnostics[0].message.contains("confidence=0.95"),
        "повідомлення мало нести confidence з FAKE_VERDICT_JSON, отримано: {}",
        diagnostics[0].message
    );
    assert!(
        diagnostics[0]
            .message
            .contains("claims a return type the source does not have"),
        "повідомлення мало нести reason з FAKE_VERDICT_JSON, отримано: {}",
        diagnostics[0].message
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
            "гість docgen/judge, що реально імпортує llm-call, НЕ мав інстанціюватись без \
             оголошення n-rules:caps/llm-consumer@1.0.0 у declared_worlds"
        );
    };
    assert!(
        matches!(err, PluginHostError::Instantiate(_)),
        "очікувався PluginHostError::Instantiate (брак host-імпорту в лінкері), отримано: {err}"
    );
}
