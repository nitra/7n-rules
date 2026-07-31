//! Native fix-домен для builtin-концернів (T1 зрізу 4 фази 7,
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4) — Rust-порт
//! T0-патернів (`fix-<concern>.mjs`, `npm/scripts/lib/lint-surface/types.mjs`
//! `T0Pattern`) для двох пілотних builtin-концернів: `doc-files/marksman_config`
//! (`npm/rules/doc-files/marksman_config/fix-marksman_config.mjs`) і
//! `hasura/migrations` (`npm/rules/hasura/migrations/fix-migrations.mjs`).
//!
//! # Форма — дзеркало `rules-contract::fix`, БЕЗ залежності на `rules-contract`
//!
//! [`FixPlan`]/[`FileEdit`]/[`WriteFile`] тут — структурно ідентичні
//! `rules_contract::fix::{FixPlan, FileEdit, WriteFile}` (той самий
//! `#[serde(tag = "type", rename_all = "lowercase")]` дискримінант
//! `"write"`/`"delete"`, той самий мінімум "повний новий вміст або
//! видалення", доккомент модуля `crates/rules-contract/src/fix.rs`).
//! Дублювання, не імпорт — той самий мотив, що документує E1 фази 5 для
//! diagnostics DTO ([`crate::diagnostics::Violation`] дзеркалить WIT
//! `diagnostic`, а не навпаки): `rules-core` НЕ залежить на `rules-contract`
//! (перевірте `Cargo.toml` — `rules-contract` підключає лише `rules-napi`,
//! як міст до wasm-плагінів contract v3), а `rules-contract` — контракт
//! WIT-межі з guest-плагінами, не внутрішній тип оркестрації builtin-концернів.
//! Зворотна залежність (`rules-core` → `rules-contract`) увела б архітектурну
//! інверсію: WIT-крейт існує ЗАРАДИ wasm-межі (`rules-plugin-host` +
//! guest-и), а не як спільна бібліотека типів для native-коду, який під
//! wasmtime не виконується взагалі.
//!
//! **План злиття** (як і в diagnostics DTO, секція «Фаза 5» спеки): коли
//! реєстр `NATIVE_CONCERNS`/`NATIVE_FIXES` узагальниться до єдиного
//! інтерфейсу builtin ↔ wasm (рішення И, фаза 6, статус §7 спеки — «чинний
//! реєстр `NATIVE_CONCERNS` узагальнюється до одного інтерфейсу»), дублікат
//! тут стає кандидатом на видалення: або `rules-contract::fix` переїжджає в
//! окремий DTO-крейт без залежності на WIT-генерацію коду (спільний і для
//! `rules-core`, і для `rules-plugin-host`), або builtin fix-домен сам
//! переїжджає під той самий інтерфейс, що й wasm-фікси, і викликає
//! `rules-contract::fix` напряму через цей спільний шар. До того — точна
//! структурна відповідність полів звірена руками (і тестами нижче), як і
//! diagnostics DTO звіряється з `normalizeViolation` (`detect.mjs`).
//!
//! # Реєстр [`NATIVE_FIXES`] і диспетчер [`run_concern_fix`]
//!
//! Дзеркалить [`super::NATIVE_CONCERNS`]/[`super::run_concern`]: JS-оркестратор
//! (`run-fix.mjs`) звіряє належність `ruleId/concernId`-ключа до
//! [`NATIVE_FIXES`] ДО виклику — невідомий ключ тут теж повертає
//! `RulesError::Concern`, той самий останній рубіж захисту, не основний
//! контракт маршрутизації.
//!
//! На відміну від [`super::run_concern`] (детектор може мати
//! `files`-параметр), fix-домен НЕ читає файлову систему цільового репо
//! напряму й нічого не пише сам — [`run_concern_fix`] лише БУДУЄ [`FixPlan`]
//! (декларативний список операцій) із вхідних `violations`; застосування
//! (`fs::write`/`fs::remove_file`, `ctx.recordWrite` для rollback-контракту)
//! лишається на JS-боці (`run-fix.mjs`, обгортка над T0Pattern — секція
//! нижче). `cwd`-параметр (той самий, що бере [`super::run_concern`])
//! лишається у сигнатурі для симетрії API й майбутніх native-фіксів, яким
//! знадобиться читати cwd-стан (напр. умовний edit залежно від наявного
//! вмісту файлу) — жоден із двох пілотів тут цього не потребує.
//!
//! # Зміна семантики: install-guard недосяжний у native
//!
//! JS-версія `fix-marksman_config.mjs` перевіряє `existsSync(MARKSMAN_BASELINE_PATH)`
//! ПЕРЕД копіюванням і кидає дружню помилку «інсталяція @7n/rules пошкоджена,
//! перевстанови пакет» — це install-sanity-guard проти зламаного npm-пакета
//! (відсутній `data/marksman_config/marksman.baseline.toml` через обрізаний
//! `files`-whitelist чи пошкоджений `node_modules`). Native-порт вбудовує
//! baseline у бінарник через `include_str!` НА ЕТАПІ КОМПІЛЯЦІЇ — файл
//! стає частиною самого cdylib/бінаря, а не окремим artifact-ом на диску,
//! який можна «загубити» при встановленні npm-пакета. Це означає:
//!
//!   - клас помилки «canonical baseline відсутній на диску» СТРУКТУРНО
//!     неможливий для native-шляху — якщо аддон завантажився і
//!     [`contract_version`](../../../rules-napi) збігається, baseline ГАРАНТОВАНО
//!     є (він зашитий у той самий бінарний файл, що й код перевірки);
//!   - install-guard і його дружнє повідомлення («перевстанови пакет»)
//!     НЕ портуються — немає стану, який вони мали б ловити;
//!   - це свідома зміна поведінки зламаної інсталяції, не забутий кейс:
//!     стара JS-гілка (і її тест) явно документують, що вона більше не
//!     застосовна до native-шляху (секція в тесті fix-run.mjs/T0-обгортки,
//!     дивись план задачі — «install-guard тест marksman — його онови під
//!     нову семантику»).

