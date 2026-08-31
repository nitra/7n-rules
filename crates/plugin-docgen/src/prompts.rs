//! Порт `npm/rules/doc-files/docgen-prompts/main.mjs` (341 рядок) — текст
//! system/user промптів для `docgen-gen`/`docgen-judge`. Жодного дискового
//! вводу: усі функції будують рядки з переданого `facts`/`anchors`/`intent` —
//! той самий контракт, що JS-оригінал (обидва боки завжди отримують ці дані
//! ГОТОВИМИ параметрами, не читають диск).
//!
//! `UNIT_DIGEST_TOKENS` (env `N_CURSOR_DOCGEN_DIGEST_TOKENS`) — гість не має
//! host-каналу для env (те саме обмеження, що [`crate::crc::QUALITY_THRESHOLD`]
//! і `JUDGE_CONFIDENCE`, `crates/plugin-docgen/src/lib.rs`);
//! [`UNIT_DIGEST_TOKENS`] тут — константа з тим самим дефолтом (2000), що JS
//! БЕЗ env-перевизначення.
//!
//! Цей етап сам НЕ кличе LLM (карта розвідки, §2: «непрямо») — будує лише
//! текст `messages`, які майбутній консюмер (`docgen-gen`, поза обсягом цієї
//! фази — §5.1 `docs/specs/2026-08-31-recon-docgen-surface.md`) передав би у
//! `llm-call`.

use crate::extract_anchors::{anchors_to_prompt, Anchors};

/// Спільний system-стиль для всіх docgen-промптів — byte-exact порт `STYLE`
/// (`main.mjs:12-20`).
pub fn style() -> String {
    [
        "Ти технічний письменник. Пишеш лаконічну ПОВЕДІНКОВУ документацію до коду українською, чистим Markdown.",
        "Пиши ЩО і НАВІЩО, не ЯК. Без вступів і висновків. Не обгортай у ```-блок.",
        "Заборонено: сигнатури, типи, параметри функцій; перелік stdlib-модулів; опис regex чи внутрішніх приватних імен.",
        "Виведи ЛИШЕ текст секції. ЗАБОРОНЕНО починати з мета-фраз на кшталт «Ось оновлена чорнетка…», «Оновлений текст секції:», «Як технічний письменник, я створю…» — одразу перший змістовний рядок.",
        "Не вигадуй маркери, конфігурації або code identifiers; порожній inline code `` заборонений.",
    ]
    .join(" ")
}

/// Окремий блок інструкцій з анкорами — порт `anchorsBlock` (`main.mjs:27-31`).
fn anchors_block(anchors: Option<&Anchors>) -> String {
    match anchors {
        None => String::new(),
        Some(a) => {
            let txt = anchors_to_prompt(a);
            if txt.is_empty() {
                String::new()
            } else {
                format!("\n\n{txt}")
            }
        }
    }
}

/// Один публічний експорт файла — структурний відповідник елемента `exports`.
#[derive(Debug, Clone, Default)]
pub struct ExportEntry {
    pub name: String,
    pub desc: String,
}

/// Машинні маркери факт-листа — структурний відповідник `facts.markers`.
#[derive(Debug, Clone, Default)]
pub struct Markers {
    pub skips: Vec<String>,
    pub read_only: bool,
    pub network: bool,
    pub catches_errors: bool,
    pub returns_falsy_on_fail: bool,
    pub caches: bool,
}

/// Факт-лист про файл — структурний відповідник обʼєкта `facts`
/// (`sectionMessages`/`overviewMessages`/`criticMessages`/`refineMessages`).
#[derive(Debug, Clone, Default)]
pub struct Facts {
    pub rel_path: String,
    pub header: Option<String>,
    pub exports: Vec<ExportEntry>,
    pub internal_symbols: Vec<String>,
    pub markers: Markers,
}

