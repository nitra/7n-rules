//! Ядрова (native) половина рушія `createTemplateFixPattern`
//! (`npm/scripts/lib/fix/template-deep-merge.mjs`) — розділ «1. Родина
//! `vscode_*`/`zed_settings`» плану
//! `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`, запис §2.74
//! реєстру `docs/plans/2026-08-05-open-questions-register.md`.
//!
//! # Форма: конфіги, а не пʼять реалізацій
//!
//! JS-канон цих концернів — тонкі шими: РІВНО один виклик
//! `createTemplateFixPattern({ id, targetPath })` плюс канонічний
//! `template/<basename>.snippet.json`. Тож і порт — конфіг-подібний:
//! [`TemplateFixCfg`] × пʼять констант поверх ОДНОЇ функції
//! [`template_merge_fix`]. Дзеркало тієї самої форми на плагінній колії —
//! `TemplateFixCfg`/`fix_template_merge` у `crates/plugin-ci-github/src/lib.rs`
//! (там 14 конфігів на один рушій).
//!
//! Сам рушій (deep-subset `is_subset`, deep-merge `merge_json_value`,
//! хірургічний comment-preserving `try_surgical_merge`) не дублюється —
//! він живе у спільному крейті `rules-template-merge` (§2.71), який беруть
//! ОБИДВІ колії. Розходження семантики мержу між ядром і гостями
//! неможливе за побудовою.
//!
//! # Чому в [`TemplateFixCfg`] немає поля формату
//!
//! Плагінний `TemplateFixCfg` має `is_yaml: bool` — там 13 із 14 таргетів
//! це `.github/workflows/*.yml`. Ядрова частина родини — **виключно
//! JSON/JSONC** (`.vscode/settings.json`, `.zed/settings.json`,
//! `.oxfmtrc.json`), жодного YAML-таргета. `rules-core` бере
//! `rules-template-merge` з дефолтною фічею `jsonc`, тож варіанта
//! `Format::Yaml` у цій збірці ПРОСТО НЕ ІСНУЄ (доккомент
//! `rules-template-merge/src/lib.rs`, розділ «Чому `Format`»). Поле-прапорець
//! тут було б мертвим полем, яке одного дня хтось виставив би в `true` і
//! отримав би помилку компіляції в чужому місці — краще його не мати.
//!
//! # Три свідомі відхилення від JS-канону (усі — НА КРАЩЕ)
//!
//! Принцип проєкту — «мовчазний skip чи мовчазне псування даних це вада, а
//! не делікатність». JS-канон має в цьому рушії три такі місця; native
//! відтворює семантику мержу точно, але ці три — ні:
//!
//! 1. **JSONC-вхід більше не втрачається.** `computeJsonNextText` читає
//!    таргет через `JSON.parse` — строгий JSON. Реальний
//!    `.vscode/settings.json` майже завжди JSONC: `//`-коментарі й trailing
//!    кома, які сам VS Code читає штатно. Канон на такому файлі кидає в
//!    `catch` і повертає `null` — тобто МОВЧКИ не фіксить нічого, а concern
//!    лишається червоним назавжди. Native читає таргет
//!    [`parse_jsonc_document`]-ом (рівно контракт JSONC, без JSON5-вольниці) і
//!    реально мерджить; коментарі при цьому виживають через хірургічний
//!    шлях [`try_surgical_merge`]. Побитий синтаксис (СПРАВДІ невалідний, не
//!    JSONC) лишається тим самим контрактом «не чіпаємо файл».
//!
//! 2. **Не-обʼєктний корінь більше не знищується.** Якщо таргет — валідний
//!    JSON, але не обʼєкт (`[1,2]`, `"текст"`, `42` — реальний слід
//!    зіпсованого редактором/скриптом конфігу), `JSON.parse` у каноні
//!    успішний, а `mergeJsonValue` на не-обʼєктному `actual` починає з
//!    порожнього `{}` і ТИХО перезаписує файл, знищивши попередній вміст.
//!    Native: [`parse_jsonc_document`] повертає `Some` лише для обʼєктного
//!    кореня, інакше план порожній — файл не чіпається, а діагностика
//!    concern-а лишається видимою. Це НЕ мовчазний skip: користувач бачить
//!    червоний concern і сам вирішує, що робити зі своїм зламаним конфігом,
//!    замість того щоб дізнатися про втрату вмісту з `git diff`.
//!
//! 3. **Коментарі й форматування виживають.** Канон, коли таки мерджить,
//!    робить `JSON.stringify(..., 2)` — повна регенерація, коментарі та
//!    стиль наявного файлу зникають. Native спершу пробує хірургічний
//!    байтовий splice ([`try_surgical_merge`] з post-generation guard-ом) і
//!    падає на повну регенерацію ([`merge_json_value`] +
//!    [`json_to_pretty_string`], байт-у-байт форма канону) лише коли splice
//!    недосяжний чи не пройшов перевірку.
//!
//! Гейт парності з JS-каноном на цих трьох кейсах СВІДОМО розходиться —
//! тести фіксують native-поведінку як правильну, а не підганяються під
//! дефект (`npm/rules/*/tests/fix-*-native.test.mjs`).

