//! Host-golden тест `plugin-lang-php` — вузький, на відміну від
//! `plugin_lang_js.rs` (наскрізне покриття AST-концернів того гостя): тут
//! рівно ОДИН сценарій, якого `wasm-plugin-parity-php.test.mjs` СВІДОМО не
//! дістає (доккомент того файлу, розділ про `main-hard-fail.test.mjs`, і
//! `crates/plugin-lang-php/src/lib.rs`, розділ «Канал „mago“ недоступний»):
//! `mago` — ПЕРШИЙ pinned/managed тул серед first-party wasm-гостей
//! (`crates/plugin-lang-php/src/lib.rs`, розділ «`mago` — pinned, не
//! `path:`») — JS-канон резолвить його через `ensureToolAsync`, що на промасі
//! КИДАЄ виняток і валить увесь `lint()`-виклик
//! (`plugins/lang-php/rules/php/mago_fmt/tests/main-hard-fail.test.mjs`,
//! `.../mago_lint/tests/main-hard-fail.test.mjs`, по одному тесту в кожному,
//! видалені разом із рештою JS-канону цієї хвилі). wasm-гість структурно НЕ
//! може відтворити «кинути й провалити прогін» (`exec-tool` контрактно
//! повертає `ToolResult`, не помилку виклику) — замість цього нерезолвлений
//! `mago` дає `status: none`, який `detect_project`/`detect_mago_per_file`
//! (`crates/plugin-lang-php/src/lib.rs`) мапить у ЗВИЧАЙНЕ порушення тим
//! самим `reason`-ом, що non-zero exit код.
//!
//! Той самий мотив і та сама форма, що ПЕРШИЙ pilot `exec-tool` у
//! `plugin-lang-js` (`bun/licensee`,
//! `crates/rules-plugin-host/tests/plugin_lang_js.rs::licensee_maps_unresolved_tool_to_canonical_bun_missing`)
//! — там park теж мав окремий host-golden тест САМЕ на канал «тул
//! незадекларований», бо parity-гейт того плагіна той канал так само
//! свідомо оминає (недетермінований реальний спавн). Генеричний механізм
//! («`status: none`, не паніка») уже перевірений НЕЗАЛЕЖНО від будь-якого
//! конкретного гостя в `contract_test_kit.rs`
//! (`run_tool_missing_from_resolver_returns_typed_error_in_diagnostic`) —
//! цей файл перевіряє САМЕ php-специфічне мапування (`reason`/`label`/
//! `mdc`-текст) на РЕАЛЬНОМУ `plugin_lang_php.wasm`, не на generic-фікстурі.
//!
//! `lang-python`/`lang-rust` (попередні дві хвилі того самого видалення
//! JS-канону, #476/#479) обидва свідомо НЕ додавали `plugin_lang_{python,rust}.rs`
//! — жоден з тих двох гостей не декларує pinned/managed тул (обидва тулюють
//! ЛИШЕ через `path:`-схему, `resolveCmd`-еквівалент, тихий skip на промах,
//! БЕЗ кидання винятку в каноні), тож у них просто немає аналога цього
//! каналу. `php` — ПЕРШИЙ гість цієї серії з таким каналом (доккомент
//! `crates/plugin-lang-php/src/lib.rs`), тому прецедент «ще один host-файл —
//! симетрія заради симетрії» тут не застосовний: питання розв'язане
//! дивлячись, не за аналогією.
//!
//! Декларативні full-scope перевірки (`php/tooling`, чотири декларативні
//! `php/composer_manifest`-гілки) і exec-tool-щасливий/провальний шлях на
//! РЕЗОЛВЛЕНИХ тулах уже покриває `wasm-plugin-parity-php.test.mjs` —
//! дублювати їх тут не варто.

use std::path::PathBuf;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_plugin_host::{PluginHost, ToolResolver};

mod common;

const PLUGIN_WORLD_VERSION: &str = "5.0.0";
const CONCERN_PROJECT: &str = "php/project";
const CONCERN_MAGO_FMT: &str = "php/mago_fmt";
const CONCERN_MAGO_LINT: &str = "php/mago_lint";

/// Абсолютний шлях до зібраного `.wasm`-компонента
/// (`crates/plugin-lang-php/build.sh`) — `wasm32-wasip3`/`release`, той
/// самий шлях, що використовує `wasm-plugin-parity-php.test.mjs`.
fn fixture_wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip3/release/plugin_lang_php.wasm")
}

fn require_fixture() -> PathBuf {
    common::require_fresh_fixture(
        &fixture_wasm_path(),
        "wasm-компонент plugin-lang-php",
        "plugin-lang-php",
        "bash crates/plugin-lang-php/build.sh",
    )
}

