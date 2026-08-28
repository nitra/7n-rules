//! cspell:ignore десеріалізується picomatch
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

use napi::bindgen_prelude::Function;
use napi::{Error, Result};
use napi_derive::napi;
use rules_contract::detect::{DetectBatch, SourceFile};
use rules_contract::manifest::ConcernScope;
use rules_contract::version::PLUGIN_WORLD_VERSION;
use rules_core::RulesError;
use rules_plugin_host::{LoadedPlugin, PluginHost, PluginHostError, ToolResolver};

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
/// [`rules_core::scan::walk_dir_raw`] (D1 фази 4а
/// `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`), точний
/// семантичний порт `walkDir` (`npm/scripts/utils/walkDir.mjs`).
///
/// Свідомо `_raw`: `extra_ignore_globs` приходять УЖЕ нормалізованими з
/// JS-боку (`npm/scripts/utils/walkDir.mjs:58-79` сам читає
/// `.n-rules.json`/`.n-cursor.json` і нормалізує шляхи в глоби до виклику цього
/// binding-а) — нормалізація лишається на боці JS-фасаду (D2 фази 4а), бо
/// завʼязана на `process.cwd()`, якого немає в native. Це не той самий клас
/// точки виклику, що `build_full_scope_files` нижче (там native САМ читає
/// `.n-rules.json`, бо `run_wasm_concern` не має де прокинути `ignorePaths`,
/// доккомент `cursor_ignore.rs`) — тут виклик приходить ЗІ СТОРОНИ JS, яка
/// вже прочитала конфіг сама, тож повторне читання тут було б і зайвим, і
/// неможливим без `process.cwd()`-контексту.
///
/// - `dir` — корінь обходу.
/// - `extra_ignore_globs` — уже нормалізовані ignore-глоби (relative-posix
///   від `dir`, із суфіксом `/**`).
///
/// Повертає relative-posix шляхи файлів, відсортовані байтово-лексикографічно
/// (детермінізм — doc-комент `rules_core::scan`, секція «Порядок»). Будь-яка
/// помилка (неіснуючий/не-каталоговий `dir`, фатальна помилка обходу) →
/// порожній список, тому сигнатура не повертає `Result` (fail-safe, той самий
/// контракт, що й `collect_changed_files`).
#[napi]
pub fn walk_dir(dir: String, extra_ignore_globs: Vec<String>) -> Vec<String> {
    rules_core::scan::walk_dir_raw(&PathBuf::from(dir), &extra_ignore_globs)
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
    let report = rules_core::concerns::run_concern(&key, &PathBuf::from(cwd), files.as_deref())
        .map_err(to_napi_err)?;
    // Ноти йдуть окремим полем — рівно як їх чекає `normalizeResult`
    // (`detect.mjs`); порожній вектор серіалізується у ВІДСУТНЄ поле, тож
    // форма для концернів без нот не змінилась.
    serde_json::to_value(report)
        .map_err(|error| Error::from_reason(format!("серіалізація звіту концерну: {error}")))
}

/// Виконує batch builtin-native concern-ів ОДНИМ native-викликом — тонкий
/// binding над [`rules_core::concerns::run_concerns_batch`] (R2 зрізу 3 фази
/// 7, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`). JS-бік
/// (`run-detectors.mjs::runNativeSegmentSync`) групує суцільні прогони
/// `isBuiltinNativeConcern`-items у ОДИН такий виклик замість N окремих
/// [`run_native_concern`] — менше napi hops на гарячому шляху `detectAll`.
///
/// - `items` — JSON-масив, що десеріалізується у
///   `Vec<rules_core::concerns::BatchItem>` (`{key, cwd, files}`, той самий
///   мінімальний DTO, доккомент модуля `rules_core::concerns::batch`).
/// - `on_progress` — опційний JS callback, викликається СИНХРОННО (звичайний
///   `Function::call`, БЕЗ `ThreadsafeFunction` — колбек і napi-виклик
///   живуть на тому самому потоці, той самий синхронний контракт, що
///   документує crate-doc-коментар вище) ПІСЛЯ кожного item-а з
///   `{key, violationsCount, error?}`: JS-бік реконструює звідси
///   progress-репортинг (concernStart/detectSnapshot/concernDone) — той
///   самий набір викликів, що дав би per-item `runConcernDetector`-шлях.
///
/// Повертає `{results: [{key, violations?, error?}]}` у порядку `items` —
/// помилка ОДНОГО item-а не зупиняє решту батчу (per-item `Result`,
/// доккомент `rules_core::concerns::batch`); JS-бік вирішує, зупинятись на
/// першій помилці чи ні (`DetectorError`-семантика — рядок «detector
/// ruleId/concernId: ...» будується виключно на JS-боці з поля `error`
/// тут, той самий поділ відповідальності, що для одиночного
/// [`run_native_concern`]).
///
/// Помилка САМОГО колбека (JS кинув усередині `onProgress`) — окрема
/// категорія від помилки концерну: батч на Rust-боці все одно доводиться до
/// кінця (concerns read-only, зайве обчислення після зіпсованого колбека
/// нешкідливе), але перша така помилка повертається з ЦІЄЇ napi-функції як
/// `Err` ПІСЛЯ завершення цикла — на відміну від помилки концерну, вона не
/// потрапляє в `results` як `error`-поле, бо не належить жодному конкретному
/// item-у семантично (зіпсований виклик, не сирий результат детектора).
#[napi]
pub fn run_native_concerns_batch(
    items: serde_json::Value,
    on_progress: Option<Function<'_, serde_json::Value, ()>>,
) -> Result<serde_json::Value> {
    let parsed: Vec<rules_core::concerns::BatchItem> =
        serde_json::from_value(items).map_err(|err| {
            Error::from_reason(format!("runNativeConcernsBatch: невалідний вхід: {err}"))
        })?;

    let mut callback_error: Option<Error> = None;
    let batch_results = rules_core::concerns::run_concerns_batch(&parsed, |key, result| {
        let Some(cb) = &on_progress else { return };
        if callback_error.is_some() {
            return;
        }
        let payload = match result {
            Ok(violations) => {
                serde_json::json!({ "key": key, "violationsCount": violations.violations.len() })
            }
            Err(err) => {
                serde_json::json!({ "key": key, "violationsCount": 0, "error": err.to_string() })
            }
        };
        if let Err(err) = cb.call(payload) {
            callback_error = Some(err);
        }
    });

    if let Some(err) = callback_error {
        return Err(err);
    }

    let results: Vec<serde_json::Value> = batch_results
        .into_iter()
        .map(|r| match r.result {
            // `r.result` — це `ConcernReport` (`{violations, diagnostics}`), а не
            // голий вектор порушень: батч мусить розкласти його на ТІ САМІ два
            // поля, що їх віддає одиночний [`run_native_concern`] вище, інакше
            // JS-бік дістає обʼєкт там, де `normalizeResult` чекає масив.
            // Ноти передаються далі, а не гинуть на batch-шляху — інакше
            // «перевірку пропущено» зникало б саме на гарячому шляху
            // `detectAll`, тобто там, де його майже завжди й видно.
            Ok(report) => serde_json::json!({
                "key": r.key,
                "violations": report.violations,
                "diagnostics": report.diagnostics,
            }),
            Err(err) => serde_json::json!({ "key": r.key, "error": err.to_string() }),
        })
        .collect();

    Ok(serde_json::json!({ "results": results }))
}

