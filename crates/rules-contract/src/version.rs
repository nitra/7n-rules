//! Константи версії WIT-пакетів контракту (`wit/`) — рішення З спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`: версія
//! контракту = версія WIT world, продовження `CONTRACT_VERSION` diagnostics
//! DTO (`crates/rules-core/src/dto.rs`, `2`). Числові простори різні:
//! `CONTRACT_VERSION` — плоский `u32` JSON-DTO-контракту `rules-core` ⇄
//! `rules-napi`; тут — semver-рядок world/пакета, negotiation якого (рішення
//! З: skip-not-crash, як `requiresPluginApi` у v2) звіряється по
//! major-компоненті.

/// Версія world `n-rules:plugin` (`wit/world.wit`) — те, що плагін заявляє
/// у `manifest.world-version` при `describe()`.
///
/// `4.0.0` — МАЖОР (§2.84 реєстру відкритих питань
/// `docs/plans/2026-08-05-open-questions-register.md`): три зміни ФОРМИ
/// типів межі гість↔хост (`write-bytes` у `variant file-edit`, `fix-glob` у
/// `record concern-contribution`, `fix-only-concerns` у `record manifest`).
/// Component Model не має width-subtyping — §2.83 виміряла, що кожна з них
/// поодинці ламає інстанціацію вже пінованого гостя (доккомент
/// `wit/world.wit`, версійний блок `4.0.0`), тож усі три поїхали одним
/// бампом.
///
/// Negotiation лишається MAJOR-only (`PluginHost::load` →
/// `check_world_version`) — і саме тому цей бамп ламає ВСІХ гостей
/// одномоментно: плагін, що заявляє будь-яку `3.x`, цим хостом більше НЕ
/// приймається. Це не деградація, а «плагін не вантажиться»: проміжного
/// стану «хост `4.0.0`, гість `3.2.0`» бути не може навіть на один коміт
/// (усі шість first-party гостей + фікстури + шаблон скіла переведені тією
/// самою задачею).
///
/// До `4.0.0` тут стояло `"3.1.0"`, тоді як WIT-пакет уже був `3.2.0` —
/// дрейф без наслідків (negotiation major-only, `3` == `3`), але саме
/// такий, що ховає версію контракту від людини. Гейт
/// `plugin_world_version_matches_wit_package` (`tests/wit_parity.rs`)
/// тепер тримає цю константу й `package n-rules:plugin@…` синхронними
/// механічно.
///
/// `5.0.0` — МАЖОР (спека `docs/specs/2026-08-31-plugin-contract-v5.md`
/// §8/§11, §2.109 реєстру відкритих питань): нове поле
/// `worlds: list<string>` у `record manifest` — та сама структурна причина
/// (`expected record of N fields, found N-1 fields`), доккомент
/// `wit/world.wit`, версійний блок `5.0.0`. На відміну від `4.0.0`, цей
/// бамп СВІДОМО не несе одразу всіх пунктів, які спека §11 перелічує для
/// мажора `5.0.0` (винесення `run-tool`/`exec-tool` у `caps:tool-runner`,
/// `ecosystem-outdated`/`docgen-render` у слотові світи): вони належать
/// окремим паралельним крокам реалізації (спека §12, кроки 3–4) і не
/// заходять в область цього коміту — доккомент `wit/world.wit`, версійний
/// блок `5.0.0`, пояснює, чому проміжний стан «major уже піднятий, форма
/// ще не вся змінена» тут безпечний (жодного зовнішнього консюмента ще
/// немає, пре-реліз-режим із самого початку файлу).
///
/// Шість first-party гостей до реальної міграції (спека §10, крок 4 §12)
/// несуть `worlds = []` як тимчасову декларацію (доккомент `wit/world.wit`,
/// версійний блок `5.0.0`) — до неї плагіни все одно НЕ інстанціюються цим
/// хостом (`check_world_version` major-only), тож порожній список нічого
/// не приховує: він лише документує «повноважень понад ядро не заявлено»,
/// а не «плагін уже мігрований».
pub const PLUGIN_WORLD_VERSION: &str = "5.0.0";

/// Версія пакета `n-rules:slots` (`wit/deps/slots/ci-artifact.wit`) —
/// незалежний цикл версіонування від `PLUGIN_WORLD_VERSION` (рішення Л:
/// еволюція слоту не тягне bump world).
pub const SLOTS_PACKAGE_VERSION: &str = "1.0.0";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_world_version_is_five_zero_zero() {
        assert_eq!(PLUGIN_WORLD_VERSION, "5.0.0");
    }

    #[test]
    fn slots_package_version_is_one_zero_zero() {
        assert_eq!(SLOTS_PACKAGE_VERSION, "1.0.0");
    }
}
