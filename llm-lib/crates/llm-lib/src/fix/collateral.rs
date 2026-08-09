//! Collateral-veto — відхилення правок поза цільовою ділянкою (cross-file і hunk-window).
//!
//! Частина детермінованого harness-а навколо циклу `fix` (спека
//! `2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.7 — оркестрація поза LLM).
//! Rust-порт `npm/scripts/lib/lint-surface/collateral-veto.mjs` (спека
//! `docs/specs/2026-06-26-pi-fix-engine-migration.md` §12, addendum
//! 2026-07-05; in-file hunk-level розширення — addendum 2026-07-24 після
//! колатеральної правки, що видалила задокументований обхід реального Bun
//! SQL бага в `upsert-order.js`).
//!
//! Клас collateral слабких локальних моделей: «виправляючи» правило, модель
//! робить семантичну правку у сторонньому місці, яка НЕ порушує жодного
//! правила й тому проходить canonical re-detect (живий кейс `App.vue`:
//! хардкод версії `"0.3.0"` з коментарем "we simulate it being available"
//! замість наявного виклику `getVersion()`).
//!
//! # Два незалежні класи collateral
//!
//! 1. **Cross-file** ([`find_collateral_edits`]): рунг ЗМІНИВ наявний файл
//!    поза target-set порушення. Нові файли дозволені — легітимний клас
//!    (scaffold, доки поряд із кодом); контракт caller-а (`modified_existing`
//!    — лише файли, наявні ще ДО рунга) виключає їх звідси автоматично.
//!    Порожній target-set (whole-repo концерни без file-атрибуції) →
//!    veto незастосовний (fail-open, повертає порожній список) — свідомо,
//!    щоб не ламати концерни без file-атрибуції.
//! 2. **In-file hunk-level** ([`find_in_file_collateral_edits`]): рунг
//!    змінює файл, що ВЖЕ входить у target-set (легітимна ціль порушення),
//!    але зачіпає рядки поза ділянкою самого порушення — напр. модель
//!    виправляє відсутній doc-comment над функцією і заодно видаляє сусідній
//!    задокументований обхід реального бага усередині тіла тієї самої
//!    функції. Cross-file veto цього не бачить (файл — законна ціль).
//!    Fail-open, якщо рядок порушення невідомий (немає як відповідально
//!    обмежити hunk).
//!
//! # Injectable-інтерфейс (без fs-обходу вмісту)
//!
//! Обидві функції — чиста бібліотечна логіка: жодного читання поточного
//! вмісту файлів усередині модуля. Викликач (harness навколо циклу `fix`)
//! передає готові дані — список змінених наявних файлів
//! ([`crate::write_guard::WriteGuard::touched_files`]/`pre_image`) і
//! пре-/пост-образи конкретного файлу — це вже є в циклі як побічний
//! продукт write-guard-а, окремого fs-проходу не треба. Єдиний реальний
//! fs-виклик у модулі — [`realpath_best_effort`] (canonicalize шляху для
//! symlink-нормалізації, не обхід дерева чи читання вмісту).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Дефолтне вікно (рядків з обох боків номера рядка порушення), у межах
/// якого зміна вважається «поруч із порушенням» для in-file hunk-level veto.
pub const HUNK_WINDOW: usize = 20;

/// Грубий змінений рядковий діапазон (1-indexed, у координатах `current`),
/// повернутий [`changed_line_range`]/[`find_in_file_collateral_edits`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineRange {
    /// Перший змінений рядок (1-indexed).
    pub start: usize,
    /// Останній змінений рядок (1-indexed, включно).
    pub end: usize,
}

/// `realpath` шляху з найкращих зусиль — реекспорт єдиної реалізації з
/// [`crate::write_guard`]: veto і write-guard МУСЯТЬ нормалізувати шляхи
/// однаково, інакше symlink-розбіжність (macOS `/tmp` → `/private/tmp`) дасть
/// розбіжні ключі й хибні вердикти. Друга копія тут була б саме таким ризиком.
pub(crate) use crate::write_guard::realpath_best_effort;

/// Нормалізує target-set порушення (файли, відносні до `cwd`, або абсолютні)
/// у множину realpath-абсолютних шляхів — спільна основа для cross-file
/// veto (файли ПОЗА target-set) і, у майбутньому, для test-gate-подібних
/// перевірок (файли ВСЕРЕДИНІ target-set).
#[must_use]
pub fn resolve_target_set(target_files: &[PathBuf], cwd: &Path) -> HashSet<PathBuf> {
    target_files
        .iter()
        .map(|f| {
            let abs = if f.is_absolute() {
                f.clone()
            } else {
                cwd.join(f)
            };
            realpath_best_effort(&abs)
        })
        .collect()
}

