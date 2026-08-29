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
pub const PLUGIN_WORLD_VERSION: &str = "4.0.0";

/// Версія пакета `n-rules:slots` (`wit/deps/slots/ci-artifact.wit`) —
/// незалежний цикл версіонування від `PLUGIN_WORLD_VERSION` (рішення Л:
/// еволюція слоту не тягне bump world).
pub const SLOTS_PACKAGE_VERSION: &str = "1.0.0";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_world_version_is_four_zero_zero() {
        assert_eq!(PLUGIN_WORLD_VERSION, "4.0.0");
    }

    #[test]
    fn slots_package_version_is_one_zero_zero() {
        assert_eq!(SLOTS_PACKAGE_VERSION, "1.0.0");
    }
}
