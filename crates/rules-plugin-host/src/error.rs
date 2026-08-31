//! Типізовані помилки `rules-plugin-host` (рішення М спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.6):
//! вузький публічний trait — жодна wasmtime-специфічна помилка не перетинає
//! межу крейта, усе загорнуто тут у людиночитні варіанти.

use std::path::PathBuf;

/// Помилка `rules-plugin-host` — публічний тип, єдиний спосіб дізнатись про
/// збій завантаження/виконання плагіна поза цим крейтом.
#[derive(Debug, thiserror::Error)]
pub enum PluginHostError {
    /// Не вдалось прочитати/скомпілювати `.wasm` (I/O або wasm-валідація
    /// Component Model).
    #[error("не вдалось завантажити wasm-компонент {path}: {source}")]
    Load {
        path: PathBuf,
        #[source]
        source: anyhow::Error,
    },

    /// WASI preopen для одного з `capabilities.fs_read`-шляхів маніфеста не
    /// вдався (шлях відсутній чи недоступний на хості).
    #[error("preopen fs-read шляху `{path}` не вдався: {source}")]
    Preopen {
        path: PathBuf,
        #[source]
        source: anyhow::Error,
    },

    /// Плагін заявляє world-версію, несумісну (за major-компонентою) з
    /// очікуваною — skip-not-crash семантика (рішення З спеки): оркестрація
    /// ловить цей варіант і пропускає плагін, не валить прогін.
    #[error(
        "плагін заявляє world-версію `{found}` — несумісна за major з очікуваною `{expected}` (skip-not-crash)"
    )]
    IncompatibleVersion { found: String, expected: String },

    /// Інстанціація компонента (лінкінг, WASI-хук, host-функції) не
    /// вдалась.
    #[error("інстанціація wasm-компонента не вдалась: {0}")]
    Instantiate(#[source] anyhow::Error),

    /// Виконання guest-функції завершилось помилкою (trap чи інша
    /// wasmtime-помилка виклику).
    #[error("виконання guest-функції `{function}` завершилось помилкою: {source}")]
    Execution {
        function: &'static str,
        #[source]
        source: anyhow::Error,
    },

    /// Корінь, від якого резолвляться `capabilities.fs_read`-preopens, —
    /// відносний шлях. Відносний корінь дорезолвився б від
    /// `std::env::current_dir()` ХОСТ-ПРОЦЕСУ, тобто рівно та підміна
    /// дерева, яку [`crate::PluginHost::load_in_root`] і закриває (§2.95
    /// реєстру відкритих питань): для `lint --path <інше-дерево>` гість
    /// читав би не те дерево, що лінтується. Тому — типізована відмова, а
    /// не «якось зарезолвимо».
    #[error(
        "корінь preopen-ів `{root}` має бути АБСОЛЮТНИМ: відносний резолвився б від cwd \
         хост-процесу, а не від кореня дерева, що лінтується"
    )]
    RelativePreopenRoot { root: PathBuf },

    /// Плагін заявив непорожній `capabilities.fs_read`, але завантажений
    /// БЕЗ кореня ([`crate::PluginHost::load`], не `load_in_root`) — жодного
    /// preopen не відкрито. Виклик гостя в такому стані означав би, що гість
    /// мовчки не бачить нічого зі заявленого; замість тихої деградації —
    /// типізована помилка в точці шкоди (`detect`/`fix`), тоді як
    /// `describe()` на такому плагіні лишається робочим.
    #[error(
        "плагін `{plugin_id}` заявляє capabilities.fs-read {paths:?}, але завантажений без \
         кореня preopen-ів — виклик `{function}` дав би гостю порожню пісочницю; \
         вантажте його через `PluginHost::load_in_root(.., <корінь дерева>)`"
    )]
    FsReadRootUnbound {
        plugin_id: String,
        paths: Vec<String>,
        function: &'static str,
    },

    /// Guest повернув дані, які не конвертуються в DTO контракту (напр.
    /// невалідний JSON у `diagnostic.data`).
    #[error("плагін повернув дані, несумісні з контрактом: {0}")]
    InvalidContractData(String),

    /// Компонент оголосив (параметром виклику `PluginHost::load_for_worlds`
    /// — спека `docs/specs/2026-08-31-plugin-contract-v5.md` §9, п.3) світ
    /// повноважень/поверхні, якого хост не знає — рядок відсутній у
    /// реєстрі відомих світів `crate::world_linker`. Гучна відмова, не
    /// мовчазний пропуск: невідомий світ означає або
    /// друкарську помилку в оголошенні, або те, що хост відстав від
    /// пакетів `caps`/`surfaces` — жодного зі сценаріїв не можна тихо
    /// проігнорувати.
    #[error(
        "плагін оголосив невідомий світ `{world}` — цей хост не має зареєстрованого лінкера \
         для нього (перевір версію хоста й пакети n-rules:caps/n-rules:surfaces)"
    )]
    UnknownWorld { world: String },

    /// Виклик функції слотової поверхні (напр. `collect-coverage`,
    /// `n-rules:surfaces/coverage-provider@1.0.0`) на плагіні, що НЕ
    /// оголосив цей world у `manifest.worlds` — типізована відмова, не
    /// порожній звіт (правило проєкту «мовчазний пропуск — вада», крок 6
    /// спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12: «гість, що
    /// не вміє зібрати покриття, має віддати типізовану помилку, а не
    /// порожній звіт: порожній звіт не відрізнити від "покриття нульове"»).
    /// Відрізняється від [`Self::UnknownWorld`]: там хост не знає РЯДКА
    /// world-а взагалі, тут хост world знає, але ЦЕЙ плагін його не
    /// заявив — виклик відповідного акцесора (`LoadedPlugin::collect_coverage`)
    /// просто не має чого викликати (`Option::None`, доккомент поля
    /// `LoadedPlugin::coverage_provider`).
    #[error(
        "плагін `{plugin_id}` не оголосив world `{world}` у manifest.worlds — виклик `{function}` \
         неможливий (плагін не реалізує цю слотову поверхню)"
    )]
    SurfaceNotDeclared {
        plugin_id: String,
        world: &'static str,
        function: &'static str,
    },
}