/// Обчислює cross-file collateral-правки рунга: наявні (на момент старту
/// рунга) файли, змінені поза target-set порушення. Порожній результат —
/// veto не спрацював (нема collateral, або target-set невідомий — fail-open).
///
/// `modified_existing` — абсолютні шляхи наявних файлів, змінених відносно
/// pre-image (у циклі — файли, торкнуті [`crate::write_guard::WriteGuard`],
/// для яких `pre_image` дав [`crate::write_guard::PreImage::Existing`], не
/// [`crate::write_guard::PreImage::New`]); саме цей контракт — а не логіка
/// цієї функції — виключає нові файли (scaffold/доки) з-під veto.
/// `target_files` — файли порушення (відносні до `cwd` або абсолютні).
#[must_use]
pub fn find_collateral_edits(
    modified_existing: &[PathBuf],
    target_files: &[PathBuf],
    cwd: &Path,
) -> Vec<PathBuf> {
    let targets = resolve_target_set(target_files, cwd);
    if targets.is_empty() {
        return Vec::new();
    }
    modified_existing
        .iter()
        .map(|p| realpath_best_effort(p))
        .filter(|abs| !targets.contains(abs))
        .collect()
}

/// Обчислює грубий змінений рядковий діапазон (1-indexed, у координатах
/// `current`) між `pre_image` і `current`: найдовший спільний префікс +
/// найдовший спільний суфікс рядків, усе між ними — «змінене».
///
/// Це СВІДОМО не повний Myers-diff: алгоритм не бачить кількох розрізнених
/// hunk-ів як окремих інтервалів — лише зовнішні межі першої і останньої
/// розбіжності (тому чиста правка на самому початку файлу + окреме
/// видалення далеко внизу дають ОДИН діапазон, що охоплює обидва місця).
/// Для мети цього модуля — відрізнити «зміна лишилась у ділянці порушення»
/// від «зачепило щось далеко» — цього достатньо: точність hunk-рівня явно
/// позначена як бажаний, але не обов'язковий бар (spec §12 addendum
/// 2026-07-24), а для повного Myers-diff тут немає виправданої залежності.
fn changed_line_range(pre_image: &str, current: &str) -> Option<LineRange> {
    if pre_image == current {
        return None;
    }
    let pre_lines: Vec<&str> = pre_image.split('\n').collect();
    let cur_lines: Vec<&str> = current.split('\n').collect();

    let max_lcp = pre_lines.len().min(cur_lines.len());
    let mut lcp = 0;
    while lcp < max_lcp && pre_lines[lcp] == cur_lines[lcp] {
        lcp += 1;
    }

    let max_lcs = max_lcp - lcp;
    let mut lcs = 0;
    while lcs < max_lcs
        && pre_lines[pre_lines.len() - 1 - lcs] == cur_lines[cur_lines.len() - 1 - lcs]
    {
        lcs += 1;
    }

    let start = lcp + 1;
    let end = cur_lines.len() - lcs;
    if start > end {
        None
    } else {
        Some(LineRange { start, end })
    }
}

