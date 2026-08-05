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

    /// Виставляє payload слоту `repo-root@1` host-функції `host-context`
    /// (доккомент `wit/world.wit` біля `import host-context`): абсолютний
    /// корінь consumer-репо поточного `detect`/`fix`-виклику — той самий
    /// `cwd`, від якого рахуються posix-relative `SourceFile::path`. Той
    /// самий мотив per-виклик підміни, що [`Self::set_tool_resolver`]:
    /// `LoadedPlugin` кешується per-path на процес, а `cwd` приходить із
    /// кожним napi-викликом окремо. `None` — прибрати контекст (guest
    /// отримає `none` і деградує сам).
    pub fn set_repo_root(&mut self, repo_root: Option<String>) {
        self.store.data_mut().repo_root = repo_root;
    }

    /// lint-домен: детекція діагностик по батчу файлів заявленого
    /// концерну. Той самий `Store`/`Instance`, що й попередні виклики цього
    /// `LoadedPlugin` (reuse).
    pub fn detect(&mut self, batch: &DetectBatch) -> Result<Vec<Diagnostic>, PluginHostError> {
        let wit_batch = convert::detect_batch_to_wit(batch);
        self.reset_scratch();
        let result = self.plugin.call_detect(&mut self.store, &wit_batch);
        self.reset_scratch();
        let result = result.map_err(|err| PluginHostError::Execution {
            function: "detect",
            source: err.into(),
        })?;
        convert::diagnostics_from_wit(result)
    }

    /// Дропає scratch-каталог `exec-tool` цього `Store` (`Drop` `TempDir`
    /// видаляє його рекурсивно) — контракт «каталог живе рівно один
    /// `detect`/`fix`-виклик» (доккомент `wit/world.wit` біля слоту
    /// `scratch-dir@1`).
    ///
    /// Викликається і ПЕРЕД, і ПІСЛЯ виклику гостя, і це не надмірність:
    /// «після» — штатне прибирання, «перед» — єдине, що працює, коли гість
    /// тріпнув (wasm trap/panic), бо тоді `call_detect` повернув `Err`, і
    /// хоч «після» теж відпрацює, наступний виклик не має жодного права
    /// покладатись на це в майбутніх шляхах виходу. Store переюзається між
    /// викликами (рішення Г спеки), тож без скидання каталог жив би до
    /// вивантаження плагіна — тобто, за кешем `LOADED_PLUGINS` napi-мосту,
    /// до кінця процесу.
    fn reset_scratch(&mut self) {
        *self.store.data().scratch.borrow_mut() = None;
    }

    /// lint-домен: побудова fix-plan-у для підмножини діагностик `detect`.
    ///
    /// План — недовірений вхід від guest-коду: перед поверненням він
    /// валідується host-валідатором
    /// [`rules_contract::validators::fix::validate_fix_plan`] (safe
    /// repo-relative шляхи, ліміти розміру — доккомент модуля валідатора);
    /// будь-яке порушення відхиляє план ЦІЛКОМ типізованою помилкою
    /// [`PluginHostError::InvalidContractData`] (не часткове застосування) —
    /// той самий контракт, що конверсія `diagnostic.data` у `detect`.
    pub fn fix(&mut self, request: &FixRequest) -> Result<FixPlan, PluginHostError> {
        let wit_request = convert::fix_request_to_wit(request);
        self.reset_scratch();
        let plan = self.plugin.call_fix(&mut self.store, &wit_request);
        self.reset_scratch();
        let plan = plan.map_err(|err| PluginHostError::Execution {
            function: "fix",
            source: err.into(),
        })?;
        let plan = convert::fix_plan_from_wit(plan);
        rules_contract::validators::fix::validate_fix_plan(&plan).map_err(|errors| {
            PluginHostError::InvalidContractData(format!(
                "fix-plan відхилено: {}",
                errors.join("; ")
            ))
        })?;
        Ok(plan)
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
