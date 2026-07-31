//! cspell:ignore колація кодпойнтне picomatch timsort
//! Порт sort/render/exit-code контуру lint-оркестрації (R1 фази 7,
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4) — другий зріз
//! після `lint_plan` (P1): `sortViolations`/`violationLine`
//! (`npm/scripts/lib/lint-surface/run-detectors.mjs:553-574`),
//! `renderViolations`/`formatViolation`
//! (`npm/scripts/lib/lint-surface/render.mjs:13-40`) і похідна exit-code
//! логіка `detectAll` (`run-detectors.mjs:648-658`: infra-помилка → `2`,
//! `violations.length > 0` → `1`, інакше `0`).
//!
//! # Форма [`LintViolation`] — навмисно ширша за `diagnostics::Violation`
//!
//! [`crate::diagnostics::Violation`] — DTO detector-результату ДО
//! нормалізації (без `ruleId`/`concernId`, doc-комент того модуля). Тут
//! потрібна ВЖЕ нормалізована форма (`normalizeViolation` домішує
//! `ruleId`/`concernId` з `ctx`, `detect.mjs:58-90`) — саме її сортує й
//! рендерить `run-detectors.mjs`/`render.mjs`. Тому [`LintViolation`] —
//! окрема структура з тими самими `reason`/`message`/`file`/`severity`/`data`
//! плюс `rule_id`/`concern_id` зверху, а не розширення `diagnostics::Violation`
//! (та лишається чистим pre-normalization DTO для detector-виходу).
//!
//! # `renderViolations` — БЕЗ сортування, [`render_violations`] так само
//!
//! `render.mjs::renderViolations` групує через `Map` за ключем
//! `${ruleId}/${concernId}` у порядку ПЕРШОЇ появи у вхідному масиві —
//! функція нічого не сортує сама (викликачі `default-worker.mjs`/
//! `run-fix.mjs` передають малі, вже по-концерну відфільтровані підмножини,
//! де порядок групи не має значення). [`render_violations`] тут — той самий
//! insertion-order group-by (`Vec` порядку перших ключів + `HashMap` для
//! накопичення), не використовує [`sort_violations`] всередині. Комбінований
//! [`sort_and_render_violations`] явно сортує ПЕРЕД рендером — це вибір
//! викликача (`run-detectors.mjs::detectAll`), не властивість самого рендеру.
//!
//! # `localeCompare` ⇄ `str::cmp` — чому byte-order тут коректний паритет
//!
//! JS-версія сортує через `String.prototype.localeCompare` (locale-aware
//! колація дефолтного locale рантайму). Усі чотири рядкові поля ключа
//! сортування (`ruleId`, `concernId`, `file`, `reason`) на практиці —
//! ASCII kebab-case ідентифікатори чи posix-relative шляхи (перевіряється
//! `normalizeViolation`: `file` без `..`/провідного `/`; `ruleId`/`concernId`
//! — імена каталогів concern.json). Для чистого ASCII без діакритики/
//! спецсимволів локаль-колація і кодпойнтне порівняння (`str::cmp`, яке
//! використовує Rust) дають однаковий порядок — на відміну від повної
//! Unicode-колації (де пунктуація іноді ignorable на primary strength),
//! ризик розходження існує лише для гіпотетичних не-ASCII `reason`/`file`,
//! які жоден чинний concern не виробляє. Той самий клас припущення, що
//! `picomatch`-паритет у `lint_plan` (doc-комент [`crate::lint_plan`]) —
//! звірено на реальних identifiers, не доведено формально для всього Unicode.
//!
//! # Стабільність сортування — Rust `sort_by` ⇄ JS `toSorted`
//!
//! `run-detectors.mjs::sortViolations` викликає `Array.prototype.toSorted`
//! (ES2023) — специфікація ES2019+ гарантує СТАБІЛЬНИЙ sort для всіх
//! `Array.prototype.sort`-подібних методів (до ES2019 рушії могли бути
//! нестабільними для довгих масивів, сучасний V8 — завжди стабільний).
//! [`Vec::sort_by`] у Rust std — теж гарантовано стабільний (адаптивний
//! merge sort, timsort-подібний). Обидва боки стабільні — порядок violations
//! з ІДЕНТИЧНИМ п'ятикомпонентним ключем (`ruleId`/`concernId`/`file`/
//! `line`/`reason` — усі рівні, отже дублікат) лишається в порядку появи
//! на вході по обидва боки; ключ уже достатньо селективний, щоб на
//! практиці такого не траплялось (дублікат violation — сигнал detector-бага,
//! не штатний випадок).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::diagnostics::Severity;

