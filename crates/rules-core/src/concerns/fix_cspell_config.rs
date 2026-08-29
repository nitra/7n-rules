//! T0-фікс policy-концерну `text/cspell` (§2.79 реєстру
//! `docs/plans/2026-08-05-open-questions-register.md`, розділ 4 «Поодинокі»
//! плану `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`) —
//! порт `npm/rules/text/cspell/fix-cspell.mjs`.
//!
//! # Сусід, з яким його плутають
//!
//! `text/cspell` ≠ `text/cspell-fix`. Другий — LLM-**воркер**
//! (`crates/rules-fix/src/workers.rs`, доккомент [`super::fix`] розділ T4),
//! у нього немає `fix-<concern>.mjs` і ключа в [`super::fix::NATIVE_FIXES`]
//! бути НЕ може. Цей модуль — про перший: чистий policy-концерн
//! (`concern.json` → `policy.files.single = ".cspell.json"`, канон у
//! `.rego` + `template/`), детектор якого лишається на JS-policy-адаптері,
//! а T0-фікс тепер native. Той самий розклад, що в родини
//! [`super::fix_vscode_extensions`]: ключ у `NATIVE_FIXES` не вимагає
//! native-детектора.
//!
//! # Семантика (порт `fix-cspell.mjs`)
//!
//! - **Застосовність** — хоча б одна violation з `reason`
//!   `policy-file-missing` або `policy-deny` (обидва reason-и
//!   `policy-lint-adapter.mjs`).
//! - **Канон читається з template концерну, не з тексту violation**:
//!   `snippet` (`version`, `useGitignore`, `gitignoreRoot`, `ignorePaths`)
//!   + `contains` (`import`-підрядки). Тут обидва вшиті `include_str!`
//!   (той самий мотив, що в `MARKSMAN_BASELINE` модуля [`super::fix`]: файл стає
//!   частиною бінарника, «канон загубився при встановленні пакета»
//!   структурно неможливо).
//! - **Мерж, а не перезапис** — інцидент, заради якого JS-фікс і писався:
//!   скаффолд-перезапис зносив локальні `words` і repo-специфічні
//!   `ignorePaths` (`target/**`). Масиви — union (наявні елементи
//!   попереду, БЕЗ видалень), скаляри — канонічне значення, обʼєкти —
//!   недоторкані (rego їх не перевіряє). `contains`: needle дописується
//!   окремим елементом, лише якщо жоден наявний рядок його не містить.
//! - **`language`** — presence-only канон (inverse, живе в `.rego`, не в
//!   template): дефолт `en,uk` додається лише коли поля немає.
//! - **Заборонені import-и** (`@cspell/dict-*`, `template/.cspell.json.deny.json`)
//!   НЕ вирізаються — видалення лишається ручним рішенням, як у каноні.
//! - **Нічого не змінилось і файл існує** → порожній план.
//!
//! # Дефекти канону, полагоджені тут (не відтворені заради парності)
//!
//! 1. **JSONC-вхід.** `.cspell.json` — офіційно JSONC-формат самого
//!    cspell (його власний лоадер приймає `//`-коментарі), і в репо вони
//!    трапляються поруч із секціями `words`. Канон читав файл
//!    `JSON.parse` і на винятку робив `return { touchedFiles: [] }` —
//!    МОВЧАЗНИЙ no-op на цілком легальному конфізі: лінт світить
//!    порушення, `--fix` не робить нічого, причина ніде не звучить. Тут
//!    читання йде [`parse_jsonc_document`] — мерж бачить РЕАЛЬНИЙ вміст.
//!    Той самий фікс, що вже зроблено у [`super::fix_vscode_extensions`].
//! 2. **Не-обʼєктний корінь.** Канон робив `cfg.language = …` на будь-якому
//!    результаті `JSON.parse`: для масиву властивість тихо губилась при
//!    `JSON.stringify`, для скаляра — кидало. Тут не-обʼєктний корінь —
//!    явний no-op (нема з чого будувати мерж).
//!
//! Свідомо ЗБЕРЕЖЕНА поведінка канону: справді побитий (навіть не JSONC)
//! вміст → порожній план. Перезаписати сміття «канонічним» файлом означало
//! б знищити `words` користувача — рівно те, проти чого фікс і писався;
//! порушення при цьому лишається видимим у звіті лінту.

