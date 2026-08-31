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
use rules_contract::manifest::{ConcernContribution, ConcernScope};
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

/// Усі СЬОГОДНІ відомі world-и повноважень (крок 5 спеки
/// `docs/specs/2026-08-31-plugin-contract-v5.md`) — розширюють лінкер
/// БЕЗУМОВНО для КОЖНОГО завантаження, не лише `plugin-lang-js`
/// (єдиного сьогодні реального споживача, `bun/package_json`).
///
/// # Чому безумовно, а не читаючи `manifest.worlds`
///
/// Курка-яйце (спека §8): щоб знати, які world-и оголосив компонент, треба
/// прочитати маніфест; щоб прочитати маніфест (`describe()`), компонент
/// уже має бути інстанційований проти ПРАВИЛЬНОГО набору імпортів.
/// Розвʼязання без інстанціації — custom-section дискавері
/// (`inspect_component`, без wasmtime) — окрема робота Д2
/// (`crates/rules-cli`), поза обсягом цього кроку.
///
/// Безумовне розширення — безпечний обхід: `crate::world_linker`
/// (`rules-plugin-host`) документує експериментально доведений факт —
/// «зайві» імпорти в лінкері НЕ шкодять гостю, що їх не потребує
/// (Component Model перевіряє лише що гостьові імпорти ЗАДОВОЛЕНІ, не що
/// лінкер СКУПИЙ). Пʼять із шести first-party гостей і сьогодні несуть
/// `worlds = []` — для них цей рядок не міняє нічого.
fn declared_worlds() -> &'static [String] {
    static WORLDS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    WORLDS.get_or_init(|| vec!["n-rules:caps/file-reader@1.0.0".to_string()])
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
/// виклик для цього шляху) і виконує `f` над ним — БЕЗ кореня preopen-ів.
///
/// Вхід для викликів, які кореня не мають і не потребують
/// ([`wasm_plugin_concerns`]/[`wasm_plugin_manifest`] — чистий
/// `describe()`). Плагін із непорожнім `capabilities.fs-read`, узятий цим
/// шляхом, лишається придатним лише до `describe()`: перший же
/// `detect`/`fix` на ньому падає типізовано
/// (`PluginHostError::FsReadRootUnbound`), а не читає порожню пісочницю
/// мовчки. Виклики з деревом ходять через
/// [`with_loaded_plugin_in_root`].
fn with_loaded_plugin<T>(
    wasm_path: &str,
    f: impl FnOnce(&mut LoadedPlugin) -> Result<T>,
) -> Result<T> {
    with_loaded_plugin_in_root(wasm_path, None, f)
}

/// Те саме, але з КОРЕНЕМ дерева, що лінтується (`cwd`-параметр
/// [`run_wasm_concern`]/[`run_wasm_concern_fix`]) — від нього хост
/// резолвить `capabilities.fs-read`-preopens (§2.95 реєстру відкритих
/// питань).
///
/// # Чому кеш переживає зміну кореня, а інстанс — ні
///
/// `LOADED_PLUGINS` кешує інстанс per-path на процес (уникнення повторної
/// компіляції компонента), але preopens фіксуються при створенні `Store` —
/// підмінити їх постфактум, як `set_tool_resolver`/`set_repo_root`,
/// неможливо. Тож коли закешований інстанс відкритий НЕ на те дерево, яке
/// прийшло з викликом, плагін перезавантажується
/// ([`preopen_root_satisfies`]). Ціна платиться ЛИШЕ плагінами з
/// непорожнім `fs-read` (жоден чинний маніфест його не заявляє) — решта
/// preopen-ів не має взагалі, тож для них корінь ні на що не впливає й
/// кеш працює як раніше.
fn with_loaded_plugin_in_root<T>(
    wasm_path: &str,
    root: Option<&Path>,
    f: impl FnOnce(&mut LoadedPlugin) -> Result<T>,
) -> Result<T> {
    LOADED_PLUGINS.with(|cache| {
        let mut cache = cache.borrow_mut();
        let cached_fits = cache.get(wasm_path).is_some_and(|plugin| {
            preopen_root_satisfies(
                !plugin.describe().capabilities.fs_read.is_empty(),
                plugin.preopen_root(),
                root,
            )
        });
        if !cached_fits {
            let loaded = PLUGIN_HOST
                .with(|host| match root {
                    Some(root) => {
                        host.load_in_root_for_worlds(
                            Path::new(wasm_path),
                            PLUGIN_WORLD_VERSION,
                            root,
                            declared_worlds(),
                        )
                    }
                    None => host.load_for_worlds(Path::new(wasm_path), PLUGIN_WORLD_VERSION, declared_worlds()),
                })
                .map_err(to_wasm_napi_err)?;
            cache.insert(wasm_path.to_string(), loaded);
        }
        let plugin = cache
            .get_mut(wasm_path)
            .expect("щойно вставлено або вже було в кеші");
        f(plugin)
    })
}

/// Чи придатний закешований інстанс для виклику з коренем `wanted`
/// (доккомент [`with_loaded_plugin_in_root`]).
///
/// Чиста функція — рішення тут одне на всі гілки кешу, і воно варте
/// власних юніт-тестів: «підходить/не підходить» помилкове в бік `true`
/// означає рівно ту ваду, яку §2.95 закриває (гість читає ІНШЕ дерево,
/// мовчки), а помилкове в бік `false` — зайву перекомпіляцію компонента на
/// кожен виклик.
fn preopen_root_satisfies(
    declares_fs_read: bool,
    cached_root: Option<&Path>,
    wanted_root: Option<&Path>,
) -> bool {
    // Порожній `fs-read` — жодного preopen-у не відкривається, тож корінь
    // на поведінку гостя не впливає (типовий випадок: усі чинні маніфести).
    if !declares_fs_read {
        return true;
    }
    match (cached_root, wanted_root) {
        // Корінь виклику невідомий (`describe()`-шлях) — інстанс лишається
        // як є: гейт `FsReadRootUnbound` спрацює на `detect`/`fix`, якщо
        // хтось спробує ним щось запустити.
        (_, None) => true,
        (Some(cached), Some(wanted)) => cached == wanted,
        // Інстанс без preopen-ів, а дерево тепер відоме — перезавантажити.
        (None, Some(_)) => false,
    }
}

