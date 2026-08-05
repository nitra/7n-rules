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
/// `3.1.0` — зріз 5 контракту v3.1 (`import exec-tool` + slot
/// `scratch-dir@1`, рішення Ж спеки
/// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`). Negotiation
/// лишається MAJOR-only (`PluginHost::load` → `check_world_version`), тож
/// v3.0-плагін, який заявляє `"3.0.0"`, приймається цим хостом без змін —
/// саме це й робить мінор additive-сумісним на рівні негоціації, а не лише
/// на рівні лінкування імпортів.
pub const PLUGIN_WORLD_VERSION: &str = "3.1.0";

/// Версія пакета `n-rules:slots` (`wit/deps/slots/ci-artifact.wit`) —
/// незалежний цикл версіонування від `PLUGIN_WORLD_VERSION` (рішення Л:
/// еволюція слоту не тягне bump world).
pub const SLOTS_PACKAGE_VERSION: &str = "1.0.0";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_world_version_is_three_one_zero() {
        assert_eq!(PLUGIN_WORLD_VERSION, "3.1.0");
    }

    #[test]
    fn slots_package_version_is_one_zero_zero() {
        assert_eq!(SLOTS_PACKAGE_VERSION, "1.0.0");
    }
}