use std::path::Path;

use rules_template_merge::{json_to_pretty_string, parse_jsonc_document, Json};

use crate::diagnostics::Violation;

use super::fix::{FileEdit, FixPlan, WriteFile};

/// Ціль фіксу — posix-relative шлях від cwd (`policy.files.single`
/// концерну; `WriteFile::path` — relative, розгортає його виконавець плану).
const CSPELL_TARGET: &str = ".cspell.json";

/// Канонічний snippet — той самий файл, який JS-фіксер читав із
/// `ctx.concernDir`, і той самий, який policy-адаптер віддає rego як
/// `data.template.snippet`.
const CSPELL_SNIPPET: &str =
    include_str!("../../../../npm/rules/text/cspell/template/.cspell.json.snippet.json");

/// Канон `contains` — `data.template.contains` rego-перевірки.
const CSPELL_CONTAINS: &str =
    include_str!("../../../../npm/rules/text/cspell/template/.cspell.json.contains.json");

/// Дефолт presence-only поля `language` — порт літерала `fix-cspell.mjs`
/// (сам канон живе в `.rego` як inverse-перевірка, у template його немає).
const LANGUAGE_DEFAULT: &str = "en,uk";

/// `reason`-и policy-адаптера, за якими JS-патерн вважав себе застосовним
/// (`test:` у `fix-cspell.mjs`).
const APPLICABLE_REASONS: [&str; 2] = ["policy-file-missing", "policy-deny"];

/// Розбирає вшитий канон; `include_str!`-вміст валідний на етапі збірки,
/// тож `expect` тут — інваріант, а не runtime-умова.
fn parse_embedded(text: &str, what: &str) -> Vec<(String, Json)> {
    match parse_jsonc_document(text).unwrap_or(Json::Null) {
        Json::Object(entries) => entries,
        _ => panic!("вшитий канон {what} має бути JSON-обʼєктом"),
    }
}

/// Значення поля обʼєкта за ключем (mutable) — [`Json::get`] лише read-only.
fn entry_mut<'a>(entries: &'a mut [(String, Json)], key: &str) -> Option<&'a mut Json> {
    entries.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// Встановлює поле обʼєкта, зберігаючи позицію наявного ключа (нове —
/// у хвіст), точний відповідник присвоєння властивості в JS.
fn set_entry(entries: &mut Vec<(String, Json)>, key: &str, value: Json) {
    if let Some(slot) = entry_mut(entries, key) {
        *slot = value;
    } else {
        entries.push((key.to_string(), value));
    }
}

/// Merge канону snippet-а — точний порт `mergeSnippet`: масиви union
/// (наявні попереду, без видалень), скаляри — канонічне значення, обʼєкти
/// не чіпаємо. Повертає людиночитані описи змін (порожньо — без змін).
fn merge_snippet(cfg: &mut Vec<(String, Json)>, snippet: &[(String, Json)]) -> Vec<String> {
    let mut changes = Vec::new();
    for (key, canonical) in snippet {
        match canonical {
            Json::Array(canon_items) => {
                let existing: Vec<Json> = cfg
                    .iter()
                    .find(|(k, _)| k == key)
                    .and_then(|(_, v)| v.as_array().map(<[Json]>::to_vec))
                    .unwrap_or_default();
                let to_add: Vec<Json> = canon_items
                    .iter()
                    .filter(|c| !existing.contains(c))
                    .cloned()
                    .collect();
                if to_add.is_empty() {
                    continue;
                }
                changes.push(format!("{key}: +{}", to_add.len()));
                let mut merged = existing;
                merged.extend(to_add);
                set_entry(cfg, key, Json::Array(merged));
            }
            // `typeof canonical !== 'object'` у JS: обʼєкти пропускаємо,
            // масиви вже оброблені гілкою вище.
            Json::Object(_) => {}
            scalar => {
                if cfg.iter().any(|(k, v)| k == key && v == scalar) {
                    continue;
                }
                changes.push(format!("{key}={}", scalar_to_text(scalar)));
                set_entry(cfg, key, scalar.clone());
            }
        }
    }
    changes
}

