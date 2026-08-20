//! Native-порт `text/cspell-fix` (`npm/rules/text/cspell-fix/main.mjs`) —
//! read-only детект cspell плюс shared-хелпери LLM-класифікації «Unknown
//! word»-знахідок.
//!
//! cspell не має нативного `--fix`, а ~90% «Unknown word» на укр+тех-репо —
//! валідні терміни, не одруки. Тому fix-режим НЕ переписує файли, а
//! класифікує знахідки: валідні слова дописуються у `.cspell.json#words`
//! (видно в diff), ймовірні одруки лишаються на ревʼю. Сама класифікація —
//! у fix-воркері (`rules-fix::workers`); тут детект і чисті хелпери, які
//! воркер ділить із детектором (той самий поділ, що в JS: `main.mjs` проти
//! `fix-worker.mjs`).
//!
//! # Межі порту
//!
//! - `spawn` дитини — синхронний `Command::status` (native-концерни й так
//!   виконуються поза event loop-ом; паралельність тримає план лінта);
//! - `.cspell.json` пишеться через `serde_json` із `preserve_order` у графі
//!   (`indexmap` у lock) — порядок ключів конфіга зберігається, як і в JS
//!   `JSON.parse`/`stringify`;
//! - сортування слів — [`crate::locale::locale_compare`], дзеркало
//!   `toSorted((a, b) => a.localeCompare(b))`.

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::LazyLock;

use regex::Regex;

use crate::diagnostics::{Severity, Violation};
use crate::tool_resolve::resolve_cmd;

/// Слово у рядку cspell: `<file>:<line>:<col> - Unknown word (xxx)` — порт
/// `UNKNOWN_WORD_RE`.
static UNKNOWN_WORD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Unknown word \(([^)]+)\)").expect("valid regex"));

/// Підсумковий рядок cspell: `CSpell: Files checked: N, …` — порт
/// `FILES_CHECKED_RE`.
static FILES_CHECKED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Files checked:\s*(\d+)").expect("valid regex"));

/// Максимум distinct-слів під класифікацію за прогін — порт
/// `MAX_CLASSIFY_WORDS`.
pub const MAX_CLASSIFY_WORDS: usize = 80;

/// Результат прогону cspell: exit-код + обʼєднаний stdout/stderr.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CspellRun {
    /// Exit-код ПІСЛЯ нормалізації «Files checked: 0» → 0.
    pub code: i32,
    /// Обʼєднаний вивід (stdout + stderr, у цьому порядку — як у JS).
    pub out: String,
}

/// Нормалізує сирий результат cspell — порт хвоста `detectCspell`: cspell
/// повертає `!=0` і коли жоден переданий файл не пройшов `ignorePaths`
/// (`Files checked: 0`) — це «нічого перевіряти», не порушення. Чиста
/// функція, окремо від спавна — тестується без бінаря.
#[must_use]
pub fn interpret_cspell_output(code: i32, out: String) -> CspellRun {
    if code != 0 {
        if let Some(captures) = FILES_CHECKED_RE.captures(&out) {
            if captures.get(1).is_some_and(|m| m.as_str() == "0") {
                return CspellRun { code: 0, out };
            }
        }
    }
    CspellRun { code, out }
}

/// Запускає `cspell` над `files` (delta) або над `.` (full) — порт
/// `detectCspell` (без `verbose`-гілки: native-шлях не має інтерактивного
/// прогрес-режиму, `--no-progress` завжди).
#[must_use]
pub fn detect_cspell(cwd: &Path, npx: &Path, files: Option<&[String]>) -> CspellRun {
    let mut command = Command::new(npx);
    command
        .current_dir(cwd)
        .arg("cspell")
        .arg("--no-progress")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match files {
        Some(list) => {
            command.args(list);
        }
        None => {
            command.arg(".");
        }
    }
    match command.output() {
        Ok(output) => {
            let mut out = String::from_utf8_lossy(&output.stdout).into_owned();
            out.push_str(&String::from_utf8_lossy(&output.stderr));
            interpret_cspell_output(output.status.code().unwrap_or(1), out)
        }
        Err(_) => CspellRun {
            code: 1,
            out: String::new(),
        },
    }
}

