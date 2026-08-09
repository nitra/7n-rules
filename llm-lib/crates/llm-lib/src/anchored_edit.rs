//! Анкерний протокол правок — Rust-порт `llm-lib/lib/anchored-edit.mjs`
//! (спека `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7, клас 3).
//!
//! Строга заміна fuzzy-редагування (`str_replace`/`apply_patch`) для fix-циклу
//! слабких моделей: кожен рядок файлу має 3-символьний base36-якір від хешу
//! ВМІСТУ рядка (номер рядка в хеш НЕ входить). Правка застосовується лише якщо
//! якір збігається з поточним вмістом рядка — жодного fuzzy-match, мовчазного
//! переміщення чи автокорекції. Валідація ЗАВЖДИ йде перед застосуванням і
//! атомарно на увесь виклик: хоч одна застаріла правка → відмова всього набору,
//! вміст не змінюється (див. [`apply_anchored_edits`]).
//!
//! Модуль pi-free і fs-free: чисті функції над рядками. Читання/запис файлу і
//! проводка в pi `defineTool` (аналог `createAnchoredTools` з JS-джерела)
//! лишаються поза цим зрізом — вони підуть у Rust-обв'язку agent-fix, яка й
//! робитиме `edit_anchored` write-guard-керованим tool-викликом.

use sha2::{Digest, Sha256};

/// Довжина якоря у base36-символах (36³ = 46656 значень — на рядок, не на файл).
const ANCHOR_LEN: usize = 3;

/// Алфавіт base36-кодування (0-9, a-z) — той самий порядок, що й у `Number.toString(36)`.
const BASE36_DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// Якір рядка: перші 3 base36-символи sha256 від вмісту рядка.
///
/// Навмисно БЕЗ номера рядка у хеші: якір «прив'язаний до вмісту», а номер іде
/// окремим полем правки — розбіжність будь-якого з двох означає stale-стан.
/// Порт `readUInt32BE(0) % 36³` з JS-джерела: перші 4 байти дайджесту як
/// big-endian `u32`, за модулем 36³, base36 з padStart('0', 3).
pub fn line_anchor(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);
    let value = n % 36u32.pow(ANCHOR_LEN as u32);
    to_base36_padded(value, ANCHOR_LEN)
}

/// Кодує число в base36, доповнюючи зліва нулями до `width` символів
/// (аналог `n.toString(36).padStart(width, '0')`).
fn to_base36_padded(mut value: u32, width: usize) -> String {
    let mut digits = Vec::with_capacity(width);
    if value == 0 {
        digits.push(BASE36_DIGITS[0]);
    }
    while value > 0 {
        digits.push(BASE36_DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    while digits.len() < width {
        digits.push(b'0');
    }
    digits.reverse();
    // BASE36_DIGITS — ASCII, тож послідовність байтів завжди валідний UTF-8.
    String::from_utf8(digits).expect("base36-кодування дає лише ASCII-байти")
}

/// Діапазон рядків для [`render_anchored`] (1-based, включно з обох боків).
///
/// `Default` відповідає `{ from: 1, to: Infinity }` з JS-джерела — увесь файл.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnchorRange {
    pub from: usize,
    pub to: usize,
}

impl Default for AnchorRange {
    fn default() -> Self {
        Self {
            from: 1,
            to: usize::MAX,
        }
    }
}

/// Рендерить вміст файлу у anchored-форматі: `якір|номер|текст`, нумерація з 1.
///
/// Рядки поза межами файлу чи інвертований діапазон (`from > to`) дають
/// порожній рядок-вивід — так само, як порожній `Array.join('\n')` у JS.
pub fn render_anchored(content: &str, range: AnchorRange) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    let from = range.from.max(1);
    let to = range.to.min(lines.len());
    if from > to {
        return String::new();
    }
    let mut out = Vec::with_capacity(to - from + 1);
    for i in from..=to {
        let text = lines[i - 1];
        let anchor = line_anchor(text);
        out.push(format!("{anchor}|{i}|{text}"));
    }
    out.join("\n")
}

/// Одна анкерна правка рядка.
///
/// `new_text = None` — видалення рядка; `Some(text)` — заміна рядка (може бути
/// багаторядковою: `text` зі своїми `\n` розбивається на кілька рядків файлу).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnchoredEdit {
    /// 3-символьний base36-якір, з яким рядок мав збігатися (з `read_anchored`).
    pub anchor: String,
    /// 1-based номер рядка у поточному файлі.
    pub line: usize,
    /// Заміна вмісту рядка; `None` = видалити рядок.
    pub new_text: Option<String>,
}

