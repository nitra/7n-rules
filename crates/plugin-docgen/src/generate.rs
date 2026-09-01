//! Порт ВУЗЬКОГО зрізу `npm/rules/doc-files/docgen-gen/main.mjs`
//! (1 106 рядків) — ЛИШЕ шлях `oneShotDoc` (один `llm-call` на весь
//! документ, "unsupported"-fallback: файли без мовного екстрактора, як-от
//! `.vue`/`.py` до юніт-шару). Другий портований LLM-споживач фази 3 (перший
//! — `docgen/judge`, §2.127 реєстру); карта решти НЕпортованого обсягу
//! `docgen-gen` — доккомент [`crate::generate_fallback_doc`] у `lib.rs`.
//!
//! # Чому саме цей зріз, не весь `docgen-gen`
//!
//! `docgen-gen` — оркестратор із КІЛЬКОМА незалежними шляхами:
//! `orchestratedDoc` (N LLM-викликів по секціях + critique/refine цикл +
//! det-скорер + judge-гейт + best-of-2 retry), `commentOnlyDoc` (0 LLM),
//! і `oneShotDoc` (РІВНО один `llm-call`). Лише останній має ту саму форму
//! "один prompt → один текст", що вже довів собі право на порт `docgen/judge`
//! (карта розвідки §3, п.2: «форма 1:1 з `llm-consumer.wit`»). Решта
//! (`orchestratedDoc`, det-скоринг `scoreDoc`, critique/refine, judge-гейт
//! `runJudgeGate`/`judgeRefinePass`, best-of-2) — свідомо НЕ портовані цим
//! кроком: вони не змінюють ВИСНОВОК «контракту не треба» (рішення 1, план
//! §7 «Нове» п.7 — це й досі N незалежних `llm-call`), але є окремим,
//! значно більшим обсягом роботи (докладний список — доккомент
//! `generate_fallback_doc`).
//!
//! # Функції тут — чиста трансформація тексту
//!
//! Жодна функція цього модуля не кличе `llm-call` сама (той самий поділ, що
//! [`crate::prompts`]: тут лише текст-обробка; сам виклик — `lib.rs`,
//! дзеркало [`crate::judge_doc`]). Усі регекси — byte-exact порт відповідних
//! констант `docgen-gen/main.mjs`, ОКРІМ `SENTENCE_BOUNDARY_RE`
//! (`/(?<=[.!?])(?=\s|$)/u`, lookbehind+lookahead) — крейт `regex` не
//! підтримує lookaround, тож [`split_sentence_boundaries`] — ручний
//! character-scan з ТОЧНО тією самою семантикою (розбиває одразу ПІСЛЯ
//! `.`/`!`/`?`, коли наступний символ — пробільний або кінець рядка; жоден
//! символ не поглинається, on-conflict-join відтворює вихідний текст
//! побайтово).

use std::sync::OnceLock;

use regex::Regex;

use crate::prompts::{Facts, Message};
use crate::test_context::{render_test_scenarios, TestFileScenarios};

fn fence_open_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^```[a-z]*\n?").expect("FENCE_OPEN_RE"))
}

fn fence_close_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\n?```\s*$").expect("FENCE_CLOSE_RE"))
}

fn paren_mdc_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\([^()\n]+\.mdc\)").expect("PAREN_MDC_RE"))
}

fn leading_heading_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^#{1,6}[ \t]{1,8}[^\n]{0,400}\n{1,8}").expect("LEADING_HEADING_RE")
    })
}

fn signature_call_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"([`\w$.]{1,80})\([^()]{0,300}\)").expect("SIGNATURE_CALL_RE")
    })
}

/// R9 чат-преамбули — byte-exact порт `PREAMBLE_LINE_RES`
/// (`main.mjs:121-128`), усі з `/i` (case-insensitive; `unicode-case`
/// фіча крейта `regex`, як `REFUSAL_FILLER_PATTERNS` у `lib.rs`).
fn preamble_line_res() -> &'static Vec<Regex> {
    static RES: OnceLock<Vec<Regex>> = OnceLock::new();
    RES.get_or_init(|| {
        [
            r"(?i)^Ось (?:оновлен|переписан|виправлен|готов|вміст|текст|чорнетк|секці)",
            r"(?i)^Оновлен(?:ий|а|е|о) (?:текст|чорнетк|секці|вміст|версі)",
            r"(?i)^Як технічний письменник",
            r"(?i)^(?:Я )?(?:створю|напишу|перепишу|підготую) ",
            r"(?i)^(?:Звісно|Гаразд|Добре)[,.!]",
            r"(?i)^(?:Нижче наведено|Нижче — )",
        ]
        .iter()
        .map(|p| Regex::new(p).expect("PREAMBLE_LINE_RES"))
        .collect()
    })
}

