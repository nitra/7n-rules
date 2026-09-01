//! Реєстр повноважень/поверхневих світів (спека
//! `docs/specs/2026-08-31-plugin-contract-v5.md` §9) і механізм
//! **вибіркового** лінкування Component Model wasmtime під них.
//!
//! # Технічна передумова — доведена експериментом, не припущенням
//!
//! Спека §9 спирається на факт: `wasmtime::component::bindgen!` можна
//! викликати кілька разів у одному крейті для РІЗНИХ `world` (кожен виклик
//! породжує незалежний модуль зі своїм `Host`-трейтом і своєю
//! `add_to_linker_imports`), і отримані `add_to_linker_imports` можна
//! викликати вибірково на СПІЛЬНИЙ `Linker<T>` — без потреби перебудовувати
//! `Engine` чи компонент.
//!
//! Це перевірено поза цим деревом (`wasm32-wasip2`-гості, зібрані
//! `wit-bindgen`, і `wasmtime::component::Linker::instantiate` проти них)
//! перед тим, як писати цей модуль:
//!
//! - `Linker`, що має лише імпорти світу A, **гучно** валить інстанціацію
//!   гостя, що реально імпортує щось зі світу B — повідомлення wasmtime
//!   називає САМЕ відсутній імпорт (`component imports function
//!   "cap-a-fn", but a matching implementation was not found in the
//!   linker`), не тихий no-op;
//! - той самий `Linker`, розширений `add_to_linker_imports` світу B (через
//!   `Linker::clone()` — `Linker<T: 'static>` реалізує `Clone`), інстанціює
//!   того самого гостя без перезбирання компонента;
//!   `Linker`, що має ЗАЙВІ (не запитані гостем) імпорти, інстанціює гостя,
//!   якому вони не потрібні, — зайва реєстрація в лінкері не шкодить.
//!
//! Тобто дизайн §9 технічно спроможний: «ядро + по одному модулю на кожен
//! оголошений світ» — буквально `add_to_linker_imports` кожного
//! зареєстрованого тут світу, застосована до клону базового `Linker`
//! (`PluginHost::base_linker`, `src/host.rs`).
//!
//! # Чому реєстр порожній
//!
//! Пакети `n-rules:caps`/`n-rules:surfaces` (хвиля 1 цієї паралельної
//! роботи, `wit/deps/caps/`, `wit/deps/surfaces/`) ще не злиті в це дерево
//! — цей крок (крок 3) навмисно НЕ читає манфест і НЕ знає конкретних імен
//! світів (преамбула задачі: «твоя функція не читає маніфест… приймає
//! перелік світів як вхід»). Тому [`KNOWN_CAPABILITY_WORLDS`] сьогодні
//! порожній — **це коректний стан, не недогляд**: жодного відомого світу
//! повноважень ще нема, тож БУДЬ-ЯКИЙ непорожній `worlds`-вхід гучно
//! відхиляється як невідомий (`PluginHostError::UnknownWorld`) — рівно
//! поведінка, яку вимагає п.3 послідовності спеки §9 «відхилити гучно
//! невідомий світ».
//!
//! Коли хвиля 1 зіллється, підключення нового світу — це:
//! 1. `wasmtime::component::bindgen!` на нього (окремий приватний модуль,
//!    той самий прийом, що [`crate::wit`]);
//!    guest, чий тип реально не потребує цього світу — інстанціюється
//!    так само, як і сьогодні (доведено вище: зайві імпорти в лінкері не
//!    шкодять).
//! 2. один запис у [`KNOWN_CAPABILITY_WORLDS`]: WIT-ідентифікатор світу
//!    (`namespace:package/world@version`, формат маніфесту §8) + функція
//!    `add_to_linker_imports` цього світу.
//!
//! Жодної іншої правки цього модуля чи `PluginHost` не потрібно — реєстр
//! росте адитивно, як і самі пакети `caps`/`surfaces` (спека §3: «Три
//! родини, три цикли версіонування»).

use wasmtime::component::{HasSelf, Linker};

use crate::caps_file_reader::FileReader;
use crate::caps_llm_consumer::LlmConsumer;
use crate::caps_registry_reader::RegistryReader;
use crate::error::PluginHostError;
use crate::host_state::HostState;