/// Короткий людиночитний витяг фактів — порт `factsSummary` (`main.mjs:38-55`).
pub fn facts_summary(facts: &Facts) -> String {
    let m = &facts.markers;
    let mut lines = Vec::new();
    if let Some(header) = &facts.header {
        lines.push(format!("Намір файлу: {}", header.replace('\n', " ")));
    }
    if !facts.exports.is_empty() {
        let names = facts
            .exports
            .iter()
            .map(|e| e.name.clone())
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Публічні функції: {names}"));
    }
    if !m.skips.is_empty() {
        lines.push(format!("Свідомо пропускає шляхи: {}", m.skips.join(", ")));
    }
    if m.read_only {
        lines.push(
            "Власних операцій запису (ФС/БД) у файлі немає (імпортовані модулі не аналізувались)"
                .to_string(),
        );
    }
    if m.network {
        lines.push("Звертається до мережі".to_string());
    }
    if m.catches_errors {
        lines.push(
            "Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні"
                .to_string(),
        );
    }
    if m.returns_falsy_on_fail {
        lines.push("Деякі локальні fail-safe гілки повертають порожнє значення (напр. null) замість винятку".to_string());
    }
    lines.push(if m.caches {
        "Кешування: так, у межах прогону".to_string()
    } else {
        "Кешування: НЕМАЄ — не згадуй кеш у гарантіях".to_string()
    });
    lines.join("\n")
}

/// Пара `{role, content}` — структурний відповідник елемента `messages`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub role: String,
    pub content: String,
}

fn msgs(system: String, user: String) -> Vec<Message> {
    vec![
        Message {
            role: "system".to_string(),
            content: system,
        },
        Message {
            role: "user".to_string(),
            content: user,
        },
    ]
}

/// Блок read-only контексту із секції «Призначення» — порт `intentContext`
/// (`main.mjs:69-77`).
fn intent_context(intent: Option<&str>) -> String {
    match intent {
        None => String::new(),
        Some(text) => format!(
            "\n\nАВТОРИТЕТНИЙ КОНТЕКСТ (секція «Призначення», написана людиною — НЕ повторюй дослівно, узгоджуйся й доповнюй):\n{text}"
        ),
    }
}

/// Опції [`section_messages`] — структурний відповідник `opts`
/// (`main.mjs:93`).
#[derive(Debug, Clone, Copy, Default)]
pub struct SectionOptions {
    pub complementary_behavior: bool,
}

/// Одна секція промптів — структурний відповідник елемента, який повертає
/// `sectionMessages` (`main.mjs:91`).
#[derive(Debug, Clone)]
pub struct SectionPrompt {
    pub key: String,
    pub messages: Vec<Message>,
    pub num_predict: u32,
}