/// Порожній резолвер — жоден тул не резолвиться (кожен `exec-tool`-виклик
/// отримає `status: none`). Достатньо для `php/mago_fmt`/`php/mago_lint`:
/// обидва перевіряють ЛИШЕ ПРИСУТНІСТЬ `composer.json` у батчі
/// (`batch_file`, `crates/plugin-lang-php/src/lib.rs::detect_mago_per_file`)
/// — `composer` як тул вони НІКОЛИ не викликають.
fn host() -> PluginHost {
    PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись")
}

/// Пише виконуваний sh-скрипт (фейковий `composer`) і будує хост, що
/// резолвить його під іменем `composer` — `mago` НАВМИСНО відсутній у мапі
/// (доккомент модуля). Той самий мотив, що `licensee_host` у
/// `plugin_lang_js.rs`.
#[cfg(unix)]
fn host_with_composer_only(dir: &std::path::Path, body: &str) -> PluginHost {
    use std::os::unix::fs::PermissionsExt;
    let script = dir.join("composer");
    std::fs::write(&script, body).expect("запис фейкового composer не мав провалитись");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
        .expect("chmod не мав провалитись");
    let mut tools = std::collections::HashMap::new();
    tools.insert("composer".to_string(), script);
    PluginHost::new(ToolResolver::new(tools)).expect("PluginHost::new не мав провалитись")
}

/// `php/mago_fmt` і `php/mago_lint` (спільний нижній рівень
/// `detect_mago_per_file`) на нерезолвленому `mago`: `status: none` МАЄ
/// мапитись у ЗВИЧАЙНЕ порушення з concern-специфічним `reason`, а не
/// провалювати `detect()` панікою/помилкою — заміняє реальну-крашну
/// поведінку JS-канону (`main-hard-fail.test.mjs` обох концернів) єдиним
/// доступним wasm-боку спостереженням.
#[test]
fn mago_unresolved_maps_to_canonical_violation_for_mago_fmt_and_mago_lint() {
    let path = require_fixture();
    let mut plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на plugin-lang-php");

    let batch = DetectBatch {
        concern_id: CONCERN_MAGO_FMT.to_string(),
        files: vec![
            SourceFile {
                path: "composer.json".to_string(),
                content: "{}".to_string(),
            },
            SourceFile {
                path: "src/a.php".to_string(),
                content: "<?php\n".to_string(),
            },
        ],
    };

    let fmt_diagnostics = plugin
        .detect(&batch)
        .expect("php/mago_fmt detect не мав провалитись навіть без резолвленого mago");
    assert_eq!(fmt_diagnostics.len(), 1);
    assert_eq!(fmt_diagnostics[0].reason, "mago-fmt-unformatted");
    assert!(
        fmt_diagnostics[0]
            .message
            .contains("mago format (dry-run) — потрібне форматування"),
        "повідомлення мало відобразити канонічний label: {:?}",
        fmt_diagnostics[0].message
    );
    assert!(fmt_diagnostics[0].message.contains("mago_fmt.mdc"));

    let lint_batch = DetectBatch {
        concern_id: CONCERN_MAGO_LINT.to_string(),
        ..batch
    };
    let lint_diagnostics = plugin
        .detect(&lint_batch)
        .expect("php/mago_lint detect не мав провалитись навіть без резолвленого mago");
    assert_eq!(lint_diagnostics.len(), 1);
    assert_eq!(lint_diagnostics[0].reason, "mago-lint");
    assert!(lint_diagnostics[0]
        .message
        .contains("mago lint — знайдено порушення"));
    assert!(lint_diagnostics[0].message.contains("mago_lint.mdc"));
}

/// `php/project`: `composer audit` резолвлений і чистий (exit 0), АЛЕ
/// `mago` не резолвлений — `detect_project` мусить дійти до кроку `mago
/// analyze` (не короткозамкнутись раніше, доккомент
/// `crates/plugin-lang-php/src/lib.rs::detect_project`, п. «НЕ-уніформний
/// ланцюжок») і зрештою повернути `mago-analyze` замість паніки.
#[cfg(unix)]
#[test]
fn project_composer_audit_ok_mago_unresolved_maps_to_mago_analyze_violation() {
    let dir = tempfile::tempdir().expect("tempdir має створитись");
    let host = host_with_composer_only(dir.path(), "#!/bin/sh\nexit 0\n");
    let path = require_fixture();
    let mut plugin = host
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("load не мав провалитись на plugin-lang-php");

    let batch = DetectBatch {
        concern_id: CONCERN_PROJECT.to_string(),
        files: vec![SourceFile {
            path: "composer.json".to_string(),
            content: "{}".to_string(),
        }],
    };

    let diagnostics = plugin
        .detect(&batch)
        .expect("php/project detect не мав провалитись навіть без резолвленого mago");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].reason, "mago-analyze");
    assert!(
        diagnostics[0]
            .message
            .contains("lint-php: mago analyze — помилка"),
        "повідомлення мало відобразити канонічний mago-analyze текст: {:?}",
        diagnostics[0].message
    );
    assert!(diagnostics[0].message.contains("php.mdc"));
}