use std::path::Path;

use crate::{diagnostics::Violation, RulesError};

/// Записати файл — повний новий вміст. Структурний відповідник
/// `rules_contract::fix::WriteFile` (доккомент модуля вище).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WriteFile {
    /// Posix-relative шлях від cwd (той самий контракт, що
    /// `rules_contract::detect::SourceFile::path`).
    pub path: String,
    pub content: String,
}

/// Одна файлова операція fix-plan-у. Структурний відповідник
/// `rules_contract::fix::FileEdit` — той самий `type`-дискримінант
/// (`"write"`/`"delete"`), той самий мінімум «write повним вмістом | delete».
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FileEdit {
    Write(WriteFile),
    Delete { path: String },
}

/// Результат `run_concern_fix` — впорядкований список операцій; порожній
/// список = «для цих violations фіксити нічого» (той самий контракт
/// «непорожній план» ⇔ «застосовний», який JS-обгортка (`run-fix.mjs`)
/// використовує замість окремого `T0Pattern.test()` — доккомент модуля).
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct FixPlan {
    pub edits: Vec<FileEdit>,
}

/// Canonical baseline `.marksman.toml`, вбудований у бінарник на етапі
/// компіляції — джерело правди те саме, що постачається в npm-пакеті
/// (`npm/rules/doc-files/marksman_config/data/marksman_config/marksman.baseline.toml`,
/// той самий файл, який читає JS-фіксер через `MARKSMAN_BASELINE_PATH`).
/// Секція «Зміна семантики» вище пояснює, чому install-guard,
/// що охороняв JS-версію цього читання, тут не потрібен.
const MARKSMAN_BASELINE: &str = include_str!(
    "../../../../npm/rules/doc-files/marksman_config/data/marksman_config/marksman.baseline.toml"
);