/// Секційні набори messages — порт `sectionMessages` (`main.mjs:93-131`).
/// Повертає РІВНО одну секцію (`behavior`) — та сама поведінка, що
/// JS-оригінал цього кроку («Публічний API» і «Огляд» — окремі функції).
pub fn section_messages(
    facts: &Facts,
    src: &str,
    anchors: Option<&Anchors>,
    intent: Option<&str>,
    opts: SectionOptions,
) -> Vec<SectionPrompt> {
    let facts_txt = facts_summary(facts);
    let anch = anchors_block(anchors);
    let intent_ctx = intent_context(intent);
    let multi = facts.exports.len() > 1;

    let export_names: Vec<String> = facts.exports.iter().map(|e| e.name.clone()).collect();
    let mut behavior_task = "нумерований алгоритм у бізнес-термінах".to_string();
    if multi {
        behavior_task = "крос-функціональний потік: у якому порядку і як функції взаємодіють між собою, звідки приходять дані і куди йдуть результати, спільні правила чи стан. НЕ переказуй кожну функцію окремим пунктом — одно-рядкові описи вже є в секції «Публічний API»".to_string();
    }
    if opts.complementary_behavior {
        behavior_task =
            "короткі поведінкові абзаци про відсутній користувацький контракт, без алгоритму"
                .to_string();
    }
    let only_exports = if export_names.is_empty() {
        String::new()
    } else {
        format!(
            " Описуй РІВНО ці публічні імена і жодних інших: {}.",
            export_names.join(", ")
        )
    };
    let no_internal = if facts.internal_symbols.is_empty() {
        String::new()
    } else {
        format!(
            " НЕ згадуй за іменами службові функції: {}.",
            facts.internal_symbols.join(", ")
        )
    };
    let complementary_instruction = if opts.complementary_behavior {
        " «Огляд» і «Публічний API» уже дослівно зібрані з авторських коментарів. Додай ЛИШЕ відсутній для користувача контракт: умови, результат, error-flow, concurrency або інваріанти. Не перефразовуй авторський текст і НЕ переказуй реалізацію: заборонені обходи каталогів, цикли, читання файлів, AST-вузли, допоміжні виклики та нумерований алгоритм. Заборонені generic-фрази без факту з коду: «не вимагає налаштування», «виклик ініціює перевірку», «успішно повертається результат». Дай 1–4 короткі абзаци; якщо доповнювати нічого — поверни рівно NONE.".to_string()
    } else {
        String::new()
    };

    let behavior = SectionPrompt {
        key: "behavior".to_string(),
        num_predict: 500,
        messages: msgs(
            format!("{}\n\nФАЙЛ {}:\n```\n{src}\n```\n\nВІДОМІ ФАКТИ:\n{facts_txt}{anch}{intent_ctx}", style(), facts.rel_path),
            format!(
                "Напиши вміст секції «Поведінка»: {behavior_task}.{only_exports}{complementary_instruction} Сценарії з test/spec-файлів рендерить JS окремою секцією — не згадуй і не відтворюй їх. Якщо у фактах є свідомі пропуски шляхів — згадай їх там, де доречно (не вигадуй інших «не перевіряє»). НЕ пиши аргументи функцій у дужках, без regex.{no_internal} Без заголовка, без додаткових ## чи # підзаголовків усередині секції."
            ),
        ),
    };
    vec![behavior]
}

/// «опис.» — JSDoc-заглушка без сенсу — порт `STUB_DESC_RE` (`main.mjs:136`).
fn is_stub_desc(desc: &str) -> bool {
    let lower = desc.to_lowercase();
    lower == "опис" || lower == "опис."
}

/// Stage 2 (gap-детект, 0 токенів) — порт `isApiGap` (`main.mjs:144-147`).
pub fn is_api_gap(exp: &ExportEntry) -> bool {
    let desc = exp.desc.trim();
    desc.is_empty() || is_stub_desc(desc)
}

/// Stage 1 (скриптовий рендер, 0 токенів) — порт `renderApiLine`
/// (`main.mjs:155-157`).
pub fn render_api_line(exp: &ExportEntry) -> String {
    format!("- {} — {}", exp.name, exp.desc.trim())
}

/// Stage 3 messages лише для експортів-прогалин — порт `apiGapMessages`
/// (`main.mjs:167-174`).
pub fn api_gap_messages(gap_exports: &[ExportEntry], anchors: Option<&Anchors>) -> Vec<Message> {
    let anch = anchors_block(anchors);
    let list = gap_exports
        .iter()
        .map(|e| format!("- {}", e.name))
        .collect::<Vec<_>>()
        .join("\n");
    msgs(
        format!("{}{anch}", style()),
        format!(
            "Для кожної названої публічної функції напиши один рядок маркованого списку «назва — що робить», СВОЇМИ словами, без типів і сигнатур, РІВНО у цьому порядку й з РІВНО цими назвами:\n{list}\nБез заголовка. Без generic-фраз «застосовує логіку», «перевіряє коректність» — пиши конкретно ЩО саме застосовує/перевіряє."
        ),
    )
}