use std::path::Path;

use rules_template_merge::{
    is_subset, json_to_pretty_string, merge_json_value, parse_jsonc_document, try_surgical_merge,
    Format, Json,
};

use super::fix::{FileEdit, FixPlan, WriteFile};
use crate::diagnostics::Violation;

/// Статична конфігурація одного `createTemplateFixPattern`-концерну ядрової
/// колії: цільовий файл + канонічний snippet, вшитий у бінарник на етапі
/// компіляції.
///
/// `snippet_raw` — БАЙТ-У-БАЙТ текст `template/<basename>.snippet.json`
/// концерну: на відсутньому таргеті він копіюється verbatim, точно як
/// `writeFileSync(absTarget, rawSnippet, 'utf8')` канону. `include_str!`
/// (а не читання з `ctx.concernDir` у рантаймі) — той самий мотив, що
/// `MARKSMAN_BASELINE` (`super::fix`) і `security/trufflehog`: клас помилки
/// «канонічний snippet не доїхав у npm-пакет» стає структурно неможливим.
pub struct TemplateFixCfg {
    /// Posix-relative шлях цільового файлу від кореня consumer-репо.
    pub target_path: &'static str,
    /// Сирий текст канонічного snippet-а концерну.
    pub snippet_raw: &'static str,
}

/// `rego/vscode_settings` — `[rego]`-блок форматера OPA у `.vscode/settings.json`.
const REGO_VSCODE_SETTINGS_CFG: TemplateFixCfg = TemplateFixCfg {
    target_path: ".vscode/settings.json",
    snippet_raw: include_str!(
        "../../../../npm/rules/rego/vscode_settings/template/settings.json.snippet.json"
    ),
};

/// `text/vscode_settings` — `formatOnSave` + oxc-форматер по мовах.
const TEXT_VSCODE_SETTINGS_CFG: TemplateFixCfg = TemplateFixCfg {
    target_path: ".vscode/settings.json",
    snippet_raw: include_str!(
        "../../../../npm/rules/text/vscode_settings/template/settings.json.snippet.json"
    ),
};

/// `worktree/vscode_settings` — `search.exclude`/`files.exclude` для `.worktrees`.
const WORKTREE_VSCODE_SETTINGS_CFG: TemplateFixCfg = TemplateFixCfg {
    target_path: ".vscode/settings.json",
    snippet_raw: include_str!(
        "../../../../npm/rules/worktree/vscode_settings/template/settings.json.snippet.json"
    ),
};

/// `worktree/zed_settings` — `file_scan_exclusions` у `.zed/settings.json`.
/// ЄДИНИЙ з пʼяти, чий snippet містить масив: перевіряє гілку
/// [`merge_json_value`], що додає лише структурно відсутні елементи.
const WORKTREE_ZED_SETTINGS_CFG: TemplateFixCfg = TemplateFixCfg {
    target_path: ".zed/settings.json",
    snippet_raw: include_str!(
        "../../../../npm/rules/worktree/zed_settings/template/settings.json.snippet.json"
    ),
};

/// `text/oxfmtrc` — `.oxfmtrc.json`. Пʼятий конфіг того самого рушія:
/// `fix-oxfmtrc.mjs` — такий самий однорядковий шим
/// (`createTemplateFixPattern({ id, targetPath })`), таргет теж `.json`,
/// тож порт коштує рівно однієї константи.
const TEXT_OXFMTRC_CFG: TemplateFixCfg = TemplateFixCfg {
    target_path: ".oxfmtrc.json",
    snippet_raw: include_str!(
        "../../../../npm/rules/text/oxfmtrc/template/.oxfmtrc.json.snippet.json"
    ),
};

/// Розбирає вшитий snippet концерну. Panics — це інваріант ЗБІРКИ, не
/// рантайм-умова: snippet приїхав через `include_str!`, тож «невалідний
/// JSON» тут означає, що зламаний файл у репозиторії, і мовчазна деградація
/// (порожній план) сховала б це від усіх.
fn parse_embedded_snippet(cfg: &TemplateFixCfg) -> Json {
    parse_jsonc_document(cfg.snippet_raw).unwrap_or_else(|| {
        panic!(
            "вшитий snippet концерну {} — валідний JSON-обʼєкт",
            cfg.target_path
        )
    })
}