/// `String(canonical)` для тексту повідомлення (лише скаляри).
fn scalar_to_text(value: &Json) -> String {
    match value {
        Json::Str(s) => s.clone(),
        Json::Bool(b) => b.to_string(),
        Json::Int(i) => i.to_string(),
        Json::Float(f) => f.to_string(),
        Json::Null => "null".to_string(),
        _ => String::new(),
    }
}

/// Merge contains-канону — точний порт `mergeContains`: для кожного `field`
/// кожен needle має ЗУСТРІЧАТИСЬ підрядком у якомусь елементі масиву;
/// інакше needle дописується окремим елементом (наявні не чіпаємо).
fn merge_contains(cfg: &mut Vec<(String, Json)>, contains: &[(String, Json)]) -> Vec<String> {
    let mut changes = Vec::new();
    for (field, needles) in contains {
        let Some(needles) = needles.as_array() else {
            continue;
        };
        let arr: Vec<Json> = cfg
            .iter()
            .find(|(k, _)| k == field)
            .and_then(|(_, v)| v.as_array().map(<[Json]>::to_vec))
            .unwrap_or_default();
        let missing: Vec<&str> = needles
            .iter()
            .filter_map(Json::as_str)
            .filter(|needle| {
                !arr.iter()
                    .filter_map(Json::as_str)
                    .any(|item| item.contains(needle))
            })
            .collect();
        if missing.is_empty() {
            continue;
        }
        changes.push(format!("{field}: +{}", missing.join(", ")));
        let mut merged = arr;
        merged.extend(missing.into_iter().map(|n| Json::Str(n.to_string())));
        set_entry(cfg, field, Json::Array(merged));
    }
    changes
}

/// Чи поле `language` присутнє й «truthy» — порт `if (!cfg.language)`
/// (порожній рядок, `false`, `0` і `null` у JS теж falsy).
fn has_language(cfg: &[(String, Json)]) -> bool {
    match cfg.iter().find(|(k, _)| k == "language").map(|(_, v)| v) {
        None | Some(Json::Null) => false,
        Some(Json::Str(s)) => !s.is_empty(),
        Some(Json::Bool(b)) => *b,
        Some(Json::Int(i)) => *i != 0,
        Some(Json::Float(f)) => *f != 0.0,
        Some(_) => true,
    }
}