/// Ціль copy-фіксу — порт `MARKSMAN_TARGET_FILENAME`
/// (`fix-marksman_config.mjs:18`, `crates/rules-core/src/concerns/marksman_config.rs:29`).
const MARKSMAN_TARGET_FILENAME: &str = ".marksman.toml";

/// Ключ `data.kind`, за яким детектор [`super::marksman_config`] позначає
/// violation (`crates/rules-core/src/concerns/marksman_config.rs:33,50`) —
/// той самий, за яким матчився JS T0-патерн (`v.data?.kind`).
const MARKSMAN_MISSING_KIND: &str = "marksman-config-missing";

/// T0-фікс `doc-files/marksman_config` — точний семантичний порт
/// `patterns[0]` з `fix-marksman_config.mjs` (мінус install-guard, секція
/// доккомент модуля вище). Застосовність: хоча б одна violation з
/// `data.kind === "marksman-config-missing"` (`test()` у JS-версії) — план
/// непорожній лише тоді.
fn marksman_config_fix(violations: &[Violation]) -> FixPlan {
    let applicable = violations.iter().any(|v| {
        v.data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str())
            == Some(MARKSMAN_MISSING_KIND)
    });
    if !applicable {
        return FixPlan::default();
    }
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: MARKSMAN_TARGET_FILENAME.to_string(),
            content: MARKSMAN_BASELINE.to_string(),
        })],
    }
}

/// `reason`, за яким детектор [`super::hasura_migrations`] позначає
/// violation (`crates/rules-core/src/concerns/hasura_migrations.rs:19`) —
/// той самий, за яким матчився JS T0-патерн (`v.reason === 'down-sql-forbidden'`).
const HASURA_DOWN_SQL_REASON: &str = "down-sql-forbidden";

/// T0-фікс `hasura/migrations` — точний семантичний порт `patterns[0]` з
/// `fix-migrations.mjs`: видалити кожен `down.sql`, на який вказує
/// violation з `reason === "down-sql-forbidden"`. Дедуп за шляхом (той самий
/// `[...new Set(...)]` у JS) — план не містить дублікатів `Delete` для
/// одного файлу, навіть якщо кілька violations вказують на нього.
fn hasura_migrations_fix(violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        if v.reason != HASURA_DOWN_SQL_REASON {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if !seen.insert(file.clone()) {
            continue;
        }
        edits.push(FileEdit::Delete { path: file.clone() });
    }
    FixPlan { edits }
}

/// Ключі native-портованих fix-ів (`ruleId/concernId`) — той самий формат,
/// що [`super::NATIVE_CONCERNS`]. Підмножина: не кожен native-детектор має
/// native-фікс (пілот T1 зрізу 4 — лише два з двадцяти шести).
pub const NATIVE_FIXES: &[&str] = &["doc-files/marksman_config", "hasura/migrations"];