/// Ключі native-портованих fix-ів (`ruleId/concernId`) — тонкий binding над
/// [`rules_core::concerns::NATIVE_FIXES`] (T1 зрізу 4 фази 7,
/// `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4). JS-обгортка
/// (`run-fix.mjs`) звіряє належність `ruleId/concernId`-ключа до цього
/// списку, щоб вирішити, чи синтезувати `T0Pattern` над native-планом, чи
/// шукати `fix-<concern>.mjs` на диску (той самий поділ відповідальності, що
/// [`list_native_concerns`] для детекторів).
#[napi]
pub fn list_native_fixes() -> Vec<String> {
    rules_core::concerns::NATIVE_FIXES
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

/// Будує fix-plan native-fix-концерну за ключем — тонкий binding над
/// [`rules_core::concerns::run_concern_fix`] (T1 зрізу 4 фази 7).
///
/// Повертає `Some({ "edits": [...] })` — точна форма `FixPlan` (`type`-тег
/// `"write"`/`"delete"` на кожному елементі `edits`, доккомент модуля
/// `rules_core::concerns::fix`), АБО `None` (JS-бік бачить `null`), якщо
/// `key` не належить [`list_native_fixes`] — на відміну від
/// [`run_native_concern`] (кидає на невідомому ключі, бо JS-бік ЗАВЖДИ
/// звіряє належність через [`list_native_concerns`] ДО виклику), тут
/// null-семантика — навмисно другий, самодостатній шлях перевірки
/// застосовності: JS-обгортка (`run-fix.mjs`) може викликати цю функцію
/// напряму без окремого membership-чеку через [`list_native_fixes`] і
/// трактувати `null` як «немає native-фікса для цього concern-а» (той самий
/// смисл, що дав би відсутній `fix-<concern>.mjs` на диску).
///
/// Порожній (не `null`) `edits` = «concern МАЄ native-фікс, але для ЦИХ
/// violations фіксити нічого» (native-план сам вирішує застосовність —
/// доккомент `run_concern_fix`, той самий контракт, що замінює окремий
/// `T0Pattern.test()` на JS-боці).
///
/// - `key` — `ruleId/concernId`.
/// - `cwd` — абсолютний корінь consumer-репо.
/// - `violations` — JSON-масив, що десеріалізується у
///   `Vec<rules_core::diagnostics::Violation>` (підмножина результату
///   `detect` для цього concern-а — той самий вхід, що `FixRequest::diagnostics`
///   у `rules-contract::fix`).
#[napi]
pub fn run_native_concern_fix(
    key: String,
    cwd: String,
    violations: serde_json::Value,
) -> Result<Option<serde_json::Value>> {
    if !rules_core::concerns::NATIVE_FIXES.contains(&key.as_str()) {
        return Ok(None);
    }
    let parsed: Vec<rules_core::diagnostics::Violation> = serde_json::from_value(violations)
        .map_err(|err| {
            Error::from_reason(format!("runNativeConcernFix: невалідний вхід: {err}"))
        })?;
    let plan = rules_core::concerns::run_concern_fix(&key, &PathBuf::from(cwd), &parsed)
        .map_err(to_napi_err)?;
    serde_json::to_value(plan).map(Some).map_err(|err| {
        Error::from_reason(format!(
            "runNativeConcernFix: серіалізація плану провалилась: {err}"
        ))
    })
}

/// Рахує lint-план — тонкий binding над [`rules_core::lint_plan::build_lint_plan`]
/// (P1 фази 7, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4):
/// порт `buildPlan` + усіх п'ять builders з
/// `npm/scripts/lib/lint-surface/run-detectors.mjs`.
///
/// `input` — JSON, що десеріалізується у
/// [`rules_core::lint_plan::BuildLintPlanInput`] (`mode` + мінімальний
/// `byRule`-зріз + мод-специфічні поля); межа native ⇄ JS (дискавері й
/// обидва фільтри — capabilities/applies — лишаються в JS) задокументована
/// в doc-коментарі модуля `rules_core::lint_plan`. Повертає
/// `Vec<PlanItem{ruleId, concernId, files}>` — JS зіставляє його назад зі
/// своїми повними `ConcernMeta`.
#[napi]
pub fn build_lint_plan(input: serde_json::Value) -> Result<serde_json::Value> {
    let parsed: rules_core::lint_plan::BuildLintPlanInput = serde_json::from_value(input)
        .map_err(|err| Error::from_reason(format!("buildLintPlan: невалідний вхід: {err}")))?;
    let plan = rules_core::lint_plan::build_lint_plan(&parsed);
    serde_json::to_value(plan).map_err(|err| {
        Error::from_reason(format!(
            "buildLintPlan: серіалізація плану провалилась: {err}"
        ))
    })
}

/// picomatch-паритетний glob-матчер — тонкий binding над
/// [`rules_core::lint_plan::match_lint_globs`]. Використовується JS-стороною
/// `computeActiveDomains` (`run-detectors.mjs`) — той самий матчер, що й
/// [`build_lint_plan`] усередині, єдине джерело правди для glob-семантики
/// по обидва боки.
#[napi]
pub fn match_lint_globs(glob: Vec<String>, files: Vec<String>) -> Vec<String> {
    rules_core::lint_plan::match_lint_globs(&glob, &files)
}

/// Рендерить порушення згруповані за concern-ом — тонкий binding над
/// [`rules_core::lint_render::render_violations`] (R1 фази 7, другий зріз
/// `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4). НЕ сортує
/// (doc-комент модуля `rules_core::lint_render`, секція про insertion-order
/// групування) — точна заміна `renderViolations`
/// (`npm/scripts/lib/lint-surface/render.mjs`), яку викликають
/// `default-worker.mjs`/`run-fix.mjs` на вже вузьких, не глобально
/// відсортованих підмножинах violations одного concern-а/rung-а.
///
/// `violations` — JSON-масив, що десеріалізується у
/// `Vec<rules_core::lint_render::LintViolation>`.
#[napi]
pub fn render_violations(violations: serde_json::Value) -> Result<String> {
    let parsed: Vec<rules_core::lint_render::LintViolation> = serde_json::from_value(violations)
        .map_err(|err| Error::from_reason(format!("renderViolations: невалідний вхід: {err}")))?;
    Ok(rules_core::lint_render::render_violations(&parsed))
}

/// Сортує+рендерить+рахує exit-code одним викликом — тонкий binding над
/// [`rules_core::lint_render::sort_and_render_violations`] (R1 фази 7).
/// Комбінований контракт (замість трьох окремих napi-викликів) — гарячий
/// шлях `detectAll` (`run-detectors.mjs`) рахує усі три похідні з ОДНОГО
/// набору violations за один hop через межу.
///
/// `input` — JSON, що десеріалізується у
/// [`rules_core::lint_render::SortAndRenderInput`] (`{violations,
/// infraMessage?}`). Повертає `{sorted, rendered, exitCode}` — `rendered`
/// завжди рахується від ВЖЕ відсортованого `sorted` (doc-комент модуля),
/// незалежно від `infraMessage`; чи друкувати `rendered`, вирішує викликач.
#[napi]
pub fn sort_and_render_violations(input: serde_json::Value) -> Result<serde_json::Value> {
    let parsed: rules_core::lint_render::SortAndRenderInput = serde_json::from_value(input)
        .map_err(|err| {
            Error::from_reason(format!("sortAndRenderViolations: невалідний вхід: {err}"))
        })?;
    let result = rules_core::lint_render::sort_and_render_violations(&parsed);
    serde_json::to_value(result).map_err(|err| {
        Error::from_reason(format!(
            "sortAndRenderViolations: серіалізація результату провалилась: {err}"
        ))
    })
}

/// Конвертує `PluginHostError` у `napi::Error` — той самий мотив, що
/// [`to_napi_err`] для `RulesError`.
fn to_wasm_napi_err(err: PluginHostError) -> Error {
    Error::from_reason(err.to_string())
}

/// Будує [`ToolResolver`] із JS-переданого `toolPaths` (`Option<HashMap<String,String>>`,
/// задача N1 фази 6, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
/// §3.3): напряму мапить «ім'я тула → шлях» у `PathBuf`, версійну політику
/// (semver-суфікс декларації) тут НЕ застосовує (той самий doc-коментар, що
/// `ToolResolver` — ensure-tool контур на JS-боці вже поставив канонічну
/// версію ДО того, як шлях потрапив сюди). `None`/відсутній параметр →
/// порожній резолвер (кожен `run-tool`-виклик отримає типізовану помилку).
fn build_tool_resolver(tool_paths: Option<HashMap<String, String>>) -> Arc<ToolResolver> {
    let map = tool_paths
        .unwrap_or_default()
        .into_iter()
        .map(|(name, path)| (name, PathBuf::from(path)))
        .collect();
    Arc::new(ToolResolver::new(map))
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
    /// Стартовий резолвер — порожній: `Engine`/`Linker` (єдине, що фіксується
    /// на весь час життя `PluginHost`) не залежать від `ToolResolver`, тож
    /// конкретна мапа тулів не потрібна тут — [`run_wasm_concern`] підмінює
    /// [`ToolResolver`] на потрібний ПЕРЕД кожним `detect` через
    /// `LoadedPlugin::set_tool_resolver` (задача N1: різні `#[napi]`-виклики
    /// того самого закешованого плагіна можуть нести різний `toolPaths`).
    static PLUGIN_HOST: PluginHost = PluginHost::new(ToolResolver::empty())
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
    with_loaded_plugin(&wasm_path, |plugin| {
        Ok(plugin
            .describe()
            .concerns
            .iter()
            .map(|c| c.key.clone())
            .collect())
    })
}

/// Повний маніфест wasm-плагіна за шляхом — тонкий binding над
/// `LoadedPlugin::describe` (задача N1, спека
/// `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3),
/// серіалізований у `serde_json::Value` (той самий шлях napi-конверсії, що
/// й `{"violations": [...]}` у [`run_wasm_concern`]). JS-dispatch
/// (`npm/scripts/lib/lint-surface/wasm-plugins.mjs`) читає звідси
/// `manifest.concerns` (для мапи концернів) і `manifest.tools` (для
/// ensure-tool контуру ДО виклику [`run_wasm_concern`]) — на відміну від
/// [`wasm_plugin_concerns`] (лише `concerns`), цей binding віддає ввесь DTO
/// `Manifest`.
#[napi]
pub fn wasm_plugin_manifest(wasm_path: String) -> Result<serde_json::Value> {
    with_loaded_plugin(&wasm_path, |plugin| {
        serde_json::to_value(plugin.describe()).map_err(|err| {
            Error::from_reason(format!(
                "wasm_plugin_manifest: серіалізація маніфесту провалилась: {err}"
            ))
        })
    })
}

/// Читає `SourceFile` для explicit-переданого списку файлів (per-file
/// диспатч, чи будь-який виклик, де caller уже знає, які файли передати) —
/// utf8-lossy; відсутній/нечитаний файл пропускається — та сама поведінка,
/// що дав би звичайний filesystem-обхід.
fn read_source_files(cwd: &Path, files: Vec<String>) -> Vec<SourceFile> {
    files
        .into_iter()
        .filter_map(|rel| {
            let abs = cwd.join(&rel);
            std::fs::read(&abs).ok().map(|bytes| SourceFile {
                path: rel,
                content: String::from_utf8_lossy(&bytes).into_owned(),
            })
        })
        .collect()
}

/// Full-scope батч (задача N2, передумова full-scope мосту): коли виклик не
/// передав `files` (`None` — JS-оркестрація не має дельти для whole-repo
/// концерну, `run-detectors.mjs::buildFullPlan`/`planConcernForDelta`
/// лишають `files: undefined` саме для `scope: 'full'`), хост будує список
/// сам: [`rules_core::concerns::cursor_ignore::walk_repo`] (той самий
/// [`rules_core::scan::walk_dir_raw`]-двигун, що й `walk_dir`-napi вище, але
/// з consumer-ignore, прочитаним із `.n-rules.json`) → фільтр [`globset`] за
/// glob-ами задекларованої
/// contribution → читання вмісту ([`read_source_files`]). Невалідний
/// glob-патерн у контрибуції — тихо пропускається (`GlobSetBuilder::add`
/// повертає `Err`, ігнорується): контрибуцію будує сам плагін, а не
/// недовірений вхід ззовні, тож tolerant-парсинг тут — про запас, не
/// enforcement-точка.
///
/// `cwd` — той самий walk-корінь, з якого читається `.n-rules.json`: перед
/// обходом хост сам читає consumer-репо конфіг —
/// [`rules_core::concerns::cursor_ignore::walk_repo`] (корінь конфігу == корінь
/// обходу) — той самий порядок операцій, що `loadCursorIgnorePaths` →
/// inline-нормалізація → `walkDir` на JS-боці (`npm/scripts/utils/walkDir.mjs:58-79`)
/// і що вже роблять native full-scope концерни (`k8s_common.rs`, `env_dns.rs`
/// тощо, доккомент `cursor_ignore.rs`, секція «Відхилення від Р5»). До фіксу
/// тут був жорсткий `walk_dir(cwd, &[])` — consumer-специфічний ignore
/// ігнорувався для УСІХ full-scope wasm-концернів (задокументовано як
/// відкладений дефект у `plugin-lang-js/src/lib.rs`, доккомент біля
/// `run_wasm_concern`-порту).
fn build_full_scope_files(cwd: &Path, glob_patterns: &[String]) -> Vec<SourceFile> {
    let mut builder = globset::GlobSetBuilder::new();
    for pattern in glob_patterns {
        if let Ok(glob) = globset::Glob::new(pattern) {
            builder.add(glob);
        }
    }
    let Ok(set) = builder.build() else {
        return Vec::new();
    };
    let matched: Vec<String> = rules_core::concerns::cursor_ignore::walk_repo(cwd)
        .into_iter()
        .filter(|f| set.is_match(f))
        .collect();
    read_source_files(cwd, matched)
}

/// Синтезує `FileEdit`-и з різниці "до/після" знімків диска — host-side
/// захист для **exec-tool-фіксерів**: гість спавнить зовнішній процес
/// (`ruff`, `eslint`, `cargo fix` тощо), який сам мутує файли на диску
/// ВСЕРЕДИНІ виклику `fix()`, а не повертає зміни через `FixPlan`. Без
/// цього хост бачить порожній `plan.edits` і вважає, що фікс нічого не
/// зробив (доккомент §2.51/§2.63 реєстру відкритих питань,
/// `docs/plans/2026-08-05-open-questions-register.md`) — `wasmFixPattern`
/// (`npm/scripts/lib/lint-surface/run-fix.mjs`) гейтить застосування на
/// `edits.length > 0`, гість-пріоритет (`guestFix`) не спрацьовує, і
/// JS-fallback запускається ПОВТОРНО поверх уже змінених файлів.
///
/// Порівнює `before`/`after` (шлях → вміст, `posix`-relative) і повертає:
/// - [`FileEdit::Write`] для шляхів, чий вміст змінився чи зʼявився;
/// - [`FileEdit::Delete`] для шляхів, що зникли.
///
/// `already_covered` — шляхи, які вже несе план, повернений самим гостем
/// (`plan.edits`) — синтезований діф їх НЕ дублює: явний edit гостя має
/// пріоритет над знімком (декларативний фіксер міг ЗАДЕКЛАРУВАТИ зміну, не
/// записавши її на диск під час `fix()` — той самий контракт, що й
/// раніше), а `already_covered` рятує від подвійного запису того самого
/// шляху.
///
/// Незмінені файли (той самий вміст до/після) — НЕ потрапляють у
/// результат: для декларативних фіксерів (не торкаються диска в `fix()`)
/// `before == after` для КОЖНОГО файлу знімку, тож ця функція повертає
/// порожній `Vec` — жодної регресії наявного контракту.
fn diff_snapshot_edits(
    before: &HashMap<String, String>,
    after: &HashMap<String, String>,
    already_covered: &std::collections::HashSet<String>,
) -> Vec<rules_contract::fix::FileEdit> {
    use rules_contract::fix::{FileEdit, WriteFile};

    let mut edits = Vec::new();
    for (path, after_content) in after {
        if already_covered.contains(path) {
            continue;
        }
        match before.get(path) {
            Some(before_content) if before_content == after_content => {}
            _ => edits.push(FileEdit::Write(WriteFile {
                path: path.clone(),
                content: after_content.clone(),
            })),
        }
    }
    for path in before.keys() {
        if !already_covered.contains(path) && !after.contains_key(path) {
            edits.push(FileEdit::Delete { path: path.clone() });
        }
    }
    edits
}

/// Типізована помилка «неоднозначний порожній fix-batch» — [`run_wasm_concern_fix`]
/// кличе її, коли `target_files` (побудований з `diagnostic.file`-полів)
/// порожній, `diagnostics` НЕПОРОЖНІЙ, концерн НЕ `scope: Full` (чи взагалі
/// не знайдений у `describe().concerns`) І викликач не передав
/// `delta_files`.
///
/// Після рішення (б) (дельта запиту, а не per-diagnostic атрибуція —
/// доккомент `run_wasm_concern_fix` і `wit/world.wit` біля `record
/// diagnostic`) це вже НЕ основна поведінка агрегованих концернів, а
/// backstop на проводку: штатний шлях (`run-fix.mjs` → `wasmFixPattern`)
/// дельту передає завжди, тож сюди долітає лише викликач, який її НЕ дав
/// (наприклад прямий napi-виклик із тесту чи стороннього інструмента) або
/// дав порожню при непорожніх діагностиках. Помилка лишається саме тому,
/// що мовчазний `Vec::new()` у цьому місці був би регресом до #513 —
/// «зелено, бо гість нічого не побачив».
///
/// # Чому не мовчазний `Vec::new()` і не full-scope glob-обхід
///
/// Обидва — здогадки, а не безпечні дефолти для цього стану:
/// - `Vec::new()` — ТА САМА прихована вада, що виправив #513
///   (`crates/plugin-lang-js/src/lib.rs`, «`js/check` — T0-фіксер
///   ПОРТОВАНО»): гість отримує порожній batch і не може відрізнити
///   «файлів немає» від «хост їх не передав» — там це стиралось конфіги
///   консюмера, тут (не-full-scope концерн) наслідок менш руйнівний, але
///   природа та сама;
/// - full-scope glob-обхід (як для `scope: full`) — безпечний ЛИШЕ коли
///   концерн сам заявив, що хоче цілий репозиторій. Для `per-file`
///   концерну він розширив би fix ЗА МЕЖІ дельти — порушив би саме той
///   scope-контракт, що `per-file` декларує (`wit/world.wit`, доккомент
///   `enum concern-scope`).
///
/// # Контракт більше не мовчить (рішення (б))
///
/// Питання, яке #517 лишив відкритим — «заборонити `file: none` для
/// `per-file` чи дати спосіб нести дельту без per-diagnostic атрибуції» —
/// вирішене на користь другого: `file: none` лишається легітимним
/// (агрегований тул чесно каже «не знаю, який файл»; змушувати детектор
/// ВИГАДУВАТИ атрибуцію заради host-механіки, якій вона не потрібна, —
/// хибний напрям), а дельту несе сам запит через `delta_files`. Розширення
/// WIT не знадобилось: `fix-request.files` — окреме поле, не похідне від
/// діагностик, — існує з `3.0.0`; бракувало лише проводки host → napi.
///
/// Межа цього рішення: воно дає ВЕСЬ список файлів запиту, а не
/// відповідність «діагностика → файл». Фіксити ПІДМНОЖИНУ діагностик
/// агрегованого концерну і далі неможливо — сьогодні такого споживача
/// немає (`applyT0` передає всі violations концерну одним масивом), а
/// якщо зʼявиться, знадобиться саме атрибуція, тобто варіант (а).
///
/// Живий кандидат на сьогодні: `python/ruff`
/// (`crates/plugin-lang-python/src/lib.rs::detect_ruff`/`run_ruff_step`) —
/// `scope: per-file`, але одна діагностика на ВЕСЬ прогін `ruff
/// check`/`ruff format --check` (тула не парсить власний вивід по
/// файлах), `file: None`. Саме він і мотивував `delta_files`: після
/// рішення (б) порт його фіксера цією помилкою більше НЕ блокований
/// (лишається інша, незалежна межа — `exec-tool` у fix-контурі, PR #516).
/// `rust/check` — НЕ кандидат,
/// на відміну від попередніх нотаток: `crates/plugin-lang-rust/src/lib.rs`
/// декларує його `scope: Full` (`ConcernContribution` у `build_manifest`),
/// тож він і сьогодні йде full-scope гілкою вище, цієї помилки не бачить.
fn ambiguous_empty_fix_batch_err(key: &str, scope_label: &str, diagnostics_count: usize) -> Error {
    Error::from_reason(format!(
        "runWasmConcernFix: концерн `{key}` (scope: {scope_label}) — {diagnostics_count} \
         діагностик(и) fix-запиту, і ЖОДНА не несе `file`. Хост не може безпечно побудувати \
         FixRequest::files: концерн не `full`-scope, тож full-scope glob-обхід розширив би fix \
         за межі дельти (порушив би per-file семантику), а порожній batch — та сама прихована \
         вада, що PR #513 (js/check затирав конфіги консюмера), лише для не-full-scope \
         концерну — гість не зміг би відрізнити «файлів немає» від «хост їх не передав». \
         Штатний шлях для агрегованих (file-less) діагностик — передати дельту запиту \
         аргументом `delta_files` (шостий параметр runWasmConcernFix, той самий список, що \
         йде в runWasmConcern на детекті): цей виклик її НЕ передав (або передав порожню). \
         Див. доккомент ambiguous_empty_fix_batch_err (crates/rules-napi/src/lib.rs) і \
         wit/world.wit біля record diagnostic."
    ))
}

/// Виконує `detect` одного концерну wasm-плагіна — тонкий binding над
/// `LoadedPlugin::detect` (задача K фази 6, full-scope міст — задача N2).
/// Повертає ТУ САМУ форму `{"violations": [...]}`, що [`run_native_concern`]
/// (JS-шар прогонить результат через `normalizeResult`
/// (`npm/scripts/lib/lint-surface/detect.mjs`), без окремого адаптера).
///
/// - `wasm_path` — абсолютний шлях до `.wasm`-компонента (той самий, що
///   передається у [`wasm_plugin_concerns`]).
/// - `key` — `ruleId/concernId`, передається як `detect-batch.concern-id`.
/// - `cwd` — абсолютний корінь consumer-репо (звідки резолвляться `files`).
/// - `files` — `Some(...)` → posix-relative шляхи файлів для детекції
///   (per-file dispatch, [`read_source_files`]); `None` → full-scope: хост
///   сам будує batch за `ConcernContribution::glob` задекларованого
///   концерну ([`build_full_scope_files`]) — концерн БЕЗ `scope: Full` (чи
///   не задекларований у `manifest.concerns` узагалі) отримує порожній
///   batch (той самий skip-not-crash дух, що решта контракту: невідповідна
///   контрибуція не панікує, просто нічого не аналізує).
/// - `tool_paths` — опційна мапа «ім'я тула → абсолютний шлях» (задача N1,
///   рішення Д спеки): JS-бік будує її через ensure-tool контур із
///   `manifest.tools` ([`wasm_plugin_manifest`]) ДО цього виклику;
///   `None`/відсутній — порожній [`ToolResolver`], кожен `run-tool` у
///   плагіні поверне типізовану помилку в `tool-output` (не паніку).
///   Підміняється на закешованому `LoadedPlugin` ПЕРЕД кожним `detect`
///   (`LoadedPlugin::set_tool_resolver`) — різні виклики того самого
///   `wasm_path` можуть нести різний `tool_paths`.
/// Будує fix-plan концерну wasm-плагіна — тонкий binding над
/// `LoadedPlugin::fix` (fix-контур contract v3, доккомент `wit/world.wit`
/// біля `export fix`). Дзеркало [`run_native_concern_fix`] для wasm-шляху:
/// повертає `{ "edits": [...] }` — ту саму JSON-форму `FixPlan` (`type`-тег
/// `"write"`/`"delete"`), що й native-планів (типи спільні —
/// `rules_contract::fix`, реекспортовані `rules-core` після злиття
/// дзеркала), тож JS-обгортка (`run-fix.mjs`) застосовує обидва одним
/// конвеєром синтетичних T0Pattern-ів.
///
/// - `wasm_path`/`key`/`cwd`/`tool_paths` — той самий контракт, що
///   [`run_wasm_concern`] (кеш per-path, `set_tool_resolver` перед викликом).
/// - `violations` — JSON-масив, що десеріалізується у
///   `Vec<rules_contract::diagnostic::Diagnostic>` (нормалізовані
///   violations JS-боку; зайві поля `ruleId`/`concernId` serde ігнорує) —
///   стає `FixRequest::diagnostics`.
/// - `FixRequest::files` хост будує з `file`-полів переданих violations
///   (дедуп зі збереженням порядку, читання через [`read_source_files`]) —
///   ТИПОВО fix потребує лише файли, на які реально вказують діагностики,
///   окремий full-scope обхід зайвий. Якщо ЖОДНА діагностика не несе
///   `file` (whole-batch концерн — `js/check`, доккомент нижче біля
///   full-scope fallback-гілки), хост падає назад на ТОЙ САМИЙ full-scope
///   резолв, що [`run_wasm_concern`] робить для `files: None` на детекті —
///   АЛЕ лише коли концерн реально `scope: full` (задекларовано в
///   `describe().concerns`). Якщо `target_files` порожній, диагностики
///   непорожні, а концерн НЕ `full`-scope (чи взагалі не знайдений у
///   маніфесті) — хост бере `delta_files` (нижче), а без неї НЕ вгадує (ні
///   мовчазний порожній batch, ні full-scope glob-обхід, який для
///   `per-file`-концерну розширив би fix за межі дельти): падає з
///   типізованою помилкою (доккомент [`ambiguous_empty_fix_batch_err`]
///   нижче) — задача fix/napi-empty-fix-batch, продовження #513 для
///   НЕ-full-scope концернів.
/// - `delta_files` — ОПЦІЙНИЙ явний список файлів запиту (posix-relative,
///   та сама форма, що `files` у [`run_wasm_concern`]): дельта, по якій
///   оркестрація вже проганяла `detect`. Потрібен рівно для одного стану —
///   `per-file`-концерн із агрегованими (file-less) діагностиками, де
///   вивести `files` із `diagnostics[].file` неможливо; в усіх інших
///   гілках ігнорується, тож викликач, який його не передає, поведінки не
///   міняє. Це рішення (б) відкритого питання, яке лишив #517 (доккомент
///   `wit/world.wit` біля `record diagnostic`): дельту несе ЗАПИТ, а не
///   кожна діагностика — розширювати WIT не довелось, `fix-request.files`
///   для цього вже існує, бракувало лише проводки host → napi.
///
/// # Чому `delta_files` в кінці, а не в позиції `files` [`run_wasm_concern`]
///
/// Позиційна симетрія з детектом тут була б оманливою: у `detect` `files` —
/// ОСНОВНИЙ вхід (що аналізувати), у `fix` основний вхід — `violations`, а
/// `delta_files` лише добудовує batch у вузькій гілці. Хвостова позиція до
/// того ж лишає валідними наявні 4-аргументні виклики (тести fix-контуру
/// `wasm-plugin-parity*.test.mjs`), яким дельта не потрібна.
///
/// Порожній `edits` = «фікс для цих violations нічого не змінює» — той
/// самий контракт застосовності, що в native-плану ([`run_native_concern_fix`]).
/// Невалідний план від плагіна (path-escape, ліміти розміру) хост відхиляє
/// ЦІЛКОМ ще до цього binding-а (`LoadedPlugin::fix` →
/// `rules_contract::validators::fix`) — сюди долітає типізована помилка.
#[napi]
pub fn run_wasm_concern_fix(
    wasm_path: String,
    key: String,
    cwd: String,
    violations: serde_json::Value,
    tool_paths: Option<HashMap<String, String>>,
    delta_files: Option<Vec<String>>,
) -> Result<serde_json::Value> {
    use rules_contract::diagnostic::Diagnostic;
    use rules_contract::fix::FixRequest;

    let diagnostics: Vec<Diagnostic> = serde_json::from_value(violations)
        .map_err(|err| Error::from_reason(format!("runWasmConcernFix: невалідний вхід: {err}")))?;

    let cwd_path = PathBuf::from(&cwd);
    let mut target_files: Vec<String> = Vec::new();
    for diagnostic in &diagnostics {
        let Some(file) = &diagnostic.file else {
            continue;
        };
        if !target_files.contains(file) {
            target_files.push(file.clone());
        }
    }

    let resolver = build_tool_resolver(tool_paths);
    let plan = with_loaded_plugin(&wasm_path, |plugin| {
        // Full-scope fallback (задача порту T0-фіксера `js/check`, доккомент
        // `crates/plugin-lang-js/src/lib.rs`, секція «`js/check` — T0-фіксер
        // ПОРТОВАНО»): whole-batch концерни (`checkOxlintRc`/
        // `checkKnipConfig`/`checkEslintConfig` — стан цілого дерева, не
        // одного файлу) НІКОЛИ не кладуть `file` у свої діагностики (той
        // самий JS-канон, golden-фікстура `js/check.json` це підтверджує) —
        // без цієї гілки `target_files` була б ЗАВЖДИ порожньою для такого
        // концерну, і `FixRequest::files` не бачила б жодного наявного файлу
        // на диску консюмера (фіксер писав би наосліп: не міг би відрізнити
        // «файл відсутній» від «файл є, але хост його не передав»). Той
        // самий full-scope резолв, що [`run_wasm_concern`] уже робить для
        // `files: None` на детекті ([`build_full_scope_files`]) — спрацьовує
        // ЛИШЕ коли жодна діагностика не назвала конкретний файл, тож
        // file-scoped фіксери (`test/no-bun-test-import`, `js/doc_comments`,
        // `rust/cargo_mutants_config` — усі несуть `diagnostic.file`)
        // поведінки не міняють. Безпечний ЛИШЕ для `scope: full` — для
        // `per-file` концерну той самий glob-обхід розширив би fix ЗА МЕЖІ
        // дельти (порушив би сам per-file-контракт), тож гілка нижче
        // звужена саме на `Full`.
        //
        // # Неоднозначний порожній batch для НЕ-full-scope концерну
        // (задача fix/napi-empty-fix-batch, продовження #513)
        //
        // `target_files` порожній ще й тоді, коли `per-file`-концерн має
        // РЕАЛЬНІ (непорожні) violations, але жодна не несе `file` —
        // агрегована діагностика на весь прогін зовнішнього тула, не по
        // одному файлу (живий кандидат: `python/ruff` —
        // `crates/plugin-lang-python/src/lib.rs::detect_ruff`, одна
        // діагностика на ВЕСЬ `ruff check`/`ruff format --check`, тула не
        // парсить свій вивід по файлах). Це ТА САМА двозначність, що
        // спричинила #513 (`Vec::new()` → гість не відрізняє «файлів
        // немає» від «хост їх не передав»), лише для не-full-scope
        // концерну, де full-scope glob-обхід — НЕ безпечна заміна (вище).
        // WIT-контракт (`wit/world.wit`, `record diagnostic`/`record
        // fix-request`) МОВЧИТЬ про цей випадок — не каже, що per-file
        // діагностика МУСИТЬ нести `file`, і не визначає, як host має
        // будувати `fix-request.files`, коли вона цього не робить. Тож
        // замість вгадувати — падаємо голосно (доккомент
        // [`ambiguous_empty_fix_batch_err`]): принцип власника
        // «сигналізувати яскраво, не ховати» (error, не warn). Порожні
        // `diagnostics` (нема violations узагалі — нема що фіксити)
        // лишаються Vec::new(), як і раніше — жодної двозначності немає.
        let contribution = plugin
            .describe()
            .concerns
            .iter()
            .find(|c| c.key == key)
            .cloned();
        let files = if target_files.is_empty() {
            match &contribution {
                Some(c) if c.scope == ConcernScope::Full => {
                    build_full_scope_files(&cwd_path, &c.glob)
                }
                _ if diagnostics.is_empty() => Vec::new(),
                // Явна дельта викликача (`delta_files`) — рішення (б)
                // відкритого питання, яке лишив по собі fix/napi-empty-fix-batch
                // (доккомент `wit/world.wit` біля `record diagnostic`).
                // Агрегована діагностика `per-file`-концерну (одна на весь
                // прогін зовнішнього тула, `python/ruff`) НЕ несе `file` — і
                // не мусить: дельта є властивістю ЗАПИТУ, а не діагностики.
                // Хост-оркестрація її вже знає (`item.files`, той самий
                // список, який сусіднім викликом іде в `detect`), тож замість
                // вимагати per-diagnostic атрибуцію вона просто проводить
                // дельту сюди. Порожній `delta_files` НЕ приймається за
                // відповідь (`!delta.is_empty()`): «дельта є, але порожня»
                // при непорожніх diagnostics — той самий нерозрізненний стан,
                // що й відсутня дельта, тож він і далі падає голосно нижче.
                _ => match delta_files.as_deref() {
                    Some(delta) if !delta.is_empty() => read_source_files(&cwd_path, delta.to_vec()),
                    _ => {
                        let scope_label = contribution
                            .as_ref()
                            .map(|c| format!("{:?}", c.scope))
                            .unwrap_or_else(|| "не заявлений у describe().concerns".to_string());
                        return Err(ambiguous_empty_fix_batch_err(
                            &key,
                            &scope_label,
                            diagnostics.len(),
                        ));
                    }
                },
            }
        } else {
            read_source_files(&cwd_path, target_files.clone())
        };
        plugin.set_tool_resolver(resolver);
        // Слот `repo-root@1` host-контексту (доккомент `wit/world.wit` біля
        // `import host-context`) — той самий `cwd`, що резолвить `files`.
        plugin.set_repo_root(Some(cwd.clone()));

        // Host-diff для exec-tool-фіксерів (§2.51/§2.63 реєстру відкритих
        // питань) — знімок ДО виклику `fix()`. Скоуп знімку: ПОВНИЙ glob
        // концерну (`contribution.glob`), НЕ лише `files`/`target_files`.
        //
        // Чому не дешевший скоуп «лише `files`»: exec-tool, що мутує диск
        // напряму (`ruff check --fix .`, `eslint --fix` без явного списку
        // файлів), НЕ обмежений дельтою запиту — тул сам вирішує, які
        // файли зачепити (весь `cwd`, свій власний glob/config-резолв).
        // Знімок лише `files` побачив би ЛИШЕ ту підмножину, яку хост і
        // так уже передав, і мовчки пропустив би мутації поза нею — саме
        // той клас «тихого success», який ця інфраструктура мала закрити.
        // Обраний скоуп коштує подвійного читання `contribution.glob` на
        // КОЖЕН fix-виклик (до і після) — свідомий компроміс «гучно й
        // повільніше, ніж тихо й швидше» (принцип проекту), а не
        // недогляд. Межа: якщо `contribution` не знайдено в
        // `describe().concerns` (концерн не задекларований), glob
        // невідомий — діф пропускається (порожні знімки), поведінка
        // деградує до стану ДО цієї зміни, без нового захисту, але й без
        // регресії.
        let diff_glob: Option<&[String]> = contribution.as_ref().map(|c| c.glob.as_slice());
        let before_snapshot: HashMap<String, String> = diff_glob
            .map(|glob| {
                build_full_scope_files(&cwd_path, glob)
                    .into_iter()
                    .map(|f| (f.path, f.content))
                    .collect()
            })
            .unwrap_or_default();

        let mut plan = plugin
            .fix(&FixRequest {
                concern_id: key.clone(),
                files,
                diagnostics,
            })
            .map_err(to_wasm_napi_err)?;

        // Знімок ПІСЛЯ — і мерж діфу з планом, що гість повернув сам.
        // Декларативні фіксери (диск не мутують у `fix()`) дають
        // `before == after` для кожного шляху знімку — синтезований діф
        // порожній, план лишається РІВНО тим, що повернув гість (жодної
        // зміни для вже портованих концернів, напр. `js/doc_comments`).
        if let Some(glob) = diff_glob {
            let after_snapshot: HashMap<String, String> = build_full_scope_files(&cwd_path, glob)
                .into_iter()
                .map(|f| (f.path, f.content))
                .collect();
            let covered: std::collections::HashSet<String> = plan
                .edits
                .iter()
                .map(|e| match e {
                    rules_contract::fix::FileEdit::Write(w) => w.path.clone(),
                    rules_contract::fix::FileEdit::Delete { path } => path.clone(),
                })
                .collect();
            plan.edits.extend(diff_snapshot_edits(
                &before_snapshot,
                &after_snapshot,
                &covered,
            ));
        }

        Ok(plan)
    })?;
    serde_json::to_value(plan).map_err(|err| {
        Error::from_reason(format!(
            "runWasmConcernFix: серіалізація плану провалилась: {err}"
        ))
    })
}

/// Запускає wasm-порт concern-а за ключем — тонкий binding над
/// [`rules_core::concerns::run_concern`] (E1 фази 5).
/// Повертає `{ "violations": [...] }` у тій самій JSON-формі, що й native-виклик;
/// `files` задає явний список файлів, а `None` вмикає full-scope резолв через
/// `describe().concerns` і `set_tool_resolver` перед `detect`.
#[napi]
pub fn run_wasm_concern(
    wasm_path: String,
    key: String,
    cwd: String,
    files: Option<Vec<String>>,
    tool_paths: Option<HashMap<String, String>>,
) -> Result<serde_json::Value> {
    let cwd_path = PathBuf::from(&cwd);
    let resolver = build_tool_resolver(tool_paths);
    let diagnostics = with_loaded_plugin(&wasm_path, |plugin| {
        let source_files = match files {
            Some(files) => read_source_files(&cwd_path, files),
            None => {
                let contribution = plugin
                    .describe()
                    .concerns
                    .iter()
                    .find(|c| c.key == key)
                    .cloned();
                match contribution {
                    Some(c) if c.scope == ConcernScope::Full => {
                        build_full_scope_files(&cwd_path, &c.glob)
                    }
                    _ => Vec::new(),
                }
            }
        };
        let batch = DetectBatch {
            concern_id: key.clone(),
            files: source_files,
        };
        plugin.set_tool_resolver(resolver);
        // Слот `repo-root@1` host-контексту (доккомент `wit/world.wit` біля
        // `import host-context`) — той самий `cwd`, від якого збудовано
        // batch: концерни з абсолютними шляхами у `diagnostic.data`
        // (`test/storybook-vitest-config`) резолвлять їх guest-side.
        plugin.set_repo_root(Some(cwd.clone()));
        plugin.detect(&batch).map_err(to_wasm_napi_err)
    })?;
    Ok(serde_json::json!({ "violations": diagnostics }))
}

#[cfg(test)]
mod tests {
    //! [`read_source_files`] — «якорі» (`lint.anchors`,
    //! `crates/rules-core/src/lint_plan.rs::plan_concern_for_delta`) кладуться
    //! в `files` planner-ом БЕЗУМОВНО (незалежно від того, чи шлях реально є
    //! на диску) — саме цей `filter_map`+`.ok()` тут і дає гостю точну
    //! семантику «якір у batch-і РІВНО тоді, коли він існує». Поведінка сама
    //! по собі НЕ нова (доккомент функції вже це стверджував), тест лише
    //! робить твердження перевіреним, а не декларативним.
    use super::*;

    #[test]
    fn read_source_files_skips_missing_path_and_keeps_existing() {
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(
            dir.path().join("pyproject.toml"),
            "[project]\nname = \"demo\"\n",
        )
        .expect("запис фікстури");

        let files = read_source_files(
            dir.path(),
            vec![
                "pyproject.toml".to_string(),
                "no-such-anchor.toml".to_string(),
            ],
        );

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "pyproject.toml");
        assert!(files[0].content.contains("demo"));
    }

    #[test]
    fn read_source_files_all_missing_returns_empty() {
        let dir = tempfile::tempdir().expect("tmp dir");
        let files = read_source_files(dir.path(), vec!["missing.py".to_string()]);
        assert!(files.is_empty());
    }

    // --- build_full_scope_files: консультується з `.n-rules.json:ignore` --
    //
    // Регрес задокументованого дефекту (`plugin-lang-js/src/lib.rs`,
    // доккомент біля `run_wasm_concern`-порту): до фіксу `build_full_scope_files`
    // передавала `&[]` у `walk_dir` замість `extra_ignore_globs`, зібраних із
    // consumer-репо `.n-rules.json` — файли з явно виключеної консюмером
    // директорії все одно потрапляли у full-scope batch УСІХ wasm-концернів.

    /// Дерево-фікстура: `keep.txt` у корені + `vendor/skip.txt` під
    /// директорією-кандидатом на ignore. Повертає `TempDir`, щоб фікстура
    /// не звільнилась до кінця тесту.
    fn fixture_tree_with_vendor_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("keep.txt"), "keep").expect("keep.txt");
        std::fs::create_dir_all(dir.path().join("vendor")).expect("vendor/");
        std::fs::write(dir.path().join("vendor/skip.txt"), "skip").expect("vendor/skip.txt");
        dir
    }

    /// Відносні шляхи (`SourceFile::path`), відсортовані для стабільного
    /// порівняння в асертах.
    fn sorted_paths(files: &[SourceFile]) -> Vec<&str> {
        let mut paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        paths.sort_unstable();
        paths
    }

    /// full-scope батч НЕ містить файлів із директорії, названої в
    /// `.n-rules.json:ignore` — головний регрес-кейс фіксу.
    #[test]
    fn build_full_scope_files_excludes_dir_from_n_rules_json_ignore() {
        let dir = fixture_tree_with_vendor_dir();
        std::fs::write(dir.path().join(".n-rules.json"), r#"{"ignore":["vendor"]}"#)
            .expect(".n-rules.json");

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()]);

        assert_eq!(sorted_paths(&files), vec!["keep.txt"]);
    }

    /// Без конфігу (`.n-rules.json` відсутній) поведінка не змінилась —
    /// регресія проти дофіксового `&[]`: обидва файли потрапляють у batch.
    #[test]
    fn build_full_scope_files_without_config_matches_everything() {
        let dir = fixture_tree_with_vendor_dir();

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()]);

        assert_eq!(sorted_paths(&files), vec!["keep.txt", "vendor/skip.txt"]);
    }

    /// Побитий JSON у `.n-rules.json` — tolerant-парсинг
    /// ([`rules_core::concerns::cursor_ignore::load_cursor_ignore_paths`]
    /// повертає порожній список), не крах: той самий результат, що й без
    /// конфігу взагалі.
    #[test]
    fn build_full_scope_files_survives_broken_json_config() {
        let dir = fixture_tree_with_vendor_dir();
        std::fs::write(dir.path().join(".n-rules.json"), "{ not: json").expect(".n-rules.json");

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()]);

        assert_eq!(sorted_paths(&files), vec!["keep.txt", "vendor/skip.txt"]);
    }

    /// Ignore-шлях поза `cwd` не ламає обхід — `to_relative_ignore_globs`
    /// відкидає його (rel починався б з `..`), `walk_dir` отримує порожній
    /// `extra_ignore_globs` і повертає звичайний повний список.
    #[test]
    fn build_full_scope_files_ignore_path_outside_cwd_does_not_break_walk() {
        let dir = fixture_tree_with_vendor_dir();
        let outside = tempfile::tempdir().expect("outside tmp dir");
        std::fs::write(
            dir.path().join(".n-rules.json"),
            serde_json::json!({ "ignore": [outside.path().join("elsewhere").to_string_lossy()] })
                .to_string(),
        )
        .expect(".n-rules.json");

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()]);

        assert_eq!(sorted_paths(&files), vec!["keep.txt", "vendor/skip.txt"]);
    }

    // --- run_wasm_concern_fix: неоднозначний порожній fix-batch ---
    //
    // Задача fix/napi-empty-fix-batch (продовження #513 для НЕ-full-scope
    // концернів, доккомент [`ambiguous_empty_fix_batch_err`]). Тести кличуть
    // РЕАЛЬНИЙ `run_wasm_concern_fix` проти зібраної guest-фікстури
    // `crates/test-plugin-guest` — той самий `.wasm`, що
    // `crates/rules-plugin-host/tests/contract_test_kit.rs` (шлях
    // обчислюється так само, `CARGO_MANIFEST_DIR` тут — `crates/rules-napi`,
    // теж два рівні вгору до кореня workspace).

    /// Абсолютний шлях до зібраного `.wasm`-компонента фікстури
    /// (`crates/test-plugin-guest/build.sh`).
    fn guest_fixture_wasm_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/wasm32-wasip2/release/test_plugin_guest.wasm")
    }

    /// Падає з чіткою інструкцією збірки, якщо фікстура відсутня — не
    /// мовчазний skip (той самий мотив, що `require_fixture` у
    /// `contract_test_kit.rs`).
    fn require_guest_fixture() -> PathBuf {
        let path = guest_fixture_wasm_path();
        assert!(
            path.is_file(),
            "guest-фікстура contract-test-kit не зібрана: {} відсутній.\n\
             Зберіть її командою: bash crates/test-plugin-guest/build.sh",
            path.display(),
        );
        path
    }

    /// Червоний-зелений якір цього фіксу: `test/guest-echo` — `scope:
    /// per-file` у `describe()` (`test-plugin-guest`), і `fix()` для нього
    /// падає на дефолтну заглушку (не `FIX_REWRITE_CONCERN_ID`) — тобто
    /// ДО фіксу цей самий виклик тихо повертав `Ok({"edits": []})` (гілка
    /// `_ => Vec::new()`, `target_files.is_empty()` для `PerFile`), а
    /// gуест і не підозрював, що йому дали порожній batch замість
    /// реального. Одна violation БЕЗ `file` — та сама двозначність, що
    /// #513, лише не-full-scope. Після фіксу — типізована помилка з
    /// поясненням (концерн, причина), не мовчазний порожній план.
    #[test]
    fn run_wasm_concern_fix_errors_loudly_on_ambiguous_empty_batch() {
        let wasm_path = require_guest_fixture();
        let cwd = tempfile::tempdir().expect("tmp dir");
        let violations = serde_json::json!([
            {
                "reason": "guest-echo",
                "message": "агрегована діагностика без file",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-echo".to_string(),
            cwd.path().to_string_lossy().to_string(),
            violations,
            None,
            None,
        );

        let err = result.expect_err(
            "per-file концерн з file-less діагностикою МАЄ падати з поясненням, не мовчати",
        );
        let message = err.to_string();
        assert!(
            message.contains("test/guest-echo"),
            "повідомлення має називати конкретний концерн: {message}"
        );
        assert!(
            message.contains("file"),
            "повідомлення має пояснювати причину (відсутній `file`): {message}"
        );
    }

    /// Регресія на full-scope шлях (`js/check`-подібний): `target_files`
    /// порожній (жодна violation не несе `file`), АЛЕ концерн заявлений
    /// `scope: full` у `describe()` — хост МАЄ впасти назад на
    /// `build_full_scope_files`, не на нову помилку. Непорожній `edits`
    /// (guest реально переписав знайдений на диску `broken.marker`)
    /// доводить, що файли справді прийшли з full-scope glob-обходу, а не
    /// просто «виклик не впав».
    #[test]
    fn run_wasm_concern_fix_full_scope_concern_falls_back_to_glob_when_target_files_empty() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("broken.marker"), "BROKEN content").expect("marker file");
        let violations = serde_json::json!([
            {
                "reason": "guest-full-scope",
                "message": "whole-batch діагностика без file",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-fix-full-scope".to_string(),
            dir.path().to_string_lossy().to_string(),
            violations,
            None,
            None,
        );

        let plan =
            result.expect("full-scope концерн має впасти назад на glob-обхід, не на нову помилку");
        let edits = plan["edits"].as_array().expect("edits — масив");
        assert_eq!(
            edits.len(),
            1,
            "full-scope обхід мав знайти marker-файл на диску: {plan:?}"
        );
        assert_eq!(edits[0]["type"], "write");
        assert_eq!(edits[0]["path"], "broken.marker");
        assert_eq!(edits[0]["content"], "FIXED content");
    }

    /// Регресія на file-scoped шлях (`test/no-bun-test-import`,
    /// `js/doc_comments`, `rust/doc_comments`, `rust/cargo_mutants_config`,
    /// `ga/workflows`, `rust/toolchain_cache` — усі несуть
    /// `diagnostic.file`): `target_files` НЕПОРОЖНІЙ (violation несе
    /// `file`) — гілка `if target_files.is_empty()` узагалі не
    /// виконується, увесь цей фікс на неї не впливає. `test/guest-fix-rewrite`
    /// (`test-plugin-guest`) — той самий шаблон `BROKEN`→`FIXED`.
    #[test]
    fn run_wasm_concern_fix_file_scoped_concern_uses_explicit_diagnostic_file_unaffected() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("target.txt"), "BROKEN content").expect("target file");
        let violations = serde_json::json!([
            {
                "reason": "guest-echo",
                "message": "file-scoped violation",
                "file": "target.txt",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-fix-rewrite".to_string(),
            dir.path().to_string_lossy().to_string(),
            violations,
            None,
            None,
        );

        let plan = result.expect("file-scoped фіксер з diagnostic.file не мав зламатись фіксом");
        let edits = plan["edits"].as_array().expect("edits — масив");
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0]["path"], "target.txt");
        assert_eq!(edits[0]["content"], "FIXED content");
    }

    /// Порожні `diagnostics` (немає violations узагалі — нема що фіксити)
    /// лишаються Vec::new() без помилки: нема двозначності «діагностики
    /// без file», бо діагностик просто немає. Відрізняє «нічого фіксити»
    /// від ambiguous-кейсу вище.
    #[test]
    fn run_wasm_concern_fix_empty_diagnostics_returns_empty_plan_without_error() {
        let wasm_path = require_guest_fixture();
        let cwd = tempfile::tempdir().expect("tmp dir");

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-echo".to_string(),
            cwd.path().to_string_lossy().to_string(),
            serde_json::json!([]),
            None,
            None,
        );

        let plan = result.expect("порожні diagnostics — немає що фіксити, не помилка");
        assert_eq!(plan["edits"].as_array().expect("edits — масив").len(), 0);
    }

    // --- run_wasm_concern_fix: явна дельта запиту (`delta_files`) ---
    //
    // Рішення (б) відкритого питання #517 (доккомент
    // [`ambiguous_empty_fix_batch_err`], секція «Контракт більше не мовчить»).

    /// Червоно-зелений якір рішення (б): `test/guest-fix-rewrite` — `scope:
    /// per-file` у `describe()`, violation БЕЗ `file` (агрегована
    /// діагностика, як `python/ruff`). До цієї зміни виклик падав
    /// [`ambiguous_empty_fix_batch_err`]; тепер `delta_files` дає хосту
    /// список, з якого будується `FixRequest::files`.
    ///
    /// Перевіряється саме ДОСТАВКА файлів гостю, а не «виклик не впав»:
    /// guest-фікстура переписує `BROKEN`→`FIXED` лише в тих файлах, які
    /// РЕАЛЬНО прийшли в `FixRequest::files` (їх вміст вона бачить тільки
    /// звідти — власного fs-доступу в неї для цього концерну немає). Порожній
    /// `edits` тут означав би, що дельта до гостя не дійшла.
    #[test]
    fn run_wasm_concern_fix_uses_delta_files_when_no_diagnostic_carries_file() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("target.txt"), "BROKEN content").expect("target file");
        let violations = serde_json::json!([
            {
                "reason": "guest-echo",
                "message": "агрегована діагностика без file",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-fix-rewrite".to_string(),
            dir.path().to_string_lossy().to_string(),
            violations,
            None,
            Some(vec!["target.txt".to_string()]),
        );

        let plan = result.expect("явна дельта запиту має зняти двозначність, а не падати");
        let edits = plan["edits"].as_array().expect("edits — масив");
        assert_eq!(
            edits.len(),
            1,
            "дельта мала дійти до гостя як FixRequest::files: {plan:?}"
        );
        assert_eq!(edits[0]["path"], "target.txt");
        assert_eq!(edits[0]["content"], "FIXED content");
    }

    /// Дельта НЕ звужує batch, коли діагностики самі несуть `file`:
    /// пріоритет лишається за `diagnostic.file` (найвужчий batch — рівно ті
    /// файли, на які вказують violations). Тут `delta_files` називає ДВА
    /// файли, violation — один; фіксер має чинити тільки названий
    /// діагностикою, інакше fix розповзся б по всій дельті.
    #[test]
    fn run_wasm_concern_fix_diagnostic_file_wins_over_delta_files() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("target.txt"), "BROKEN content").expect("target file");
        std::fs::write(dir.path().join("other.txt"), "BROKEN content").expect("other file");
        let violations = serde_json::json!([
            {
                "reason": "guest-echo",
                "message": "file-scoped violation",
                "file": "target.txt",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-fix-rewrite".to_string(),
            dir.path().to_string_lossy().to_string(),
            violations,
            None,
            Some(vec!["target.txt".to_string(), "other.txt".to_string()]),
        );

        let plan = result.expect("file-scoped шлях не мав зламатись через передану дельту");
        let edits = plan["edits"].as_array().expect("edits — масив");
        assert_eq!(
            edits.len(),
            1,
            "fix мав лишитись у межах diagnostic.file, не розповзтись по дельті: {plan:?}"
        );
        assert_eq!(edits[0]["path"], "target.txt");
    }

    /// ПОРОЖНЯ дельта не приймається за відповідь: «дельта є, але порожня»
    /// при непорожніх діагностиках — той самий нерозрізненний стан, що й
    /// відсутня дельта (гість не відрізнить «файлів немає» від «хост їх не
    /// передав»), тож fail-loud лишається.
    #[test]
    fn run_wasm_concern_fix_empty_delta_files_still_errors_loudly() {
        let wasm_path = require_guest_fixture();
        let cwd = tempfile::tempdir().expect("tmp dir");
        let violations = serde_json::json!([
            {
                "reason": "guest-echo",
                "message": "агрегована діагностика без file",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-echo".to_string(),
            cwd.path().to_string_lossy().to_string(),
            violations,
            None,
            Some(Vec::new()),
        );

        let err = result.expect_err("порожня дельта — та сама двозначність, має падати");
        assert!(
            err.to_string().contains("delta_files"),
            "повідомлення має підказати штатний шлях: {err}"
        );
    }
}
