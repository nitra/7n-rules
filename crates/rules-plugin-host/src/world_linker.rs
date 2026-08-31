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

use wasmtime::component::Linker;

use crate::error::PluginHostError;
use crate::host_state::HostState;

/// Функція одного зареєстрованого світу — обгортка над згенерованою
/// `<World>::add_to_linker_imports::<_, HasSelf<_>>`, звужена до сигнатури,
/// яку можна зберегти в статичному масиві (generic-параметри
/// `add_to_linker_imports` не дозволяють зберігати саму функцію напряму —
/// обгортка фіксує їх один раз при реєстрації).
type LinkFn = fn(&mut Linker<HostState>) -> Result<(), PluginHostError>;

/// Реєстр відомих світів повноважень/поверхонь: WIT-ідентифікатор світу →
/// функція, що долінковує його імпорти. Порожній до злиття хвилі 1
/// (доккомент модуля вище) — кожен новий світ додає РІВНО один рядок.
///
/// Ядровий світ `n-rules:plugin` тут навмисно ВІДСУТНІЙ — спека §8 прямо
/// каже «ядровий світ `n-rules:plugin` не перелічується — його реалізують
/// усі», і [`PluginHost::base_linker`](crate::host::PluginHost) вже несе
/// його імпорти безумовно, до будь-якого запиту цього реєстру.
const KNOWN_CAPABILITY_WORLDS: &[(&str, LinkFn)] = &[];

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
        let engine = wasmtime::Engine::new(
            wasmtime::Config::new().wasm_component_model(true),
        )
        .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        extend_linker_for_worlds(&mut linker, &[]).expect("порожній вхід не мав відмовити");
    }

    /// Будь-який непорожній рядок сьогодні невідомий (реєстр порожній до
    /// хвилі 1) — [`PluginHostError::UnknownWorld`], а не тиха відмова чи
    /// паніка.
    #[test]
    fn unknown_world_is_rejected_loudly() {
        let engine = wasmtime::Engine::new(
            wasmtime::Config::new().wasm_component_model(true),
        )
        .expect("Engine::new");
        let mut linker = Linker::<HostState>::new(&engine);
        let err = extend_linker_for_worlds(
            &mut linker,
            &["n-rules:caps/tool-runner@1.0.0".to_string()],
        )
        .expect_err("невідомий світ мав відхилитись");
        match err {
            PluginHostError::UnknownWorld { world } => {
                assert_eq!(world, "n-rules:caps/tool-runner@1.0.0");
            }
            other => panic!("очікував UnknownWorld, отримав {other:?}"),
        }
    }
}