/// Функція одного зареєстрованого світу — обгортка над згенерованою
/// `<World>::add_to_linker_imports::<_, HasSelf<_>>`, звужена до сигнатури,
/// яку можна зберегти в статичному масиві (generic-параметри
/// `add_to_linker_imports` не дозволяють зберігати саму функцію напряму —
/// обгортка фіксує їх один раз при реєстрації).
type LinkFn = fn(&mut Linker<HostState>) -> Result<(), PluginHostError>;

/// Обгортка `FileReader::add_to_linker_imports::<_, HasSelf<_>>` (крок 4.1
/// спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1, п.2) — той
/// самий прийом, що [`crate::host::PluginHost::new`] лінкує ядровий
/// `wit::Plugin`: `HasSelf<_>` каже bindgen-у, що `Host`-трейт реалізує сам
/// `HostState` (не окремий підресурс), `|state| state` — проекція
/// `&mut HostState` із даних `Store`.
fn link_file_reader(linker: &mut Linker<HostState>) -> Result<(), PluginHostError> {
    FileReader::add_to_linker_imports::<_, HasSelf<_>>(linker, |state| state)
        .map_err(|err| PluginHostError::Instantiate(err.into()))
}

/// Обгортка `LlmConsumer::add_to_linker_imports::<_, HasSelf<_>>` (крок 4.1
/// спеки, застосований ДРУГИЙ раз, `crate::caps_llm_consumer`) — той самий
/// прийом, що [`link_file_reader`] вище.
fn link_llm_consumer(linker: &mut Linker<HostState>) -> Result<(), PluginHostError> {
    LlmConsumer::add_to_linker_imports::<_, HasSelf<_>>(linker, |state| state)
        .map_err(|err| PluginHostError::Instantiate(err.into()))
}

/// Обгортка `RegistryReader::add_to_linker_imports::<_, HasSelf<_>>` (S1
/// карти `docs/specs/2026-08-30-contract-roadmap-blocked-concerns.md`,
/// `crate::caps_registry_reader`) — той самий прийом, що
/// [`link_file_reader`]/[`link_llm_consumer`].
fn link_registry_reader(linker: &mut Linker<HostState>) -> Result<(), PluginHostError> {
    RegistryReader::add_to_linker_imports::<_, HasSelf<_>>(linker, |state| state)
        .map_err(|err| PluginHostError::Instantiate(err.into()))
}

/// Реєстрація `n-rules:surfaces/coverage-provider@1.0.0` (крок 6 спеки
/// §12, «перша слотова поверхня») — НАВМИСНИЙ no-op, на відміну від
/// [`link_file_reader`] вище: `coverage-provider` world не має ЖОДНОГО
/// import-у (доккомент `crate::surfaces_coverage_provider` — це
/// ЕКСПОРТНИЙ world, хост КЛИЧЕ `collect-coverage`, а не РЕАЛІЗУЄ якийсь
/// його імпорт), тож нічого долінковувати. Запис усе одно потрібен: без
/// нього [`extend_linker_for_worlds`] гучно відхилив би рядок як
/// [`PluginHostError::UnknownWorld`] для БУДЬ-ЯКОГО гостя, що заявив цей
/// world у `manifest.worlds` (`plugin-lang-rust`, крок 6) — реєстр цього
/// файлу відповідає на питання «хост ЗНАЄ цей world» незалежно від того,
/// чи є для нього що лінкувати.
fn link_coverage_provider(_linker: &mut Linker<HostState>) -> Result<(), PluginHostError> {
    Ok(())
}