/// «Огляд» ОСТАННІМ: узагальнення вже написаної Поведінки — порт
/// `overviewMessages` (`main.mjs:188-195`).
pub fn overview_messages(facts: &Facts, behavior_text: &str, intent: Option<&str>) -> Vec<Message> {
    let facts_txt = facts_summary(facts);
    let dedup = if intent.is_some() {
        " Не дублюй секцію «Призначення»."
    } else {
        ""
    };
    msgs(
        format!("{}\n\nВІДОМІ ФАКТИ:\n{facts_txt}{}", style(), intent_context(intent)),
        format!(
            "На основі вже написаної секції «Поведінка» (нижче) напиши «Огляд»: 1-3 речення — що файл робить і навіщо існує (роль у системі). Узагальнюй САМЕ описану поведінку, не додавай нових фактів. Без заголовка, без переліку функцій. Заборонені абстрактні формули без конкретики («перевірка/валідація/обробка даних», «відповідність контракту», «застосовує логіку») — пиши, ЩО саме і за яким контрактом.{dedup}\n\nПОВЕДІНКА:\n{behavior_text}"
        ),
    )
}

/// E2-step 1 — критик — порт `criticMessages` (`main.mjs:206-226`).
pub fn critic_messages(
    section_key: &str,
    draft: &str,
    facts: &Facts,
    anchors: &Anchors,
) -> Vec<Message> {
    let anch = anchors_block(Some(anchors));
    let criteria = [
        "generic-фрази без конкретики («забезпечує перевірку», «виконує валідацію», «застосовує логіку»)",
        "пропущені обов'язкові АНКОРИ з контексту (URLs, magic-string constants, error-маркери, конфіги, code-приклади)",
        "граматичні помилки українською («перед їх застосування», «моделіне», англіцизми як «applys», «moduleline»)",
        "h1/h2/h3 підзаголовки всередині секції — їх не повинно бути",
        "дослівна копія JSDoc-сигнатури або параметрів у дужках",
        "вигадані факти, відсутні у ВІДОМИХ ФАКТАХ і АНКОРАХ",
    ]
    .join("\n  - ");
    vec![
        Message {
            role: "system".to_string(),
            content: format!("Ти жорсткий редактор технічної документації українською. Знаходиш конкретні дефекти у чорнетці. ВІДОМІ ФАКТИ:\n{}{anch}", facts_summary(facts)),
        },
        Message {
            role: "user".to_string(),
            content: format!(
                "Перевір цю чорнетку секції «{section_key}» за критеріями:\n  - {criteria}\n\nЧЕРНЕТКА:\n{draft}\n\nВідповідь — короткий нумерований список знайдених issues (1-5 пунктів). Якщо дефектів немає — поверни одне слово: NONE."
            ),
        },
    ]
}

/// E2-step 2 — refine — порт `refineMessages` (`main.mjs:237-249`).
pub fn refine_messages(
    section_key: &str,
    draft: &str,
    issues: &str,
    facts: &Facts,
    anchors: &Anchors,
) -> Vec<Message> {
    let anch = anchors_block(Some(anchors));
    vec![
        Message {
            role: "system".to_string(),
            content: format!("{}\n\nВІДОМІ ФАКТИ:\n{}{anch}", style(), facts_summary(facts)),
        },
        Message {
            role: "user".to_string(),
            content: format!(
                "Перепиши чорнетку секції «{section_key}», прибравши перелічені issues. Збережи мову (українська) і формат (без додаткових ## підзаголовків, без обгортки ```). Якщо issues вимагають включення АНКОРІВ — додай їх дослівно.\n\nЧЕРНЕТКА:\n{draft}\n\nISSUES ВІД РЕДАКТОРА:\n{issues}\n\nПоверни ЛИШЕ оновлений текст секції без преамбули."
            ),
        },
    ]
}