/// Точний порт `createTemplateFixPattern(...).apply` для JSON/JSONC-таргета
/// (три свідомі відхилення — доккомент модуля).
///
/// Послідовність: немає жодної діагностики про `cfg.target_path` → порожній
/// план (порт `violations.every(v => v.file !== targetPath)`); файлу немає →
/// snippet копіюється verbatim; файл є, але не парситься як JSONC-обʼєкт →
/// порожній план; файл уже задовольняє snippet ([`is_subset`]) → порожній
/// план (idempotent, без reformat); інакше — хірургічний splice з
/// fallback-ом на повну регенерацію.
pub fn template_merge_fix(cwd: &Path, violations: &[Violation], cfg: &TemplateFixCfg) -> FixPlan {
    let empty = FixPlan { edits: vec![] };
    if !violations
        .iter()
        .any(|v| v.file.as_deref() == Some(cfg.target_path))
    {
        return empty;
    }

    let abs = cwd.join(cfg.target_path);
    let Ok(source) = std::fs::read_to_string(&abs) else {
        // Файл відсутній (чи нечитний) → копіюємо snippet як є: мерджити
        // немає з чим — той самий контракт, що `prevText === null` у каноні.
        return FixPlan {
            edits: vec![FileEdit::Write(WriteFile {
                path: cfg.target_path.to_string(),
                content: cfg.snippet_raw.to_string(),
            })],
        };
    };

    let Some(actual) = parse_jsonc_document(&source) else {
        return empty; // побитий синтаксис або не-обʼєктний корінь — не чіпаємо
    };
    let snippet = parse_embedded_snippet(cfg);
    if is_subset(Some(&actual), &snippet) {
        return empty;
    }

    let content = try_surgical_merge(&source, &snippet, Format::Jsonc)
        .unwrap_or_else(|| json_to_pretty_string(&merge_json_value(Some(&actual), &snippet)));
    if content == source {
        return empty;
    }
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: cfg.target_path.to_string(),
            content,
        })],
    }
}

/// `rego/vscode_settings` — див. [`template_merge_fix`].
pub fn rego_vscode_settings_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    template_merge_fix(cwd, violations, &REGO_VSCODE_SETTINGS_CFG)
}

/// `text/vscode_settings` — див. [`template_merge_fix`].
pub fn text_vscode_settings_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    template_merge_fix(cwd, violations, &TEXT_VSCODE_SETTINGS_CFG)
}

/// `worktree/vscode_settings` — див. [`template_merge_fix`].
pub fn worktree_vscode_settings_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    template_merge_fix(cwd, violations, &WORKTREE_VSCODE_SETTINGS_CFG)
}

/// `worktree/zed_settings` — див. [`template_merge_fix`].
pub fn worktree_zed_settings_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    template_merge_fix(cwd, violations, &WORKTREE_ZED_SETTINGS_CFG)
}