/// Реєстр відомих світів повноважень/поверхонь: WIT-ідентифікатор світу →
/// функція, що долінковує його імпорти. Перший непорожній запис —
/// `n-rules:caps/file-reader@1.0.0` (крок 4.1 спеки §12.1, перший
/// реалізований world за трьома причинами, названими там: найбільше
/// доведених споживачів, семантика вже перевикористана з
/// `rules_core::concerns::cursor_ignore`/`rules-napi::build_full_scope_files`,
/// без нових зовнішніх залежностей) — кожен наступний world додає РІВНО
/// один рядок.
///
/// Ядровий світ `n-rules:plugin` тут навмисно ВІДСУТНІЙ — спека §8 прямо
/// каже «ядровий світ `n-rules:plugin` не перелічується — його реалізують
/// усі», і [`PluginHost::base_linker`](crate::host::PluginHost) вже несе
/// його імпорти безумовно, до будь-якого запиту цього реєстру.
/// WIT-ідентифікатор world-а `coverage-provider` (крок 6 спеки §12) —
/// `pub(crate)`, а не приватний рядковий літерал усередині цього масиву:
/// `crate::host`/`crate::loaded_plugin` звіряють `declared_worlds` проти
/// РІВНО цього рядка (доккомент [`crate::loaded_plugin::LoadedPlugin::collect_coverage`]),
/// і дублювання його як окремого літерала в трьох місцях — той самий клас
/// дрейфу, від якого рятує єдина крапка правди.
pub(crate) const COVERAGE_PROVIDER_WORLD: &str = "n-rules:surfaces/coverage-provider@1.0.0";

const KNOWN_CAPABILITY_WORLDS: &[(&str, LinkFn)] = &[
    ("n-rules:caps/file-reader@1.0.0", link_file_reader as LinkFn),
    (COVERAGE_PROVIDER_WORLD, link_coverage_provider as LinkFn),
    // `n-rules:caps/llm-consumer@1.0.0` (крок 4.1, застосований ДРУГИЙ раз,
    // §2.124 реєстру відкритих питань): `llm-call` реалізує
    // `crate::caps_llm_consumer::RealLlmCaller` через `n7n-llm-lib`,
    // зафіксований на `Tier::Local` (доккомент модуля `caps_llm_consumer`,
    // «ціна виклику»).
    (
        "n-rules:caps/llm-consumer@1.0.0",
        link_llm_consumer as LinkFn,
    ),
    // `n-rules:caps/registry-reader@1.0.0` (S1 карти
    // `docs/specs/2026-08-30-contract-roadmap-blocked-concerns.md` §2.2/§2.3):
    // `active-domains`/`resolve-ci-artifacts` реалізує
    // `crate::caps_registry_reader::RegistryProvider`, ін'єктований через
    // `PluginHost::new_with_registry_provider` (дефолт `PluginHost::new` —
    // `NoRegistryProvider`, легітимний `None` на обидва запити).
    (
        "n-rules:caps/registry-reader@1.0.0",
        link_registry_reader as LinkFn,
    ),
];

