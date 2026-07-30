//! napi-біндінги до `rules-core` для `@7n/rules`.
//!
//! Тонкий binding: жодної власної логіки, лише передача виклику в
//! `rules-core`. Окремий cdylib від `llm-lib-napi` (архітектура спеки
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`) — синхронна
//! N-API поверхня (Р2), без `tokio_rt`, бо споживачі (`npm/scripts/lib/*`)
//! викликають функції синхронно.

use std::path::PathBuf;

use napi::{Error, Result};
use napi_derive::napi;
use rules_core::RulesError;

/// Версія JSON DTO-контракту `rules-core` ⇄ `rules-napi` ([`rules_core::dto::CONTRACT_VERSION`]).
/// JS-loader звіряє це значення при завантаженні аддона (Р10 спеки) —
/// enforcement-точка за зразком `requiresPluginApi`.
#[napi]
pub fn contract_version() -> u32 {
    rules_core::dto::CONTRACT_VERSION
}

/// Конвертує `RulesError` у `napi::Error` — за зразком `to_napi_err`
/// у `llm-lib-napi/src/lib.rs`.
fn to_napi_err(e: RulesError) -> Error {
    Error::from_reason(e.to_string())
}

/// Визначає git base для scoped-перевірок — тонкий binding над
/// [`rules_core::changed_base::resolve_changed_base`] (T2 фази 1, Rust-порт
/// `resolveChangedBase` з `changed-files.mjs:63`).
///
/// - `cwd` — робочий каталог (може бути linked worktree, зокрема
///   `.claude/worktrees/...`).
/// - `candidates` — уже розгорнутий список ref-ів (`origin/<name>`/`<name>`);
///   розгортання Git policy лишається в JS-фасаді (Р5 спеки).
/// - `base_ref` — явний ref бази; якщо заданий, `candidates` ігноруються
///   (той самий пріоритет, що й у JS).
///
/// Повертає `None`, якщо жоден кандидат не дав merge-base (не git-репо,
/// відсутній ref, немає HEAD тощо) — дзеркалить мовчазну поведінку JS-версії:
/// синхронна поверхня (Р2 спеки) ніколи не кидає на «звичайних» негараздах
/// git-резолву, лише на непередбачених (наразі — жодних, `RulesError`
/// лишається про запас).
#[napi]
pub fn resolve_changed_base(
    cwd: String,
    candidates: Vec<String>,
    base_ref: Option<String>,
) -> Result<Option<String>> {
    rules_core::changed_base::resolve_changed_base(
        &PathBuf::from(cwd),
        &candidates,
        base_ref.as_deref(),
    )
    .map_err(to_napi_err)
}

/// Санітизує довільний рядок (наприклад, `<current-branch>-<suffix>`) до
/// безпечного компонента шляху worktree — тонкий binding над
/// [`rules_core::worktree::sanitize_name`] (делегат `mt_core::sanitize`,
/// Р3 спеки фази 2, задача B1).
#[napi]
pub fn sanitize_worktree_name(raw: String) -> String {
    rules_core::worktree::sanitize_name(&raw)
}

/// Створює dev-worktree — тонкий binding над
/// [`rules_core::worktree::create_dev_worktree`], що відтворює семантику
/// `mt worktree create <name> [--base <ref>] --description <d>` (Р3 спеки).
///
/// - `repo_root` — корінь репозиторію (worktree завжди створюється в
///   `<repo_root>/.worktrees/<name>`, rules-конвенція).
/// - `base` — `None` мапиться на `"main"`, той самий дефолт, що в `mt` CLI.
///
/// Повертає абсолютний шлях щойно створеного worktree.
#[napi]
pub fn worktree_create(
    repo_root: String,
    name: String,
    description: String,
    base: Option<String>,
) -> Result<String> {
    rules_core::worktree::create_dev_worktree(
        &PathBuf::from(repo_root),
        &name,
        &description,
        base.as_deref(),
    )
    .map(|path| path.to_string_lossy().into_owned())
    .map_err(to_napi_err)
}

/// Прибирає dev-worktree — тонкий binding над
/// [`rules_core::worktree::remove_worktree`], що відтворює семантику
/// `mt worktree remove <name> [--force]` (Р3 спеки), включно з видаленням
/// гілки `mt/<name>`, якою worktree володіє.
#[napi]
pub fn worktree_remove(repo_root: String, name: String, force: bool) -> Result<()> {
    rules_core::worktree::remove_worktree(&PathBuf::from(repo_root), &name, force)
        .map_err(to_napi_err)
}

/// Relative-posix список змінених + untracked файлів робочого дерева —
/// тонкий binding над [`rules_core::changed_files::collect_changed_files`]
/// (C2 фази 3, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
/// Поза git-репо або при будь-якій помилці git — порожній список (не
/// помилка), тому сигнатура не повертає `Result`.
#[napi]
pub fn collect_changed_files(cwd: String) -> Vec<String> {
    rules_core::changed_files::collect_changed_files(&PathBuf::from(cwd))
}

/// Список змінених + untracked файлів **відносно базового комміту** —
/// тонкий binding над
/// [`rules_core::changed_files::collect_changed_files_since`] (C2 фази 3).
///
/// - `base = None` → fallback на [`collect_changed_files`] (робоче дерево
///   vs HEAD).
/// - `base = Some(_)`, але недосяжний у `cwd` (rebase/force-update/shallow
///   prune) → `Err` з повідомленням, що містить «недосяжний» (той самий
///   текст-контракт, що й попередня JS-версія та її тест).
#[napi]
pub fn collect_changed_files_since(cwd: String, base: Option<String>) -> Result<Vec<String>> {
    rules_core::changed_files::collect_changed_files_since(&PathBuf::from(cwd), base.as_deref())
        .map_err(to_napi_err)
}

/// Чи лежить відносний posix-шлях усередині worktree-чекаута (`.worktrees/`
/// або `.claude/worktrees/`) — тонкий binding над
/// [`rules_core::changed_files::is_worktree_checkout_path`] (C2 фази 3).
#[napi]
pub fn is_worktree_checkout_path(rel_path: String) -> bool {
    rules_core::changed_files::is_worktree_checkout_path(&rel_path)
}

/// Рекурсивний filesystem scan — тонкий binding над
/// [`rules_core::scan::walk_dir`] (D1 фази 4а
/// `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`), точний
/// семантичний порт `walkDir` (`npm/scripts/utils/walkDir.mjs`).
///
/// - `dir` — корінь обходу.
/// - `extra_ignore_globs` — уже нормалізовані ignore-глоби (relative-posix
///   від `dir`, із суфіксом `/**`); нормалізація лишається на боці
///   JS-фасаду (D2 фази 4а), бо завʼязана на `process.cwd()`.
///
/// Повертає relative-posix шляхи файлів, відсортовані байтово-лексикографічно
/// (детермінізм — doc-комент `rules_core::scan`, секція «Порядок»). Будь-яка
/// помилка (неіснуючий/не-каталоговий `dir`, фатальна помилка обходу) →
/// порожній список, тому сигнатура не повертає `Result` (fail-safe, той самий
/// контракт, що й `collect_changed_files`).
#[napi]
pub fn walk_dir(dir: String, extra_ignore_globs: Vec<String>) -> Vec<String> {
    rules_core::scan::walk_dir(&PathBuf::from(dir), &extra_ignore_globs)
}

/// Ключі native-портованих concern-ів (`ruleId/concernId`) — тонкий binding
/// над [`rules_core::concerns::NATIVE_CONCERNS`] (E1 фази 5). JS-оркестратор
/// звіряє належність concern-а до цього списку — основа маршрутизації
/// виклику: у native чи в `import(main.mjs)` (співіснування, не fallback —
/// секція «Фаза 5» спеки).
#[napi]
pub fn list_native_concerns() -> Vec<String> {
    rules_core::concerns::NATIVE_CONCERNS
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

/// Запускає native-порт concern-а за ключем — тонкий binding над
/// [`rules_core::concerns::run_concern`] (E1 фази 5).
///
/// Повертає `{ "violations": [...] }` — та сама форма, що й `LintResult`
/// (`npm/scripts/lib/lint-surface/types.mjs`), тож JS-шар прогонить
/// результат через `normalizeResult` (`detect.mjs`) без окремого адаптера.
///
/// - `key` — `ruleId/concernId` (елемент [`list_native_concerns`]).
/// - `cwd` — абсолютний корінь consumer-репо.
/// - `files` — posix-relative файли для per-file concern-ів (`k8s/dremio_logging`);
///   ігнорується whole-repo концернами.
///
/// Невідомий `key` → `Err` (`RulesError::Concern`, `to_napi_err`).
#[napi]
pub fn run_native_concern(
    key: String,
    cwd: String,
    files: Option<Vec<String>>,
) -> Result<serde_json::Value> {
    let violations = rules_core::concerns::run_concern(&key, &PathBuf::from(cwd), files.as_deref())
        .map_err(to_napi_err)?;
    Ok(serde_json::json!({ "violations": violations }))
}