/// `text/oxfmtrc` — див. [`template_merge_fix`].
pub fn text_oxfmtrc_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    template_merge_fix(cwd, violations, &TEXT_OXFMTRC_CFG)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn violation(file: &str) -> Violation {
        Violation {
            reason: "policy-template-mismatch".to_string(),
            message: "m".to_string(),
            file: Some(file.to_string()),
            severity: Severity::Error,
            data: None,
        }
    }

    fn written(plan: &FixPlan) -> (&str, &str) {
        assert_eq!(plan.edits.len(), 1, "очікували рівно одну правку");
        match &plan.edits[0] {
            FileEdit::Write(w) => (w.path.as_str(), w.content.as_str()),
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    #[test]
    fn all_embedded_snippets_are_valid_json_objects() {
        for cfg in [
            &REGO_VSCODE_SETTINGS_CFG,
            &TEXT_VSCODE_SETTINGS_CFG,
            &WORKTREE_VSCODE_SETTINGS_CFG,
            &WORKTREE_ZED_SETTINGS_CFG,
            &TEXT_OXFMTRC_CFG,
        ] {
            assert!(matches!(parse_embedded_snippet(cfg), Json::Object(_)));
        }
    }

    #[test]
    fn no_violation_for_target_gives_empty_plan() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            worktree_zed_settings_fix(dir.path(), &[]).edits.is_empty(),
            "порожні violations"
        );
        assert!(
            worktree_zed_settings_fix(dir.path(), &[violation("інший/файл.json")])
                .edits
                .is_empty(),
            "violation про чужий файл"
        );
    }

    #[test]
    fn missing_target_is_created_from_snippet_verbatim() {
        let dir = tempfile::tempdir().unwrap();
        let plan = text_oxfmtrc_fix(dir.path(), &[violation(".oxfmtrc.json")]);
        let (path, content) = written(&plan);
        assert_eq!(path, ".oxfmtrc.json");
        assert_eq!(content, TEXT_OXFMTRC_CFG.snippet_raw);
    }

    #[test]
    fn canonical_content_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".vscode")).unwrap();
        std::fs::write(
            dir.path().join(".vscode/settings.json"),
            WORKTREE_VSCODE_SETTINGS_CFG.snippet_raw,
        )
        .unwrap();
        let plan = worktree_vscode_settings_fix(dir.path(), &[violation(".vscode/settings.json")]);
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn merges_into_existing_object_keeping_local_keys() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".vscode")).unwrap();
        std::fs::write(
            dir.path().join(".vscode/settings.json"),
            "{\n  \"editor.tabSize\": 2\n}\n",
        )
        .unwrap();
        let plan = worktree_vscode_settings_fix(dir.path(), &[violation(".vscode/settings.json")]);
        let (_, content) = written(&plan);
        assert!(content.contains("editor.tabSize"), "локальний ключ вижив");
        assert!(content.contains("search.exclude"));
        assert!(content.contains("files.exclude"));
        assert!(content.contains("**/.worktrees/**"));
    }

    /// Відхилення 1 (доккомент модуля): JSONC-вхід канон губив
    /// (`JSON.parse` → `catch` → `null`), native мерджить і зберігає коментар.
    #[test]
    fn jsonc_input_is_merged_and_comments_survive() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".vscode")).unwrap();
        std::fs::write(
            dir.path().join(".vscode/settings.json"),
            "{\n  // локальний коментар користувача\n  \"editor.tabSize\": 2,\n}\n",
        )
        .unwrap();
        let plan = worktree_vscode_settings_fix(dir.path(), &[violation(".vscode/settings.json")]);
        let (_, content) = written(&plan);
        assert!(
            content.contains("// локальний коментар користувача"),
            "коментар вижив: {content}"
        );
        assert!(content.contains("search.exclude"));
    }

    /// Відхилення 2: не-обʼєктний корінь канон ТИХО затирав, native не чіпає.
    #[test]
    fn non_object_root_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".vscode")).unwrap();
        std::fs::write(dir.path().join(".vscode/settings.json"), "[1, 2, 3]\n").unwrap();
        let plan = worktree_vscode_settings_fix(dir.path(), &[violation(".vscode/settings.json")]);
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn broken_syntax_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".vscode")).unwrap();
        std::fs::write(dir.path().join(".vscode/settings.json"), "{ не json").unwrap();
        let plan = worktree_vscode_settings_fix(dir.path(), &[violation(".vscode/settings.json")]);
        assert!(plan.edits.is_empty());
    }

    /// Масивна гілка мержу: наявні елементи лишаються, бракітні додаються
    /// БЕЗ дублювання вже присутніх.
    #[test]
    fn zed_array_union_without_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".zed")).unwrap();
        std::fs::write(
            dir.path().join(".zed/settings.json"),
            "{\n  \"file_scan_exclusions\": [\"**/.git\", \"**/custom\"]\n}\n",
        )
        .unwrap();
        let plan = worktree_zed_settings_fix(dir.path(), &[violation(".zed/settings.json")]);
        let (path, content) = written(&plan);
        assert_eq!(path, ".zed/settings.json");
        assert!(content.contains("**/custom"), "локальний елемент вижив");
        assert_eq!(content.matches("\"**/.git\"").count(), 1, "без дублювання");
        assert!(content.contains("**/.claude/worktrees"));
    }

    /// Два різні концерни на ОДНОМУ таргеті (`.vscode/settings.json`) —
    /// кожен домерджує лише свій snippet і не зачіпає чужі ключі.
    #[test]
    fn two_concerns_share_one_target_without_clobbering() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join(".vscode/settings.json");
        std::fs::create_dir_all(dir.path().join(".vscode")).unwrap();
        std::fs::write(&target, "{}\n").unwrap();

        let v = [violation(".vscode/settings.json")];
        let (_, first) = {
            let plan = rego_vscode_settings_fix(dir.path(), &v);
            let (_, c) = written(&plan);
            (0, c.to_string())
        };
        std::fs::write(&target, &first).unwrap();
        let plan = worktree_vscode_settings_fix(dir.path(), &v);
        let (_, second) = written(&plan);
        assert!(second.contains("[rego]"), "ключ першого концерну вижив");
        assert!(second.contains("search.exclude"));
    }
}