/// In-file hunk-level veto (§12 addendum 2026-07-24): рунг змінив файл, що
/// вже входить у target-set порушення, але змінений рядковий діапазон
/// виходить за межі вікна `window` навколо КОЖНОЇ `violation_lines`
/// цього файлу — сигнал колатеральної правки поза власне порушенням (клас
/// `upsert-order.js`: модель видалила сусідній задокументований обхід бага,
/// виправляючи doc-comment над функцією).
///
/// Fail-open (повертає `None` — veto не спрацював) у трьох випадках: файл
/// не мав pre-image або поточного вмісту (`None`/`None`), немає жодного
/// відомого рядка порушення (`violation_lines` порожній — hunk неможливо
/// відповідально обмежити), або зміна вкладається у вікно бодай ОДНОГО з
/// `violation_lines`. Повертає `Some(range)` — відхилений діапазон — лише
/// коли зміна є (вміст різниться) і виходить за вікно кожного порушення.
#[must_use]
pub fn find_in_file_collateral_edits(
    pre_image: Option<&str>,
    current: Option<&str>,
    violation_lines: &[usize],
    window: usize,
) -> Option<LineRange> {
    let (pre_image, current) = match (pre_image, current) {
        (Some(p), Some(c)) => (p, c),
        _ => return None,
    };
    if violation_lines.is_empty() {
        return None;
    }
    let range = changed_line_range(pre_image, current)?;
    // i64: дзеркалить JS-семантику `line - window` (може бути відʼємним,
    // коли порушення близько до початку файлу) — усі поля тут малі, тож
    // приведення до i64 без ризику переповнення.
    let in_window = violation_lines.iter().any(|&line| {
        let line = line as i64;
        let window = window as i64;
        range.start as i64 >= line - window && range.end as i64 <= line + window
    });
    if in_window {
        None
    } else {
        Some(range)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- find_collateral_edits (cross-file) --------------------------------

    #[test]
    fn cross_file_veto_flags_edit_to_existing_file_outside_target_set() {
        // Живий кейс App.vue: порушення таргетоване на target.txt, рунг
        // додатково хардкодить версію у сторонньому НАЯВНОМУ src/App.vue.
        let cwd = PathBuf::from("/repo");
        let target_txt = cwd.join("target.txt");
        let app_vue = cwd.join("src").join("App.vue");
        let modified_existing = vec![target_txt, app_vue.clone()];
        let target_files = vec![PathBuf::from("target.txt")];

        let rejected = find_collateral_edits(&modified_existing, &target_files, &cwd);

        assert_eq!(rejected, vec![app_vue]);
    }

    #[test]
    fn cross_file_veto_new_file_never_flagged_via_modified_existing_contract() {
        // Нові файли (scaffold, доки) не потрапляють у `modified_existing`
        // (контракт caller-а — лише файли з pre-image `Existing`), тож
        // find_collateral_edits їх ніколи не бачить і не ветує. `target.txt`
        // — легітимна ціль, docs-note.md новий і в списку відсутній.
        let cwd = PathBuf::from("/repo");
        let modified_existing = vec![cwd.join("target.txt")];
        let target_files = vec![PathBuf::from("target.txt")];

        let rejected = find_collateral_edits(&modified_existing, &target_files, &cwd);

        assert!(rejected.is_empty());
    }

    #[test]
    fn cross_file_veto_empty_target_set_fails_open() {
        // Whole-repo концерн без file-атрибуції порушення → target-set
        // порожній → veto свідомо не втручається (fail-open).
        let cwd = PathBuf::from("/repo");
        let modified_existing = vec![cwd.join("unrelated.txt")];
        let target_files: Vec<PathBuf> = vec![];

        let rejected = find_collateral_edits(&modified_existing, &target_files, &cwd);

        assert!(rejected.is_empty());
    }

    #[test]
    fn cross_file_veto_realpath_normalizes_symlinked_cwd() {
        // Регрес macOS `/tmp` → `/private/tmp`: target-set резолвиться від
        // не-canonicalized cwd, а modified_existing приходить уже
        // canonicalized (як реально дає write-guard) — без realpath-
        // нормалізації обох боків вони хибно не збіглись би.
        let tmp = tempfile::tempdir().expect("створити тимчасову директорію");
        let raw_cwd = tmp.path().to_path_buf();
        let canonical_target = std::fs::canonicalize(tmp.path())
            .expect("canonicalize tmpdir")
            .join("target.txt");

        let rejected = find_collateral_edits(
            &[canonical_target],
            &[PathBuf::from("target.txt")],
            &raw_cwd,
        );

        assert!(rejected.is_empty());
    }

    // --- changed_line_range --------------------------------------------------

    #[test]
    fn changed_line_range_identical_content_returns_none() {
        assert_eq!(changed_line_range("a\nb\nc", "a\nb\nc"), None);
    }

    #[test]
    fn changed_line_range_insertion() {
        // pre: a,b,c → cur: a,X,b,c — одна вставлена лінія на позиції 2.
        let range = changed_line_range("a\nb\nc", "a\nX\nb\nc");
        assert_eq!(range, Some(LineRange { start: 2, end: 2 }));
    }

    #[test]
    fn changed_line_range_pure_deletion_collapses_to_none() {
        // pre: a,b,c,d → cur: a,d — чисте видалення без жодного лишку
        // відмінності у CURRENT: грубий алгоритм (не Myers-diff) не має
        // рядка, який показати як "змінений" у координатах current, тож
        // повертає null — задокументоване обмеження, не баг.
        assert_eq!(changed_line_range("a\nb\nc\nd", "a\nd"), None);
    }

    #[test]
    fn changed_line_range_change_in_middle() {
        let range = changed_line_range("a\nb\nc\nd\ne", "a\nb\nX\nd\ne");
        assert_eq!(range, Some(LineRange { start: 3, end: 3 }));
    }

    #[test]
    fn changed_line_range_change_at_start() {
        let range = changed_line_range("a\nb\nc", "X\nb\nc");
        assert_eq!(range, Some(LineRange { start: 1, end: 1 }));
    }

    #[test]
    fn changed_line_range_change_at_end() {
        let range = changed_line_range("a\nb\nc", "a\nb\nZ");
        assert_eq!(range, Some(LineRange { start: 3, end: 3 }));
    }

    // --- find_in_file_collateral_edits (in-file hunk-level) -----------------

    #[test]
    fn in_file_veto_change_within_window_is_allowed() {
        let pre = (1..=20)
            .map(|i| format!("line{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut cur_lines: Vec<String> = (1..=20).map(|i| format!("line{i}")).collect();
        cur_lines[9] = "CHANGED".to_string(); // line10 (1-indexed) — зміна поруч із порушенням.
        let cur = cur_lines.join("\n");

        let veto = find_in_file_collateral_edits(Some(&pre), Some(&cur), &[10], 5);

        assert_eq!(veto, None);
    }

    #[test]
    fn in_file_veto_change_outside_window_is_rejected() {
        let pre = (1..=25)
            .map(|i| format!("l{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut cur_lines: Vec<String> = (1..=25).map(|i| format!("l{i}")).collect();
        cur_lines[19] = "X".to_string(); // line20 — далеко за вікном ±5 навколо порушення на line3.
        let cur = cur_lines.join("\n");

        let veto = find_in_file_collateral_edits(Some(&pre), Some(&cur), &[3], 5);

        assert_eq!(veto, Some(LineRange { start: 20, end: 20 }));
    }

    #[test]
    fn in_file_veto_multiple_violation_lines_any_covers() {
        // Два порушення в одному файлі (line3, line50) — зміна поруч із
        // ХОЧА Б ОДНИМ з них лишається дозволеною.
        let pre = "a\nb\nc\nd\ne";
        let cur = "a\nb\nX\nd\ne"; // range {3,3} — у вікні line3±5, поза вікном line50±5.

        let veto = find_in_file_collateral_edits(Some(pre), Some(cur), &[3, 50], 5);

        assert_eq!(veto, None);
    }

    #[test]
    fn in_file_veto_multiple_violation_lines_none_covers() {
        // Та сама пара порушень (line3, line50), але зміна між ними — поза
        // вікном обох → veto.
        let pre = (1..=25)
            .map(|i| format!("l{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut cur_lines: Vec<String> = (1..=25).map(|i| format!("l{i}")).collect();
        cur_lines[19] = "X".to_string(); // line20: поза [3-5,3+5] і поза [50-5,50+5].
        let cur = cur_lines.join("\n");

        let veto = find_in_file_collateral_edits(Some(&pre), Some(&cur), &[3, 50], 5);

        assert_eq!(veto, Some(LineRange { start: 20, end: 20 }));
    }

    #[test]
    fn in_file_veto_unknown_violation_line_fails_open() {
        let veto = find_in_file_collateral_edits(Some("a\nb"), Some("a\nX"), &[], HUNK_WINDOW);
        assert_eq!(veto, None);
    }

    #[test]
    fn in_file_veto_missing_pre_image_or_current_fails_open() {
        assert_eq!(
            find_in_file_collateral_edits(None, Some("a"), &[1], HUNK_WINDOW),
            None
        );
        assert_eq!(
            find_in_file_collateral_edits(Some("a"), None, &[1], HUNK_WINDOW),
            None
        );
    }

    #[test]
    fn in_file_veto_identical_content_returns_none() {
        let veto =
            find_in_file_collateral_edits(Some("a\nb\nc"), Some("a\nb\nc"), &[1], HUNK_WINDOW);
        assert_eq!(veto, None);
    }

    #[test]
    fn in_file_veto_upsert_order_style_top_and_bottom_hunk_is_rejected() {
        // Регрес-фікстура за мотивами реального кейсу upsert-order.js:
        // порушення на line1 (відсутній doc-comment), рунг додає doc-comment
        // ЗВЕРХУ (легітимно) і водночас прибирає задокументований workaround
        // ДАЛЕКО внизу файлу. Грубий diff бачить ОДИН діапазон від першої до
        // останньої розбіжності — його "end" далеко за вікном±20 навколо
        // line1, тому veto спрацьовує, попри те що сам doc-comment-фікс
        // цілком у вікні.
        let mut pre_lines: Vec<String> = vec![
            "function doStuff() {".to_string(),
            "  return 1".to_string(),
            "}".to_string(),
            String::new(),
        ];
        pre_lines.extend((0..30).map(|i| format!("// padding {i}")));
        pre_lines.push(String::new());
        pre_lines.push(
            "// INTENTIONAL: Bun SQL не збирає jsonb[] коректно — не «виправляти».".to_string(),
        );
        pre_lines.push("const workaround = 1".to_string());
        let pre = pre_lines.join("\n");

        let mut cur_lines: Vec<String> = vec![
            "/**".to_string(),
            " * Does stuff.".to_string(),
            " */".to_string(),
        ];
        cur_lines.extend(pre_lines.iter().take(pre_lines.len() - 2).cloned());
        cur_lines.push("const workaround = 1".to_string()); // INTENTIONAL-рядок вирізано.
        let cur = cur_lines.join("\n");

        let veto = find_in_file_collateral_edits(Some(&pre), Some(&cur), &[1], HUNK_WINDOW);

        assert!(
            veto.is_some(),
            "top+bottom hunk має вийти за вікно й ветувати рунг"
        );
    }
}