/// E3 — детермінований шаблон секції «Гарантії поведінки» — порт
/// `guaranteesFromMarkers` (`main.mjs:257-278`). Без LLM: 0 запитів, 0
/// галюцинацій.
pub fn guarantees_from_markers(facts: &Facts) -> String {
    let m = &facts.markers;
    let mut lines = Vec::new();
    if m.read_only {
        lines.push("- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.".to_string());
    }
    if m.catches_errors {
        lines.push(
            "- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні."
                .to_string(),
        );
    }
    if m.returns_falsy_on_fail {
        lines.push("- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.".to_string());
    }
    if m.caches {
        lines.push("- Кешує результати в межах одного прогону.".to_string());
    }
    if !m.skips.is_empty() {
        let skips = m
            .skips
            .iter()
            .map(|s| format!("`{s}`"))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("- Свідомо пропускає шляхи: {skips}."));
    }
    if lines.is_empty() {
        return "- (специфічних машинно-виведених гарантій немає)".to_string();
    }
    lines.join("\n")
}

/// One-shot messages (база для порівняння) — порт `oneShotMessages`
/// (`main.mjs:286-292`).
pub fn one_shot_messages(facts: &Facts, src: &str) -> Vec<Message> {
    let multi = facts.exports.len() > 1;
    let api_section = if multi {
        "## Публічний API (назва + що робить), "
    } else {
        ""
    };
    msgs(
        style(),
        format!(
            "Напиши документацію для файлу. Секції: ## Огляд (1-3 речення), ## Поведінка (нумерований/маркований алгоритм), {api_section}## Гарантії поведінки. Не додавай «Сценарії використання»: її детерміновано рендерить JS із повʼязаних test/spec-файлів.\n\nФАЙЛ {}:\n```\n{src}\n```",
            facts.rel_path
        ),
    )
}

/// Поріг (у токенах), після якого сирий src замінюється юніт-дайджестом —
/// дефолт JS БЕЗ env-перевизначення (доккомент модуля).
pub const UNIT_DIGEST_TOKENS: u32 = 2000;

/// Скільки перших рядків тіла юніта потрапляє в дайджест — порт
/// `DIGEST_BODY_LINES` (`main.mjs:298`).
const DIGEST_BODY_LINES: usize = 12;

/// Юніт файлу — структурний відповідник елемента `units` (`extractUnits`).
#[derive(Debug, Clone, Default)]
pub struct Unit {
    pub name: String,
    pub kind: String,
    pub exported: bool,
    pub doc: Option<String>,
    pub calls: Vec<String>,
    pub body: Option<String>,
}

/// Стислий юніт-дайджест великого файлу — порт `buildUnitDigest`
/// (`main.mjs:308-325`).
pub fn build_unit_digest(units: &[Unit]) -> String {
    let mut parts = vec![
        "СТИСЛИЙ ДАЙДЖЕСТ ФАЙЛУ (повний код не подано — файл завеликий; описуй ЛИШЕ те, що видно з дайджесту):".to_string(),
    ];
    for u in units {
        let head = format!(
            "### {} ({}{})",
            u.name,
            if u.exported { "export " } else { "" },
            u.kind
        );
        let mut lines = vec![head];
        if let Some(doc) = &u.doc {
            lines.push(format!("JSDoc: {doc}"));
        }
        if !u.calls.is_empty() {
            lines.push(format!("викликає: {}", u.calls.join(", ")));
        }
        if u.doc.is_none() {
            if let Some(body) = &u.body {
                let body_lines: Vec<&str> = body.split('\n').collect();
                let trimmed = body_lines
                    .iter()
                    .take(DIGEST_BODY_LINES)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                let suffix = if body_lines.len() > DIGEST_BODY_LINES {
                    "\n…"
                } else {
                    ""
                };
                lines.push("```".to_string());
                lines.push(format!("{trimmed}{suffix}"));
                lines.push("```".to_string());
            }
        }
        parts.push(lines.join("\n"));
    }
    parts.join("\n\n")
}