/// Будує [`FixPlan`] для native-fix-концерну за ключем `ruleId/concernId`.
///
/// - `cwd` — абсолютний корінь consumer-репо (доккомент модуля — симетрія з
///   [`super::run_concern`], жоден із двох пілотів наразі не читає файлову
///   систему тут).
/// - `violations` — підмножина результату `detect` для цього concern-а
///   (дзеркало `FixRequest::diagnostics` у `rules-contract::fix`).
///
/// Невідомий ключ → [`RulesError::Concern`] (JS-бік має звіряти належність
/// до [`NATIVE_FIXES`] ДО виклику — остання лінія захисту, не основний
/// контракт, той самий мотив, що документує [`super::run_concern`]).
pub fn run_concern_fix(
    key: &str,
    cwd: &Path,
    violations: &[Violation],
) -> Result<FixPlan, RulesError> {
    let _ = cwd;
    match key {
        "doc-files/marksman_config" => Ok(marksman_config_fix(violations)),
        "hasura/migrations" => Ok(hasura_migrations_fix(violations)),
        other => Err(RulesError::Concern(format!(
            "невідомий native fix: {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn violation(reason: &str, file: Option<&str>, data: Option<serde_json::Value>) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: "m".to_string(),
            file: file.map(|f| f.to_string()),
            severity: Severity::Error,
            data,
        }
    }

    // ── marksman_config ──

    #[test]
    fn marksman_fix_empty_plan_without_matching_violation() {
        let plan = marksman_config_fix(&[]);
        assert!(plan.edits.is_empty());
        let plan = marksman_config_fix(&[violation("other", None, None)]);
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn marksman_fix_writes_embedded_baseline_when_missing_kind_present() {
        let v = violation(
            "marksman-config-missing",
            Some(".marksman.toml"),
            Some(serde_json::json!({ "kind": "marksman-config-missing" })),
        );
        let plan = marksman_config_fix(&[v]);
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, ".marksman.toml");
                assert!(w.content.contains("[core]"));
                assert!(w.content.contains("[completion]"));
                assert!(w.content.contains("[code_action]"));
            }
            FileEdit::Delete { .. } => panic!("очікували write"),
        }
    }

    #[test]
    fn marksman_fix_ignores_violations_without_matching_kind() {
        let v = violation("marksman-config-missing", Some(".marksman.toml"), None);
        assert!(marksman_config_fix(&[v]).edits.is_empty());
    }

    // ── hasura/migrations ──

    #[test]
    fn hasura_fix_empty_plan_without_violations() {
        assert!(hasura_migrations_fix(&[]).edits.is_empty());
    }

    #[test]
    fn hasura_fix_deletes_each_down_sql_file() {
        let violations = vec![
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/2000_add_bar/down.sql"),
                None,
            ),
        ];
        let plan = hasura_migrations_fix(&violations);
        assert_eq!(plan.edits.len(), 2);
        for edit in &plan.edits {
            match edit {
                FileEdit::Delete { path } => assert!(path.ends_with("down.sql")),
                FileEdit::Write(_) => panic!("очікували delete"),
            }
        }
    }

    #[test]
    fn hasura_fix_dedup_same_file_across_multiple_violations() {
        let violations = vec![
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
        ];
        assert_eq!(hasura_migrations_fix(&violations).edits.len(), 1);
    }

    #[test]
    fn hasura_fix_ignores_other_reasons_and_missing_file() {
        let violations = vec![
            violation("other-reason", Some("hasura/migrations/x/down.sql"), None),
            violation("down-sql-forbidden", None, None),
        ];
        assert!(hasura_migrations_fix(&violations).edits.is_empty());
    }

    // ── реєстр/диспетчер ──

    #[test]
    fn native_fixes_lists_two_pilot_keys() {
        assert_eq!(
            NATIVE_FIXES,
            &["doc-files/marksman_config", "hasura/migrations"]
        );
    }

    #[test]
    fn run_concern_fix_dispatches_marksman_config() {
        let tmp = tempfile::TempDir::new().unwrap();
        let v = violation(
            "marksman-config-missing",
            Some(".marksman.toml"),
            Some(serde_json::json!({ "kind": "marksman-config-missing" })),
        );
        let plan = run_concern_fix("doc-files/marksman_config", tmp.path(), &[v]).unwrap();
        assert_eq!(plan.edits.len(), 1);
    }

    #[test]
    fn run_concern_fix_dispatches_hasura_migrations() {
        let tmp = tempfile::TempDir::new().unwrap();
        let v = violation(
            "down-sql-forbidden",
            Some("hasura/migrations/x/down.sql"),
            None,
        );
        let plan = run_concern_fix("hasura/migrations", tmp.path(), &[v]).unwrap();
        assert_eq!(plan.edits.len(), 1);
    }

    #[test]
    fn run_concern_fix_rejects_unknown_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        let err = run_concern_fix("k8s/unknown-concern", tmp.path(), &[]).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("k8s/unknown-concern"));
    }
}
