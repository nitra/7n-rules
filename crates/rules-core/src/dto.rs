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
///
/// `2` — нова поверхня [`crate::diagnostics`] (`Violation`/`Severity`) додана
/// у фазі 5 задачі E1 (`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`):
/// перше JSON-DTO, що серіалізується в напрямку `rules-core` → JS (на відміну
/// від попередніх сигнатур фази 1/3/4а, де через межу йшли лише прості типи —
/// `String`/`Option<String>`/`Vec<String>`/`bool`), тож інкремент з `1`.
pub const CONTRACT_VERSION: u32 = 2;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_version_is_two() {
        // Фаза 5 задача E1: diagnostics DTO (`Violation`/`Severity`) додана —
        // перша несумісна зміна форми контракту після плейсхолдера T1 (`1`).
        assert_eq!(CONTRACT_VERSION, 2);
    }
}
