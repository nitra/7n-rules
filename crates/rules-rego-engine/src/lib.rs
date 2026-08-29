//! Тонка обгортка над `regorus::Engine` — єдине джерело істини для
//! rego-семантики цього репозиторію (реєстр відкритих питань
//! `docs/plans/2026-08-05-open-questions-register.md` §2.66: rego-двигун
//! винесено з wasm-гостя в хост).
//!
//! Точний перенос трьох приватних функцій, що раніше жили в
//! `crates/plugin-ci-github/src/lib.rs` (`eval_deny_rule`/
//! `build_workflow_common_engine`/`extract_string_set`/
//! `value_as_owned_string`) — семантика НЕ переглядалась при перенесенні,
//! лише перейменована під публічний API двох споживачів:
//!
//! - `crates/rules-plugin-host` — реалізація host-import resource
//!   `rego-engine` (`wit/world.wit`): продакшн-шлях, гість кличе через
//!   Component Model межу, `regorus` виконується на хості.
//! - `crates/plugin-ci-github` під `cfg(not(target_arch = "wasm32"))` —
//!   нативні `cargo test`, той самий код in-process (без перетину межі) —
//!   найризикованіша частина порту (YAML→JSON + rego-виконання) лишається
//!   ПОВНІСТЮ покритою нативно, той самий мотив, що документував модуль
//!   `plugin-ci-github` до цієї зміни.
//!
//! Один крейт, дві точки виклику — не дві реалізації, яким можна розійтись.

/// Стадія, на якій rego-виклик провалився — точний відповідник
/// рядкових тегів `"compile"`/`"set_input"`/`"eval"`, які
/// `crates/plugin-ci-github::push_rego_engine_error` вже очікує (жодної
/// зміни видимого контракту діагностик).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegoStage {
    /// `add_policy`/`add_data_json` — компіляція policy/data.
    Compile,
    /// `set_input_json` — вхід не парситься як JSON.
    Input,
    /// `eval_rule` — сама rego-оцінка (відсутнє правило, runtime-помилка).
    Eval,
}

impl RegoStage {
    /// Рядковий тег стадії — той самий, що `eval_deny_rule` повертав ДО
    /// цього перенесення (`"compile"`/`"set_input"`/`"eval"`), НЕ
    /// `"input"` — історичний тег лишається, щоб діагностики не змінились
    /// байт-у-байт.
    pub fn as_str(self) -> &'static str {
        match self {
            RegoStage::Compile => "compile",
            RegoStage::Input => "set_input",
            RegoStage::Eval => "eval",
        }
    }
}

/// Помилка rego-виклику — стадія + людинописне повідомлення
/// (`regorus`-помилка, перетворена в `String` на межі цього крейта, той
/// самий контракт, що `eval_deny_rule` мав раніше).
#[derive(Debug, Clone)]
pub struct RegoError {
    pub stage: RegoStage,
    pub message: String,
}

/// Один rego-двигун — тонка обгортка `regorus::Engine`. `add_policy`/
/// `add_data_json` готують двигун РАЗ (batch-контракт: `workflow_common`
/// компілює policy+data один раз, потім `eval_rule` у циклі по файлах —
/// доккомент `wit/world.wit` біля `resource rego-engine`), `eval_rule`
/// викликається СТІЛЬКИ РАЗІВ, скільки треба.
pub struct RegoEngine {
    engine: regorus::Engine,
}

impl Default for RegoEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl RegoEngine {
    pub fn new() -> Self {
        Self {
            engine: regorus::Engine::new(),
        }
    }

    /// Компілює й додає одну rego-policy. Точний відповідник
    /// `engine.add_policy(name, source)` — стадія помилки завжди
    /// `Compile`.
    pub fn add_policy(&mut self, name: &str, source: &str) -> Result<(), RegoError> {
        self.engine
            .add_policy(name.to_string(), source.to_string())
            .map(|_| ())
            .map_err(|e| RegoError {
                stage: RegoStage::Compile,
                message: e.to_string(),
            })
    }

