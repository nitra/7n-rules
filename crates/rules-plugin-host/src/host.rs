//! `PluginHost` — вузький публічний вхід у Component Model wasmtime
//! (рішення М спеки): будує `Engine` і базовий `Linker` (WASI + ядровий
//! світ `n-rules:plugin`) один раз, спільні для всіх завантажених плагінів
//! — `load()`/`load_for_worlds()` компілює `.wasm`, під конкретний
//! компонент збирає лінкер (ядро + оголошені світи повноважень/поверхонь,
//! спека `docs/specs/2026-08-31-plugin-contract-v5.md` §9, доккомент
//! [`PluginHost`] нижче), інстанціює двофазно (probe `describe()` без
//! capabilities → реальний `Store` з preopens) і повертає `LoadedPlugin`.

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
use crate::world_linker;

/// Embedded wasmtime-хост для `n-rules:plugin@4.0.0`. `Engine`+`base_linker`
/// будуються раз на `PluginHost` — окремий `Store` на плагін через `load`.
///
/// # `base_linker` — ядро, не весь лінкер (спека §9)
///
/// До задачі «хост будує лінкер під набір світів» (`docs/specs/2026-08-31-plugin-contract-v5.md`
/// §9) тут був ЄДИНИЙ статичний `linker`, спільний для всіх плагінів. Тепер
/// `base_linker` несе лише те, що належить КОЖНОМУ гостю за конструкцією —
/// WASI Preview 2 й ядровий світ `n-rules:plugin` (спека §8: «ядровий світ…
/// не перелічується — його реалізують усі») — і саме тому лишається полем
/// `PluginHost`, побудованим раз: жоден зі шести гостей сьогодні не оголошує
/// жодного світу повноважень (реєстр `crate::world_linker` порожній до
/// хвилі 1), тож `base_linker` — це й є фактичний лінкер для всіх поточних
/// плагінів.
///
/// Лінкер під ДЕКЛАРОВАНІ світи компонента (капабіліті/поверхневі, поза
/// ядром) будується per-load — [`Self::linker_for_worlds`]: клон
/// `base_linker` (`Linker<T: 'static>` реалізує `Clone` дешево — доккомент
/// `crate::world_linker`) розширюється `add_to_linker_imports` кожного
/// оголошеного світу. Клонування «до» додавання host-функцій, компільованих
/// у `base_linker` один раз тут, лишається дешевим — і саме тому коментар
/// вище про одноразову побудову ядра ще правдивий, попри те, що фінальний
/// лінкер, який бачить `Component::instantiate`, тепер збирається наново на
/// кожен `load`.
pub struct PluginHost {
    engine: Engine,
    base_linker: Linker<HostState>,
    tool_resolver: Arc<ToolResolver>,
    /// `current_thread`-рантайм, що ганяє `instantiate_async`/`call_async`
    /// (спека `docs/specs/2026-08-31-plugin-contract-v5.md`, розділ 10.1) —
    /// `component-model-async` вимагає async-виклику НАВІТЬ для семантично
    /// синхронних host-функцій (доккомент `crate::wit`), тож ЦЕЙ рантайм —
    /// формальність ABI, не джерело реальної конкурентності. Публічний API
    /// [`PluginHost`]/[`LoadedPlugin`] лишається СИНХРОННИМ (рішення М спеки:
    /// жоден wasmtime/tokio-тип у публічній сигнатурі) — кожен виклик
    /// блокує потік викликача через [`tokio::runtime::Runtime::block_on`],
    /// той самий контракт, що й до цієї хвилі. Один рантайм на `PluginHost`
    /// (не per-виклик) — `Runtime::new()` не безкоштовний (створює потік
    /// таймера/резервує ресурси), а `PluginHost` уже живе процес-довго
    /// (доккомент вище: `Engine`+`base_linker` будуються раз).
    runtime: Arc<tokio::runtime::Runtime>,
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
        // `component-model-async` (спека, розділ 10.1) — потрібна БУДЬ-ЯКОМУ
        // компоненту, зібраному під `wasm32-wasip3` (WASI 0.3, host-функції
        // p3-інтерфейсів — стрімами/futures на рівні canonical ABI, доккомент
        // `crate::wit`). Дуальний `p2`+`p3` лінк нижче потребує ЦЬОГО
        // прапорця навіть для чисто-p2 гостей, зібраних до цієї хвилі —
        // доведено спайком: `instantiate_async` успішно інстанціює й старий
        // wasm32-wasip2 компонент на цьому самому `Engine`.
        config.wasm_component_model_async(true);
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
        //
        // ДУАЛЬНИЙ лінк p2+p3 (спека, розділ 10.1) — `WasiCtx`/`WasiCtxView`/
        // `WasiView` ОДИН СПІЛЬНИЙ тип для обох ліній (не p2/p3-специфічний,
        // доккомент піна `wasmtime-wasi` у `Cargo.toml`), тож той самий
        // `HostState` задовольняє обидва трейти без жодного дублювання.
        // `p2::add_to_linker_sync` реєструє `wasi:*@0.2.x`, `p3::add_to_linker`
        // — `wasi:*@0.3.x`; жодного перетину ключів (різні WIT-пакети), тож
        // порядок реєстрації не важить. Причина дуальності — не інерція:
        // `npm/skills/wasm-plugin/template/build.sh` (протектована зона
        // паралельної хвилі) СЬОГОДНІ ще скаффолдить `wasm32-wasip2`-гостей
        // (`tests/wasm_plugin_skill_smoke.rs`,
        // `tests/guest_additive_compat.rs::v50_guest_loads_and_detects_on_current_host`),
        // і негайне видалення `p2` тут поламало б обидва тести гучно заради
        // половинчастого переходу (правило проєкту: половинчаста міграція
        // гірша за жодну). Видалення `p2` — наступний крок, ПІСЛЯ окремої
        // хвилі, що мігрує шаблон скіла (відкрите питання, реєстр
        // `docs/plans/2026-08-05-open-questions-register.md`).
        // `add_to_linker_ASYNC`, НЕ `_sync` (перша спроба цієї хвилі впала
        // саме на цьому): `add_to_linker_sync` усередині сам блокує потік
        // через власний тимчасовий `tokio`-рантайм при КОЖНОМУ реальному
        // WASI-виклику (не при лінкуванні) — конфліктує з `self.runtime.
        // block_on` ЦЬОГО хоста, коли Store вже async (`wasm_component_model_async`
        // вище) і виконується всередині ВЖЕ активного block_on. Емпірично
        // зловлено `tests/fs_read_preopen_root.rs`: `describe()` (без I/O)
        // проходив і з `_sync`, а реальний `std::fs::read_to_string` гостя
        // (справжній WASI filesystem-виклик) падав `"Cannot start a runtime
        // from within a runtime"`. `add_to_linker_async` інтегрується з ЦИМ
        // самим `block_on`, а не заводить свій — конфлікту нема.
        wasmtime_wasi::p2::add_to_linker_async(&mut linker)
            .map_err(|err| PluginHostError::Instantiate(err.into()))?;
        wasmtime_wasi::p3::add_to_linker(&mut linker)
            .map_err(|err| PluginHostError::Instantiate(err.into()))?;
        wit::Plugin::add_to_linker_imports::<_, HasSelf<_>>(&mut linker, |state| state)
            .map_err(|err| PluginHostError::Instantiate(err.into()))?;

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|err| PluginHostError::Instantiate(anyhow::Error::new(err)))?;

        Ok(Self {
            engine,
            base_linker: linker,
            tool_resolver: Arc::new(tool_resolver),
            runtime: Arc::new(runtime),
        })
    }

    /// Будує лінкер під конкретний компонент — клон [`Self::base_linker`]
    /// (ядро вже прилінковане), розширений `add_to_linker_imports` кожного
    /// світу з `declared_worlds` (спека §9, п.3: «зібрати лінкер: ядро + по
    /// одному модулю на кожен оголошений світ»).
    ///
    /// Гучно повертає [`PluginHostError::UnknownWorld`] на першому
    /// нерозпізнаному світі — делегує `crate::world_linker`
    /// (доккомент модуля пояснює, чому реєстр сьогодні порожній і чому це
    /// коректний стан, а не недогляд).
    fn linker_for_worlds(
        &self,
        declared_worlds: &[String],
    ) -> Result<Linker<HostState>, PluginHostError> {
        let mut linker = self.base_linker.clone();
        world_linker::extend_linker_for_worlds(&mut linker, declared_worlds)?;
        Ok(linker)
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
        self.load_impl(path, expected_world_version, None, &[])
    }

    /// Те саме, що [`Self::load`], але з ЯВНИМ переліком світів
    /// повноважень/поверхонь, які оголосив компонент (спека
    /// `docs/specs/2026-08-31-plugin-contract-v5.md` §9) — параметром, НЕ
    /// прочитаним із маніфеста тут: побудова лінкера навмисно не знає,
    /// звідки взявся перелік (доккомент `crate::world_linker` і преамбула
    /// задачі steps 3). Інтеграція з полем `manifest.worlds` (спека §8) —
    /// окремий тривіальний крок після мержу паралельних хвиль 1/2: виклик
    /// на кшталт `host.load_for_worlds(path, version, &manifest.worlds)`.
    ///
    /// Порожній `declared_worlds` — поведінка, тотожна [`Self::load`]
    /// (ядро й лише ядро) — саме так завантажуються всі шість гостей
    /// сьогодні, до міграції на `5.0.0` (спека §10).
    pub fn load_for_worlds(
        &self,
        path: &Path,
        expected_world_version: &str,
        declared_worlds: &[String],
    ) -> Result<LoadedPlugin, PluginHostError> {
        self.load_impl(path, expected_world_version, None, declared_worlds)
    }

    /// Те саме, що [`Self::load`], але з ЯВНИМ коренем, від якого
    /// резолвляться `capabilities.fs_read`-preopens (§2.95 реєстру
    /// відкритих питань).
    ///
    /// # Навіщо окремий вхід, а не `current_dir()`
    ///
    /// До цієї правки preopens резолвились від `std::env::current_dir()`
    /// ХОСТ-ПРОЦЕСУ, тоді як корінь дерева, що лінтується, приходить окремим
    /// параметром (`cwd` у `run_wasm_concern`/`run_wasm_concern_fix`
    /// `crates/rules-napi`). Для `lint --path <інше-дерево>` ці два корені
    /// розходяться, і гість читав би не те дерево — мовчки, бо назви
    /// файлів у чужому дереві ті самі. Чинних споживачів `fs_read` немає
    /// (усі маніфести лишають його порожнім), тож дефект був латентним:
    /// його треба було зняти ДО першого споживача, інакше він проявився б
    /// як тиха підміна кореня.
    ///
    /// `root` МУСИТЬ бути абсолютним ([`PluginHostError::RelativePreopenRoot`]):
    /// відносний дорезолвився б `Path::join`-ом від cwd процесу — тобто
    /// повернув би рівно ту саму ваду з іншого боку.
    pub fn load_in_root(
        &self,
        path: &Path,
        expected_world_version: &str,
        root: &Path,
    ) -> Result<LoadedPlugin, PluginHostError> {
        if !root.is_absolute() {
            return Err(PluginHostError::RelativePreopenRoot {
                root: root.to_path_buf(),
            });
        }
        self.load_impl(path, expected_world_version, Some(root), &[])
    }

    /// Те саме, що [`Self::load_in_root`], але з переліком світів — див.
    /// доккомент [`Self::load_for_worlds`] (той самий параметр, той самий
    /// мотив «не читає маніфест тут»).
    pub fn load_in_root_for_worlds(
        &self,
        path: &Path,
        expected_world_version: &str,
        root: &Path,
        declared_worlds: &[String],
    ) -> Result<LoadedPlugin, PluginHostError> {
        if !root.is_absolute() {
            return Err(PluginHostError::RelativePreopenRoot {
                root: root.to_path_buf(),
            });
        }
        self.load_impl(path, expected_world_version, Some(root), declared_worlds)
    }

    /// Спільне тіло [`Self::load`]/[`Self::load_in_root`] — `preopen_root:
    /// None` означає «корінь не заявлений»: preopens НЕ відкриваються
    /// взагалі (жодного мовчазного fallback-у на cwd процесу), а плагін із
    /// непорожнім `fs_read` лишається придатним лише до `describe()` —
    /// перший же `detect`/`fix` падає
    /// [`PluginHostError::FsReadRootUnbound`] (доккомент
    /// `LoadedPlugin::ensure_fs_read_bound`).
    fn load_impl(
        &self,
        path: &Path,
        expected_world_version: &str,
        preopen_root: Option<&Path>,
        declared_worlds: &[String],
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

        // Лінкер під ЦЕЙ компонент — раз на `load_impl`, спека §9: обидві
        // фази нижче (probe і реальна) інстанціюють проти того самого
        // набору оголошених світів, тож той самий лінкер годиться для обох
        // (доккомент `Self::linker_for_worlds`).
        let linker = self.linker_for_worlds(declared_worlds)?;

        // Probe — завжди `Capabilities::default()` (порожній `fs_read`), тож
        // корінь preopen-ів цій фазі не потрібен: `None`.
        let probe_manifest =
            self.describe_with_capabilities(&component, &Capabilities::default(), None, &linker)?;
        check_world_version(&probe_manifest.world_version, expected_world_version)?;
        // Маніфест — недовірений вхід рівно так само, як fix-план
        // (`LoadedPlugin::fix` → `validators::fix`). Мажор `4.0.0` (§2.84)
        // додав другий список контрибуцій, і WIT типізацією НЕ може
        // заборонити плагіну назвати один ключ в обох — стан, у якому
        // плагін заявляє два взаємно виключних наміри. Хост не вгадує:
        // плагін не завантажується взагалі (доккомент
        // `validators::manifest`).
        rules_contract::validators::manifest::validate_manifest(&probe_manifest).map_err(
            |errors| {
                PluginHostError::InvalidContractData(format!(
                    "маніфест плагіна порушує контракт: {}",
                    errors.join("; ")
                ))
            },
        )?;

        // Реальна фаза викликає `describe()` ЗНОВУ на реальному `Store`
        // (той самий guest-виклик, ідемпотентний за контрактом — WIT
        // `describe` не бере аргументів і не має side-effects) — так
        // `LoadedPlugin::describe()` кешує маніфест саме з того інстансу,
        // що й лишається живим для `detect`/`fix`, і лог-капчур цього
        // `Store` реально містить запис про перший виклик (доккомент
        // `Self::load` вище: «перший виклик хоста після завантаження
        // компонента»), а не запис у відкинутому probe-`Store`.
        let host_state = self.build_host_state(&probe_manifest.capabilities, preopen_root)?;
        let mut store = Store::new(&self.engine, host_state);
        let (plugin, manifest) = self.runtime.block_on(async {
            let instance = linker
                .instantiate_async(&mut store, &component)
                .await
                .map_err(|err| PluginHostError::Instantiate(err.into()))?;
            let plugin = wit::Plugin::new(&mut store, &instance)
                .map_err(|err| PluginHostError::Instantiate(err.into()))?;
            let manifest =
                plugin
                    .call_describe(&mut store)
                    .await
                    .map_err(|err| PluginHostError::Execution {
                        function: "describe",
                        source: err.into(),
                    })?;
            Ok::<_, PluginHostError>((plugin, manifest))
        })?;
        let manifest = convert::manifest_from_wit(manifest);

        Ok(LoadedPlugin::new(
            store,
            plugin,
            manifest,
            preopen_root.map(Path::to_path_buf),
            Arc::clone(&self.runtime),
        ))
    }

    /// Фаза 1 інстанціації — див. доккомент [`Self::load`]: інстанціює
    /// компонент у тимчасовий `Store` з переданими `capabilities` (probe —
    /// `Capabilities::default()`, без preopens/мережі) і повертає
    /// `describe()`; `Store`/`Instance` цієї фази відкидаються.
    fn describe_with_capabilities(
        &self,
        component: &Component,
        capabilities: &Capabilities,
        preopen_root: Option<&Path>,
        linker: &Linker<HostState>,
    ) -> Result<Manifest, PluginHostError> {
        let host_state = self.build_host_state(capabilities, preopen_root)?;
        let mut store = Store::new(&self.engine, host_state);
        let manifest = self.runtime.block_on(async {
            let instance = linker
                .instantiate_async(&mut store, component)
                .await
                .map_err(|err| PluginHostError::Instantiate(err.into()))?;
            let plugin = wit::Plugin::new(&mut store, &instance)
                .map_err(|err| PluginHostError::Instantiate(err.into()))?;
            plugin
                .call_describe(&mut store)
                .await
                .map_err(|err| PluginHostError::Execution {
                    function: "describe",
                    source: err.into(),
                })
        })?;
        Ok(convert::manifest_from_wit(manifest))
    }

    /// Будує `HostState` (WASI-контекст + наш host-стан) за
    /// `capabilities`: `fs_read`-шляхи — read-only preopens, резолвлені
    /// відносно `preopen_root` — КОРЕНЯ ДЕРЕВА, ЩО ЛІНТУЄТЬСЯ (та сама
    /// конвенція, що й `SourceFile::path` — «posix-relative шлях від
    /// `cwd`-параметра виклику»), а НЕ від `std::env::current_dir()`
    /// хост-процесу (§2.95, доккомент [`Self::load_in_root`]). Глоб-патерни
    /// в `fs_read` НЕ розкриваються тут (v3.0-обмеження, задокументовано —
    /// типовий концерн лишає `fs_read` порожнім, вміст файлів хост передає
    /// inline у `DetectBatch`/`FixRequest`; глоб-резолвинг — кандидат на
    /// майбутню оркестрацію, фаза 7).
    ///
    /// `preopen_root: None` (завантаження без кореня — [`Self::load`]) НЕ
    /// відкриває жодного preopen-у навіть за непорожнього `fs_read`:
    /// мовчазний fallback на cwd процесу і був вадою. Гучність цього стану
    /// забезпечує `LoadedPlugin` на першому ж `detect`/`fix`.
    fn build_host_state(
        &self,
        capabilities: &Capabilities,
        preopen_root: Option<&Path>,
    ) -> Result<HostState, PluginHostError> {
        let mut builder = WasiCtxBuilder::new();
        for rel in preopen_root
            .into_iter()
            .flat_map(|_| capabilities.fs_read.iter())
        {
            let host_path = preopen_root
                .expect("гілка ітерується лише коли корінь заявлений")
                .join(rel);
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
            // Абсолютний корінь для `n-rules:caps/file-reader@1.0.0`
            // (крок 4.1 спеки §12.1) — той самий `preopen_root`, що
            // `LoadedPlugin` собі памʼятає нижче (`load_impl`), незалежно
            // від `capabilities.fs_read` (доккомент поля `HostState::fs_read_root`).
            fs_read_root: preopen_root.map(Path::to_path_buf),
        })
    }
}

/// Major-компонента world-версії (`"4.0.0"` → `"4"`) — semver-крейт тут
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