/// Абсолютний корінь дерева з `cwd`-параметра napi-виклику.
///
/// `cwd` приходить із JS і за конвенцією вже абсолютний, але хост вимагає
/// абсолютний шлях типізовано (`PluginHostError::RelativePreopenRoot`) —
/// тож відносний тут дорезолвлюється РІВНО так само, як його вже резолвить
/// решта fix/detect-шляху (`cwd_path.join(file)` у [`read_source_files`]):
/// від cwd процесу. Так preopens і батч файлів гарантовано дивляться в
/// одне дерево, яким би не був вхід.
fn absolute_root(cwd: &Path) -> Result<PathBuf> {
    if cwd.is_absolute() {
        return Ok(cwd.to_path_buf());
    }
    let base = std::env::current_dir().map_err(|err| {
        Error::from_reason(format!(
            "не вдалось визначити cwd процесу для резолву відносного кореня `{}`: {err}",
            cwd.display()
        ))
    })?;
    Ok(base.join(cwd))
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

/// Типізована помилка «патерн glob-а контрибуції невалідний».
///
/// # Чому помилка, а не мовчазний пропуск (той самий клас, що §2.65/§2.72)
///
/// До цієї правки обидві гілки нижче стояли як `if let Ok(glob) = …` БЕЗ
/// `else`: невалідний патерн просто зникав із набору. Наслідок залежить від
/// того, який саме патерн зник, і жоден із варіантів не видно в логах:
/// зник include — концерн отримує МЕНШЕ файлів (або нуль, і тоді звітує
/// «чисто», не перевіривши нічого); зник exclude — БІЛЬШЕ, тобто гість
/// бачить файли, які канон свідомо відсіює. Обидва — тиха розбіжність із
/// каноном, рівно та, що §2.65 (`--full` мовчки не перевіряв per-file
/// концерни) і §2.72 (вузький glob беззвучно каструє fix) робили гучною.
///
/// `plugin.toml` і `build_manifest()` гостя — єдине джерело цих патернів,
/// тож помилка називає патерн дослівно: правити треба там.
fn invalid_contribution_glob_err(pattern: &str, err: &globset::Error) -> Error {
    Error::from_reason(format!(
        "runWasmConcern: патерн `{pattern}` у glob-і контрибуції концерну невалідний ({err}). \
         Раніше такий патерн мовчки випадав із набору — і скоуп концерну тихо \
         розходився з каноном в один чи інший бік (менше файлів → «чисто», не \
         перевіривши нічого; менше виключень → гість бачить те, що канон відсіює). \
         Патерни оголошує плагін: `plugin.toml` + `build_manifest()` відповідного \
         крейта. Див. §2.65/§2.72 docs/plans/2026-08-05-open-questions-register.md."
    ))
}

/// Типізована помилка «файл у batch-і не UTF-8» (§2.83 реєстру відкритих
/// питань) — [`read_source_files`] кличе її замість колишнього
/// `String::from_utf8_lossy`.
///
/// # Чому відмова, а не lossy-конверсія (§2.65: тихий скіп — вада)
///
/// `source-file.content` у WIT — `string`, тобто **валідний UTF-8**: байтів
/// контракт не транспортує взагалі. Lossy-конверсія мовчки підміняла кожен
/// невалідний байт на `U+FFFD` (`EF BF BD`) — і поки цей рядок їхав лише в
/// `detect`, наслідком був хибний вердикт. Але той самий
/// [`read_source_files`] годує ОБИДВА знімки host-diff-у
/// (`before_snapshot`/`after_snapshot` у [`run_wasm_concern_fix`]), а
/// [`diff_snapshot_edits`] синтезує з них `FileEdit::Write` — тобто для
/// файлу, що потрапив у glob контрибуції і був змінений exec-tool-ом,
/// хост записав би на диск НЕ те, що там лежить, а покалічений lossy-рядок:
/// 12 байтів PNG-сигнатури перетворюються на 18 байтів мозаїки, файл
/// знищено. Регрес — `read_source_files_rejects_non_utf8_file` і
/// `host_diff_snapshot_rejects_non_utf8_file` нижче.
///
/// Сьогодні жодна контрибуція бінарного глоба не має
/// (`crates/plugin-*/plugin.toml` — лише `*.yml`/`*.vue`/`*.test.mjs` тощо),
/// тож ця відмова не змінює жодного чинного прогону: вона стріляє рівно
/// тоді, коли новий концерн заявить glob, що зачіпає бінарник — і скаже це
/// вголос, замість зіпсувати файл.
fn non_utf8_source_file_err(rel: &str, err: &std::string::FromUtf8Error) -> Error {
    Error::from_reason(format!(
        "runWasmConcern: файл `{rel}` не є валідним UTF-8 ({err}), а `source-file.content` \
         контракту `n-rules:plugin` — `string`, не `list<u8>`: байти через цю межу не їдуть. \
         Раніше тут стояв `String::from_utf8_lossy`, який мовчки підміняв невалідні байти на \
         U+FFFD — і той самий покалічений вміст ішов у знімки host-diff, з яких синтезується \
         `FileEdit::Write`, тобто фікс ПЕРЕЗАПИСАВ БИ бінарний файл мозаїкою. Полагодити можна \
         двома способами: звузити `glob` контрибуції концерну (`plugin.toml` + `build_manifest()` \
         плагіна), щоб він не зачіпав нетекстові файли, або передати явний список файлів. \
         Див. доккомент non_utf8_source_file_err (crates/rules-napi/src/lib.rs) і §2.83 \
         docs/plans/2026-08-05-open-questions-register.md."
    ))
}

/// Читає `SourceFile` для explicit-переданого списку файлів (per-file
/// диспатч, чи будь-який виклик, де caller уже знає, які файли передати).
/// Відсутній/нечитаний файл пропускається — та сама поведінка, що дав би
/// звичайний filesystem-обхід; а от файл, що існує й прочитався, але НЕ є
/// валідним UTF-8, — гучна відмова ([`non_utf8_source_file_err`]), не
/// lossy-підміна байтів.
fn read_source_files(cwd: &Path, files: Vec<String>) -> Result<Vec<SourceFile>> {
    let mut out = Vec::new();
    for rel in files {
        let abs = cwd.join(&rel);
        let Ok(bytes) = std::fs::read(&abs) else {
            continue;
        };
        let content =
            String::from_utf8(bytes).map_err(|err| non_utf8_source_file_err(&rel, &err))?;
        out.push(SourceFile { path: rel, content });
    }
    Ok(out)
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
/// `!`-префікс патерна — ВИКЛЮЧЕННЯ, точно як у `concern.json`'s `walkGlob`
/// (`resolveTargetFiles`, `npm/scripts/lib/resolve-target-files.mjs`) і як
/// у решті glob-поверхонь репо. До цієї правки `!`-патерн потрапляв прямо в
/// [`globset::Glob::new`], де `!` — ЗВИЧАЙНИЙ символ шляху: патерн не матчив
/// нічого, виключення мовчки не діяло, і гість отримував у batch файли, які
/// канон свідомо відсіює (`.azurepipelines/templates/**` для
/// `azure-pipelines/service_deploy_pipeline` — перша контрибуція, що
/// декларує `!`; до неї жоден гість `!`-патернів не мав, тож дефект був
/// латентним). Мовчазне розширення detect-скоупу — рівно той клас тихої
/// розбіжності з каноном, що §2.65/§2.72 робили гучним, тому семантика
/// додана тут, у хості, а не обходиться в кожному гості окремо.
fn build_full_scope_files(cwd: &Path, glob_patterns: &[String]) -> Result<Vec<SourceFile>> {
    let mut builder = globset::GlobSetBuilder::new();
    let mut exclude_builder = globset::GlobSetBuilder::new();
    let mut has_excludes = false;
    for pattern in glob_patterns {
        match pattern.strip_prefix('!') {
            Some(negated) => {
                let glob = globset::Glob::new(negated)
                    .map_err(|e| invalid_contribution_glob_err(pattern, &e))?;
                exclude_builder.add(glob);
                has_excludes = true;
            }
            None => {
                let glob = globset::Glob::new(pattern)
                    .map_err(|e| invalid_contribution_glob_err(pattern, &e))?;
                builder.add(glob);
            }
        }
    }
    let Ok(set) = builder.build() else {
        return Ok(Vec::new());
    };
    let excludes = if has_excludes {
        exclude_builder.build().ok()
    } else {
        None
    };
    let matched: Vec<String> = rules_core::concerns::cursor_ignore::walk_repo(cwd)
        .into_iter()
        .filter(|f| set.is_match(f))
        .filter(|f| !excludes.as_ref().is_some_and(|ex| ex.is_match(f)))
        .collect();
    read_source_files(cwd, matched)
}

/// Типізована помилка «нерозвʼязний detect-batch full-прогону» —
/// [`build_detect_batch_files`] кличе її, коли виклик НЕ дав явного `files`
/// (full-прогін), а контрибуція концерну не дає з чого побудувати batch:
/// або її взагалі немає у `describe().concerns`, або вона `per-file` БЕЗ
/// жодного glob-патерну.
///
/// # Чому помилка, а не мовчазний `Vec::new()` (§2.65)
///
/// Мовчазний порожній batch тут — рівно та вада, яку
/// [`ambiguous_empty_fix_batch_err`] (§2.52) зробила гучною на fix-боці, лише
/// на detect-боці й тому вдвічі підступніша: гість отримує нуль файлів,
/// повертає нуль діагностик, і концерн звітує «чисто» — прогін ЗЕЛЕНИЙ, хоча
/// не перевірено нічого. До §2.65 сюди мовчки провалювався КОЖЕН
/// `per-file`-концерн у `--full` (девʼять контрибуцій у чотирьох гостях):
/// гілка `_ => Vec::new()` не розрізняла «нема що читати» і «хост не зумів
/// побудувати список».
///
/// # Що НЕ є цим станом
///
/// - `per-file` з непорожнім glob-ом — штатний full-прогін
///   ([`build_full_scope_files`], та сама гілка, що `scope: Full`);
/// - `scope: Full` з ПОРОЖНІМ glob-ом — свідома декларація «канон не читає
///   з диска нічого перед спавном» (`js/jscpd_duplicates`,
///   `crates/plugin-lang-js/plugin.toml`): порожній batch там — заявлений
///   намір гостя, не прогалина хоста;
/// - glob, що не зматчив жодного файлу в конкретному репо — чесна відповідь
///   «таких файлів тут немає», не двозначність.
fn unresolvable_detect_batch_err(key: &str, scope_label: &str, cause: &str) -> Error {
    Error::from_reason(format!(
        "runWasmConcern: концерн `{key}` (scope: {scope_label}) — виклик БЕЗ явного списку \
         `files` (full-прогін, `--full`), і хост не може побудувати detect-batch: {cause}. \
         Порожній batch тут був би мовчазною брехнею про чистоту: гість не побачив би жодного \
         файлу, повернув би нуль діагностик, а концерн звітував би «чисто» (та сама вада, що \
         на fix-боці зробила гучною ambiguous_empty_fix_batch_err). Полагодити можна двома \
         способами: задекларувати `glob` контрибуції (`plugin.toml` + `build_manifest()` \
         плагіна) або передати явний список файлів четвертим аргументом runWasmConcern. \
         Див. доккомент build_detect_batch_files (crates/rules-napi/src/lib.rs) і §2.65 \
         docs/plans/2026-08-05-open-questions-register.md."
    ))
}

/// Batch full-прогону детекту (`files: None`) — резолв за задекларованою
/// контрибуцією концерну, СПІЛЬНИЙ для `scope: Full` і `scope: per-file`
/// (§2.65).
///
/// # Чому `per-file` резолвиться так само, як `full` (а на fix-боці — НІ)
///
/// `--full` для `per-file`-концерну означає рівно «перевір КОЖЕН файл, який
/// підпадає під glob цього концерну» — саме це JS-канон і робив завжди
/// (`ctx.files === undefined` → детектор обходить репо сам). Розширення
/// batch-у за межі дельти тут БЕЗПЕЧНЕ, бо detect — read-only: він нічого не
/// пише, лише звітує. На fix-боці той самий glob-обхід був би НЕбезпечним
/// (він виправляв би файли поза дельтою запиту — доккомент
/// [`ambiguous_empty_fix_batch_err`], розділ «Чому не мовчазний `Vec::new()`
/// і не full-scope glob-обхід»), тому там дельту несе окремий аргумент
/// `delta_files` (§2.53). Асиметрія двох сигнатур — свідома й ось у чому
/// саме: detect добудовує batch, fix — вимагає дельту.
///
/// # Межа: `glob` контрибуції МУСИТЬ покривати й «якорі» концерну
///
/// Дельта-планувальник (`rules_core::lint_plan::plan_concern_for_delta`)
/// доклада́є до per-file batch-у `concern.json.lint.anchors` (`pyproject.toml`
/// для `python/mypy`/`python/ruff`, `composer.json` для `php/mago_*`) — але
/// хост їх НЕ знає: WIT-контрибуція несе лише `key`/`scope`/`glob`
/// (`wit/world.wit`, `record concern-contribution`). Тому гість, чий детектор
/// вимагає якір у батчі (`batch_file(files, "pyproject.toml")`), МУСИТЬ
/// внести цей якір у власний `glob` контрибуції — інакше full-прогін дасть
/// йому .py-файли без `pyproject.toml`, і детектор чесно, але хибно
/// «пропустить» концерн. §2.65 зробила саме це для чотирьох tool-детекторів;
/// anti-drift тест кожного гостя звіряє `plugin.toml` з `build_manifest()`.
fn build_detect_batch_files(
    cwd: &Path,
    key: &str,
    contribution: Option<&ConcernContribution>,
) -> Result<Vec<SourceFile>> {
    let Some(contribution) = contribution else {
        return Err(unresolvable_detect_batch_err(
            key,
            "не заявлений у describe().concerns",
            "плагін узагалі не декларує контрибуцію з таким ключем, тож ні glob, ні scope \
             хосту невідомі",
        ));
    };
    if !contribution.glob.is_empty() {
        return build_full_scope_files(cwd, &contribution.glob);
    }
    if contribution.scope == ConcernScope::Full {
        // Заявлений намір гостя (`js/jscpd_duplicates`), не прогалина —
        // доккомент [`unresolvable_detect_batch_err`], розділ «Що НЕ є цим
        // станом».
        return Ok(Vec::new());
    }
    Err(unresolvable_detect_batch_err(
        key,
        &format!("{:?}", contribution.scope),
        "контрибуція `per-file` не декларує жодного glob-патерну, тож хост не має з чого \
         зібрати повний список файлів",
    ))
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

/// Типізована помилка «діагностики назвали ЛИШЕ відсутні на диску файли, і
/// відновити батч нема з чого» (§2.95, продовження §2.87).
///
/// # Чому це окремий випадок, а не «просто порожній batch»
///
/// Гейт [`ambiguous_empty_fix_batch_err`] дивиться на `target_files` ДО
/// читання диска: якщо хоч одна діагностика назвала файл, виклик уважався
/// однозначним. Але концерн класу «канонічного файлу БРАКУЄ»
/// (`stryker-config-missing` у `plugins/lang-js/rules/test/stryker_config`,
/// §2.80) називає у `file` рівно той шлях, якого НЕМАЄ — його й треба
/// створити. [`read_source_files`] пропускає відсутні шляхи
/// (`read_source_files_all_missing_returns_empty`), тож гість діставав
/// ПОРОЖНІЙ `files` при непорожніх `diagnostics` — та сама двозначність
/// #513, лише занесена з іншого боку, і мовчазна: план виходив порожній, а
/// прогін звітував «чисто».
///
/// Порядок відновлення (у [`run_wasm_concern_fix`]) — від найбільш
/// заявленого до найменш: `effective_fix_glob` контрибуції (гість сам
/// оголосив свій fix-скоуп, §2.84/§2.87) → `delta_files` запиту → ця
/// помилка. Порожній результат ГЛОБ-обходу помилкою НЕ вважається: там
/// хост зробив рівно те, що концерн заявив, і «у дереві нічого не
/// знайшлось» — факт про дерево, а не невизначеність хоста.
fn missing_target_files_fix_batch_err(key: &str, target_files: &[String]) -> Error {
    Error::from_reason(format!(
        "runWasmConcernFix: концерн `{key}` — усі названі діагностиками файли відсутні на \
         диску ({target_files:?}), а контрибуція не заявляє ані `fix-glob`, ані `glob`, і \
         виклик не передав `delta_files`. Хост не має з чого побудувати FixRequest::files, а \
         порожній batch при непорожніх diagnostics — та сама прихована вада, що PR #513: \
         гість не відрізнив би «файлів немає» від «хост їх не передав» і мусив би писати \
         наосліп. Штатний шлях для концерну класу «канонічного файлу бракує» — оголосити \
         `fix-glob` контрибуції (§2.87): непорожній `fix-glob` вмикає full-scope fix-батч із \
         union-ом названих діагностиками файлів. Див. доккомент \
         missing_target_files_fix_batch_err (crates/rules-napi/src/lib.rs)."
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
///   (per-file dispatch, [`read_source_files`]); `None` → full-прогін: хост
///   сам будує batch за `ConcernContribution::glob` задекларованого
///   концерну ([`build_detect_batch_files`]) — НЕЗАЛЕЖНО від
///   `scope` (§2.65: до фіксу `per-file`-концерн діставав тут порожній
///   batch і мовчки звітував «чисто» в `--full`), а нерозвʼязна
///   контрибуція падає типізованою помилкою, не тишею.
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
/// # Скоуп fix-batch-у — `fix-glob`, а не `glob` (мажор `4.0.0`, §2.84)
///
/// УСІ три місця цієї функції, де batch (чи знімок host-diff) будується з
/// контрибуції, беруть [`ConcernContribution::effective_fix_glob`], а не
/// `glob`: full-scope fallback, per-file full-прогін і скоуп
/// `before`/`after` знімків.
///
/// До `4.0.0` тут стояв `glob` — той самий список, що годує ДЕТЕКТ, і
/// §2.72 записала наслідок у реєстр: вузький detect-glob беззвучно
/// каструє fix. `rust/check` дивиться на `Cargo.toml`, а `cargo fix`
/// мутує `src/**` — знімок по detect-глобу не побачив би жодної мутації,
/// план лишився б порожнім, гейт `edits.length > 0` (`wasmFixPattern`,
/// `npm/scripts/lib/lint-surface/run-fix.mjs`) не пустив би гість-пріоритет,
/// і JS-канон ТИХО зробив би фікс удруге поверх уже змінених файлів.
/// Обхід, який §2.72 реально застосувала, — РОЗШИРИТИ detect-glob заради
/// fix-у — змушував детект читати файли, які йому не потрібні, заради
/// побічної механіки хоста; `fix-glob` це закриває.
///
/// Порожній `fix-glob` = «fix ділить скоуп із детектом» (fallback на
/// `glob`), тож для жодної чинної контрибуції поведінка не змінилась.
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
    // Корінь preopen-ів — те саме дерево, від якого резолвиться батч
    // (§2.95, доккомент [`with_loaded_plugin_in_root`]).
    let preopen_root = absolute_root(&cwd_path)?;
    let plan = with_loaded_plugin_in_root(&wasm_path, Some(&preopen_root), |plugin| {
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
        // ОБИДВА списки контрибуцій (`concerns` + `fix_only_concerns`,
        // мажор `4.0.0` §2.84) — через єдиний акцесор
        // `Manifest::fix_contribution`. Пошук лише в `concerns` (як було до
        // першого fix-only споживача, `js/eslint`) давав тиху ваду рівно
        // того класу, що §2.72: для fix-only концерну контрибуція не
        // знаходилась, тож (а) `diff_glob` ставав `None` і host-diff
        // ВИМИКАВСЯ — exec-tool-фіксер мутував диск, а план виходив
        // порожній, і JS-канон мовчки робив фікс удруге; (б) у `--full`
        // (`delta_files: None`) виклик падав `ambiguous_empty_fix_batch_err`
        // із текстом «не заявлений у describe().concerns», хоч концерн був
        // заявлений — у другому списку.
        let contribution = plugin.describe().fix_contribution(&key).cloned();
        // ЯВНИЙ `fix-glob` — opt-in «fix-скоуп ширший за діагностики» (§2.87).
        //
        // До цієї зміни `fix-glob` впливав РІВНО на дві речі: гілку
        // `target_files.is_empty()` нижче і скоуп host-diff знімків. Тобто
        // концерн, чиї діагностики НЕСУТЬ `file` (переважна більшість),
        // діставав `fix-request.files` рівно з тих файлів — і задекларований
        // `fix-glob` МОВЧКИ ігнорувався. Це та сама вада класу §2.72, від
        // якої `fix-glob` мав рятувати, лише в іншому місці: гість оголошує
        // ширший fix-скоуп, хост його не дає, план виходить порожній або
        // неповний, а JS-канон тихо фіксить удруге.
        //
        // Ще гірший підклас, який ця гілка закриває, — концерн «канонічного
        // файлу бракує»: усі його діагностики несуть `file`, але ЖОДЕН із
        // цих шляхів на диску не існує, тож [`read_source_files`] пропускає
        // їх усі (`read_source_files_all_missing_returns_empty`) і гість
        // отримує ПОРОЖНІЙ `files` при непорожніх `diagnostics` — рівно та
        // двозначність #513, яку [`ambiguous_empty_fix_batch_err`] нібито
        // закрив: гейт дивиться на `target_files` ДО читання, а не на
        // фактичний батч. Гість не відрізняє «файлів немає» від «хост їх не
        // передав» і мусить писати наосліп.
        //
        // Форма opt-in-у (а не «завжди full-scope для `scope: full`»)
        // свідома: батч усього репо на КОЖЕН fix-виклик коштує обходу й
        // читання, і платити його мають лише ті концерни, що самі це
        // заявили. Для жодної чинної контрибуції поведінка не змінюється —
        // `fix_glob` досі порожній усюди, крім storybook-пари §2.87.
        //
        // `target_files` тут НЕ втрачаються: файли з діагностик, які glob не
        // покрив, дочитуються поверх (union зі збереженням порядку глоба),
        // інакше вужчий `fix-glob` беззвучно з'їв би названий діагностикою
        // файл — та сама вада, лише дзеркальна.
        let explicit_fix_glob: Option<Vec<String>> = contribution
            .as_ref()
            .filter(|c| !c.fix_glob.is_empty())
            .map(|c| c.fix_glob.clone());
        let files = if let Some(glob) = explicit_fix_glob {
            let mut batch = build_full_scope_files(&cwd_path, &glob)?;
            let covered: std::collections::HashSet<String> =
                batch.iter().map(|f| f.path.clone()).collect();
            let missing: Vec<String> = target_files
                .iter()
                .filter(|f| !covered.contains(*f))
                .cloned()
                .collect();
            batch.extend(read_source_files(&cwd_path, missing)?);
            batch
        } else if target_files.is_empty() {
            match &contribution {
                Some(c) if c.scope == ConcernScope::Full => {
                    // `effective_fix_glob()` (мажор `4.0.0`, §2.84), НЕ
                    // `glob`: fix-скоуп відділений від detect-скоупу —
                    // доккомент `fix_glob_scope` нижче.
                    build_full_scope_files(&cwd_path, c.effective_fix_glob())?
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
                // `delta_files: None` — НЕ «дельти немає, бо забули», а
                // заявлений full-прогін: `wasmFixPattern`
                // (`npm/scripts/lib/lint-surface/run-fix.mjs`) передає
                // `item.files`, а в `lint --full` планувальник списку не
                // будує взагалі, тож поле лишається `undefined` (це вже
                // задокументована семантика — доккомент `wasmFixPattern`).
                // Для `per-file`-контрибуції з НЕПОРОЖНІМ glob-ом хост має
                // з чого зібрати batch сам — рівно тим самим обходом, що
                // [`build_detect_batch_files`] робить на detect-боці для
                // `per-file` у full-прогоні (§2.65). Без цієї гілки
                // `per-file` exec-tool-фіксер (`style/lint`) у `--full`
                // падав би `ambiguous_empty_fix_batch_err` при кожному
                // прогоні, попри те що батч однозначно резолвиться.
                // Двозначність §2.52 гілка НЕ повертає: `Some(delta)` з
                // ПОРОЖНІМ списком при непорожніх diagnostics і далі падає
                // голосно (нижче), бо «дельта є, але порожня» — це стан
                // викликача, а не заявлений full-прогін.
                _ => {
                    match delta_files.as_deref() {
                        Some(delta) if !delta.is_empty() => {
                            read_source_files(&cwd_path, delta.to_vec())?
                        }
                        None if contribution
                            .as_ref()
                            .is_some_and(|c| !c.effective_fix_glob().is_empty()) =>
                        {
                            let glob = contribution
                                .as_ref()
                                .map(|c| c.effective_fix_glob().to_vec())
                                .unwrap_or_default();
                            build_full_scope_files(&cwd_path, &glob)?
                        }
                        _ => {
                            let scope_label = contribution
                            .as_ref()
                            .map(|c| format!("{:?}", c.scope))
                            .unwrap_or_else(|| "не заявлений ані у describe().concerns, ані у fix_only_concerns".to_string());
                            return Err(ambiguous_empty_fix_batch_err(
                                &key,
                                &scope_label,
                                diagnostics.len(),
                            ));
                        }
                    }
                }
            }
        } else {
            // Батч із названих діагностиками файлів — і ПЕРЕВІРКА ФАКТИЧНОГО
            // батчу, а не лише `target_files` (§2.95, доккомент
            // [`missing_target_files_fix_batch_err`]): коли всі названі
            // шляхи на диску відсутні (клас «канонічного файлу БРАКУЄ»),
            // `read_source_files` віддає порожній список, і гість дістав би
            // порожній `files` при непорожніх `diagnostics` — мовчки.
            let batch = read_source_files(&cwd_path, target_files.clone())?;
            if !batch.is_empty() {
                batch
            } else {
                match contribution
                    .as_ref()
                    .map(ConcernContribution::effective_fix_glob)
                {
                    Some(glob) if !glob.is_empty() => build_full_scope_files(&cwd_path, glob)?,
                    _ => match delta_files.as_deref() {
                        Some(delta) if !delta.is_empty() => {
                            read_source_files(&cwd_path, delta.to_vec())?
                        }
                        _ => {
                            return Err(missing_target_files_fix_batch_err(&key, &target_files));
                        }
                    },
                }
            }
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
        let diff_glob: Option<&[String]> = contribution
            .as_ref()
            .map(ConcernContribution::effective_fix_glob);
        let before_snapshot: HashMap<String, String> = match diff_glob {
            Some(glob) => build_full_scope_files(&cwd_path, glob)?
                .into_iter()
                .map(|f| (f.path, f.content))
                .collect(),
            None => HashMap::new(),
        };

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
            let after_snapshot: HashMap<String, String> = build_full_scope_files(&cwd_path, glob)?
                .into_iter()
                .map(|f| (f.path, f.content))
                .collect();
            let covered: std::collections::HashSet<String> =
                plan.edits.iter().map(|e| e.path().to_string()).collect();
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
    // Корінь preopen-ів — те саме дерево, від якого резолвиться batch
    // (§2.95, доккомент [`with_loaded_plugin_in_root`]).
    let preopen_root = absolute_root(&cwd_path)?;
    let diagnostics = with_loaded_plugin_in_root(&wasm_path, Some(&preopen_root), |plugin| {
        let source_files = match files {
            Some(files) => read_source_files(&cwd_path, files)?,
            None => {
                let contribution = plugin
                    .describe()
                    .concerns
                    .iter()
                    .find(|c| c.key == key)
                    .cloned();
                build_detect_batch_files(&cwd_path, &key, contribution.as_ref())?
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

    // --- §2.95: корінь preopen-ів = дерево виклику, не cwd процесу ---
    //
    // Наскрізний доказ («гість читає САМЕ передане дерево») живе там, де
    // є гість із непорожнім `fs-read`:
    // `crates/rules-plugin-host/tests/fs_read_preopen_root.rs`. Тут —
    // рішення кешу, яке той доказ робить дійсним і в napi-мосту, де
    // інстанс переживає багато викликів із РІЗНИМИ коренями.

    /// Типовий випадок (усі чинні маніфести): `fs-read` порожній —
    /// preopen-ів немає, корінь ні на що не впливає, кеш не має
    /// перезавантажувати компонент через зміну `cwd`.
    #[test]
    fn preopen_root_satisfies_ignores_root_when_no_fs_read_declared() {
        assert!(preopen_root_satisfies(
            false,
            None,
            Some(Path::new("/tree/one"))
        ));
        assert!(preopen_root_satisfies(
            false,
            Some(Path::new("/tree/one")),
            Some(Path::new("/tree/two"))
        ));
    }

    /// Червоний-зелений якір §2.95 на боці кешу: інстанс, відкритий на
    /// ІНШЕ дерево, для плагіна з `fs-read` НЕ придатний — інакше
    /// `lint --path <інше-дерево>` після першого ж виклику читав би
    /// перше дерево, мовчки.
    #[test]
    fn preopen_root_satisfies_requires_exact_root_match_for_fs_read_plugin() {
        assert!(preopen_root_satisfies(
            true,
            Some(Path::new("/tree/one")),
            Some(Path::new("/tree/one"))
        ));
        assert!(!preopen_root_satisfies(
            true,
            Some(Path::new("/tree/one")),
            Some(Path::new("/tree/two"))
        ));
        // Інстанс без preopen-ів (завантажений `describe()`-шляхом), а
        // дерево тепер відоме — перезавантажити, не кликати гостя в
        // порожній пісочниці.
        assert!(!preopen_root_satisfies(
            true,
            None,
            Some(Path::new("/tree/one"))
        ));
    }

    /// `describe()`-шлях (`wasmPluginConcerns`/`wasmPluginManifest`) кореня
    /// не має й не потребує — інстанс переюзається як є. Гучність тут
    /// забезпечує не кеш, а сам хост: `detect`/`fix` на плагіні без
    /// прив'язаного кореня падає `FsReadRootUnbound`.
    #[test]
    fn preopen_root_satisfies_keeps_instance_when_call_has_no_root() {
        assert!(preopen_root_satisfies(
            true,
            Some(Path::new("/tree/one")),
            None
        ));
        assert!(preopen_root_satisfies(true, None, None));
    }

    /// Відносний `cwd` дорезолвлюється від cwd процесу — РІВНО як його вже
    /// резолвить `read_source_files` (`cwd_path.join(file)`), тож preopens
    /// і батч дивляться в одне дерево; абсолютний лишається як є.
    #[test]
    fn absolute_root_resolves_relative_cwd_the_same_way_batch_does() {
        let absolute = PathBuf::from("/tree/one");
        assert_eq!(absolute_root(&absolute).expect("абсолютний"), absolute);

        let relative = PathBuf::from("sub/tree");
        let expected = std::env::current_dir()
            .expect("cwd процесу")
            .join(&relative);
        assert_eq!(absolute_root(&relative).expect("відносний"), expected);
    }

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
        )
        .expect("усі файли фікстури — валідний UTF-8");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "pyproject.toml");
        assert!(files[0].content.contains("demo"));
    }

    #[test]
    fn read_source_files_all_missing_returns_empty() {
        let dir = tempfile::tempdir().expect("tmp dir");
        let files = read_source_files(dir.path(), vec!["missing.py".to_string()])
            .expect("відсутній файл — пропуск, не помилка");
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

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()])
            .expect("усі файли фікстури — валідний UTF-8");

        assert_eq!(sorted_paths(&files), vec!["keep.txt"]);
    }

    /// Без конфігу (`.n-rules.json` відсутній) поведінка не змінилась —
    /// регресія проти дофіксового `&[]`: обидва файли потрапляють у batch.
    #[test]
    fn build_full_scope_files_without_config_matches_everything() {
        let dir = fixture_tree_with_vendor_dir();

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()])
            .expect("усі файли фікстури — валідний UTF-8");

        assert_eq!(sorted_paths(&files), vec!["keep.txt", "vendor/skip.txt"]);
    }

    /// `!`-патерн контрибуції — ВИКЛЮЧЕННЯ, як у `walkGlob` `concern.json`
    /// (перший споживач — `azure-pipelines/service_deploy_pipeline`,
    /// `!.azurepipelines/templates/**`). До фіксу `!` йшов у
    /// [`globset::Glob::new`] як звичайний символ шляху: патерн не матчив
    /// нічого, виключення мовчки не діяло, і гість бачив у batch-і файли,
    /// які канон свідомо відсіює.
    #[test]
    fn build_full_scope_files_treats_bang_pattern_as_exclusion() {
        let dir = fixture_tree_with_vendor_dir();

        let files = build_full_scope_files(
            dir.path(),
            &["**/*.txt".to_string(), "!vendor/**".to_string()],
        )
        .expect("усі файли фікстури — валідний UTF-8");

        assert_eq!(sorted_paths(&files), vec!["keep.txt"]);
    }

    /// Невалідний патерн у glob-і контрибуції — ГУЧНА відмова, не мовчазний
    /// пропуск. До §2.83 обидві гілки стояли як `if let Ok(glob) = …` без
    /// `else`, тож зіпсований патерн просто зникав із набору, а скоуп
    /// концерну тихо розходився з каноном (той самий клас, що §2.65/§2.72).
    /// Перевіряються ОБИДВІ гілки — include і `!`-exclude — бо кожна мала
    /// власний мовчазний `if let`.
    #[test]
    fn build_full_scope_files_rejects_invalid_glob_pattern_loudly() {
        let dir = fixture_tree_with_vendor_dir();

        for pattern in ["**/*.{txt", "!**/*.{txt"] {
            let err = build_full_scope_files(dir.path(), &[pattern.to_string()])
                .expect_err("невалідний патерн мусить впасти, а не зникнути з набору");
            let text = err.to_string();
            assert!(
                text.contains(pattern),
                "помилка мусить називати патерн: {text}"
            );
        }
    }

    /// Валідний патерн поруч із невалідним НЕ рятує: набір або повний, або
    /// помилка. Інакше «часткове» звуження скоупу лишалось би тихим — рівно
    /// те, що ця правка й закриває.
    #[test]
    fn build_full_scope_files_rejects_invalid_pattern_even_among_valid_ones() {
        let dir = fixture_tree_with_vendor_dir();

        let err = build_full_scope_files(
            dir.path(),
            &["**/*.txt".to_string(), "**/*.{md".to_string()],
        )
        .expect_err("один зіпсований патерн валить увесь набір");
        assert!(err.to_string().contains("**/*.{md"));
    }

    /// Побитий JSON у `.n-rules.json` — tolerant-парсинг
    /// ([`rules_core::concerns::cursor_ignore::load_cursor_ignore_paths`]
    /// повертає порожній список), не крах: той самий результат, що й без
    /// конфігу взагалі.
    #[test]
    fn build_full_scope_files_survives_broken_json_config() {
        let dir = fixture_tree_with_vendor_dir();
        std::fs::write(dir.path().join(".n-rules.json"), "{ not: json").expect(".n-rules.json");

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()])
            .expect("усі файли фікстури — валідний UTF-8");

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

        let files = build_full_scope_files(dir.path(), &["**/*.txt".to_string()])
            .expect("усі файли фікстури — валідний UTF-8");

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
            .join("../../target/wasm32-wasip3/release/test_plugin_guest.wasm")
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

    // --- §2.95/§2.80: діагностика назвала файл, якого на диску НЕМАЄ ---
    //
    // Клас «канонічного файлу БРАКУЄ» (`test/stryker_config`,
    // `stryker-config-missing`): усі діагностики несуть `file`, але ЖОДЕН
    // із цих шляхів не існує — він і має бути створений. `target_files`
    // непорожній, тож жодна з fallback-гілок не вмикається, а
    // `read_source_files` пропускає всі відсутні шляхи — гість дістає
    // ПОРОЖНІЙ батч при непорожніх діагностиках і не відрізняє «у дереві
    // нічого немає» від «хост нічого не передав».

    /// §2.87 закрила цей клас для контрибуцій із ЯВНИМ `fix-glob`: батч
    /// будується glob-обходом, а названі діагностиками файли доливаються
    /// поверх. Тест доводить це наскрізно (гість реально переписав
    /// знайдений на диску `broken.marker`) — тобто для порту
    /// `test/stryker_config` форма host-мосту БІЛЬШЕ НЕ блокер.
    #[test]
    fn run_wasm_concern_fix_explicit_glob_survives_diagnostics_naming_missing_files() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("broken.marker"), "BROKEN content").expect("marker file");
        let violations = serde_json::json!([
            {
                "reason": "canonical-file-missing",
                "message": "canonical-файл відсутній — його й треба створити",
                "file": "stryker.config.mjs",
                "severity": "error"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-fix-explicit-glob".to_string(),
            dir.path().to_string_lossy().to_string(),
            violations,
            None,
            None,
        );

        let plan = result.expect("явний fix-glob має дати батч попри відсутній таргет діагностики");
        let edits = plan["edits"].as_array().expect("edits — масив");
        assert_eq!(
            edits.len(),
            1,
            "батч мав прийти з glob-обходу диска, не з відсутнього таргета: {plan:?}"
        );
        assert_eq!(edits[0]["path"], "broken.marker");
        assert_eq!(edits[0]["content"], "FIXED content");
    }

    /// Залишок того самого класу, який §2.87 НЕ закрила: контрибуція без
    /// явного `fix-glob`. Гейт `ambiguous_empty_fix_batch_err` дивиться на
    /// `target_files` ДО читання, тож «діагностика назвала лише відсутні
    /// файли» проходила повз нього — гість діставав порожній батч і
    /// звітував «чисто». Тепер хост падає назад на `effective_fix_glob`
    /// (та сама гілка, що для «жодна діагностика не назвала файл»), і
    /// непорожній `edits` доводить, що файли прийшли з диска.
    #[test]
    fn run_wasm_concern_fix_full_scope_recovers_when_named_files_are_all_missing() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("broken.marker"), "BROKEN content").expect("marker file");
        let violations = serde_json::json!([
            {
                "reason": "canonical-file-missing",
                "message": "canonical-файл відсутній — його й треба створити",
                "file": "stryker.config.mjs",
                "severity": "error"
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

        let plan = result.expect("full-scope концерн має впасти назад на glob-обхід");
        let edits = plan["edits"].as_array().expect("edits — масив");
        assert_eq!(
            edits.len(),
            1,
            "батч мав прийти з glob-обходу диска: {plan:?}"
        );
        assert_eq!(edits[0]["path"], "broken.marker");
        assert_eq!(edits[0]["content"], "FIXED content");
    }

    /// Крайній випадок того самого класу: у контрибуції немає ЖОДНОГО
    /// глоба (ані detect-, ані fix-), тобто відновити батч нема з чого.
    /// Тоді — гучна типізована помилка, а не порожній батч мовчки: гість
    /// не повинен вирішувати, писати йому наосліп чи ні.
    #[test]
    fn run_wasm_concern_fix_errors_loudly_when_named_files_missing_and_no_glob() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        let violations = serde_json::json!([
            {
                "reason": "guest-delete",
                "message": "діагностика назвала файл, якого немає",
                "file": "no-such-file.txt",
                "severity": "error"
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

        let err = result.expect_err("порожній батч при непорожніх діагностиках має падати гучно");
        let message = err.to_string();
        assert!(
            message.contains("test/guest-fix-rewrite"),
            "повідомлення має називати концерн: {message}"
        );
        assert!(
            message.contains("no-such-file.txt"),
            "повідомлення має називати шлях, якого не знайшлось: {message}"
        );
    }

    /// `per-file` контрибуція з непорожнім glob-ом і `delta_files: None`
    /// (заявлений `lint --full`) — batch будується glob-обходом, а не
    /// падає `ambiguous_empty_fix_batch_err`. Це fix-бічний двійник §2.65
    /// (там ту саму асиметрію полагодили на detect-боці); живий споживач —
    /// `style/lint` (`crates/plugin-lang-js`), чий exec-tool-фіксер інакше
    /// червонив би КОЖЕН full-прогін. Доказ через вміст плану: guest
    /// переписав знайдений на диску `broken.marker`, тобто файли справді
    /// прийшли з обходу.
    #[test]
    fn run_wasm_concern_fix_per_file_concern_with_glob_builds_batch_when_delta_absent() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("broken.marker"), "BROKEN content").expect("marker file");
        let violations = serde_json::json!([
            {
                "reason": "guest-aggregate",
                "message": "агрегована діагностика per-file концерну без file",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-detect-per-file-glob".to_string(),
            dir.path().to_string_lossy().to_string(),
            violations,
            None,
            None,
        );

        let plan = result.expect("per-file з glob-ом і без дельти — full-прогін, не двозначність");
        let edits = plan["edits"].as_array().expect("edits — масив");
        assert_eq!(
            edits.len(),
            1,
            "glob-обхід мав знайти marker-файл: {plan:?}"
        );
        assert_eq!(edits[0]["path"], "broken.marker");
        assert_eq!(edits[0]["content"], "FIXED content");
    }

    /// Двозначність §2.52 НЕ повернулась: `delta_files: Some([])`
    /// (порожня дельта при непорожніх diagnostics) для того самого
    /// `per-file` концерну з glob-ом і далі падає голосно — «дельта є, але
    /// порожня» ≠ «заявлений full-прогін».
    #[test]
    fn run_wasm_concern_fix_per_file_concern_with_glob_still_errors_on_empty_delta() {
        let wasm_path = require_guest_fixture();
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("broken.marker"), "BROKEN content").expect("marker file");
        let violations = serde_json::json!([
            {
                "reason": "guest-aggregate",
                "message": "агрегована діагностика per-file концерну без file",
                "severity": "warn"
            }
        ]);

        let result = run_wasm_concern_fix(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-detect-per-file-glob".to_string(),
            dir.path().to_string_lossy().to_string(),
            violations,
            None,
            Some(vec![]),
        );

        let err = result.expect_err("порожня дельта при непорожніх diagnostics — гучна помилка");
        assert!(
            err.to_string().contains("test/guest-detect-per-file-glob"),
            "помилка має називати концерн: {err}"
        );
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

    // --- run_wasm_concern: full-прогін `per-file`-концерну (§2.65) ---
    //
    // ДО фіксу гілка `files: None` будувала batch ЛИШЕ для `scope: Full`, а
    // для `per-file` віддавала `Vec::new()` — гість діставав нуль файлів,
    // повертав нуль діагностик, і концерн у `--full` звітував «чисто»
    // мовчки. Обидва тести нижче ганяють РЕАЛЬНИЙ `run_wasm_concern` проти
    // зібраної guest-фікстури (той самий міст, що продакшн-виклик
    // `detect.mjs`), не ізольований guest-виклик.

    /// Червоно-зелений якір фіксу: `per-file`-концерн З glob-ом
    /// (`test/guest-detect-per-file-glob`, `**/*.marker`) у full-прогоні
    /// (`files: None`) МАЄ побачити реальні файли з диска. Непорожній
    /// результат саме з іменем файлу доводить обхід, а не просто «виклик не
    /// впав»; `noise.txt` поруч доводить, що обхід відфільтровано glob-ом.
    /// До §2.65 цей самий виклик повертав `{"violations": []}`.
    #[test]
    fn run_wasm_concern_full_run_resolves_per_file_concern_by_glob() {
        let wasm_path = require_guest_fixture();
        let cwd = tempfile::tempdir().expect("tmp dir");
        std::fs::write(cwd.path().join("a.marker"), "BROKEN").expect("a.marker");
        std::fs::write(cwd.path().join("noise.txt"), "поза glob-ом").expect("noise.txt");

        let result = run_wasm_concern(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-detect-per-file-glob".to_string(),
            cwd.path().to_string_lossy().to_string(),
            None,
            None,
        )
        .expect("full-прогін per-file концерну має будувати batch, а не падати");

        let violations = result["violations"]
            .as_array()
            .expect("`violations` — масив")
            .clone();
        assert_eq!(
            violations.len(),
            1,
            "гість echo-ить по одній діагностиці на файл батчу — маємо побачити РІВНО a.marker: {violations:?}"
        );
        assert_eq!(violations[0]["file"].as_str(), Some("a.marker"));
    }

    /// Друга половина того самого фіксу: `per-file` БЕЗ glob-а
    /// (`test/guest-echo`) хост побудувати не може — і тепер каже це вголос
    /// замість мовчазного «чисто». Дзеркало
    /// [`run_wasm_concern_fix_errors_loudly_on_ambiguous_empty_batch`] на
    /// detect-боці.
    #[test]
    fn run_wasm_concern_full_run_errors_loudly_when_batch_unresolvable() {
        let wasm_path = require_guest_fixture();
        let cwd = tempfile::tempdir().expect("tmp dir");
        std::fs::write(cwd.path().join("a.marker"), "BROKEN").expect("a.marker");

        let err = run_wasm_concern(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-echo".to_string(),
            cwd.path().to_string_lossy().to_string(),
            None,
            None,
        )
        .expect_err("per-file концерн без glob-а у full-прогоні МАЄ падати, не мовчати");

        let message = err.to_string();
        assert!(
            message.contains("test/guest-echo"),
            "повідомлення має називати конкретний концерн: {message}"
        );
        assert!(
            message.contains("glob"),
            "повідомлення має пояснювати причину (нема glob-а): {message}"
        );
    }

    /// Той самий виклик для концерну, якого плагін узагалі не декларує —
    /// теж гучно (раніше: порожній batch і «чисто»).
    #[test]
    fn run_wasm_concern_full_run_errors_loudly_on_unknown_concern() {
        let wasm_path = require_guest_fixture();
        let cwd = tempfile::tempdir().expect("tmp dir");

        let err = run_wasm_concern(
            wasm_path.to_string_lossy().to_string(),
            "test/no-such-concern".to_string(),
            cwd.path().to_string_lossy().to_string(),
            None,
            None,
        )
        .expect_err("незадекларований концерн у full-прогоні МАЄ падати, не мовчати");

        assert!(
            err.to_string().contains("test/no-such-concern"),
            "повідомлення має називати конкретний ключ: {err}"
        );
    }

    /// Регресія на full-scope шлях: `scope: Full` із НЕПОРОЖНІМ glob-ом
    /// резолвиться рівно як до фіксу (той самий [`build_full_scope_files`]).
    #[test]
    fn run_wasm_concern_full_scope_concern_unchanged() {
        let wasm_path = require_guest_fixture();
        let cwd = tempfile::tempdir().expect("tmp dir");
        std::fs::write(cwd.path().join("a.marker"), "BROKEN").expect("a.marker");

        let result = run_wasm_concern(
            wasm_path.to_string_lossy().to_string(),
            "test/guest-fix-full-scope".to_string(),
            cwd.path().to_string_lossy().to_string(),
            None,
            None,
        )
        .expect("full-scope концерн має резолвитись, як і до §2.65");

        assert_eq!(result["violations"].as_array().map(Vec::len), Some(1));
    }

    // --- build_detect_batch_files: одиниця резолву (§2.65) ---

    /// Хелпер контрибуції для тестів нижче.
    fn contribution(key: &str, scope: ConcernScope, glob: &[&str]) -> ConcernContribution {
        ConcernContribution {
            key: key.to_string(),
            scope,
            glob: glob.iter().map(|g| (*g).to_string()).collect(),
            fix_glob: vec![],
        }
    }

    /// `per-file` з glob-ом резолвиться ТИМ САМИМ обходом, що `full`
    /// (включно з `.n-rules.json:ignore` — [`build_full_scope_files`]).
    #[test]
    fn build_detect_batch_files_per_file_walks_glob() {
        let dir = fixture_tree_with_vendor_dir();
        let c = contribution("demo/per-file", ConcernScope::PerFile, &["**/*.txt"]);

        let files = build_detect_batch_files(dir.path(), &c.key, Some(&c))
            .expect("glob є — batch будується");

        assert_eq!(sorted_paths(&files), vec!["keep.txt", "vendor/skip.txt"]);
    }

    // --- fix-скоуп: `fix-glob` (мажор контракту `4.0.0`, §2.84) ------------

    /// Той самий хелпер, що [`contribution`], але з окремим fix-скоупом.
    fn contribution_with_fix_glob(
        key: &str,
        scope: ConcernScope,
        glob: &[&str],
        fix_glob: &[&str],
    ) -> ConcernContribution {
        ConcernContribution {
            fix_glob: fix_glob.iter().map(|g| (*g).to_string()).collect(),
            ..contribution(key, scope, glob)
        }
    }

    /// **Ядро §2.72**: detect-скоуп і fix-скоуп розходяться, і кожен бере
    /// СВІЙ glob. Без `fix_glob` єдиним виходом було розширити detect-glob
    /// заради fix-у — саме та вада, яку реєстр записав по `rust/check`.
    ///
    /// Тест іде через [`build_full_scope_files`] обома глобами тієї самої
    /// контрибуції: це рівно те, що роблять три місця
    /// [`run_wasm_concern_fix`] (batch і обидва знімки host-diff).
    #[test]
    fn fix_glob_scopes_the_fix_batch_independently_from_detect() {
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("Cargo.toml"), "[package]").expect("Cargo.toml");
        std::fs::create_dir_all(dir.path().join("src")).expect("src/");
        std::fs::write(dir.path().join("src/lib.rs"), "fn a() {}").expect("src/lib.rs");

        let c = contribution_with_fix_glob(
            "rust/check",
            ConcernScope::Full,
            &["Cargo.toml"],
            &["Cargo.toml", "src/**/*.rs"],
        );

        // Детект бачить лише маніфест...
        let detect = build_detect_batch_files(dir.path(), &c.key, Some(&c)).expect("detect batch");
        assert_eq!(sorted_paths(&detect), vec!["Cargo.toml"]);

        // ...а fix — і те, що реально мутує тул.
        let fixed = build_full_scope_files(dir.path(), c.effective_fix_glob()).expect("fix batch");
        assert_eq!(sorted_paths(&fixed), vec!["Cargo.toml", "src/lib.rs"]);
    }

    /// Порожній `fix_glob` — свідомий дефолт «як до мажора»: fix ділить
    /// скоуп із детектом. Регрес на випадок, якби fallback колись зник:
    /// без нього кожна чинна контрибуція дістала б порожній fix-batch.
    #[test]
    fn empty_fix_glob_keeps_pre_major_behaviour() {
        let dir = fixture_tree_with_vendor_dir();
        let c = contribution("demo/shared-scope", ConcernScope::Full, &["**/*.txt"]);

        assert_eq!(c.effective_fix_glob(), c.glob.as_slice());
        let files = build_full_scope_files(dir.path(), c.effective_fix_glob()).expect("fix batch");
        assert_eq!(sorted_paths(&files), vec!["keep.txt", "vendor/skip.txt"]);
    }

    /// `fix_glob` НЕ протікає в детект: `build_detect_batch_files` і далі
    /// читає лише `glob`. Інакше поле, задумане розділити скоупи, мовчки
    /// розширювало б саме той detect-скоуп, від розширення якого рятує.
    #[test]
    fn fix_glob_does_not_widen_the_detect_batch() {
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("keep.txt"), "keep").expect("keep.txt");
        std::fs::write(dir.path().join("other.md"), "md").expect("other.md");

        let c = contribution_with_fix_glob(
            "demo/split",
            ConcernScope::Full,
            &["**/*.txt"],
            &["**/*.md"],
        );
        let detect = build_detect_batch_files(dir.path(), &c.key, Some(&c)).expect("detect batch");
        assert_eq!(sorted_paths(&detect), vec!["keep.txt"]);
    }

    /// `scope: Full` з ПОРОЖНІМ glob-ом — заявлений намір гостя
    /// (`js/jscpd_duplicates`), не помилка.
    #[test]
    fn build_detect_batch_files_full_scope_empty_glob_stays_empty() {
        let dir = fixture_tree_with_vendor_dir();
        let c = contribution("demo/full-no-glob", ConcernScope::Full, &[]);

        let files = build_detect_batch_files(dir.path(), &c.key, Some(&c))
            .expect("порожній glob full-scope концерну — не помилка");

        assert!(files.is_empty());
    }

    /// `per-file` з порожнім glob-ом — двозначність, і вона гучна.
    #[test]
    fn build_detect_batch_files_per_file_empty_glob_is_loud() {
        let dir = fixture_tree_with_vendor_dir();
        let c = contribution("demo/per-file-no-glob", ConcernScope::PerFile, &[]);

        let err = build_detect_batch_files(dir.path(), &c.key, Some(&c))
            .expect_err("per-file без glob-а — нерозвʼязний batch");

        assert!(err.to_string().contains("demo/per-file-no-glob"));
    }

    /// Контрибуції немає взагалі — теж гучно.
    #[test]
    fn build_detect_batch_files_missing_contribution_is_loud() {
        let dir = fixture_tree_with_vendor_dir();

        let err = build_detect_batch_files(dir.path(), "demo/unknown", None)
            .expect_err("невідомий концерн — нерозвʼязний batch");

        assert!(err.to_string().contains("demo/unknown"));
    }

    // --- не-UTF8 файл у batch-і: гучна відмова, не lossy-калічення (§2.83) --
    //
    // Доккомент [`non_utf8_source_file_err`] пояснює клас вади: до фіксу
    // `String::from_utf8_lossy` мовчки підміняв кожен невалідний байт на
    // U+FFFD, і той самий покалічений рядок ішов у ОБИДВА знімки host-diff
    // (`before_snapshot`/`after_snapshot`), з яких [`diff_snapshot_edits`]
    // синтезує `FileEdit::Write` — фікс переписав би бінарний файл мозаїкою.
    // Заміряно: 12 байтів PNG-сигнатури → 18 байтів `EF BF BD`-мозаїки.

    /// Байти, що НЕ є валідним UTF-8, — сигнатура PNG плюс `FF FE`.
    const NON_UTF8_BYTES: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xFE, 0x00, 0x41,
    ];

    /// Явний список файлів (per-file диспатч): не-UTF8 файл — типізована
    /// помилка з назвою файлу, а не мовчазний `SourceFile` з U+FFFD.
    #[test]
    fn read_source_files_rejects_non_utf8_file() {
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("logo.png"), NON_UTF8_BYTES).expect("запис бінарника");

        let err = read_source_files(dir.path(), vec!["logo.png".to_string()])
            .expect_err("не-UTF8 файл мусить відмовляти гучно, а не калічитись lossy-конверсією");

        let text = err.to_string();
        assert!(text.contains("logo.png"), "{text}");
        assert!(text.contains("UTF-8"), "{text}");
    }

    /// Той самий шлях, яким живиться host-diff fix-контуру
    /// ([`run_wasm_concern_fix`], `before_snapshot`/`after_snapshot`):
    /// бінарник, що потрапив у glob контрибуції, зупиняє прогін гучно —
    /// саме тут раніше народжувався `FileEdit::Write` з покаліченим вмістом,
    /// який знищив би файл на диску.
    #[test]
    fn host_diff_snapshot_rejects_non_utf8_file() {
        let dir = tempfile::tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("keep.txt"), "текст").expect("запис текстового");
        std::fs::write(dir.path().join("logo.png"), NON_UTF8_BYTES).expect("запис бінарника");

        let err = build_full_scope_files(dir.path(), &["**/*".to_string()])
            .expect_err("бінарник у glob-і знімку host-diff мусить відмовляти гучно");

        assert!(err.to_string().contains("logo.png"), "{err}");
    }

    /// Межа фіксу: текстовий файл із багатобайтовими символами (кирилиця,
    /// емодзі) — валідний UTF-8 і проходить БЕЗ змін, байт-у-байт. Інакше
    /// «гучна відмова» перетворилась би на відмову від нормальної роботи.
    #[test]
    fn read_source_files_keeps_multibyte_utf8_intact() {
        let dir = tempfile::tempdir().expect("tmp dir");
        let content = "кирилиця, емодзі 🙂, ще й ß\n";
        std::fs::write(dir.path().join("text.md"), content).expect("запис тексту");

        let files = read_source_files(dir.path(), vec!["text.md".to_string()])
            .expect("валідний UTF-8 не мав відмовити");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].content, content);
    }
}
