//! **Гейт фази 3** (крок 7 порядку реалізації спеки
//! `docs/specs/2026-08-31-plugin-contract-v5.md` §12), ДРУГИЙ портований
//! LLM-споживач `docgen` (перший — `docgen/judge`, `plugin_docgen_judge_gate.rs`):
//! доводить, що `docgen_render` (ЯДРОВИЙ export world-а `plugin`, до цього
//! кроку — суцільна `NotSupported`-заглушка на всіх шести гостях) реально
//! генерує документ через `oneShotDoc`-зріз `docgen-gen`
//! (`crates/plugin-docgen/src/generate.rs`, доккомент `src/lib.rs::generate_fallback_doc`):
//! (а) побудував `prompt` з `source-content` запиту, (б) передав його крізь
//! `llm-call`, (в) постобробив сиру відповідь ([`crate::finish_one_shot_doc`]
//! — тут недоступний напряму, перевіряється побічно через форму `content`),
//! (г) вкарбував `source-crc` запиту у frontmatter і повернув його ж як
//! `content-crc`.
//!
//! Негативна половина критерію готовності (гість без оголошеного
//! `n-rules:caps/llm-consumer@1.0.0` не інстанціюється) уже доведена
//! `plugin_docgen_judge_gate.rs::undeclared_world_fails_instantiation_loudly`
//! на ТОМУ САМОМУ `.wasm` — дублювати тут нема сенсу (той самий компонент,
//! той самий лінкер-гейт, незалежний від того, який export викликається
//! ПІСЛЯ інстанціації).
//!
//! Той самий `FakeLlmCaller`-мотив, що `plugin_docgen_judge_gate.rs`:
//! [`PluginHost::new_with_llm_caller`] підмінює мережевий виклик
//! детермінованим офлайновим двійником — жодного реального виклику моделі.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

use rules_contract::domain::DocgenRequest;
use rules_contract::manifest::Domain;
use rules_plugin_host::{
    LlmCallFuture, LlmCaller, LlmDomainError, PluginHost, ToolResolver,
};

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const LLM_CONSUMER_WORLD: &str = "n-rules:caps/llm-consumer@1.0.0";

/// Сирий текст, який [`FakeLlmCaller`] повертає на КОЖЕН `llm-call` —
/// навмисно БЕЗ провідного `#` (доводить, що постобробка додає H1 з
/// `source-path`), із код-фенс-обгорткою (доводить, що `strip_section`
/// реально знімає фенс, а не пропускає сирий текст як є).
const FAKE_DOC_TEXT: &str = "```md\nФайл читає конфіг і повертає нормалізований обʼєкт.\n```";

fn plugin_docgen_crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../plugin-docgen")
        .canonicalize()
        .expect("crates/plugin-docgen має існувати в цьому репозиторії")
}

/// Той самий `build.sh`-прийом, що `plugin_docgen_judge_gate.rs::fixture_wasm`
/// — окремий `OnceLock`, бо тести цього файлу компілюються в ОКРЕМИЙ
/// бінар (`cargo test` — один бінар на файл `tests/*.rs`), спільний кеш
/// між файлами тут неможливий і не потрібен (`build.sh` сам ідемпотентний
/// щодо незміненого дерева).
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

fn consumer_tree() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir має створитись")
}

/// Офлайновий двійник [`LlmCaller`]: звіряє, що `prompt` реально несе
/// `source-content` запиту (доводить, що `docgen_render` реально передав
/// `request.source_content` крізь `one_shot_messages`→`llm-call`, не
/// заглушку), повертає [`FAKE_DOC_TEXT`] незалежно від решти тексту.
struct FakeLlmCaller;

impl LlmCaller for FakeLlmCaller {
    fn call(&self, prompt: String) -> LlmCallFuture<'static, Result<String, LlmDomainError>> {
        Box::pin(async move {
            assert!(
                prompt.contains("fn load_config() -> Config"),
                "prompt мав нести source-content запиту, отримано: {prompt}"
            );
            Ok(FAKE_DOC_TEXT.to_string())
        })
    }
}

