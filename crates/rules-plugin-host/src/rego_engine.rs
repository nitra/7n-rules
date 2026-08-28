//! Host-реалізація imported resource `rego-engine` (`wit/world.wit`,
//! реєстр `docs/plans/2026-08-05-open-questions-register.md` §2.66) —
//! кожен метод делегує в [`rules_rego_engine::RegoEngine`] (той самий
//! крейт, що `plugin-ci-github` підключає нативно під
//! `cfg(not(wasm32))`) — жодної власної rego-логіки тут, лише міст
//! WIT ⇄ `rules-rego-engine` і `ResourceTable`-облік хендлів.

use wasmtime::component::Resource;

use rules_rego_engine::{RegoEngine, RegoStage};

use crate::host_state::HostState;
use crate::wit;

/// Rust-представлення одного хендла `rego-engine` у [`wasmtime::component::ResourceTable`]
/// (`HostState::table`) — обгортка над [`RegoEngine`], а не сам `RegoEngine`
/// напряму: `with:`-мапінг (`src/wit.rs`) вимагає `pub`-тип, окремий від
/// публічного API `rules-rego-engine`, щоб той лишався незалежним від
/// wasmtime.
pub struct RegoEngineState {
    inner: RegoEngine,
}

/// `regorus`-помилка → `wit::RegoError` — стадія й повідомлення переносяться
/// без змін (той самий контракт, що `eval_deny_rule` мав до перенесення в
/// `rules-rego-engine`).
fn to_wit_error(err: rules_rego_engine::RegoError) -> wit::RegoError {
    wit::RegoError {
        stage: match err.stage {
            RegoStage::Compile => wit::RegoStage::Compile,
            RegoStage::Input => wit::RegoStage::Input,
            RegoStage::Eval => wit::RegoStage::Eval,
        },
        message: err.message,
    }
}

impl wit::HostRegoEngine for HostState {
    fn new(&mut self) -> Resource<RegoEngineState> {
        self.table
            .push(RegoEngineState {
                inner: RegoEngine::new(),
            })
            .expect("ResourceTable::push для rego-engine — таблиця не повна за конструкцією")
    }

    fn add_policy(
        &mut self,
        self_: Resource<RegoEngineState>,
        name: String,
        source: String,
    ) -> Result<(), wit::RegoError> {
        let state = self
            .table
            .get_mut(&self_)
            .expect("гість не міг сфальшувати невалідний rego-engine хендл");
        state.inner.add_policy(&name, &source).map_err(to_wit_error)
    }

    fn add_data_json(
        &mut self,
        self_: Resource<RegoEngineState>,
        data_json: String,
    ) -> Result<(), wit::RegoError> {
        let state = self
            .table
            .get_mut(&self_)
            .expect("гість не міг сфальшувати невалідний rego-engine хендл");
        state.inner.add_data_json(&data_json).map_err(to_wit_error)
    }

    fn eval_rule(
        &mut self,
        self_: Resource<RegoEngineState>,
        input_json: String,
        rule: String,
    ) -> Result<Vec<String>, wit::RegoError> {
        let state = self
            .table
            .get_mut(&self_)
            .expect("гість не міг сфальшувати невалідний rego-engine хендл");
        state
            .inner
            .eval_rule(&input_json, &rule)
            .map_err(to_wit_error)
    }

    fn drop(&mut self, rep: Resource<RegoEngineState>) -> wasmtime::Result<()> {
        self.table.delete(rep)?;
        Ok(())
    }
}