/// Judge-refine — один локальний refine-прохід за зауваженнями судді —
/// порт `judgeRefineMessages` (`main.mjs:336-341`).
pub fn judge_refine_messages(doc: &str, reason: &str) -> Vec<Message> {
    msgs(
        style(),
        format!(
            "Рецензент знайшов у документації неточності:\n{reason}\n\nВиправ ЛИШЕ хибні твердження — прибери або переформулюй їх так, щоб вони відповідали дійсності. Збережи структуру (усі ## заголовки), мову й решту тексту без змін. Поверни ПОВНИЙ виправлений markdown-документ, без преамбул.\n\nДОКУМЕНТ:\n{doc}"
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_facts() -> Facts {
        Facts {
            rel_path: "src/lib.rs".to_string(),
            header: Some("Обробляє X".to_string()),
            exports: vec![ExportEntry {
                name: "foo".to_string(),
                desc: String::new(),
            }],
            internal_symbols: vec!["helper".to_string()],
            markers: Markers {
                read_only: true,
                caches: false,
                ..Default::default()
            },
        }
    }

    #[test]
    fn facts_summary_mentions_read_only_and_no_cache() {
        let txt = facts_summary(&sample_facts());
        assert!(txt.contains("Власних операцій запису"));
        assert!(txt.contains("Кешування: НЕМАЄ"));
    }

    #[test]
    fn section_messages_returns_single_behavior_section() {
        let facts = sample_facts();
        let sections =
            section_messages(&facts, "fn foo() {}", None, None, SectionOptions::default());
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].key, "behavior");
        assert_eq!(sections[0].messages.len(), 2);
        assert!(sections[0].messages[0].content.contains("src/lib.rs"));
    }

    #[test]
    fn is_api_gap_true_for_empty_and_stub_desc() {
        assert!(is_api_gap(&ExportEntry {
            name: "a".to_string(),
            desc: String::new()
        }));
        assert!(is_api_gap(&ExportEntry {
            name: "a".to_string(),
            desc: "опис.".to_string()
        }));
        assert!(!is_api_gap(&ExportEntry {
            name: "a".to_string(),
            desc: "Читає файл".to_string()
        }));
    }

    #[test]
    fn render_api_line_formats_name_and_desc() {
        let line = render_api_line(&ExportEntry {
            name: "foo".to_string(),
            desc: " Робить X ".to_string(),
        });
        assert_eq!(line, "- foo — Робить X");
    }

    #[test]
    fn guarantees_from_markers_default_message_when_nothing_detected() {
        let facts = Facts::default();
        assert_eq!(
            guarantees_from_markers(&facts),
            "- (специфічних машинно-виведених гарантій немає)"
        );
    }

    #[test]
    fn guarantees_from_markers_lists_detected_signals() {
        let mut facts = Facts::default();
        facts.markers.read_only = true;
        facts.markers.caches = true;
        let out = guarantees_from_markers(&facts);
        assert!(out.contains("Власних операцій запису"));
        assert!(out.contains("Кешує результати"));
    }

    #[test]
    fn build_unit_digest_includes_body_only_without_doc() {
        let units = vec![
            Unit {
                name: "a".to_string(),
                kind: "function".to_string(),
                exported: true,
                doc: Some("d".to_string()),
                body: Some("body".to_string()),
                ..Default::default()
            },
            Unit {
                name: "b".to_string(),
                kind: "function".to_string(),
                exported: false,
                doc: None,
                body: Some("line1\nline2".to_string()),
                ..Default::default()
            },
        ];
        let out = build_unit_digest(&units);
        assert!(out.contains("### a (export function)"));
        assert!(out.contains("JSDoc: d"));
        assert!(!out.contains("```\nbody"));
        assert!(out.contains("line1\nline2"));
    }

    #[test]
    fn one_shot_messages_includes_api_section_only_when_multi_export() {
        let mut facts = sample_facts();
        let single = one_shot_messages(&facts, "src");
        assert!(!single[1].content.contains("Публічний API"));
        facts.exports.push(ExportEntry {
            name: "bar".to_string(),
            desc: String::new(),
        });
        let multi = one_shot_messages(&facts, "src");
        assert!(multi[1].content.contains("Публічний API"));
    }
}