/// Розширює `linker` (очікується клон `PluginHost::base_linker` — ядро вже
/// прилінковане) імпортами кожного світу з `declared_worlds`, звіряючи
/// кожен рядок проти [`KNOWN_CAPABILITY_WORLDS`].
///
/// **Гучно** повертає [`PluginHostError::UnknownWorld`] на ПЕРШОМУ
/// нерозпізнаному світі — не пропускає, не лінкує підмножину мовчки (правило
/// проєкту «мовчазний пропуск — вада» і буквально п.3 послідовності спеки
/// §9). Порядок обходу — порядок `declared_worlds`, тож помилка
/// детермінована для того самого входу.
pub(crate) fn extend_linker_for_worlds(
    linker: &mut Linker<HostState>,
    declared_worlds: &[String],
) -> Result<(), PluginHostError> {
    for world in declared_worlds {
        let (_, link_fn) = KNOWN_CAPABILITY_WORLDS
            .iter()
            .find(|(id, _)| id == world)
            .ok_or_else(|| PluginHostError::UnknownWorld {
                world: world.clone(),
            })?;
        link_fn(linker)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Порожній вхід — без відхилення, лінкер лишається таким, яким був
    /// (ядро). Це шлях, яким сьогодні йдуть усі шість гостей (жоден ще не
    /// декларує `worlds` — міграція крок 4, після цього кроку).
    #[test]
    fn empty_declared_worlds_is_noop() {
        let engine = wasmtime::Engine::new(wasmtime::Config::new().wasm_component_model(true))
            .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        extend_linker_for_worlds(&mut linker, &[]).expect("порожній вхід не мав відмовити");
    }

    /// Реєстрація `n-rules:caps/file-reader@1.0.0` (крок 4.1 спеки §12.1) —
    /// одинична, механічна перевірка п.2 («один запис у
    /// `KNOWN_CAPABILITY_WORLDS`»): рядок розпізнається, лінкер
    /// розширюється без помилки. Наскрізний доказ, що розширені імпорти
    /// РЕАЛЬНО задовольняють гостя, живе окремо
    /// (`tests/caps_file_reader_gate.rs`, критерій готовності кроку) — тут
    /// лише факт «реєстр більше не порожній для цього рядка».
    #[test]
    fn file_reader_world_is_known() {
        let engine = wasmtime::Engine::new(wasmtime::Config::new().wasm_component_model(true))
            .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        extend_linker_for_worlds(&mut linker, &["n-rules:caps/file-reader@1.0.0".to_string()])
            .expect("file-reader має бути відомим реєстру після цього кроку");
    }

    /// Реєстрація `n-rules:caps/llm-consumer@1.0.0` (крок 4.1, застосований
    /// ДРУГИЙ раз) — той самий одинична-механічна перевірка, що
    /// `file_reader_world_is_known`: рядок розпізнається, лінкер
    /// розширюється без помилки. Наскрізний доказ, що хост РЕАЛЬНО кличе
    /// `llm-call` через цей world, живе окремо
    /// (`tests/caps_llm_consumer_gate.rs`).
    #[test]
    fn llm_consumer_world_is_known() {
        let engine = wasmtime::Engine::new(wasmtime::Config::new().wasm_component_model(true))
            .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        extend_linker_for_worlds(
            &mut linker,
            &["n-rules:caps/llm-consumer@1.0.0".to_string()],
        )
        .expect("llm-consumer має бути відомим реєстру після цього кроку");
    }

    /// Реєстрація `n-rules:surfaces/coverage-provider@1.0.0` (крок 6 спеки
    /// §12) — той самий одинична-механічна перевірка, що
    /// `file_reader_world_is_known`: рядок розпізнається, лінкер (тут —
    /// без жодної зміни, доккомент [`link_coverage_provider`]) не падає.
    /// Наскрізний доказ, що хост РЕАЛЬНО кличе `collect-coverage` через
    /// цей world, живе окремо (`tests/surfaces_coverage_provider_gate.rs`).
    #[test]
    fn coverage_provider_world_is_known() {
        let engine = wasmtime::Engine::new(wasmtime::Config::new().wasm_component_model(true))
            .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        extend_linker_for_worlds(
            &mut linker,
            &["n-rules:surfaces/coverage-provider@1.0.0".to_string()],
        )
        .expect("coverage-provider має бути відомим реєстру після цього кроку");
    }

    /// Реєстрація `n-rules:caps/registry-reader@1.0.0` (S1 карти) — та сама
    /// одинична-механічна перевірка, що `file_reader_world_is_known`.
    /// Наскрізний доказ, що хост РЕАЛЬНО кличе `active-domains`/
    /// `resolve-ci-artifacts` через цей world, живе окремо
    /// (`tests/caps_registry_reader_gate.rs`).
    #[test]
    fn registry_reader_world_is_known() {
        let engine = wasmtime::Engine::new(wasmtime::Config::new().wasm_component_model(true))
            .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        extend_linker_for_worlds(
            &mut linker,
            &["n-rules:caps/registry-reader@1.0.0".to_string()],
        )
        .expect("registry-reader має бути відомим реєстру після цього кроку");
    }

    /// Будь-який непорожній рядок, відмінний від зареєстрованих, лишається
    /// невідомим — [`PluginHostError::UnknownWorld`], а не тиха відмова чи
    /// паніка. `tool-runner` навмисно НЕ реєструється цим кроком (спека
    /// §12.1: «файловий читач першим», винесення `tool-runner` — окрема
    /// задача §11 п.2).
    #[test]
    fn unknown_world_is_rejected_loudly() {
        let engine = wasmtime::Engine::new(wasmtime::Config::new().wasm_component_model(true))
            .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        let err =
            extend_linker_for_worlds(&mut linker, &["n-rules:caps/tool-runner@1.0.0".to_string()])
                .expect_err("невідомий світ мав відхилитись");
        match err {
            PluginHostError::UnknownWorld { world } => {
                assert_eq!(world, "n-rules:caps/tool-runner@1.0.0");
            }
            other => panic!("очікував UnknownWorld, отримав {other:?}"),
        }
    }
}