/// Унікальні «Unknown word» з виводу cspell у порядку першої появи — порт
/// `unknownWords`.
#[must_use]
pub fn unknown_words(out: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut words = Vec::new();
    for line in out.split('\n') {
        if let Some(captures) = UNKNOWN_WORD_RE.captures(line) {
            let word = captures[1].to_string();
            if seen.insert(word.clone()) {
                words.push(word);
            }
        }
    }
    words
}

/// Промпт класифікації — ПОБАЙТОВИЙ порт `classifyPrompt`: для укр+тех-репо
/// bias у «valid» (додати валідне слово безпечно, «виправити» валідне —
/// шкода). Вихід bounded — JSON-масив вердиктів.
#[must_use]
pub fn classify_prompt(words: &[String]) -> String {
    let mut lines = vec![
        "You triage cspell \"unknown word\" findings for a Ukrainian + technical codebase."
            .to_string(),
        "For each word decide:".to_string(),
        "- \"valid\": correct technical term, identifier, abbreviation, transliteration, jargon, or intentional Ukrainian word → dictionary candidate.".to_string(),
        "- \"typo\": a genuine misspelling of a real word.".to_string(),
        "Default to \"valid\" when unsure (adding a real word to the dictionary is safe; \"fixing\" a valid word is harmful).".to_string(),
        "Return ONLY a JSON array, no markdown fences: [{\"w\":\"<word>\",\"verdict\":\"valid\"|\"typo\",\"fix\":\"<correction or null>\"}]".to_string(),
        "Words:".to_string(),
    ];
    lines.extend(words.iter().map(|w| format!("- {w}")));
    lines.join("\n")
}

/// Один вердикт класифікації.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct ClassifyVerdict {
    /// Слово, як його бачив cspell.
    #[serde(default)]
    pub w: Option<String>,
    /// `"valid"` чи `"typo"` (решта значень ігнорується споживачем).
    #[serde(default)]
    pub verdict: Option<String>,
}

/// Витягує JSON-масив із відповіді моделі — порт `parseClassify`: бере від
/// першої `[` до останньої `]`, зрізаючи прозу й markdown-обрамлення.
#[must_use]
pub fn parse_classify(text: &str) -> Option<Vec<ClassifyVerdict>> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<Vec<ClassifyVerdict>>(&text[start..=end]).ok()
}