/// Одна причина відмови застосування правок — застарілий/невалідний якір,
/// неіснуючий номер рядка або дублікат номера в одному виклику.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct StaleAnchor {
    pub line: usize,
    pub reason: String,
}

/// Результат [`apply_anchored_edits`]: новий вміст файлу АБО повний перелік
/// розбіжностей (для структурованої відповіді слабкій моделі — див.
/// [`stale_anchors_to_text`]).
pub type ApplyOutcome = Result<String, Vec<StaleAnchor>>;

/// Атомарно застосовує anchored-правки до вмісту файлу.
///
/// Валідація ПЕРЕД застосуванням, на весь набір правок разу: кожна правка
/// перевіряється на (а) існування номера рядка, (б) дублікат номера в межах
/// цього ж виклику, (в) збіг якоря з поточним вмістом рядка. Хоч одна
/// невалідна правка → `Err` з повним переліком причин, вихідний `content`
/// логічно незмінний (функція чиста — нічого не пише на диск і не мутує
/// вхідні дані). Порожній список правок — валідний виклик, що повертає
/// вміст без змін (`Ok(content)`), так само, як у JS-джерелі.
///
/// Застосування (коли валідація пройшла) — знизу вгору за номером рядка, щоб
/// номери рядків, які ще лишились без обробки, не зсувались.
pub fn apply_anchored_edits(content: &str, edits: &[AnchoredEdit]) -> ApplyOutcome {
    let mut lines: Vec<String> = content.split('\n').map(str::to_string).collect();
    let mut stale = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for edit in edits {
        let line = edit.line;
        if line < 1 || line > lines.len() {
            let len = lines.len();
            stale.push(StaleAnchor {
                line,
                reason: format!("рядка {line} не існує (у файлі {len})"),
            });
            continue;
        }
        if !seen.insert(line) {
            stale.push(StaleAnchor {
                line,
                reason: format!("рядок {line} правиться двічі в одному виклику"),
            });
            continue;
        }
        let actual = line_anchor(&lines[line - 1]);
        if edit.anchor != actual {
            let anchor = &edit.anchor;
            stale.push(StaleAnchor {
                line,
                reason: format!("stale anchor {anchor} (актуальний {actual}) — перечитай файл"),
            });
        }
    }

    if !stale.is_empty() {
        return Err(stale);
    }

    let mut ordered: Vec<&AnchoredEdit> = edits.iter().collect();
    ordered.sort_by_key(|e| std::cmp::Reverse(e.line));
    for edit in ordered {
        match &edit.new_text {
            None => {
                lines.remove(edit.line - 1);
            }
            Some(text) => {
                let replacement: Vec<String> = text.split('\n').map(str::to_string).collect();
                lines.splice(edit.line - 1..edit.line, replacement);
            }
        }
    }
    Ok(lines.join("\n"))
}

