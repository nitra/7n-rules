//! `LoadedPlugin` — плагін, готовий до `detect`/`fix`. `Store`/`Instance`
//! переюзаються між викликами того самого плагіна (рішення Г спеки, пул
//! інстансів: найпростіший reuse, без крос-плагінного пулу — див.
//! доккомент `PluginHost::load`).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use wasmtime::Store;

use rules_contract::coverage::{CoverageReport, CoverageRequest};
use rules_contract::detect::DetectBatch;
use rules_contract::diagnostic::Diagnostic;
use rules_contract::domain::{DocOutput, DocgenRequest, DomainError};
use rules_contract::fix::{FixPlan, FixRequest};
use rules_contract::manifest::Manifest;

use crate::convert;
use crate::error::PluginHostError;
use crate::host_state::{CapturedLog, CapturedProgress, HostState};
use crate::surfaces_coverage_provider;
use crate::tool_resolver::ToolResolver;
use crate::wit;
use crate::world_linker::COVERAGE_PROVIDER_WORLD;

/// Завантажений і готовий до виклику плагін — публічний тип, єдина точка
/// взаємодії з wasm-компонентом поза цим крейтом (рішення М спеки: жоден
/// wasmtime-тип у публічній сигнатурі).
pub struct LoadedPlugin {
    store: Store<HostState>,
    plugin: wit::Plugin,
    manifest: Manifest,
    /// Корінь, від якого відкриті `capabilities.fs_read`-preopens цього
    /// `Store` (`PluginHost::load_in_root`), або `None` — плагін
    /// завантажений без кореня (`PluginHost::load`). Поле потрібне не лише
    /// для гейта [`Self::ensure_fs_read_bound`]: `Store` створюється раз, а
    /// корінь дерева приходить із КОЖНИМ napi-викликом окремо, тож
    /// кешувальний шар (`crates/rules-napi`) звіряє цим акцесором, чи
    /// закешований інстанс відкритий саме на потрібне дерево, і
    /// перезавантажує плагін, коли ні (§2.95).
    preopen_root: Option<PathBuf>,
    /// Той самий `current_thread`-рантайм, що [`crate::host::PluginHost`]
    /// (`Arc`-клон, доккомент поля `PluginHost::runtime`) — `detect`/`fix`
    /// нижче `block_on`-лять `call_detect`/`call_fix`, які
    /// `component-model-async`-бінгден генерує як `async fn` (доккомент
    /// `crate::wit`), незалежно від того, чи КОНКРЕТНИЙ гість (`p2` чи
    /// `p3`) реально суспендиться.
    runtime: Arc<tokio::runtime::Runtime>,
    /// Акцесор на export `collect-coverage` (крок 6 спеки §12) — `Some`
    /// ЛИШЕ коли `manifest.worlds` заявляв [`COVERAGE_PROVIDER_WORLD`] (і
    /// компонент реально інстанціювався з цим world-ом, `crate::host`),
    /// `None` — плагін не реалізує цю слотову поверхню. `Option`, а не
    /// «пробувати й ловити помилку при кожному виклику»: акцесор будується
    /// РАЗ, у `load_impl` (там, де вже є `Instance`), і саме його
    /// відсутність — типізований сигнал [`PluginHostError::SurfaceNotDeclared`]
    /// у [`Self::collect_coverage`], а не повторний провал інстанціації.
    coverage_provider: Option<surfaces_coverage_provider::CoverageProvider>,
}

