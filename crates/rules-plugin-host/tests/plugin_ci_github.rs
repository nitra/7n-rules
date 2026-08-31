//! Host-golden тест `plugin-ci-github` — вузький, рівно на ОДИН канал, який
//! не дістає жоден інший рівень: «зовнішній тул не запустився» для
//! `actionlint` і `zizmor` (§2.29).
//!
//! # Чому саме тут, а не в юніт-тестах гостя й не в parity-гейті
//!
//! - **Юніт-тести гостя** (`crates/plugin-ci-github/src/lib.rs`) цей шлях
//!   НЕ покривають структурно: `run_actionlint`/`run_zizmor` кличуть
//!   `exec_tool` — host-import `wit_bindgen`, який на host-таргеті ПАНІКУЄ
//!   (non-unwinding abort). Той самий барʼєр задокументований у секції
//!   host-таргет тестів того ж файлу.
//! - **Parity-гейт** (`wasm-plugin-parity-ci-github.test.mjs`) працює саме в
//!   середовищі, де ці тули навмисно вирізані з PATH, і тому фільтрує їхні
//!   reason-и через `EXTERNAL_TOOL_REASONS` — інакше кожен його сценарій
//!   ловив би цей канал замість rego-логіки, яку він перевіряє. Фільтр
//!   свідомий, і саме він робить цей файл потрібним.
//!
//! Той самий мотив і та сама форма, що `plugin_lang_php.rs` (канал «`mago`
//! нерезолвлений») і `plugin_lang_js.rs::licensee_maps_unresolved_tool_to_canonical_bun_missing`
//! (канал «тул незадекларований»): загальний механізм «`status: none`, не
//! паніка» перевірений незалежно в `contract_test_kit.rs`, а тут — САМЕ
//! ci-github-специфічне мапування на РЕАЛЬНОМУ `plugin_ci_github.wasm`.
//!
//! # Що саме фіксується
//!
//! До §2.29 обидві функції мовчали і на `status: none`, і на коді `127`:
//! перевірка не виконувалась, а лінт лишався зеленим. Для `zizmor` це
//! security-скан workflow-ів, тобто мовчазний пропуск давав «зелено, бо
//! нічого не перевірено» — найгірший режим відмови для лінтера.

use std::path::PathBuf;

use rules_contract::detect::{DetectBatch, SourceFile};
use rules_plugin_host::{PluginHost, ToolResolver};

mod common;

/// Очікувана версія world-а береться з КОНТРАКТУ, не дублюється тут.
///
/// До §2.115 кожен golden-тест тримав власну копію рядка й передавав ЇЇ
/// у `load()` як очікуване значення — тобто звіряв гостя із самим собою,
/// а не з вимогою хоста. Такий гейт лишається зеленим і тоді, коли
/// контракт розійшовся з гостем: саме так мажор `5.0.0` проїхав повз
/// 141 зелений тест і зламав продуктовий JS-шлях. Тест має стверджувати
/// ПРИЧИНУ (вимогу контракту), а не наслідок (свою ж константу) —
/// рішення 11 спеки `2026-08-31-slice6-consumer-surfaces.md`.
use rules_contract::version::PLUGIN_WORLD_VERSION;
const CONCERN_WORKFLOWS: &str = "ga/workflows";

/// Абсолютний шлях до зібраного `.wasm`-компонента
/// (`crates/plugin-ci-github/build.sh`) — той самий, що використовує
/// `wasm-plugin-parity-ci-github.test.mjs`.
fn fixture_wasm_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32-wasip3/release/plugin_ci_github.wasm")
}

fn require_fixture() -> PathBuf {
    common::require_fresh_fixture(
        &fixture_wasm_path(),
        "wasm-компонент plugin-ci-github",
        "plugin-ci-github",
        "bash crates/plugin-ci-github/build.sh",
    )
}

/// Порожній резолвер — жоден тул не резолвиться, тож КОЖЕН `exec-tool`
/// отримує `status: none`. Рівно те середовище, у якому раніше було тихо.
fn host() -> PluginHost {
    PluginHost::new(ToolResolver::empty()).expect("PluginHost::new не мав провалитись")
}

fn workflow(path: &str, content: &str) -> SourceFile {
    SourceFile {
        path: path.to_string(),
        content: content.to_string(),
    }
}

/// Нерезолвлені `actionlint`/`zizmor` МУСЯТЬ давати видиму діагностику, а не
/// тишу — і `detect()` при цьому не має провалюватись (гість не має права
/// завалити хост).
#[test]
fn unresolved_actionlint_and_zizmor_produce_visible_diagnostics() {
    let path = require_fixture();
    let mut plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("завантаження plugin_ci_github.wasm не мало провалитись");

    let batch = DetectBatch {
        concern_id: CONCERN_WORKFLOWS.to_string(),
        files: vec![workflow(
            ".github/workflows/lint-ga.yml",
            "name: lint-ga\non:\n  push:\n    branches: [main]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
        )],
    };

    let diagnostics = plugin
        .detect(&batch)
        .expect("ga/workflows detect не мав провалитись без резолвлених тулів");

    let reasons: Vec<&str> = diagnostics.iter().map(|d| d.reason.as_str()).collect();

    assert!(
        reasons.contains(&"actionlint-unavailable"),
        "actionlint не запустився — мала бути видима діагностика, а не тиша. Отримані reason-и: {reasons:?}",
    );
    assert!(
        reasons.contains(&"zizmor-unavailable"),
        "zizmor (SECURITY-скан) не запустився — мала бути видима діагностика, а не тиша. Отримані reason-и: {reasons:?}",
    );
}

/// Повідомлення мають бути дієві: назвати тул і сказати, що перевірку
/// ПРОПУЩЕНО (а не пройдено) — інакше користувач прочитає це як «все гаразд».
#[test]
fn tool_unavailable_messages_say_check_was_skipped_not_passed() {
    let path = require_fixture();
    let mut plugin = host()
        .load(&path, PLUGIN_WORLD_VERSION)
        .expect("завантаження plugin_ci_github.wasm не мало провалитись");

    let batch = DetectBatch {
        concern_id: CONCERN_WORKFLOWS.to_string(),
        files: vec![workflow(
            ".github/workflows/lint-ga.yml",
            "name: lint-ga\non:\n  push:\n    branches: [main]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
        )],
    };

    let diagnostics = plugin
        .detect(&batch)
        .expect("ga/workflows detect не мав провалитись без резолвлених тулів");

    for reason in ["actionlint-unavailable", "zizmor-unavailable"] {
        let found = diagnostics
            .iter()
            .find(|d| d.reason == reason)
            .unwrap_or_else(|| panic!("немає діагностики {reason}"));
        assert!(
            found.message.contains("ПРОПУЩЕНО"),
            "повідомлення {reason} має явно казати, що перевірку пропущено, а не пройдено: {}",
            found.message,
        );
    }
}