    /// Додає `data` (JSON-текст) до двигуна. Точний відповідник
    /// `engine.add_data_json(data_json)` — стадія помилки `Compile` (той
    /// самий тег, що `eval_deny_rule` віддавав для побитого `data`).
    pub fn add_data_json(&mut self, data_json: &str) -> Result<(), RegoError> {
        self.engine.add_data_json(data_json).map_err(|e| RegoError {
            stage: RegoStage::Compile,
            message: e.to_string(),
        })
    }

    /// `set_input_json(input_json)` + `eval_rule(rule)` — рівно ОДИН
    /// виклик за раз (batch-цикл викликає це по одному разу на файл, той
    /// самий `Engine` перевикористовується). Повертає рядки з
    /// `Set`/`Array`-результату (`deny`-контракт) — точний відповідник
    /// `extract_string_set`/`value_as_owned_string`, які раніше жили в
    /// `plugin-ci-github`.
    pub fn eval_rule(&mut self, input_json: &str, rule: &str) -> Result<Vec<String>, RegoError> {
        self.engine
            .set_input_json(input_json)
            .map_err(|e| RegoError {
                stage: RegoStage::Input,
                message: e.to_string(),
            })?;
        let result = self
            .engine
            .eval_rule(rule.to_string())
            .map_err(|e| RegoError {
                stage: RegoStage::Eval,
                message: e.to_string(),
            })?;
        Ok(extract_string_set(&result))
    }
}

fn extract_string_set(value: &regorus::Value) -> Vec<String> {
    match value {
        regorus::Value::Set(set) => set.iter().filter_map(value_as_owned_string).collect(),
        regorus::Value::Array(arr) => arr.iter().filter_map(value_as_owned_string).collect(),
        _ => Vec::new(),
    }
}