/// Дописує слова у `.cspell.json#words` (sorted/dedup) — порт
/// `appendWordsToDict`. Повертає к-сть фактично доданих слів; вміст файлу
/// НЕ пишеться сам — повертається новий текст, щоб застосування лишалось за
/// викликачем (write-guard/pre-image у fix-воркері, а не сліпий запис тут).
///
/// Свідома відмінність від JS: JS-версія писала файл сама, бо жила ДО
/// декларативної моделі T0/EditPlan; native-шлях тримає всі мутації в руках
/// воркера — та сама причина, чому `run_concern_fix` будує план, а не пише.
#[must_use]
pub fn append_words_to_dict(current: &str, words: &[String]) -> Option<(String, usize)> {
    if words.is_empty() {
        return None;
    }
    let mut cfg: serde_json::Value = serde_json::from_str(current).ok()?;
    let existing: Vec<String> = cfg
        .get("words")
        .and_then(|value| value.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let mut set: std::collections::BTreeSet<String> = existing.into_iter().collect();
    let before = set.len();
    for word in words {
        set.insert(word.clone());
    }
    if set.len() == before {
        return None;
    }
    let added = set.len() - before;
    let mut sorted: Vec<String> = set.into_iter().collect();
    sorted.sort_by(|a, b| crate::locale::locale_compare(a, b));
    cfg["words"] = serde_json::Value::Array(
        sorted
            .into_iter()
            .map(serde_json::Value::String)
            .collect::<Vec<_>>(),
    );
    let rendered = serde_json::to_string_pretty(&cfg).ok()?;
    Some((format!("{rendered}\n"), added))
}

/// Стабільний machine code — дзеркало `fail(..., 'cspell')` у JS `lint()`.
const REASON: &str = "cspell";

/// Detector `text/cspell-fix` — порт `lint(ctx)`: read-only cspell по
/// `files` (delta) або по всьому репо (full); порушення одне на прогін,
/// сигнальне (перелік слів живе у виводі cspell, не в message).
#[must_use]
pub fn cspell_fix(cwd: &Path, files: Option<&[String]>) -> Vec<Violation> {
    if files.is_some_and(<[String]>::is_empty) {
        return Vec::new();
    }
    let Some(npx) = resolve_cmd("npx") else {
        // Паритет із JS до дрібниць: «зламане середовище» друкує stderr і
        // стає ТИМ САМИМ порушенням, що й знахідки, — `lint(ctx)` має одне
        // повідомлення на всі червоні гілки.
        eprintln!("❌ npx не знайдено в PATH (cspell).");
        return vec![violation()];
    };
    let run = detect_cspell(cwd, &npx, files);
    if run.code != 0 {
        // Перелік знахідок живе у виводі cspell, не в message, — JS друкує
        // його у stdout перед fail-ом; без цього людина не бачить, ЯКІ
        // слова доправляти вручну.
        print!("{}", run.out);
        return vec![violation()];
    }
    Vec::new()
}

fn violation() -> Violation {
    Violation {
        reason: REASON.to_string(),
        message: "cspell знайшов порушення правопису (text.mdc)".to_string(),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_checked_zero_normalizes_to_clean() {
        let run = interpret_cspell_output(
            1,
            "CSpell: Files checked: 0, Issues found: 0 in 0 files.".to_string(),
        );
        assert_eq!(run.code, 0, "нічого перевіряти ≠ порушення");
        let real = interpret_cspell_output(
            1,
            "CSpell: Files checked: 3, Issues found: 2 in 1 files.".to_string(),
        );
        assert_eq!(real.code, 1);
    }

    #[test]
    fn unknown_words_are_distinct_in_first_appearance_order() {
        let out = "a.md:1:2 - Unknown word (омлх)\n\
                   b.md:3:4 - Unknown word (rustc)\n\
                   c.md:5:6 - Unknown word (омлх)\n";
        assert_eq!(unknown_words(out), vec!["омлх", "rustc"]);
    }

    /// Промпт — побайтовий порт: звіряється з JS-джерелом parity-тестом
    /// (`npm/scripts/lib/tests/rules-cli-parity.test.mjs`); тут — форма.
    #[test]
    fn classify_prompt_lists_words_after_instructions() {
        let prompt = classify_prompt(&["слово".to_string(), "word2".to_string()]);
        assert!(prompt.starts_with("You triage cspell \"unknown word\" findings"));
        assert!(prompt.ends_with("Words:\n- слово\n- word2"));
    }

    #[test]
    fn parse_classify_strips_prose_and_fences() {
        let text =
            "Ось результат:\n```json\n[{\"w\":\"а\",\"verdict\":\"valid\",\"fix\":null}]\n```";
        let parsed = parse_classify(text).expect("масив знайдено");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].w.as_deref(), Some("а"));
        assert_eq!(parsed[0].verdict.as_deref(), Some("valid"));
        assert!(parse_classify("немає масиву").is_none());
        assert!(parse_classify("] [").is_none());
    }

    #[test]
    fn append_words_sorts_dedups_and_counts() {
        let current = "{\n  \"version\": \"0.2\",\n  \"words\": [\"aaa\", \"zzz\"]\n}\n";
        let (rendered, added) = append_words_to_dict(
            current,
            &["mmm".to_string(), "aaa".to_string(), "ббб".to_string()],
        )
        .expect("є нові слова");
        assert_eq!(added, 2, "aaa вже був");
        let cfg: serde_json::Value = serde_json::from_str(&rendered).unwrap();
        let words: Vec<&str> = cfg["words"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(words, vec!["aaa", "mmm", "zzz", "ббб"], "locale-сортування");
        assert!(rendered.ends_with('\n'), "хвостовий \\n, як у JS");
        // preserve_order: version лишився ПЕРШИМ ключем.
        assert!(rendered.trim_start().starts_with("{\n  \"version\""));
    }

    #[test]
    fn append_without_new_words_is_none() {
        let current = "{\"words\": [\"aaa\"]}";
        assert!(append_words_to_dict(current, &["aaa".to_string()]).is_none());
        assert!(append_words_to_dict(current, &[]).is_none());
    }

    #[test]
    fn empty_delta_scope_is_clean_without_spawn() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(cspell_fix(tmp.path(), Some(&[])).is_empty());
    }
}
