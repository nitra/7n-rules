//! `LoadedPlugin` — плагін, готовий до `detect`/`fix`. `Store`/`Instance`
//! переюзаються між викликами того самого плагіна (рішення Г спеки, пул
//! інстансів: найпростіший reuse, без крос-плагінного пулу — див.
//! доккомент `PluginHost::load`).

use std::sync::Arc;

use wasmtime::Store;

use rules_contract::detect::DetectBatch;
use rules_contract::diagnostic::Diagnostic;
use rules_contract::fix::{FixPlan, FixRequest};
use rules_contract::manifest::Manifest;

use crate::convert;
use crate::error::PluginHostError;
use crate::host_state::{CapturedLog, CapturedProgress, HostState};
use crate::tool_resolver::ToolResolver;
use crate::wit;

/// Завантажений і готовий до виклику плагін — публічний тип, єдина точка
/// взаємодії з wasm-компонентом поза цим крейтом (рішення М спеки: жоден
/// wasmtime-тип у публічній сигнатурі).
pub struct LoadedPlugin {
    store: Store<HostState>,
    plugin: wit::Plugin,
    manifest: Manifest,
}

impl LoadedPlugin {
    pub(crate) fn new(store: Store<HostState>, plugin: wit::Plugin, manifest: Manifest) -> Self {
        Self {
            store,
            plugin,
            manifest,
        }
    }

    /// Маніфест плагіна, отриманий `describe()` один раз у
    /// `PluginHost::load` (спека §3.2: «перший виклик хоста після
    /// завантаження компонента») і закешований — метод сам guest не кличе.
    pub fn describe(&self) -> &Manifest {
        &self.manifest
    }

    /// Підмінює [`ToolResolver`], який `run-tool`-host-функція цього
    /// `Store` бачитиме у ВСІХ наступних `detect`/`fix`-викликах — потрібно
    /// napi-мосту (`crates/rules-napi`): `PluginHost`/`LoadedPlugin`
    /// кешуються per-path на процес (уникнення повторної компіляції/
    /// інстанціації), а `toolPaths` (ensure-tool-мапа) може відрізнятись
    /// між окремими napi-викликами того самого плагіна — переінстанціювати
    /// `Store` заради цього не потрібно, `HostState.tool_resolver` — звичайне
    /// поле, доступне через `Store::data_mut()`.
    pub fn set_tool_resolver(&mut self, resolver: Arc<ToolResolver>) {
        self.store.data_mut().tool_resolver = resolver;
    }

    /// lint-домен: детекція діагностик по батчу файлів заявленого
    /// концерну. Той самий `Store`/`Instance`, що й попередні виклики цього
    /// `LoadedPlugin` (reuse).
    pub fn detect(&mut self, batch: &DetectBatch) -> Result<Vec<Diagnostic>, PluginHostError> {
        let wit_batch = convert::detect_batch_to_wit(batch);
        let result = self
            .plugin
            .call_detect(&mut self.store, &wit_batch)
            .map_err(|err| PluginHostError::Execution {
                function: "detect",
                source: err.into(),
            })?;
        convert::diagnostics_from_wit(result)
    }

    /// lint-домен: побудова fix-plan-у для підмножини діагностик `detect`.
    pub fn fix(&mut self, request: &FixRequest) -> Result<FixPlan, PluginHostError> {
        let wit_request = convert::fix_request_to_wit(request);
        let plan = self
            .plugin
            .call_fix(&mut self.store, &wit_request)
            .map_err(|err| PluginHostError::Execution {
                function: "fix",
                source: err.into(),
            })?;
        Ok(convert::fix_plan_from_wit(plan))
    }

    /// Дренує буфер логів, захоплених host-функцією `log` (plugin → host)
    /// з моменту останнього виклику `take_logs` — капчур накопичується за
    /// весь час життя `LoadedPlugin` (не скидається між `detect`/`fix`),
    /// типове використання — дренувати одразу після виклику.
    pub fn take_logs(&mut self) -> Vec<CapturedLog> {
        self.store.data().logs.borrow_mut().drain(..).collect()
    }

    /// Дренує буфер прогрес-подій, захоплених host-функцією
    /// `report-progress` (спека §2 рішення Г: прогрес per-concern, на боці
    /// хоста).
    pub fn take_progress(&mut self) -> Vec<CapturedProgress> {
        self.store.data().progress.borrow_mut().drain(..).collect()
    }
}