fn value_as_owned_string(value: &regorus::Value) -> Option<String> {
    match value {
        regorus::Value::String(s) => Some(s.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_policy_then_eval_rule_returns_deny_messages() {
        let mut engine = RegoEngine::new();
        engine
            .add_policy(
                "p.rego",
                "package p\ndeny contains msg if { msg := \"boom\" }",
            )
            .unwrap();
        engine.add_data_json("{}").unwrap();
        let messages = engine.eval_rule("{}", "data.p.deny").unwrap();
        assert_eq!(messages, vec!["boom".to_string()]);
    }

    #[test]
    fn same_engine_reused_across_multiple_eval_rule_calls() {
        let mut engine = RegoEngine::new();
        engine
            .add_policy(
                "p.rego",
                "package p\ndeny contains msg if { input.bad; msg := \"bad-input\" }",
            )
            .unwrap();
        engine.add_data_json("{}").unwrap();
        assert!(engine.eval_rule(r#"{"bad": true}"#, "data.p.deny").unwrap()
            == vec!["bad-input".to_string()]);
        assert!(engine
            .eval_rule(r#"{"bad": false}"#, "data.p.deny")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn add_policy_compile_error_is_tagged_compile() {
        let mut engine = RegoEngine::new();
        let err = engine.add_policy("p.rego", "not valid rego (((").unwrap_err();
        assert_eq!(err.stage, RegoStage::Compile);
    }

    #[test]
    fn eval_rule_input_error_is_tagged_set_input() {
        let mut engine = RegoEngine::new();
        engine
            .add_policy("p.rego", "package p\ndeny contains \"x\"")
            .unwrap();
        let err = engine.eval_rule("not-json", "data.p.deny").unwrap_err();
        assert_eq!(err.stage, RegoStage::Input);
        assert_eq!(err.stage.as_str(), "set_input");
    }

    #[test]
    fn eval_rule_missing_rule_error_is_tagged_eval() {
        let mut engine = RegoEngine::new();
        engine.add_policy("p.rego", "package p").unwrap();
        let err = engine.eval_rule("{}", "data.p.deny").unwrap_err();
        assert_eq!(err.stage, RegoStage::Eval);
    }

    // --- Регресійний гейт на не-дефолтні builtins (`"graph"`-фіт) ---
    //
    // `regorus` пінується тут із `default-features = false` — НАВМИСНО, щоб
    // тримати розмір нативного хоста (доккомент [`regorus`-залежності]
    // `Cargo.toml`, реєстр відкритих питань
    // `docs/plans/2026-08-05-open-questions-register.md` §2.68). Це створює
    // постійну спокусу «прибрати зайву фіту» — а `"graph"` ламається
    // ОСОБЛИВО підступно: без неї policy з `walk()`/`graph.reachable`
    // КОМПІЛЮЄТЬСЯ (hoist-прохід `regorus` розпізнає ці імена незалежно від
    // фіту), але падає на ЕВАЛЮАЦІЇ з оманливою помилкою `use of undefined
    // variable '...' is unsafe` — виглядає як баг Rego-безпеки в самій
    // policy, а не як відсутній builtin (підтверджено мінімальним репро
    // задачею §2.68, цикл, витрачений на діагностику, — сам доказ, що
    // помилка вводить в оману). Ці два тести — якір: якщо хтось прибере
    // `"graph"` з фіт-набору нижче, тут падає ЧЕРВОНИЙ тест із зрозумілою
    // назвою замість загадкової помилки в чужому wasm-плагіні через
    // півроку.
    //
    // `walk()` — реально ВЖЕ споживається (`plugin-ci-azure`,
    // `azure-pipelines/lint_pipeline`, `crates/plugin-ci-azure/src/lib.rs`).
    // `graph.reachable` — ще НЕ споживається жодним вшитим `.rego` жодного
    // wasm-гостя (перевірено grep-ом по `plugins/{ci-github,ci-azure}/rules/`
    // на момент написання цього тесту — обидва наявні вжитки живуть у
    // `ga/service_deploy_workflow`/`azure-pipelines/service_deploy_pipeline`,
    // СВІДОМО поза обсягом портованих концернів), але лежить у ТІЙ САМІЙ
    // фіті, що `walk()` — тест тут ЗАРАНІШЕ ловить регрес, якщо майбутній
    // порт `service_deploy_*` покладеться на неї мовчки. Решта fіт-набору
    // (`regex`/`std`/`arc`) — не builtin-реєстрація, а мовна фіча
    // (`regex`) чи ABI-деталь (`std`/`arc`), тому не того самого класу
    // ризику (відсутність дає ПОМИЛКУ КОМПІЛЯЦІЇ чи взагалі не компілюється
    // цей крейт, не оманливий рантайм-фейл) — нового гейта на них не
    // додано.
    #[test]
    fn walk_builtin_traverses_nested_input_without_graph_feature_being_dropped() {
        let mut engine = RegoEngine::new();
        engine
            .add_policy(
                "p.rego",
                r#"package p
import rego.v1

scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}
"#,
            )
            .unwrap();
        engine.add_data_json("{}").unwrap();
        let mut messages = engine
            .eval_rule(
                r#"{"steps":[{"script":"a"}],"nested":{"x":{"script":"b"}}}"#,
                "data.p.scripts",
            )
            .expect(
                "walk() мусить еваluюватись — якщо тут Err, фіт \"graph\" прибрано з rules-rego-engine/Cargo.toml (доккомент тесту)",
            );
        messages.sort();
        assert_eq!(messages, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn graph_reachable_builtin_evaluates_without_graph_feature_being_dropped() {
        let mut engine = RegoEngine::new();
        engine
            .add_policy(
                "p.rego",
                r#"package p
import rego.v1

deny contains "reachable" if {
	"b" in graph.reachable({"a": {"b"}, "b": set()}, {"a"})
}
"#,
            )
            .unwrap();
        engine.add_data_json("{}").unwrap();
        let messages = engine.eval_rule("{}", "data.p.deny").expect(
            "graph.reachable() мусить еваluюватись — якщо тут Err, фіт \"graph\" прибрано з rules-rego-engine/Cargo.toml (доккомент тесту)",
        );
        assert_eq!(messages, vec!["reachable".to_string()]);
    }
}