/// Нормалізоване порушення — точний Rust-відповідник JS `LintViolation`
/// ПІСЛЯ `normalizeViolation` (`ruleId`/`concernId` вже домішані,
/// doc-комент модуля вище). serde `camelCase` — та сама JSON-форма, що йде
/// через napi-межу в обидва боки.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintViolation {
    pub rule_id: String,
    pub concern_id: String,
    pub reason: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default)]
    pub severity: Severity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// `data.line` порушення (не top-level поле — doc-комент
/// `crate::diagnostics`, секція «Чому без top-level `line`») — точний порт
/// `violationLine` (`run-detectors.mjs:553-556`). Відсутність чи не-число →
/// `0.0` (перед усіма реальними номерами рядків), той самий фолбек, що і в
/// JS. `f64`, не `i64` — JSON-числа в `data` семантично — JS `number`
/// (завжди f64), порівняння тут мусить лишатись байдужим до цілого/дробового
/// розрізнення так само, як і оригінал.
fn violation_line(v: &LintViolation) -> f64 {
    v.data
        .as_ref()
        .and_then(|d| d.get("line"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0)
}

/// Стабільне сортування за `(ruleId, concernId, file, line, reason)` —
/// точний порт `sortViolations` (`run-detectors.mjs:565-574`, doc-комент
/// модуля вище щодо `localeCompare`-паритету і стабільності). Не мутує вхід,
/// повертає новий `Vec` (дзеркало `Array.prototype.toSorted`).
pub fn sort_violations(violations: &[LintViolation]) -> Vec<LintViolation> {
    let mut sorted = violations.to_vec();
    sorted.sort_by(|a, b| {
        a.rule_id
            .cmp(&b.rule_id)
            .then_with(|| a.concern_id.cmp(&b.concern_id))
            .then_with(|| {
                a.file
                    .as_deref()
                    .unwrap_or("")
                    .cmp(b.file.as_deref().unwrap_or(""))
            })
            .then_with(|| {
                violation_line(a)
                    .partial_cmp(&violation_line(b))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.reason.cmp(&b.reason))
    });
    sorted
}

/// Один рядок порушення — точний порт `formatViolation`
/// (`render.mjs:13-17`): `  <mark> ruleId/concernId → file (reason): message`,
/// без ` → file`-сегмента, якщо `file` відсутній. УВАГА: JS-версія перевіряє
/// `v.file ? ... : ''` — **truthy**-перевірка, не `!== undefined`: порожній
/// рядок `file: ''` (гіпотетичний, але дозволений `normalizeViolation` —
/// `''.startsWith('/')` і `''.split('/').includes('..')` обидва `false`) теж
/// falsy в JS і НЕ дає arrow-сегмент. `Some(f) if !f.is_empty()`, не просто
/// `Some(f)`, — точне дзеркало цієї truthy-семантики, не лише `Option`-стану.
fn format_violation(v: &LintViolation) -> String {
    let mark = if v.severity == Severity::Warn {
        "⚠"
    } else {
        "❌"
    };
    let loc = match &v.file {
        Some(f) if !f.is_empty() => format!(" → {f}"),
        _ => String::new(),
    };
    format!(
        "  {mark} {}/{}{loc} ({}): {}",
        v.rule_id, v.concern_id, v.reason, v.message
    )
}

/// Рендерить порушення згруповані за concern-ом — точний порт
/// `renderViolations` (`render.mjs:24-40`). Групування — insertion-order
/// (перша поява ключа `ruleId/concernId` у вхідному `violations`, doc-комент
/// модуля вище щодо відсутності сортування тут). Порожній вхід → порожній
/// рядок (та сама рання гілка `if (violations.length === 0) return ''`).
pub fn render_violations(violations: &[LintViolation]) -> String {
    if violations.is_empty() {
        return String::new();
    }
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<&LintViolation>> = HashMap::new();
    for v in violations {
        let key = format!("{}/{}", v.rule_id, v.concern_id);
        if !groups.contains_key(&key) {
            order.push(key.clone());
        }
        groups.entry(key).or_default().push(v);
    }
    let mut blocks: Vec<String> = Vec::new();
    for key in &order {
        let vs = &groups[key];
        blocks.push(format!("{key} — {} порушення:", vs.len()));
        for v in vs {
            blocks.push(format_violation(v));
        }
    }
    blocks.join("\n") + "\n"
}

/// Похідний exit-code — точний порт гілки `detectAll`
/// (`run-detectors.mjs:648-658`): infra-помилка домінує над violations
/// (навіть якщо частина concern-ів встигла віддати violations ДО збою —
/// той самий `if (infraMessage !== null) return { ..., exitCode: 2, ... }`
/// ПЕРЕД перевіркою `allViolations.length`).
pub fn compute_exit_code(violations_count: usize, has_infra_error: bool) -> u8 {
    if has_infra_error {
        2
    } else if violations_count > 0 {
        1
    } else {
        0
    }
}

/// Вхід [`sort_and_render_violations`] — `{violations, infraMessage?}`,
/// дзеркало того, що `detectAll` уже тримає в пам'яті (`planResult.violations`
/// + `planResult.infraMessage`) ПЕРЕД сортуванням/рендером.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortAndRenderInput {
    pub violations: Vec<LintViolation>,
    #[serde(default)]
    pub infra_message: Option<String>,
}

/// Вихід [`sort_and_render_violations`] — усе, що `detectAll` вираховує з
/// одного набору violations за один native-виклик (doc-комент задачі: «менше
/// hops» — раніше JS робив би три окремі виклики: sort, render, exit-code).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SortAndRenderResult {
    pub sorted: Vec<LintViolation>,
    pub rendered: String,
    pub exit_code: u8,
}