impl LoadedPlugin {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        store: Store<HostState>,
        plugin: wit::Plugin,
        manifest: Manifest,
        preopen_root: Option<PathBuf>,
        runtime: Arc<tokio::runtime::Runtime>,
        coverage_provider: Option<surfaces_coverage_provider::CoverageProvider>,
    ) -> Self {
        Self {
            store,
            plugin,
            manifest,
            preopen_root,
            runtime,
            coverage_provider,
        }
    }

    /// Корінь, від якого відкриті preopens цього інстансу (доккомент поля
    /// [`Self::preopen_root`]) — `None` для завантаження без кореня.
    pub fn preopen_root(&self) -> Option<&Path> {
        self.preopen_root.as_deref()
    }

    /// Гейт «заявлений `fs-read` без кореня» (§2.95): плагін із непорожнім
    /// `capabilities.fs_read`, завантажений через `PluginHost::load` (без
    /// кореня), не має ЖОДНОГО preopen-у — гість побачив би порожню
    /// пісочницю й не відрізнив би її від «у дереві нічого немає».
    /// Мовчазна деградація тут особливо підступна, бо саме так виглядав би
    /// і старий дефект (preopen від cwd ХОСТ-ПРОЦЕСУ на чужому дереві:
    /// шляхи резолвляться, вміст — не той), тож замість «якось працює»
    /// виклик падає типізовано — у точці шкоди, а не при завантаженні:
    /// `describe()` (маніфест, ensure-tool контур) кореня не потребує й
    /// лишається робочим.
    fn ensure_fs_read_bound(&self, function: &'static str) -> Result<(), PluginHostError> {
        if self.manifest.capabilities.fs_read.is_empty() || self.preopen_root.is_some() {
            return Ok(());
        }
        Err(PluginHostError::FsReadRootUnbound {
            plugin_id: self.manifest.id.clone(),
            paths: self.manifest.capabilities.fs_read.clone(),
            function,
        })
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
        self.ensure_fs_read_bound("detect")?;
        let wit_batch = convert::detect_batch_to_wit(batch);
        self.reset_scratch();
        let result = self
            .runtime
            .block_on(self.plugin.call_detect(&mut self.store, &wit_batch));
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
        self.ensure_fs_read_bound("fix")?;
        let wit_request = convert::fix_request_to_wit(request);
        self.reset_scratch();
        let plan = self
            .runtime
            .block_on(self.plugin.call_fix(&mut self.store, &wit_request));
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

    /// Слотова поверхня `n-rules:surfaces/coverage-provider@1.0.0` (крок 6
    /// спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12): кличе
    /// export `collect-coverage` ЦЬОГО плагіна.
    ///
    /// # Гучна відмова, не порожній звіт (правило проєкту)
    ///
    /// `self.coverage_provider.is_none()` означає ОДНЕ з двох: плагін
    /// узагалі не декларував цей world у `manifest.worlds`, або
    /// декларував, але компонент реально не мав відповідного export-у
    /// (обидва випадки вже відсіяні раніше — перший тим, що
    /// `crate::host::PluginHost::load_impl` просто не будує акцесор, другий
    /// — тим, що акцесор ТОДІ впав би `PluginHostError::Instantiate` ще на
    /// завантаженні, доккомент `crate::host`). Тобто на момент виклику
    /// цього методу `None` означає РІВНО «цей плагін не вміє збирати
    /// покриття» — і повертає типізовану [`PluginHostError::SurfaceNotDeclared`],
    /// а НЕ [`CoverageReport`] з порожнім `areas` (крок 6 спеки: «порожній
    /// звіт не відрізнити від "покриття нульове"»).
    pub fn collect_coverage(
        &mut self,
        request: &CoverageRequest,
    ) -> Result<CoverageReport, PluginHostError> {
        let Some(provider) = self.coverage_provider.as_ref() else {
            return Err(PluginHostError::SurfaceNotDeclared {
                plugin_id: self.manifest.id.clone(),
                world: COVERAGE_PROVIDER_WORLD,
                function: "collect-coverage",
            });
        };
        let wit_request = convert::coverage_request_to_wit(request);
        let result = self
            .runtime
            .block_on(provider.call_collect_coverage(&mut self.store, &wit_request));
        let result = result.map_err(|err| PluginHostError::Execution {
            function: "collect-coverage",
            source: err.into(),
        })?;
        match result {
            Ok(report) => Ok(convert::coverage_report_from_wit(report)),
            Err(error) => {
                let error = convert::coverage_domain_error_from_wit(error);
                Err(PluginHostError::Execution {
                    function: "collect-coverage",
                    source: anyhow::anyhow!("{}", domain_error_message(&error)),
                })
            }
        }
    }

    /// `docgen-render`-домен (рішення К спеки, `Domain::DocgenRender`):
    /// кличе export `docgen-render` ЦЬОГО плагіна напряму — на відміну від
    /// [`Self::collect_coverage`], тут НЕМАЄ окремого слотового акцесора:
    /// `docgen-render` живе в ЯДРОВОМУ world-і `plugin` (`wit/world.wit`),
    /// тож `wit::Plugin` завжди має `call_docgen_render` для БУДЬ-ЯКОГО
    /// інстанційованого плагіна — незадеклароване підтримання домену
    /// сигналить не відсутність export-у (як `coverage-provider`), а
    /// `DomainError::NotSupported` у ВІДПОВІДІ (доккомент `rules_contract::domain`:
    /// «непідтримані домени повертають `NotSupported` — захисна заглушка»).
    /// Викликач звіряє `manifest.domains` заздалегідь, якщо хоче уникнути
    /// зайвого виклику.
    pub fn docgen_render(&mut self, request: &DocgenRequest) -> Result<DocOutput, PluginHostError> {
        let wit_request = convert::docgen_request_to_wit(request);
        self.reset_scratch();
        let result = self
            .runtime
            .block_on(self.plugin.call_docgen_render(&mut self.store, &wit_request));
        self.reset_scratch();
        let result = result.map_err(|err| PluginHostError::Execution {
            function: "docgen-render",
            source: err.into(),
        })?;
        match result {
            Ok(output) => Ok(convert::doc_output_from_wit(output)),
            Err(error) => {
                let error = convert::plugin_domain_error_from_wit(error);
                Err(PluginHostError::Execution {
                    function: "docgen-render",
                    source: anyhow::anyhow!("{}", domain_error_message(&error)),
                })
            }
        }
    }
}

/// Людиночитний текст [`DomainError`] — той самий формат, що варіанти
/// `PluginHostError` уже дають через `#[error(...)]`, лише тут поза
/// `thiserror`-макросом, бо `DomainError` — тип `rules-contract`, не цього
/// крейта (жодного `impl Display` там немає — свідомо, доккомент
/// `rules_contract::domain`: DTO-шар, без format-логіки).
fn domain_error_message(error: &DomainError) -> String {
    match error {
        DomainError::NotSupported => {
            "плагін не підтримує collect-coverage (domain-error::not-supported)".to_string()
        }
        DomainError::Failed { message } => format!("collect-coverage провалився: {message}"),
    }
}
