//! Versioned JSON DTO-межа між `rules-core` і `rules-napi` (рішення Р10
//! спеки `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
//!
//! Усі структури, якими крейт обмінюється з JS-шаром через N-API, живуть
//! у цьому модулі й серіалізуються через `serde_json`. [`CONTRACT_VERSION`]
//! росте при будь-якій несумісній зміні форми DTO; JS-loader звіряє його при
//! завантаженні аддона (enforcement-точка за зразком `requiresPluginApi`) —
//! так парність JS ⇄ native не мовчки розходиться між релізами.

/// Поточна версія JSON DTO-контракту `rules-core` ⇄ `rules-napi`.
///
/// Інкрементувати при будь-якій несумісній зміні форми DTO (перейменування чи
/// видалення поля, зміна типу, зміна семантики) — сумісні додавання
/// (нове опційне поле) версію не зобов'язані рухати.
pub const CONTRACT_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_version_is_one() {
        // Плейсхолдер T1: перше значення контракту, поки DTO ще порожній
        // (перші реальні структури — задача T3, resolve_changed_base).
        assert_eq!(CONTRACT_VERSION, 1);
    }
}