fn section_label_line_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:Огляд|Поведінка|Публічний API|Гарантії поведінки):?$")
            .expect("SECTION_LABEL_LINE_RE")
    })
}

fn h2_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^##\s").expect("H2_RE"))
}

fn h1_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^#\s").expect("H1_RE"))
}

fn protected_start_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^##\s+Призначення\s*$").expect("PROTECTED_START_RE"))
}

/// Останній сегмент posix-шляху — порт виклику `basename(facts.relPath)`
/// (node:path, БЕЗ ext-аргумента: розширення НЕ зрізається).
fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Ручний character-scan замість `SENTENCE_BOUNDARY_RE` (доккомент модуля:
/// lookaround не підтримується). Розбиває одразу ПІСЛЯ `.`/`!`/`?`, коли
/// наступний символ — пробільний або кінець рядка; межа нічого не поглинає.
fn split_sentence_boundaries(text: &str) -> Vec<&str> {
    let mut pieces = Vec::new();
    let mut start = 0usize;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if matches!(c, '.' | '!' | '?') {
            let end = i + c.len_utf8();
            let boundary = match chars.peek() {
                None => true,
                Some((_, next)) => next.is_whitespace(),
            };
            if boundary {
                pieces.push(&text[start..end]);
                start = end;
            }
        }
    }
    pieces.push(&text[start..]);
    pieces
}

/// Порт `stripUnsupportedSentences` (`main.mjs:204-209`).
fn strip_unsupported_sentences(text: &str) -> String {
    split_sentence_boundaries(text)
        .into_iter()
        .filter(|s| !s.contains("``") && !paren_mdc_re().is_match(s))
        .collect::<Vec<_>>()
        .join("")
}

/// R9 — порт `stripLeadingPreamble` (`main.mjs:173-182`): ітеративно зрізає
/// провідні мета-рядки (дубль назви секції або чат-преамбула).
pub fn strip_leading_preamble(t: &str) -> String {
    let mut out = t.to_string();
    loop {
        let nl = out.find('\n');
        let first_raw: &str = match nl {
            Some(i) => &out[..i],
            None => &out[..],
        };
        let first = first_raw.trim();
        let is_meta = section_label_line_re().is_match(first)
            || preamble_line_res().iter().any(|re| re.is_match(first));
        if first.is_empty() || !is_meta || nl.is_none() {
            return if is_meta && nl.is_none() {
                String::new()
            } else {
                out
            };
        }
        let rest = &out[nl.unwrap() + 1..];
        out = rest.trim_start().to_string();
    }
}

/// Порт `stripSection` (`main.mjs:190-197`): прибирає код-фенс, випадковий
/// провідний заголовок і чат-преамбули з сирого виходу моделі.
pub fn strip_section(text: &str) -> String {
    let mut t = text.trim().to_string();
    if t.starts_with("```") {
        t = fence_open_re().replace(&t, "").into_owned();
        t = fence_close_re().replace(&t, "").into_owned();
        t = t.trim().to_string();
    }
    t = leading_heading_re().replace(&t, "").into_owned();
    let stripped = strip_unsupported_sentences(&strip_leading_preamble(t.trim()));
    stripped.replace("``", "").trim().to_string()
}

/// Порт `stripSignatures` (`main.mjs:218-222`): два проходи зрізають
/// `name(args)` → `name`, щоб зняти й вкладені виклики.
pub fn strip_signatures(text: &str) -> String {
    let mut t = text.to_string();
    for _ in 0..2 {
        t = signature_call_re().replace_all(&t, "$1").into_owned();
    }
    t
}

/// Результат [`split_protected`] — структурний відповідник обʼєкта, який
/// повертає `splitProtected` (`main.mjs:248-265`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedSplit {
    /// Тіло блоку `## Призначення` (без заголовка), або `None`.
    pub body: Option<String>,
    /// Документ без цього блоку.
    pub without: String,
}