fn host_with_fake_llm() -> PluginHost {
    PluginHost::new_with_llm_caller(ToolResolver::empty(), Arc::new(FakeLlmCaller))
        .expect("PluginHost::new_with_llm_caller не мав провалитись")
}

fn generate_request() -> DocgenRequest {
    DocgenRequest {
        source_path: "src/config.rs".to_string(),
        source_content: "fn load_config() -> Config { Config::default() }".to_string(),
        source_crc: "deadbeef".to_string(),
    }
}

/// **Позитивна половина критерію готовності**: `docgen_render` реально
/// пройшов `one_shot_messages`→`llm-call`→`finish_one_shot_doc`→`stamp_doc`,
/// повернувши документ із доданим H1, знятим код-фенсом, вкарбованим
/// `source-crc` у frontmatter, і `content-crc`, що дорівнює `source-crc`
/// запиту (доккомент `docgen_render` у `lib.rs`: `content-crc` — той самий
/// `crc`, не окремий хеш).
#[test]
fn docgen_render_generates_doc_through_host_import() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();

    let mut plugin = host_with_fake_llm()
        .load_in_root_for_worlds(
            wasm,
            PLUGIN_WORLD_VERSION,
            tree.path(),
            &[LLM_CONSUMER_WORLD.to_string()],
        )
        .expect("гість docgen має інстанціюватись і дістати доку через docgen_render");

    let output = plugin
        .docgen_render(&generate_request())
        .expect("docgen_render не мав провалитись");

    // `stamp_doc` знімає провідний H1 (той, що `finish_one_shot_doc` додав із
    // `basename(source-path)`) і замінює його frontmatter-блоком —
    // доккомент `crc.rs::stamp_doc`, звідси `content` починається з `---`,
    // не з `#`.
    assert!(
        output.content.starts_with("---\n"),
        "content мав починатись зі стампованого frontmatter, отримано: {}",
        output.content
    );
    assert!(
        output.content.contains("resource: src/config.rs"),
        "frontmatter мав нести resource=source-path запиту, отримано: {}",
        output.content
    );
    assert!(
        output
            .content
            .contains("Файл читає конфіг і повертає нормалізований обʼєкт."),
        "content мав нести знятий з код-фенсу текст FakeLlmCaller, отримано: {}",
        output.content
    );
    assert!(
        !output.content.contains("```"),
        "код-фенс мав бути знятий strip_section, отримано: {}",
        output.content
    );
    assert!(
        output.content.contains("crc: deadbeef"),
        "frontmatter мав нести source-crc запиту, отримано: {}",
        output.content
    );
    assert_eq!(
        output.content_crc, "deadbeef",
        "content-crc мав дорівнювати source-crc запиту (echo, не новий хеш)"
    );
}

/// `manifest.domains` тепер несе `docgen-render` (доккомент `lib.rs::build_manifest`,
/// «Фаза 3» — на відміну від решти пʼяти гостей, які лишають цей домен
/// `NotSupported`-заглушкою) — anti-drift на випадок, якщо маніфест
/// розійдеться з реальною поведінкою `docgen_render`.
#[test]
fn manifest_declares_docgen_render_domain() {
    let wasm = fixture_wasm();
    let tree = consumer_tree();
    let plugin = host_with_fake_llm()
        .load_in_root_for_worlds(
            wasm,
            PLUGIN_WORLD_VERSION,
            tree.path(),
            &[LLM_CONSUMER_WORLD.to_string()],
        )
        .expect("гість має інстанціюватись");
    assert!(
        plugin.describe().domains.contains(&Domain::DocgenRender),
        "manifest.domains мав нести DocgenRender, отримано: {:?}",
        plugin.describe().domains
    );
}
