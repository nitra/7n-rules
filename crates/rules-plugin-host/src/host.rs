//! `PluginHost` — вузький публічний вхід у Component Model wasmtime
//! (рішення М спеки): будує `Engine`/`Linker` один раз (спільні для всіх
//! завантажених плагінів), `load()` компілює `.wasm`, інстанціює двофазно
//! (probe `describe()` без capabilities → реальний `Store` з preopens) і
//! повертає `LoadedPlugin`.

use std::path::Path;
use std::sync::Arc;

use wasmtime::component::{Component, HasSelf, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{FsPerms, WasiCtxBuilder};

use rules_contract::manifest::{Capabilities, Manifest};

use crate::convert;
use crate::error::PluginHostError;
use crate::host_state::HostState;
use crate::loaded_plugin::LoadedPlugin;
use crate::tool_resolver::ToolResolver;
use crate::wit;

/// Embedded wasmtime-хост для `n-rules:plugin@3.1.0`. `Engine`+`Linker`
/// будуються раз на `PluginHost` (host-функції компілюються в `Linker`
/// один раз, не на кожен `load`) — окремий `Store` на плагін через `load`.
pub struct PluginHost {
    engine: Engine,
    linker: Linker<HostState>,
    tool_resolver: Arc<ToolResolver>,
}

impl PluginHost {
    /// Створює хост із реальним run-tool контуром (рішення Д спеки, задача
    /// N1): [`ToolResolver`] — мапа «ім'я тула → шлях», яку побудувала
    /// оркестрація (ensure-tool контур, JS-бік) ДО виклику цього
    /// конструктора; `ToolResolver::empty()` — валідний дефолт, коли жоден
    /// tool ще не резолвлений (кожен `run-tool`-виклик просто отримає
    /// типізовану помилку в `tool-output`, доккомент `ToolResolver::run`).
    pub fn new(tool_resolver: ToolResolver) -> Result<Self, PluginHostError> {
        let mut config = Config::new();
        config.wasm_component_model(true);
        let engine =
            Engine::new(&config).map_err(|err| PluginHostError::Instantiate(err.into()))?;

        let mut linker = Linker::<HostState>::new(&engine);
        // Усі WASI Preview 2 інтерфейси (cli/clocks/filesystem/random/sockets)
        // лінкуються уніфіковано — enforcement «мережа заборонена за
        // замовчуванням» (рішення Е спеки) не в тому, які інтерфейси
        // прилінковані, а в тому, що `WasiCtxBuilder` за замовчуванням НЕ
        // дозволяє жодної мережевої операції (`allow_tcp`/`allow_udp`/
        // `allow_ip_name_lookup` — усі `false`, доки `build_host_state`
        // явно не увімкне їх для `capabilities.network == true`). Це
        // офіційно задокументована модель wasmtime-wasi (WasiCtx «null за
        // замовчуванням») — простіша й надійніша за ручне вибіркове
        // лінкування підмножини інтерфейсів (яке залежить від приватних
        // функцій `wasmtime-wasi`, крихке між minor-релізами).
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)
            .map_err(|err| PluginHostError::Instantiate(err.into()))?;
        wit::Plugin::add_to_linker_imports::<_, HasSelf<_>>(&mut linker, |state| state)
            .map_err(|err| PluginHostError::Instantiate(err.into()))?;

        Ok(Self {
            engine,
            linker,
            tool_resolver: Arc::new(tool_resolver),
        })
    }

    /// Завантажує `.wasm`-компонент за шляхом, звіряє `world-version` (за
    /// major-компонентою) з `expected_world_version` — skip-not-crash
    /// (рішення З спеки: несумісний плагін — типізована помилка
    /// [`PluginHostError::IncompatibleVersion`], оркестрація ловить і
    /// пропускає плагін, не валить прогін) — і повертає готовий до
    /// `detect`/`fix` [`LoadedPlugin`].
    ///
    /// Двофазна інстанціація (`describe()` викликається двічі — WIT-контракт:
    /// без аргументів, без side-effects, детерміновано ідемпотентний):
    /// 1. **probe** — тимчасовий `Store` без fs preopens/мережі, лише щоб
    ///    отримати `Manifest.capabilities` ДО того, як preopens можна
    ///    налаштувати (курка-яйце: `WasiCtx` фіксується при створенні
    ///    `Store`, а список шляхів до preopen-у знає лише сам плагін);
    ///    Store і Instance цієї фази відкидаються одразу після виклику.
    /// 2. **реальна** — новий `Store` із preopens за
    ///    `probe_manifest.capabilities`, на якому `describe()` викликається
    ///    ЗНОВУ (той самий результат, детермінований контракт) — цей другий
    ///    виклик і лишається «першим викликом хоста після завантаження
    ///    компонента» зі спеки §3.2 з погляду caller-а: саме цей `Store`
    ///    лишається живим у поверненому `LoadedPlugin` для всіх наступних
    ///    `detect`/`fix` викликів (Store/Instance переюз між викликами —
    ///    рішення Г спеки, пул інстансів: найпростіший варіант reuse у
    ///    межах одного плагіна, крос-плагінний пул відкладено як непотрібне
    ///    ускладнення), і саме його лог-капчур бачить виклик `describe()`.
    pub fn load(
        &self,
        path: &Path,
        expected_world_version: &str,
    ) -> Result<LoadedPlugin, PluginHostError> {
        let bytes = std::fs::read(path).map_err(|err| PluginHostError::Load {
            path: path.to_path_buf(),
            source: anyhow::Error::new(err),
        })?;
        let component =
            Component::from_binary(&self.engine, &bytes).map_err(|err| PluginHostError::Load {
                path: path.to_path_buf(),
                source: err.into(),
            })?;

        let probe_manifest =
            self.describe_with_capabilities(&component, &Capabilities::default())?;
        check_world_version(&probe_manifest.world_version, expected_world_version)?;

        // Реальна фаза викликає `describe()` ЗНОВУ на реальному `Store`
        // (той самий guest-виклик, ідемпотентний за контрактом — WIT
        // `describe` не бере аргументів і не має side-effects) — так
        // `LoadedPlugin::describe()` кешує маніфест саме з того інстансу,
        // що й лишається живим для `detect`/`fix`, і лог-капчур цього
        // `Store` реально містить запис про перший виклик (доккомент
        // `Self::load` вище: «перший виклик хоста після завантаження
        // компонента»), а не запис у відкинутому probe-`Store`.
        let host_state = self.build_host_state(&probe_manifest.capabilities)?;
        let mut store = Store::new(&self.engine, host_state);
        let plugin = wit::Plugin::instantiate(&mut store, &component, &self.linker)
            .map_err(|err| PluginHostError::Instantiate(err.into()))?;
        let manifest =
            plugin
                .call_describe(&mut store)
                .map_err(|err| PluginHostError::Execution {
                    function: "describe",
                    source: err.into(),
                })?;
        let manifest = convert::manifest_from_wit(manifest);

        Ok(LoadedPlugin::new(store, plugin, manifest))
    }

    /// Фаза 1 інстанціації — див. доккомент [`Self::load`]: інстанціює
    /// компонент у тимчасовий `Store` з переданими `capabilities` (probe —
    /// `Capabilities::default()`, без preopens/мережі) і повертає
    /// `describe()`; `Store`/`Instance` цієї фази відкидаються.
    fn describe_with_capabilities(
        &self,
        component: &Component,
        capabilities: &Capabilities,
    ) -> Result<Manifest, PluginHostError> {
        let host_state = self.build_host_state(capabilities)?;
        let mut store = Store::new(&self.engine, host_state);
        let plugin = wit::Plugin::instantiate(&mut store, component, &self.linker)
            .map_err(|err| PluginHostError::Instantiate(err.into()))?;
        let manifest =
            plugin
                .call_describe(&mut store)
                .map_err(|err| PluginHostError::Execution {
                    function: "describe",
                    source: err.into(),
                })?;
        Ok(convert::manifest_from_wit(manifest))
    }

    /// Будує `HostState` (WASI-контекст + наш host-стан) за
    /// `capabilities`: `fs_read`-шляхи — read-only preopens, резолвлені
    /// відносно поточної робочої директорії хоста (та сама конвенція, що й
    /// `SourceFile::path` — «posix-relative шлях від cwd»). Глоб-патерни в
    /// `fs_read` НЕ розкриваються тут (v3.0-обмеження, задокументовано —
    /// типовий концерн лишає `fs_read` порожнім, вміст файлів хост передає
    /// inline у `DetectBatch`/`FixRequest`; глоб-резолвинг — кандидат на
    /// майбутню оркестрацію, фаза 7).
    fn build_host_state(&self, capabilities: &Capabilities) -> Result<HostState, PluginHostError> {
        let mut builder = WasiCtxBuilder::new();
        let cwd = std::env::current_dir()
            .map_err(|err| PluginHostError::Instantiate(anyhow::Error::new(err)))?;
        for rel in &capabilities.fs_read {
            let host_path = cwd.join(rel);
            builder
                // `FsPerms::ReadOnly` — wasmtime-wasi 48 звів колишню пару
                // `DirPerms`/`FilePerms` в один enum (обидва прапорці все одно
                // виставлялись у `READ` разом; окремий rw-стан для теки й файлу
                // сенсу не мав). Семантика незмінна: плагін читає preopen і не
                // мутує його — рішення Е спеки, доккомент `PluginHost::new`.
                .preopened_dir(&host_path, rel, FsPerms::ReadOnly)
                .map_err(|err| PluginHostError::Preopen {
                    path: host_path,
                    source: err.into(),
                })?;
        }
        if capabilities.network {
            builder
                .inherit_network()
                .allow_ip_name_lookup(true)
                .allow_udp(true)
                .allow_tcp(true);
        }
        Ok(HostState {
            wasi_ctx: builder.build(),
            table: ResourceTable::new(),
            logs: Default::default(),
            progress: Default::default(),
            tool_resolver: Arc::clone(&self.tool_resolver),
            // Контекст `repo-root@1` виставляється per-виклик через
            // `LoadedPlugin::set_repo_root` (доккомент поля) — на момент
            // load/instantiate його ще немає.
            repo_root: None,
            // Scratch-каталог слоту `scratch-dir@1` — лінивий і
            // per-виклик (`LoadedPlugin` скидає його навколо кожного
            // `detect`/`fix`), тож на момент load/instantiate його теж
            // немає й бути не має.
            scratch: Default::default(),
        })
    }
}

/// Major-компонента world-версії (`"3.0.0"` → `"3"`) — semver-крейт тут
/// свідомо не додається: negotiation (рішення З спеки) звіряє лише major,
/// рядкове порівняння цього достатньо і без нової залежності.
fn major(version: &str) -> Option<&str> {
    version.split('.').next().filter(|s| !s.is_empty())
}

fn check_world_version(found: &str, expected: &str) -> Result<(), PluginHostError> {
    match (major(found), major(expected)) {
        (Some(f), Some(e)) if f == e => Ok(()),
        _ => Err(PluginHostError::IncompatibleVersion {
            found: found.to_string(),
            expected: expected.to_string(),
        }),
    }
}