/// Серіалізує перелік застарілих якорів у JSON-текст для моделі (той самий
/// формат, що `toolFail`/`JSON.stringify` у JS-джерелі): слабка модель бачить
/// точну причину відмови і структуру для наступного кроку (перечитати файл).
/// Не бере участі у [`apply_anchored_edits`] — окрема функція, як просить спека.
pub fn stale_anchors_to_text(stale: &[StaleAnchor]) -> String {
    #[derive(serde::Serialize)]
    struct Payload<'a> {
        error: &'static str,
        stale: &'a [StaleAnchor],
    }
    let payload = Payload {
        error: "stale anchors — нічого не застосовано",
        stale,
    };
    serde_json::to_string(&payload)
        .expect("StaleAnchor — лише String/usize, серіалізація не може впасти")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Хелпер: побудувати правильну (не-stale) правку для рядка з поточним вмістом.
    fn edit(content: &str, line: usize, new_text: Option<&str>) -> AnchoredEdit {
        let lines: Vec<&str> = content.split('\n').collect();
        AnchoredEdit {
            anchor: line_anchor(lines[line - 1]),
            line,
            new_text: new_text.map(str::to_string),
        }
    }

    // --- Властивість 1: якір рядка ---

    #[test]
    fn line_anchor_is_3_base36_chars_and_content_sensitive() {
        let a = line_anchor("const x = 1");
        assert_eq!(a.len(), 3);
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() && !c.is_ascii_uppercase()));
        assert_eq!(
            line_anchor("const x = 1"),
            a,
            "детермінований для того самого вмісту"
        );
        assert_ne!(line_anchor("const x = 2"), a, "чутливий до вмісту");
    }

    #[test]
    fn line_anchor_ignores_line_number_by_construction() {
        // Якір не приймає номер рядка як параметр узагалі — той самий текст на
        // "різних рядках" (тобто просто викликаний двічі) дає той самий якір.
        assert_eq!(line_anchor("same text"), line_anchor("same text"));
    }

    // --- Властивість 2: рендер `якір|номер|текст` ---

    #[test]
    fn render_anchored_full_file_format_and_numbering_from_1() {
        let content = "a\nb\nc";
        let rendered = render_anchored(content, AnchorRange::default());
        let lines: Vec<&str> = rendered.split('\n').collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], format!("{}|1|a", line_anchor("a")));
        assert_eq!(lines[1], format!("{}|2|b", line_anchor("b")));
        assert_eq!(lines[2], format!("{}|3|c", line_anchor("c")));
    }

    #[test]
    fn render_anchored_inclusive_range() {
        let content = "a\nb\nc";
        assert_eq!(
            render_anchored(content, AnchorRange { from: 2, to: 2 }),
            format!("{}|2|b", line_anchor("b"))
        );
        let two_to_end = render_anchored(content, AnchorRange { from: 2, to: 99 });
        assert_eq!(
            two_to_end.split('\n').count(),
            2,
            "to за межами файлу обрізається на довжину файлу"
        );
    }

    #[test]
    fn render_anchored_inverted_range_is_empty() {
        let content = "a\nb\nc";
        assert_eq!(render_anchored(content, AnchorRange { from: 5, to: 1 }), "");
    }

    // --- Властивість 3+4: атомарна валідація і застосування знизу вгору ---

    #[test]
    fn apply_replaces_line_including_multiline_replacement() {
        let content = "one\ntwo\nthree";
        let e = edit(content, 2, Some("TWO\nTWO2"));
        let result = apply_anchored_edits(content, &[e]);
        assert_eq!(result, Ok("one\nTWO\nTWO2\nthree".to_string()));
    }

    #[test]
    fn apply_deletes_line_on_none() {
        let content = "one\ntwo\nthree";
        let e = edit(content, 2, None);
        let result = apply_anchored_edits(content, &[e]);
        assert_eq!(result, Ok("one\nthree".to_string()));
    }

    #[test]
    fn apply_multiple_edits_bottom_up_line_numbers_stay_stable() {
        let content = "one\ntwo\nthree";
        let e1 = edit(content, 1, Some("1a\n1b"));
        let e3 = edit(content, 3, Some("3"));
        // Навмисно у "неправильному" порядку виклику (спершу рядок 1) — функція
        // сама сортує знизу вгору, порядок вхідного списку не має значення.
        let result = apply_anchored_edits(content, &[e1, e3]);
        assert_eq!(result, Ok("1a\n1b\ntwo\n3".to_string()));
    }

    #[test]
    fn apply_empty_edit_list_is_noop_ok() {
        let content = "one\ntwo\nthree";
        assert_eq!(apply_anchored_edits(content, &[]), Ok(content.to_string()));
    }

    // --- Негативні шляхи: stale anchor, номер поза межами, дублікат номера ---

    #[test]
    fn apply_stale_anchor_rejects_whole_call_atomically() {
        let content = "one\ntwo\nthree";
        let good = edit(content, 1, Some("OK"));
        let bad = AnchoredEdit {
            anchor: "zzz".to_string(),
            line: 2,
            new_text: Some("BAD".to_string()),
        };
        let result = apply_anchored_edits(content, &[good, bad]);
        let stale = result.expect_err("хоч одна stale-правка мусить відхилити весь виклик");
        assert_eq!(
            stale.len(),
            1,
            "лише реально невалідна правка потрапляє у stale-список"
        );
        assert_eq!(stale[0].line, 2);
        assert!(
            stale[0].reason.contains("stale anchor"),
            "причина: {}",
            stale[0].reason
        );
    }

    #[test]
    fn apply_out_of_range_line_number_is_stale() {
        let content = "one\ntwo\nthree";
        let e = AnchoredEdit {
            anchor: "aaa".to_string(),
            line: 9,
            new_text: Some("x".to_string()),
        };
        let stale =
            apply_anchored_edits(content, &[e]).expect_err("рядок 9 не існує у 3-рядковому файлі");
        assert!(
            stale[0].reason.contains("не існує"),
            "причина: {}",
            stale[0].reason
        );
    }

    #[test]
    fn apply_zero_line_number_is_stale_not_panic() {
        let content = "one\ntwo\nthree";
        let e = AnchoredEdit {
            anchor: "aaa".to_string(),
            line: 0,
            new_text: Some("x".to_string()),
        };
        let stale =
            apply_anchored_edits(content, &[e]).expect_err("рядок 0 поза 1-based нумерацією");
        assert!(
            stale[0].reason.contains("не існує"),
            "причина: {}",
            stale[0].reason
        );
    }

    #[test]
    fn apply_duplicate_line_number_in_same_call_is_stale() {
        let content = "one\ntwo\nthree";
        let e1 = edit(content, 1, Some("x"));
        let e2 = edit(content, 1, Some("y"));
        let stale = apply_anchored_edits(content, &[e1, e2])
            .expect_err("той самий рядок двічі в одному виклику");
        assert!(
            stale[0].reason.contains("двічі"),
            "причина: {}",
            stale[0].reason
        );
    }

    #[test]
    fn stale_result_does_not_mutate_conceptually_content_untouched() {
        // apply_anchored_edits — чиста функція над String; сам факт, що Err не
        // містить жодного нового вмісту файлу (лише перелік причин), і є
        // гарантією "нічого не застосовано" на цьому рівні. Дисковий рівень
        // (реальний файл) перевіряється окремим тестом нижче через tempdir.
        let content = "one\ntwo\nthree";
        let bad = AnchoredEdit {
            anchor: "zzz".to_string(),
            line: 1,
            new_text: Some("X".to_string()),
        };
        let Err(stale) = apply_anchored_edits(content, &[bad]) else {
            panic!("очікувалась відмова");
        };
        assert_eq!(stale.len(), 1);
    }

    // --- Властивість 5: структуровані відмови + текстова серіалізація для моделі ---

    #[test]
    fn stale_anchors_to_text_is_valid_json_with_error_and_stale_list() {
        let content = "one\ntwo";
        let bad = AnchoredEdit {
            anchor: "zzz".to_string(),
            line: 1,
            new_text: Some("X".to_string()),
        };
        let stale = apply_anchored_edits(content, &[bad]).unwrap_err();
        let text = stale_anchors_to_text(&stale);
        let parsed: serde_json::Value = serde_json::from_str(&text).expect("валідний JSON");
        assert!(parsed["error"].as_str().unwrap().contains("stale anchors"));
        assert_eq!(parsed["stale"][0]["line"], 1);
        assert!(parsed["stale"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("stale anchor"));
    }

    // --- Дисковий рівень: атомарність на реальному файлі через tempdir ---

    /// Симулює те, що робитиме майбутній `edit_anchored` tool: прочитати файл,
    /// застосувати правки, записати назад ЛИШЕ якщо валідація пройшла.
    fn read_apply_write(path: &std::path::Path, edits: &[AnchoredEdit]) -> ApplyOutcome {
        let content = fs::read_to_string(path).expect("тестовий файл читається");
        let outcome = apply_anchored_edits(&content, edits)?;
        fs::write(path, &outcome).expect("тестовий запис не має впасти");
        Ok(outcome)
    }

    #[test]
    fn disk_file_is_untouched_when_apply_rejects_the_call() {
        let dir = tempfile::tempdir().expect("tempdir створюється");
        let path = dir.path().join("f.txt");
        let original = "one\ntwo\nthree";
        fs::write(&path, original).expect("початковий запис");

        let bad = AnchoredEdit {
            anchor: "zzz".to_string(),
            line: 1,
            new_text: Some("X".to_string()),
        };
        let result = read_apply_write(&path, std::slice::from_ref(&bad));
        assert!(result.is_err(), "stale-правка мусить відхилити весь виклик");

        let on_disk = fs::read_to_string(&path).expect("файл читається після відмови");
        assert_eq!(
            on_disk, original,
            "на диску нічого не змінилось після stale-відмови"
        );
    }

    #[test]
    fn disk_file_is_updated_when_apply_succeeds() {
        let dir = tempfile::tempdir().expect("tempdir створюється");
        let path = dir.path().join("f.txt");
        let original = "one\ntwo\nthree";
        fs::write(&path, original).expect("початковий запис");

        let e = edit(original, 2, Some("TWO"));
        let result = read_apply_write(&path, &[e]);
        assert_eq!(result, Ok("one\nTWO\nthree".to_string()));

        let on_disk = fs::read_to_string(&path).expect("файл читається після успіху");
        assert_eq!(on_disk, "one\nTWO\nthree");
    }
}