/// Порт `splitProtected` (`main.mjs:248-265`): відокремлює захищену секцію
/// `## Призначення` (Варіант B) — межа до наступного H2.
pub fn split_protected(md: &str) -> ProtectedSplit {
    let lines: Vec<&str> = md.split('\n').collect();
    let Some(start) = lines.iter().position(|l| protected_start_re().is_match(l)) else {
        return ProtectedSplit {
            body: None,
            without: md.to_string(),
        };
    };
    let mut end = lines.len();
    for (i, line) in lines.iter().enumerate().skip(start + 1) {
        if h2_re().is_match(line) {
            end = i;
            break;
        }
    }
    let body = lines[start + 1..end].join("\n").trim().to_string();
    let mut without_lines: Vec<&str> = lines[..start].to_vec();
    without_lines.extend_from_slice(&lines[end..]);
    ProtectedSplit {
        body: if body.is_empty() { None } else { Some(body) },
        without: without_lines.join("\n"),
    }
}

/// Порт `insertProtected` (`main.mjs:273-280`): вставляє захищений блок
/// одразу після H1 (фіксована позиція).
pub fn insert_protected(md: &str, intent: Option<&str>) -> String {
    let Some(intent) = intent else {
        return md.to_string();
    };
    let mut lines: Vec<&str> = md.split('\n').collect();
    let h1 = lines.iter().position(|l| h1_re().is_match(l));
    let at = h1.map(|i| i + 1).unwrap_or(0);
    lines.splice(at..at, ["", "## Призначення", "", intent]);
    lines.join("\n")
}

/// Порт `h2SectionBody`+`removeH2Section` спільної межі (`main.mjs:586-609`):
/// межі H2-секції за точним заголовком.
fn h2_section_bounds(lines: &[&str], heading: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| l.trim() == heading)?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, l)| h2_re().is_match(l))
        .map(|(i, _)| i)
        .unwrap_or(lines.len());
    Some((start, end))
}

/// Порт `removeH2Section` (`main.mjs:586-592`): видаляє H2-секцію без
/// regex з довільним тілом.
fn remove_h2_section(md: &str, heading: &str) -> String {
    let lines: Vec<&str> = md.split('\n').collect();
    let Some((start, end)) = h2_section_bounds(&lines, heading) else {
        return md.to_string();
    };
    let mut out: Vec<&str> = lines[..start].to_vec();
    out.extend_from_slice(&lines[end..]);
    out.join("\n")
}

/// Порт `insertTestScenarios` (`main.mjs:618-627`): додає детерміновану
/// секцію «Сценарії використання» перед «Гарантіями поведінки» (або в
/// кінець, якщо тієї немає).
pub fn insert_test_scenarios(md: &str, test_scenario_files: &[TestFileScenarios]) -> String {
    let scenarios = render_test_scenarios(test_scenario_files);
    if scenarios.is_empty() {
        return md.to_string();
    }
    let without_old = remove_h2_section(md, "## Сценарії використання");
    let without_old = without_old.trim_end();
    let section = format!("## Сценарії використання\n\n{scenarios}");
    let guarantees = "\n\n## Гарантії поведінки";
    match without_old.find(guarantees) {
        None => format!("{without_old}\n\n{section}\n"),
        Some(at) => format!(
            "{}\n\n{section}{}\n",
            &without_old[..at],
            &without_old[at..]
        ),
    }
}

