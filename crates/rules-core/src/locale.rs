//! cspell:ignore CLDR кодпойнтом
//!
//! Порт `String.prototype.localeCompare` (ICU root collation) для
//! детермінованого сортування, яким JS-бік упорядковує списки — id скілів
//! (`listSkillIds`, `npm/scripts/skills-cli.mjs`) і операції перейменування
//! (`collectRenameOps`, `npm/scripts/rename-yaml-extensions.mjs`).
//!
//! Причина існування модуля: байтовий `str::cmp` НЕ дає той самий порядок,
//! що `localeCompare`, а порядок тут — частина видимого виводу CLI, який
//! гейтиться byte-exact parity-тестами (фаза 8, рішення Ж мінідизайну
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`). Три системні
//! розбіжності байтового порядку з ICU:
//!
//! 1. `_` у ASCII йде ПІСЛЯ цифр і великих літер (0x5F), а в ICU root — це
//!    перший знак пунктуації, ще до `-` (`"a_b" < "a-b"`, живий Node);
//! 2. великі літери в ASCII йдуть до малих (`"Z" < "a"`), в ICU — регістр це
//!    третинна вага, тобто `"Z" > "a"` і `'a' < 'A' < 'b'`;
//! 3. решта пунктуації має власний порядок CLDR root, не збіжний з ASCII
//!    у загальному випадку (для `-`, `.`, `/` він, утім, збігається).
//!
//! # Модель
//!
//! Спрощений UCA: для кожного символу рахуємо ПЕРВИННУ вагу (клас + позиція
//! всередині класу, регістр згорнутий) і ТРЕТИННУ (0 — мала літера/решта,
//! 1 — велика). Спершу лексикографічно порівнюються первинні послідовності,
//! за нічиєї — третинні. Класи первинної ваги, в порядку зростання:
//! керівні/пробільні → пунктуація і символи в порядку CLDR root → цифри →
//! латинські літери (регістр згорнуто) → усе не-ASCII за кодпойнтом.
//!
//! # Межі порту (свідомі, звірені живим Node)
//!
//! - **Не-ASCII без діакритики** — порядок збігається: кирилиця й CJK в ICU
//!   root ідуть після латиниці (`"а".localeCompare("z") === 1`,
//!   `"日".localeCompare("б") === 1`), і між собою — за кодпойнтом.
//! - **Латиниця з діакритикою — розбіжність**: в ICU `é`/`ä` мають первинну
//!   вагу базової літери й вторинну (акцент), тож `"é" < "z"`; тут вони
//!   потрапляють у не-ASCII клас і опиняються ПІСЛЯ `z`. Відтворення вимагає
//!   таблиць нормалізації Unicode — свідомо поза цим зрізом: обидва
//!   виклики (id скілів, шляхи k8s/`.github`-маніфестів) — kebab-case ASCII.
//!   Дрейф не мовчазний: розбіжність зафіксована тестом нижче.

use std::cmp::Ordering;

/// Пунктуація й символи ASCII в порядку CLDR root (звірено живим Node:
/// `"_" < "-" < "." < "/"`, `"_" < "0"`, `"." < "/"`). Порядок груп:
/// підкреслення → дефіс → роздільники речення → лапки → дужки → «технічні»
/// (`@ * / \ & # %`) → модифікатори (`` ` `` `^`) → математичні → `|`, `~` →
/// валюта.
const PUNCTUATION_ORDER: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

/// Первинна вага символу (клас × позиція в класі); регістр згорнуто.
fn primary_weight(ch: char) -> u32 {
    if !ch.is_ascii() {
        return 0x0001_0000 + u32::from(ch);
    }
    if ch.is_ascii_digit() {
        return 0x0200 + (ch as u32 - '0' as u32);
    }
    if ch.is_ascii_alphabetic() {
        return 0x0300 + (ch.to_ascii_lowercase() as u32 - 'a' as u32);
    }
    match PUNCTUATION_ORDER.chars().position(|p| p == ch) {
        Some(index) => 0x0100 + u32::try_from(index).unwrap_or(0),
        // Керівні символи й пробіл (усе, чого немає в таблиці пунктуації) —
        // найнижчий клас, усередині за кодпойнтом.
        None => u32::from(ch),
    }
}

/// Третинна вага: велика латинська літера сортується ПІСЛЯ малої за тієї
/// самої первинної ваги (`'a' < 'A' < 'b'` в ICU root).
fn tertiary_weight(ch: char) -> u8 {
    u8::from(ch.is_ascii_uppercase())
}

/// Порівнює рядки за наближенням ICU root collation — заміна
/// `a.localeCompare(b)` у портах JS-сортувань (межі порту — доккомент модуля).
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let primary = a
        .chars()
        .map(primary_weight)
        .cmp(b.chars().map(primary_weight));
    if primary != Ordering::Equal {
        return primary;
    }
    a.chars()
        .map(tertiary_weight)
        .cmp(b.chars().map(tertiary_weight))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Пари, звірені живим Node (`node -e "a.localeCompare(b)"`) — очікування
    /// тут дослівно повторюють його вихід.
    #[test]
    fn matches_node_locale_compare_on_ascii() {
        let less = [
            ("_", "a"),
            ("_", "0"),
            ("-", "."),
            (".", "/"),
            ("a", "A"),
            ("A", "b"),
            ("9", "a"),
            ("a-b", "ab"),
            (".github/a.yaml", "a/.github/b.yaml"),
            ("a_b", "a-b"),
            ("a.b", "ab"),
            ("01", "1"),
            (" a", "_a"),
        ];
        for (a, b) in less {
            assert_eq!(locale_compare(a, b), Ordering::Less, "{a} < {b}");
            assert_eq!(locale_compare(b, a), Ordering::Greater, "{b} > {a}");
        }
        assert_eq!(
            locale_compare("k8s/a.yml", "k8s/a-b.yml"),
            Ordering::Greater
        );
        assert_eq!(locale_compare("z", "_"), Ordering::Greater);
        assert_eq!(locale_compare("Z", "a"), Ordering::Greater);
        assert_eq!(locale_compare("abc", "abc"), Ordering::Equal);
    }

    #[test]
    fn non_ascii_scripts_sort_after_latin_like_icu_root() {
        assert_eq!(locale_compare("а", "z"), Ordering::Greater); // кирилиця
        assert_eq!(locale_compare("б", "а"), Ordering::Greater);
        assert_eq!(locale_compare("日", "б"), Ordering::Greater);
    }

    /// Зафіксована межа порту: діакритична латиниця в ICU має первинну вагу
    /// базової літери (`"é" < "z"`), тут — клас не-ASCII (після `z`).
    #[test]
    fn accented_latin_diverges_from_icu_documented_limit() {
        assert_eq!(locale_compare("é", "z"), Ordering::Greater);
    }
}
