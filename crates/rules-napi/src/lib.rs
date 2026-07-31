//! napi-біндінги до `rules-core` для `@7n/rules`.
//!
//! Тонкий binding: жодної власної логіки, лише передача виклику в
//! `rules-core`. Окремий cdylib від `llm-lib-napi` (архітектура спеки
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`) — синхронна
//! N-API поверхня (Р2), без `tokio_rt`, бо споживачі (`npm/scripts/lib/*`)
//! викликають функції синхронно.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use napi::{Error, Result};
use napi_derive::napi;
use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::tool::ToolOutput as ContractToolOutput;
use rules_contract::version::PLUGIN_WORLD_VERSION;
use rules_core::RulesError;
use rules_plugin_host::{LoadedPlugin, PluginHost, PluginHostError, RunToolFn};

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

/// Конвертує `PluginHostError` у `napi::Error` — той самий мотив, що
/// [`to_napi_err`] для `RulesError`.
fn to_wasm_napi_err(err: PluginHostError) -> Error {
    Error::from_reason(err.to_string())
}

/// Run-tool callback-заглушка napi-мосту wasm-плагінів (задача K фази 6,
/// спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3):
/// пілотний концерн `vue/tfm-translations` не декларує зовнішніх tools
/// (`Manifest::tools` порожній), тож реальний ensure-tool контур — поза цією
/// задачею (рішення Д спеки лишається оркестрації, не napi-мосту).
fn stub_run_tool() -> Arc<RunToolFn> {
    Arc::new(
        |_tool: &str, _args: &[String], _stdin: Option<&str>| ContractToolOutput {
            status: None,
            stdout: String::new(),
            stderr: "run-tool не підтримується napi-мостом wasm-плагінів (задача K пілоту)"
                .to_string(),
        },
    )
}

thread_local! {
    /// `PluginHost` на потік виклику napi — синхронні `#[napi]`-функції цього
    /// модуля викликаються з JS завжди послідовно на одному потоці (той самий
    /// контракт синхронної N-API поверхні, що документує `crate`-doc-коментар
    /// вище), тож `thread_local!` уникає Send/Sync-вимог до `PluginHost`/
    /// `LoadedPlugin` (які тримають wasmtime `Store`) без утрати коректності:
    /// кеш живе, поки живий потік (типово — процес). `Engine`/`Linker`
    /// будуються раз, переюзаються між УСІМА `wasm_plugin_concerns`/
    /// `run_wasm_concern` викликами цього потоку.
    static PLUGIN_HOST: PluginHost = PluginHost::new(stub_run_tool())
        .expect("PluginHost::new не мав провалитись (Engine/Linker-конфігурація статична)");

    /// Кеш завантажених плагінів per-path на процес (задача K, вимога «не
    /// перевантажуй компонент на кожен виклик») — уникає повторної
    /// компіляції/інстанціації `.wasm`-компонента на кожен `#[napi]`-виклик.
    static LOADED_PLUGINS: RefCell<HashMap<String, LoadedPlugin>> = RefCell::new(HashMap::new());
}

/// Бере плагін за шляхом із кешу (чи завантажує й кешує, якщо це перший
/// виклик для цього шляху) і виконує `f` над ним.
fn with_loaded_plugin<T>(
    wasm_path: &str,
    f: impl FnOnce(&mut LoadedPlugin) -> Result<T>,
) -> Result<T> {
    LOADED_PLUGINS.with(|cache| {
        let mut cache = cache.borrow_mut();
        if !cache.contains_key(wasm_path) {
            let loaded = PLUGIN_HOST
                .with(|host| host.load(Path::new(wasm_path), PLUGIN_WORLD_VERSION))
                .map_err(to_wasm_napi_err)?;
            cache.insert(wasm_path.to_string(), loaded);
        }
        let plugin = cache
            .get_mut(wasm_path)
            .expect("щойно вставлено або вже було в кеші");
        f(plugin)
    })
}

/// Ключі концернів (contributions), задекларовані wasm-плагіном за шляхом —
/// тонкий binding над `PluginHost::load` + `LoadedPlugin::describe`
/// (`Manifest::concerns`, задача K фази 6, спека
/// `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3).
/// JS-dispatch (`npm/scripts/lib/lint-surface/wasm-plugins.mjs`) резолвить
/// цим ключем «`ruleId/concernId` → шлях `.wasm`»-мапу.
///
/// Плагін кешується per-path на процес (у межах потоку виклику, доккомент
/// `PLUGIN_HOST`/`LOADED_PLUGINS` вище) — повторний виклик з тим самим
/// шляхом не компілює компонент заново.
#[napi]
pub fn wasm_plugin_concerns(wasm_path: String) -> Result<Vec<String>> {
    with_loaded_plugin(&wasm_path, |plugin| Ok(plugin.describe().concerns.clone()))
}

/// Виконує `detect` одного концерну wasm-плагіна — тонкий binding над
/// `LoadedPlugin::detect` (задача K фази 6). Хост-бік читає вміст файлів із
/// `cwd` (utf8-lossy; відсутній/нечитаний файл пропускається — та сама
/// поведінка, що дав би звичайний filesystem-обхід), будує `DetectBatch` і
/// повертає ТУ САМУ форму `{"violations": [...]}`, що [`run_native_concern`]
/// (JS-шар прогонить результат через `normalizeResult`
/// (`npm/scripts/lib/lint-surface/detect.mjs`), без окремого адаптера).
///
/// - `wasm_path` — абсолютний шлях до `.wasm`-компонента (той самий, що
///   передається у [`wasm_plugin_concerns`]).
/// - `key` — `ruleId/concernId`, передається як `detect-batch.concern-id`.
/// - `cwd` — абсолютний корінь consumer-репо (звідки резолвляться `files`).
/// - `files` — posix-relative шляхи файлів для детекції.
#[napi]
pub fn run_wasm_concern(
    wasm_path: String,
    key: String,
    cwd: String,
    files: Vec<String>,
) -> Result<serde_json::Value> {
    let cwd_path = PathBuf::from(&cwd);
    let source_files: Vec<SourceFile> = files
        .into_iter()
        .filter_map(|rel| {
            let abs = cwd_path.join(&rel);
            std::fs::read(&abs).ok().map(|bytes| SourceFile {
                path: rel,
                content: String::from_utf8_lossy(&bytes).into_owned(),
            })
        })
        .collect();
    let batch = DetectBatch {
        concern_id: key,
        files: source_files,
    };
    let diagnostics = with_loaded_plugin(&wasm_path, |plugin| {
        plugin.detect(&batch).map_err(to_wasm_napi_err)
    })?;
    Ok(serde_json::json!({ "violations": diagnostics }))
}