/// Комбінований виклик для гарячого шляху `detectAll`: сортує вхідні
/// violations ([`sort_violations`]), рендерить УЖЕ відсортований результат
/// ([`render_violations`] — тому групи в тексті йдуть у sorted-порядку, не
/// insertion-порядку вхідного `input.violations`) і рахує exit-code
/// ([`compute_exit_code`]) за наявністю `infra_message`. `rendered`
/// повертається БЕЗЗАСТЕРЕЖНО (навіть коли `infra_message` заданий) —
/// рішення, чи друкувати його, лишається за викликачем (`detectAll` сьогодні
/// друкує `рендер` лише в success-гілці, а `infraMessage` — окремим рядком,
/// doc-комент модуля).
pub fn sort_and_render_violations(input: &SortAndRenderInput) -> SortAndRenderResult {
    let sorted = sort_violations(&input.violations);
    let rendered = render_violations(&sorted);
    let exit_code = compute_exit_code(sorted.len(), input.infra_message.is_some());
    SortAndRenderResult {
        sorted,
        rendered,
        exit_code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(rule_id: &str, concern_id: &str, reason: &str, message: &str) -> LintViolation {
        LintViolation {
            rule_id: rule_id.to_string(),
            concern_id: concern_id.to_string(),
            reason: reason.to_string(),
            message: message.to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        }
    }

    fn with_file(mut violation: LintViolation, file: &str) -> LintViolation {
        violation.file = Some(file.to_string());
        violation
    }

    fn with_line(mut violation: LintViolation, line: i64) -> LintViolation {
        violation.data = Some(serde_json::json!({ "line": line }));
        violation
    }

    fn with_severity(mut violation: LintViolation, severity: Severity) -> LintViolation {
        violation.severity = severity;
        violation
    }

    // --- violation_line ----------------------------------------------------

    #[test]
    fn violation_line_missing_data_defaults_to_zero() {
        assert_eq!(violation_line(&v("r", "c", "x", "m")), 0.0);
    }

    #[test]
    fn violation_line_non_number_defaults_to_zero() {
        let mut violation = v("r", "c", "x", "m");
        violation.data = Some(serde_json::json!({ "line": "not-a-number" }));
        assert_eq!(violation_line(&violation), 0.0);
    }

    #[test]
    fn violation_line_reads_data_line() {
        assert_eq!(violation_line(&with_line(v("r", "c", "x", "m"), 42)), 42.0);
    }

    // --- sort_violations -----------------------------------------------------

    #[test]
    fn sort_violations_orders_by_rule_then_concern() {
        let input = vec![v("zzz", "a", "r", "m"), v("aaa", "b", "r", "m")];
        let sorted = sort_violations(&input);
        assert_eq!(
            sorted
                .iter()
                .map(|x| x.rule_id.as_str())
                .collect::<Vec<_>>(),
            vec!["aaa", "zzz"]
        );
    }

    #[test]
    fn sort_violations_same_rule_concern_orders_by_file_then_line_then_reason() {
        let input = vec![
            with_line(with_file(v("r", "c", "z-reason", "m"), "b.txt"), 1),
            with_line(with_file(v("r", "c", "a-reason", "m"), "a.txt"), 5),
            with_file(v("r", "c", "m-reason", "m"), "a.txt"), // line відсутній → 0
        ];
        let sorted = sort_violations(&input);
        assert_eq!(
            sorted
                .iter()
                .map(|x| (
                    x.file.as_deref().unwrap(),
                    violation_line(x),
                    x.reason.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("a.txt", 0.0, "m-reason"),
                ("a.txt", 5.0, "a-reason"),
                ("b.txt", 1.0, "z-reason")
            ]
        );
    }

    #[test]
    fn sort_violations_missing_file_sorts_as_empty_string_first() {
        let input = vec![
            with_file(v("r", "c", "x", "m"), "a.txt"),
            v("r", "c", "x", "m"), // без file
        ];
        let sorted = sort_violations(&input);
        assert!(sorted[0].file.is_none());
        assert_eq!(sorted[1].file.as_deref(), Some("a.txt"));
    }

    #[test]
    fn sort_violations_does_not_mutate_input_order() {
        let input = vec![v("z", "c", "x", "m"), v("a", "c", "x", "m")];
        let _ = sort_violations(&input);
        assert_eq!(input[0].rule_id, "z");
        assert_eq!(input[1].rule_id, "a");
    }

    #[test]
    fn sort_violations_empty_input_returns_empty() {
        assert!(sort_violations(&[]).is_empty());
    }

    // --- render_violations ---------------------------------------------------

    #[test]
    fn render_violations_empty_input_returns_empty_string() {
        assert_eq!(render_violations(&[]), "");
    }

    #[test]
    fn render_violations_groups_by_rule_concern_in_first_seen_order() {
        let input = vec![
            v("probe", "check", "missing", "no file"),
            v("other", "check", "missing", "still no file"),
            v("probe", "check", "extra", "another one"),
        ];
        let rendered = render_violations(&input);
        assert_eq!(
            rendered,
            "probe/check — 2 порушення:\n  \
             ❌ probe/check (missing): no file\n  \
             ❌ probe/check (extra): another one\n\
             other/check — 1 порушення:\n  \
             ❌ other/check (missing): still no file\n"
        );
    }

    #[test]
    fn render_violations_formats_file_when_present() {
        let violation = with_file(v("probe", "check", "missing", "no file"), "a/b.txt");
        assert_eq!(
            render_violations(&[violation]),
            "probe/check — 1 порушення:\n  ❌ probe/check → a/b.txt (missing): no file\n"
        );
    }

    #[test]
    fn render_violations_omits_file_segment_when_absent() {
        let violation = v("probe", "check", "missing", "no file");
        assert_eq!(
            render_violations(&[violation]),
            "probe/check — 1 порушення:\n  ❌ probe/check (missing): no file\n"
        );
    }

    /// `file: ''` (Some, порожній рядок) — той самий truthy-фолбек JS
    /// (`v.file ? ... : ''`), doc-комент [`format_violation`]: жодного
    /// arrow-сегмента, ідентично до `file` відсутнього взагалі.
    #[test]
    fn render_violations_omits_file_segment_when_file_is_empty_string() {
        let violation = with_file(v("probe", "check", "missing", "no file"), "");
        assert_eq!(
            render_violations(&[violation]),
            "probe/check — 1 порушення:\n  ❌ probe/check (missing): no file\n"
        );
    }

    #[test]
    fn render_violations_uses_warn_mark_for_warn_severity() {
        let violation = with_severity(v("probe", "check", "deprecated", "old api"), Severity::Warn);
        assert_eq!(
            render_violations(&[violation]),
            "probe/check — 1 порушення:\n  ⚠ probe/check (deprecated): old api\n"
        );
    }

    // --- compute_exit_code ----------------------------------------------------

    #[test]
    fn compute_exit_code_infra_error_dominates() {
        assert_eq!(compute_exit_code(0, true), 2);
        assert_eq!(compute_exit_code(5, true), 2);
    }

    #[test]
    fn compute_exit_code_violations_without_infra_error() {
        assert_eq!(compute_exit_code(1, false), 1);
        assert_eq!(compute_exit_code(5, false), 1);
    }

    #[test]
    fn compute_exit_code_clean_run() {
        assert_eq!(compute_exit_code(0, false), 0);
    }

    // --- sort_and_render_violations (комбінований) -----------------------------

    #[test]
    fn sort_and_render_sorts_before_rendering_and_reports_exit_code_one() {
        let input = SortAndRenderInput {
            violations: vec![v("zzz", "c", "r", "m"), v("aaa", "c", "r", "m")],
            infra_message: None,
        };
        let result = sort_and_render_violations(&input);
        assert_eq!(result.exit_code, 1);
        assert_eq!(
            result
                .sorted
                .iter()
                .map(|x| x.rule_id.as_str())
                .collect::<Vec<_>>(),
            vec!["aaa", "zzz"]
        );
        // Рендер іде у sorted-порядку — "aaa" перед "zzz".
        assert!(result.rendered.find("aaa/c").unwrap() < result.rendered.find("zzz/c").unwrap());
    }

    #[test]
    fn sort_and_render_infra_error_gives_exit_code_two_regardless_of_violations() {
        let input = SortAndRenderInput {
            violations: vec![v("r", "c", "x", "m")],
            infra_message: Some("boom".to_string()),
        };
        let result = sort_and_render_violations(&input);
        assert_eq!(result.exit_code, 2);
        assert_eq!(result.sorted.len(), 1);
    }

    #[test]
    fn sort_and_render_clean_run_gives_exit_code_zero_and_empty_render() {
        let input = SortAndRenderInput {
            violations: vec![],
            infra_message: None,
        };
        let result = sort_and_render_violations(&input);
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.rendered, "");
        assert!(result.sorted.is_empty());
    }
}