/// Порт `oneShotMessages`-виклику -> single `prompt`: зливає system+user
/// [`Message`] у ОДИН рядок для `llm-call` — той самий прийом, що
/// [`crate::judge_messages`] (доккомент `lib.rs`: WIT-форма не несе
/// окремого `system`-поля).
pub fn messages_to_prompt(messages: &[Message]) -> String {
    messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Порт "хвоста" `oneShotDoc` (`main.mjs:551-556`) — постобробка сирої
/// відповіді моделі ПІСЛЯ `llm-call` (сам виклик — [`crate::generate_fallback_doc`]
/// у `lib.rs`, дзеркало [`crate::judge_doc`]).
pub fn finish_one_shot_doc(
    raw_text: &str,
    facts: &Facts,
    test_scenario_files: &[TestFileScenarios],
    intent: Option<&str>,
) -> String {
    let mut md = strip_signatures(&strip_section(raw_text));
    if !md.starts_with('#') {
        md = format!("# {}\n\n{}", basename(&facts.rel_path), md);
    }
    let with_scenarios = insert_test_scenarios(&format!("{md}\n"), test_scenario_files);
    insert_protected(&with_scenarios, intent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prompts::Markers;

    fn facts(rel_path: &str) -> Facts {
        Facts {
            rel_path: rel_path.to_string(),
            header: None,
            exports: vec![],
            internal_symbols: vec![],
            markers: Markers::default(),
        }
    }

    #[test]
    fn strip_section_removes_fence_and_leading_heading() {
        let raw = "```md\n# Заголовок\n\nТекст секції.\n```";
        assert_eq!(strip_section(raw), "Текст секції.");
    }

    #[test]
    fn strip_section_removes_chat_preamble() {
        let raw = "Ось оновлена чорнетка секції:\nРеальний текст.";
        assert_eq!(strip_section(raw), "Реальний текст.");
    }

    #[test]
    fn strip_section_drops_empty_inline_code_sentence() {
        let raw = "Файл робить X. Викликає `` без сенсу. Далі текст.";
        let out = strip_section(raw);
        assert!(!out.contains("``"));
        assert!(out.contains("Файл робить X."));
        assert!(out.contains("Далі текст."));
    }

    #[test]
    fn strip_section_drops_sentence_with_mdc_example() {
        let raw = "Робить X. Приклад (abie.mdc) тут не факт. Далі.";
        let out = strip_section(raw);
        assert!(!out.contains("abie.mdc"));
        assert!(out.contains("Робить X."));
        assert!(out.contains("Далі."));
    }

    #[test]
    fn strip_signatures_strips_nested_calls() {
        let out = strip_signatures("check(cwd = process.cwd())");
        assert_eq!(out, "check");
    }

    #[test]
    fn split_protected_extracts_body_and_removes_block() {
        let md = "# f.rs\n\n## Призначення\n\nЛюдський текст.\n\n## Огляд\n\nМашинний текст.\n";
        let split = split_protected(md);
        assert_eq!(split.body.as_deref(), Some("Людський текст."));
        assert!(!split.without.contains("Призначення"));
        assert!(split.without.contains("## Огляд"));
    }

    #[test]
    fn split_protected_none_when_absent() {
        let md = "# f.rs\n\n## Огляд\n\nТекст.\n";
        let split = split_protected(md);
        assert_eq!(split.body, None);
        assert_eq!(split.without, md);
    }

    #[test]
    fn insert_protected_places_block_after_h1() {
        let md = "# f.rs\n\n## Огляд\n\nТекст.\n";
        let out = insert_protected(md, Some("Ручний контекст."));
        let lines: Vec<&str> = out.split('\n').collect();
        assert_eq!(lines[0], "# f.rs");
        assert_eq!(lines[2], "## Призначення");
        assert_eq!(lines[4], "Ручний контекст.");
    }

    #[test]
    fn insert_protected_noop_without_intent() {
        let md = "# f.rs\n\nТекст.\n";
        assert_eq!(insert_protected(md, None), md);
    }

    #[test]
    fn insert_test_scenarios_noop_when_no_scenarios() {
        let md = "# f.rs\n\n## Огляд\n\nТекст.\n";
        assert_eq!(insert_test_scenarios(md, &[]), md);
    }

    #[test]
    fn messages_to_prompt_joins_all_contents() {
        let msgs = vec![
            Message {
                role: "system".to_string(),
                content: "SYS".to_string(),
            },
            Message {
                role: "user".to_string(),
                content: "USER".to_string(),
            },
        ];
        assert_eq!(messages_to_prompt(&msgs), "SYS\n\nUSER");
    }

    #[test]
    fn finish_one_shot_doc_adds_missing_h1() {
        let out = finish_one_shot_doc("Просто текст без заголовка.", &facts("src/f.rs"), &[], None);
        assert!(out.starts_with("# f.rs\n\n"));
    }

    #[test]
    fn finish_one_shot_doc_keeps_existing_h1_and_inserts_intent() {
        let raw = "# f.rs\n\nЗміст доки.";
        let out = finish_one_shot_doc(raw, &facts("src/f.rs"), &[], Some("Ручний контекст."));
        assert!(out.contains("## Призначення"));
        assert!(out.contains("Ручний контекст."));
    }
}