/// T0-фікс `text/cspell` — merge-запис `.cspell.json` (доккомент модуля).
pub(crate) fn cspell_config_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let applicable = violations
        .iter()
        .any(|v| APPLICABLE_REASONS.contains(&v.reason.as_str()));
    if !applicable {
        return FixPlan::default();
    }

    let snippet = parse_embedded(CSPELL_SNIPPET, "snippet");
    let contains = parse_embedded(CSPELL_CONTAINS, "contains");

    let cfg_path = cwd.join(CSPELL_TARGET);
    let created = !cfg_path.exists();
    let existing = std::fs::read_to_string(&cfg_path).ok();

    let mut cfg: Vec<(String, Json)> = match &existing {
        None => Vec::new(),
        Some(text) => match parse_jsonc_document(text) {
            // Побитий вміст або не-обʼєктний корінь — no-op (доккомент
            // модуля: мерж нема з чого будувати, а перезапис знищив би
            // локальні `words`).
            Some(Json::Object(entries)) => entries,
            _ => return FixPlan::default(),
        },
    };

    let mut changes = merge_snippet(&mut cfg, &snippet);
    changes.extend(merge_contains(&mut cfg, &contains));
    if !has_language(&cfg) {
        set_entry(
            &mut cfg,
            "language",
            Json::Str(LANGUAGE_DEFAULT.to_string()),
        );
        changes.push(format!("language={LANGUAGE_DEFAULT}"));
    }
    if changes.is_empty() && !created {
        return FixPlan::default();
    }

    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: CSPELL_TARGET.to_string(),
            content: json_to_pretty_string(&Json::Object(cfg)),
        })],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn violation(reason: &str) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: "m".to_string(),
            file: Some(CSPELL_TARGET.to_string()),
            severity: Severity::Error,
            data: None,
        }
    }

    fn written(plan: &FixPlan) -> &str {
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, CSPELL_TARGET);
                &w.content
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    #[test]
    fn empty_plan_without_applicable_reason() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(cspell_config_fix(tmp.path(), &[]).edits.is_empty());
        assert!(cspell_config_fix(tmp.path(), &[violation("other")])
            .edits
            .is_empty());
    }

    #[test]
    fn creates_file_from_canon_when_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan = cspell_config_fix(tmp.path(), &[violation("policy-file-missing")]);
        let text = written(&plan);
        let doc = parse_jsonc_document(text).unwrap();
        assert_eq!(doc.get("version").and_then(Json::as_str), Some("0.2"));
        assert_eq!(doc.get("language").and_then(Json::as_str), Some("en,uk"));
        assert!(doc
            .get("ignorePaths")
            .and_then(Json::as_array)
            .unwrap()
            .contains(&Json::Str("**/node_modules/**".to_string())));
        assert_eq!(
            doc.get("import").and_then(Json::as_array),
            Some(&[Json::Str("@nitra/cspell-dict".to_string())][..])
        );
        assert!(text.ends_with("}\n"));
    }

    /// Головна гарантія концерну: локальні `words`/`ignorePaths` не зникають.
    #[test]
    fn merges_without_dropping_local_entries() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join(CSPELL_TARGET),
            r#"{"version":"0.1","words":["nitra"],"ignorePaths":["target/**"],"import":["@nitra/cspell-dict/x"]}"#,
        )
        .unwrap();
        let plan = cspell_config_fix(tmp.path(), &[violation("policy-deny")]);
        let doc = parse_jsonc_document(written(&plan)).unwrap();

        assert_eq!(doc.get("version").and_then(Json::as_str), Some("0.2"));
        assert_eq!(
            doc.get("words").and_then(Json::as_array),
            Some(&[Json::Str("nitra".to_string())][..])
        );
        let ignore = doc.get("ignorePaths").and_then(Json::as_array).unwrap();
        assert_eq!(ignore[0], Json::Str("target/**".to_string()));
        assert!(ignore.contains(&Json::Str("**/.git/**".to_string())));
        // contains: наявний елемент уже МІСТИТЬ needle як підрядок → не дублюємо.
        assert_eq!(
            doc.get("import").and_then(Json::as_array),
            Some(&[Json::Str("@nitra/cspell-dict/x".to_string())][..])
        );
    }

    #[test]
    fn canonical_config_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan = cspell_config_fix(tmp.path(), &[violation("policy-file-missing")]);
        std::fs::write(tmp.path().join(CSPELL_TARGET), written(&plan)).unwrap();
        assert!(
            cspell_config_fix(tmp.path(), &[violation("policy-deny")])
                .edits
                .is_empty(),
            "повторний прогін має бути ідемпотентним"
        );
    }

    /// Полагоджений дефект канону №1: JSONC більше не мовчазний no-op.
    #[test]
    fn jsonc_input_is_parsed_not_silently_skipped() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join(CSPELL_TARGET),
            "{\n  // локальний словник\n  \"words\": [\"nitra\"],\n}\n",
        )
        .unwrap();
        let plan = cspell_config_fix(tmp.path(), &[violation("policy-deny")]);
        let doc = parse_jsonc_document(written(&plan)).unwrap();
        assert_eq!(
            doc.get("words").and_then(Json::as_array),
            Some(&[Json::Str("nitra".to_string())][..]),
            "локальні words мали пережити мерж JSONC-входу"
        );
        assert_eq!(doc.get("version").and_then(Json::as_str), Some("0.2"));
    }

    /// Полагоджений дефект канону №2: не-обʼєктний корінь — явний no-op.
    #[test]
    fn non_object_root_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(CSPELL_TARGET), "[1, 2]").unwrap();
        assert!(cspell_config_fix(tmp.path(), &[violation("policy-deny")])
            .edits
            .is_empty());
    }

    /// Свідомо збережена поведінка канону: побите сміття не перезаписується.
    #[test]
    fn broken_content_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(CSPELL_TARGET), "{ not json at all").unwrap();
        assert!(cspell_config_fix(tmp.path(), &[violation("policy-deny")])
            .edits
            .is_empty());
    }

    #[test]
    fn existing_language_is_not_overwritten() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join(CSPELL_TARGET),
            r#"{"language":"en","version":"0.2"}"#,
        )
        .unwrap();
        let plan = cspell_config_fix(tmp.path(), &[violation("policy-deny")]);
        let doc = parse_jsonc_document(written(&plan)).unwrap();
        assert_eq!(doc.get("language").and_then(Json::as_str), Some("en"));
    }
}
