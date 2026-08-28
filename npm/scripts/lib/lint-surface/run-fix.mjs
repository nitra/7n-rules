/**
 * Central fix-pipeline unified lint surface (spec 2026-06-29 §Fix Role / §Tier Ladder).
 *
 * Послідовно, per concern:
 *   detect → (clean: keep) → T0 (permanent, поза rollback) → snapshot S1 →
 *   detect → (clean: keep) → ladder[restore S1 → worker → detect]* → (exhausted: rollback S1)
 *
 * Ролі чесні: detector тільки виявляє; T0 і worker тільки змінюють; success визначає
 * ВИКЛЮЧНО canonical re-detect. Worker не володіє rollback/tier/ladder — лише один attempt.
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').FixContext} FixContext
 * @typedef {import('./types.mjs').T0Pattern} T0Pattern
 * @typedef {import('./run-detectors.mjs').PlanItem} PlanItem
 * @typedef {import('./ladder.mjs').Rung} Rung
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isLocalModel, resolveModel } from '@7n/llm-lib/model-tiers'
import { startChain } from '@7n/llm-lib/chain'
import { writeTrace } from '@7n/llm-lib/trace'
import { withTimeout } from '@7n/llm-lib/with-timeout'
import { loadNative } from '../native.mjs'
import { resolveWasmConcernMap } from './wasm-plugins.mjs'
import { buildDetectPlan } from './run-detectors.mjs'
import { runConcernDetector, DetectorError } from './detect.mjs'
import { renderViolations } from './render.mjs'
import { createSnapshot } from './snapshot.mjs'
import {
  findCollateralEdits,
  findInFileCollateralEdits,
  realpathBestEffort,
  resolveTargetSet
} from './collateral-veto.mjs'
import { findBrokenSiblingTests } from './test-gate.mjs'
import { createProgressReporter } from './progress.mjs'
import { buildLadder, decideAfterFailure, DEFAULT_MAX_AVG } from './ladder.mjs'

/**
 * Будує моделі центральної fix-ladder через єдиний policy resolver.
 * Локальна rung існує лише коли старт від `N_LOCAL_MIN_MODEL` справді дав
 * локальну модель: cloud fallback не повинен маркуватися як local і обходити
 * `skipLocalTier`. Хмарні rung-и стартують зі своїх меж policy ladder.
 * @param {{resolveModelImpl?:(selector:string)=>string, isLocalModelImpl:(model:string)=>boolean}} [deps] інʼєкції для unit-тесту policy меж
 * @returns {{localMin:string, cloudMin:string, cloudAvg:string}} Моделі для побудови fix-ladder.
 */
export function resolveFixLadderModels({ resolveModelImpl = resolveModel, isLocalModelImpl = isLocalModel } = {}) {
  const preferred = resolveModelImpl('N_LOCAL_MIN_MODEL')
  const cloudMin = resolveModelImpl('N_CLOUD_MIN_MODEL')
  const cloudAvg = resolveModelImpl('N_CLOUD_AVG_MODEL')
  return {
    localMin: isLocalModelImpl(preferred) ? preferred : '',
    cloudMin,
    // Не повторюємо той самий cloud-виклик у наступній rung; local retry лишається
    // всередині buildLadder, де він має окрему семантику.
    cloudAvg: cloudAvg === cloudMin ? '' : cloudAvg
  }
}

/**
 * Стабільний ключ одиниці прогресу для ProgressReporter.
 * @param {PlanItem} item Елемент плану.
 * @returns {string} `rule/concern`
 */
function progressKey(item) {
  return `${item.entry.ruleId}/${item.entry.concern.name}`
}

/**
 * Кеш ключів native-fix concern-ів (`ruleId/concernId`), один на процес —
 * той самий кеш-мотив, що `getNativeConcernKeys` у `detect.mjs` (T1 зрізу 4
 * фази 7, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4).
 * @type {Set<string> | null}
 */
let nativeFixKeys = null

/**
 * Лениво резолвить множину ключів native-fix-ів з аддона (`listNativeFixes()`).
 * @returns {Set<string>} Множина ключів native-fix-ів (`ruleId/concernId`).
 */
function getNativeFixKeys() {
  if (nativeFixKeys === null) {
    nativeFixKeys = new Set(loadNative().listNativeFixes())
  }
  return nativeFixKeys
}

/**
 * Застосовує ОДНУ правку fix-плану ({@link nativeFixPattern}/{@link wasmFixPattern}
 * несуть ідентичну форму `{type, path, content?}`, дзеркало контракту
 * `rules_contract::fix::FileEdit`) до диска.
 *
 * `write` перезаписує/створює файл (з `mkdir -p` батьківської теки) — та сама
 * поведінка, що й раніше. `delete` прибирає шлях цілком — файл АБО директорію
 * (рекурсивно) — одним викликом `fs.rm(..., {recursive:true})`: та сама
 * кінцева семантика, що Rust-міст `crates/rules-fix/src/t0.rs::to_edit_plan`
 * (`Delete` на директорію → вся директорія зникає), лише прямим шляхом.
 * Rust-бік розгортає директорію в пофайлові `Delete` й прибирає спорожнілі
 * теки окремим проходом (`sweep_empty_dirs`) ТОМУ, що йому для журналу
 * (editLog) потрібен pre-image КОЖНОГО файлу; T0-патерни тут пишуть напряму,
 * без журналу — рекурсивний `fs.rm` дає той самий кінцевий стан без потреби
 * повторювати журнальну машинерію.
 *
 * Раніше (`unlink`, лише файли) тут ловився БУДЬ-ЯКИЙ виняток мовчки — і
 * `unlink` на директорію (EPERM на macOS, EISDIR на Linux), і права доступу,
 * і зайнятий файл виглядали як штатний «файл уже відсутній». Тепер ловиться
 * ЛИШЕ `ENOENT` (шлях справді вже відсутній — мета вже досягнута, той самий
 * best-effort, що документує `to_edit_plan`: "Delete на відсутній файл — Err
 * валідації [з боку планувальника], а не no-op" — тут толерується гонка між
 * планом і застосуванням, не сам факт відсутності). Будь-яка ІНША помилка НЕ
 * ковтається — принцип проекту «мовчазний skip — вада, не делікатність»:
 * кидається гучний `Error` (з `cause`), що зупиняє прогін замість тихого
 * звіту «0 файлів змінено» (та сама «гучна помилка», що
 * `ambiguous_empty_fix_batch_err` на napi-боці, `crates/rules-napi/src/lib.rs`).
 * @param {{type:string,path:string,content?:string}} edit Одна правка плану.
 * @param {string} cwd Абсолютний корінь consumer-репо.
 * @param {import('./types.mjs').FixContext} ctx Контекст фікса (`recordWrite` тощо).
 * @returns {Promise<string|null>} Абсолютний шлях правки, якщо вона реально відбулась
 *   (write — завжди; delete — лише якщо шлях справді існував), інакше `null`.
 */
export async function applyPlanEdit(edit, cwd, ctx) {
  const abs = join(cwd, edit.path)
  if (edit.type === 'write') {
    ctx.recordWrite?.(abs)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, edit.content, 'utf8')
    return abs
  }
  if (edit.type === 'delete') {
    ctx.recordWrite?.(abs)
    try {
      await rm(abs, { recursive: true })
      return abs
    } catch (error) {
      // Файл/директорія вже відсутні — best-effort, той самий дух, що старий
      // JS-фіксер (`fix-migrations.mjs`, до видалення T1 зрізу 4).
      if (error.code === 'ENOENT') return null
      throw new Error(`не вдалося видалити "${edit.path}": ${error.message}`, { cause: error })
    }
  }
  return null
}

/**
 * Кеш native fix-плану за identity `violations`-масиву — `applyT0`
 * (`test()` → `apply()`) передає ОДИН і той самий масив в обидва виклики
 * одного проходу, тож другий native-виклик не потрібен: `apply()` переюзає
 * вже порахований план замість повторного napi-hop-у.
 * @type {WeakMap<LintViolation[], { edits: Array<{ type: string, path: string, content?: string }> } | null>}
 */
const nativeFixPlanCache = new WeakMap()

/**
 * Викликає `runNativeConcernFix` і кешує результат під identity `violations`.
 * @param {string} key `ruleId/concernId` native-fix concern-а.
 * @param {string} cwd Абсолютний корінь consumer-репо.
 * @param {LintViolation[]} violations Порушення concern-а (той самий вхід у test() і apply()).
 * @returns {{ edits: Array<{ type: string, path: string, content?: string }> } | null} План або `null` (concern без native-фікса).
 */
function computeNativeFixPlan(key, cwd, violations) {
  if (nativeFixPlanCache.has(violations)) return nativeFixPlanCache.get(violations)
  const plan = loadNative().runNativeConcernFix(key, cwd, violations) ?? null
  nativeFixPlanCache.set(violations, plan)
  return plan
}

/**
 * Синтезує T0Pattern-обгортку над native fix-планом (T1 зрізу 4 фази 7,
 * `crates/rules-core/src/concerns/fix.rs`) — та сама форма, що ручний
 * `fix-<concern>.mjs`, без dynamic import() JS-файлу concern-а.
 *
 * `cwd` вшитий у замикання: `T0Pattern.test(violations)` не приймає `ctx`
 * (типізація `types.mjs`), тож native-виклик у `test()` не може прочитати
 * `ctx.cwd` — натомість [`loadT0Patterns`] будує цей патерн ОДРАЗУ з відомим
 * `cwd` виклику. `test()` = «native-план для цих violations непорожній»
 * (сам native-фікс вирішує застосовність — доккомент `run_concern_fix`);
 * `apply()` перевикористовує ТОЙ САМИЙ кешований план ({@link computeNativeFixPlan}).
 *
 * Rollback-контракт: `ctx.recordWrite?.(abs)` викликається ПЕРЕД кожною
 * файловою мутацією (write чи delete) — той самий обов'язок реєстрації, що
 * документує `FixContext.recordWrite` (`types.mjs`), незалежно від того, чи
 * реальний виклик у T0-фазі передає непорожній `recordWrite` (T0 — permanent,
 * поза rollback, доккомент модуля вище): контракт однаковий для будь-якого
 * caller-а цього патерну, включно з тестами, де `ctx.recordWrite` інжектяться
 * як мок/шпигун.
 * @param {string} key `ruleId/concernId` native-fix concern-а.
 * @param {string} cwd Абсолютний корінь consumer-репо.
 * @returns {T0Pattern} Синтетичний патерн.
 */
function nativeFixPattern(key, cwd) {
  return {
    id: `native-fix:${key}`,
    // Гість-пріоритет (T0Pattern.guestFix, types.mjs): якщо `apply()` дасть непорожній
    // touchedFiles, `applyT0` зупинить подальші (JS-fallback) патерни цього concern-а.
    guestFix: true,
    test: violations => {
      const plan = computeNativeFixPlan(key, cwd, violations)
      return plan !== null && plan.edits.length > 0
    },
    apply: async (violations, ctx) => {
      const plan = computeNativeFixPlan(key, cwd, violations)
      const touchedFiles = []
      for (const edit of plan?.edits ?? []) {
        const applied = await applyPlanEdit(edit, cwd, ctx)
        if (applied) touchedFiles.push(applied)
      }
      return touchedFiles.length > 0
        ? { touchedFiles, message: `native fix ${key}: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
}

/**
 * Кеш wasm fix-плану за identity `violations`-масиву — той самий мотив, що
 * {@link nativeFixPlanCache}: `applyT0` передає ОДИН масив у `test()` і
 * `apply()` одного проходу, другий napi-hop (повторний виклик `fix()` у
 * wasm-плагіні) не потрібен.
 * @type {WeakMap<LintViolation[], { edits: Array<{ type: string, path: string, content?: string }> }>}
 */
const wasmFixPlanCache = new WeakMap()

/**
 * Викликає `runWasmConcernFix` (fix-контур contract v3, napi
 * `crates/rules-napi`) і кешує план під identity `violations`.
 *
 * `runWasmConcernFix` кидає типізовану помилку (не мовчить і не вгадує),
 * коли `target_files` порожній для НЕ-full-scope концерну з file-less
 * діагностиками — доккомент `ambiguous_empty_fix_batch_err`,
 * `crates/rules-napi/src/lib.rs` (задача fix/napi-empty-fix-batch, той
 * самий мотив, що #513). Ловимо тут і деградуємо до порожнього плану
 * (`test()` дасть `false`, concern далі йде в ladder, як і при
 * fix-заглушці) — той самий контур graceful-degrade, що вже несе
 * `loadT0Patterns` для битого `fix-<concern>.mjs` (доккомент нижче) і
 * `runConcernDetector` для wasm-падіння під час `detect()`
 * (`detect.mjs`): падіння ОДНОГО concern-а не має вбивати весь
 * fix-прогін (`runFixPipeline` кличе цю функцію в циклі по концернах), а
 * `console.error` (не мовчазний catch) лишає причину видимою.
 * @param {string} key `ruleId/concernId` wasm-концерну.
 * @param {string} cwd Абсолютний корінь consumer-репо.
 * @param {import('./wasm-plugins.mjs').WasmConcernMapEntry} entry Резолвлений запис wasm-мапи (`wasmPath`, `toolPaths`).
 * @param {LintViolation[]} violations Порушення concern-а (той самий вхід у test() і apply()).
 * @param {string[]|undefined} deltaFiles Дельта запиту (`item.files`) або `undefined` для full-scope плану.
 * @returns {{ edits: Array<{ type: string, path: string, content?: string }> }} План (порожні `edits` = фіксити нічого).
 */
function computeWasmFixPlan(key, cwd, entry, violations, deltaFiles) {
  if (wasmFixPlanCache.has(violations)) return wasmFixPlanCache.get(violations)
  let plan
  try {
    plan = loadNative().runWasmConcernFix(
      entry.wasmPath,
      key,
      cwd,
      violations,
      entry.toolPaths,
      deltaFiles
    )
  } catch (error) {
    console.error(
      `❌ wasm fix ${key}: runWasmConcernFix відмовився будувати план — ${error.message}. ` +
        'wasm T0-фікс цього concern-а пропущено, concern піде в ladder.'
    )
    plan = { edits: [] }
  }
  wasmFixPlanCache.set(violations, plan)
  return plan
}

/**
 * Синтезує T0Pattern-обгортку над wasm fix-планом — рівно та сама форма й
 * rollback-контракт (`ctx.recordWrite?.(abs)` ПЕРЕД кожною мутацією), що
 * {@link nativeFixPattern}; відрізняється лише джерело плану: `export fix`
 * wasm-плагіна через napi замість `NATIVE_FIXES`-реєстру.
 *
 * `deltaFiles` вшито у замикання з ТІЄЇ САМОЇ причини, що й `cwd` у
 * {@link nativeFixPattern}: `T0Pattern.test(violations)` не приймає `ctx`
 * (типізація `types.mjs`), а план будується вже в `test()` і кешується під
 * identity `violations` — діставати дельту з `ctx` у `apply()` було б пізно.
 * Дельта потрібна host-у рівно для агрегованих (file-less) діагностик
 * `per-file`-концерну: без неї napi не має з чого побудувати
 * `FixRequest::files` і свідомо падає (доккомент
 * `ambiguous_empty_fix_batch_err`, `crates/rules-napi/src/lib.rs`).
 * `undefined` (full-scope концерн — оркестрація не має списку) лишається
 * валідним: там host будує batch сам, glob-обходом.
 *
 * Валідність плану
 * (safe repo-relative шляхи, ліміти розміру) гарантує host ДО повернення
 * (`LoadedPlugin::fix` → `rules-contract::validators::fix`) — обгортці
 * лишається тільки застосувати.
 * @param {string} key `ruleId/concernId` wasm-концерну.
 * @param {string} cwd Абсолютний корінь consumer-репо.
 * @param {import('./wasm-plugins.mjs').WasmConcernMapEntry} entry Резолвлений запис wasm-мапи.
 * @param {string[]} [deltaFiles] Дельта запиту (`item.files`); `undefined` — full-scope концерн.
 * @returns {T0Pattern} Синтетичний патерн.
 */
function wasmFixPattern(key, cwd, entry, deltaFiles) {
  return {
    id: `wasm-fix:${key}`,
    // Гість-пріоритет (T0Pattern.guestFix, types.mjs): якщо `apply()` дасть непорожній
    // touchedFiles, `applyT0` зупинить подальші (JS-fallback) патерни цього concern-а —
    // вада double-apply (реальний wasm-фікс + `fix-<concern>.mjs` поспіль на тому самому
    // файлі, напр. `js/doc_comments`).
    guestFix: true,
    test: violations => computeWasmFixPlan(key, cwd, entry, violations, deltaFiles).edits.length > 0,
    apply: async (violations, ctx) => {
      const plan = computeWasmFixPlan(key, cwd, entry, violations, deltaFiles)
      const touchedFiles = []
      for (const edit of plan?.edits ?? []) {
        const applied = await applyPlanEdit(edit, cwd, ctx)
        if (applied) touchedFiles.push(applied)
      }
      return touchedFiles.length > 0
        ? { touchedFiles, message: `wasm fix ${key}: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
}

/**
 * Завантажує structured T0-патерни concern-а. Пріоритет джерел — дзеркало
 * `runConcernDetector` (`detect.mjs`: native → wasm → JS):
 *
 * 1. native-fix реєстр (`NATIVE_FIXES`, T1 зрізу 4 фази 7) — абсолютний
 *    пріоритет: синтетичний T0Pattern над native-планом ([`nativeFixPattern`]);
 * 2. wasm-мапа концернів (`resolveWasmConcernMap`, fix-контур contract v3) —
 *    синтетичний T0Pattern над планом `export fix` плагіна
 *    ([`wasmFixPattern`]); на відміну від detect-shadowing (wasm ПОВНІСТЮ
 *    заміняє main.mjs), тут wasm-патерн ДОДАЄТЬСЯ ПЕРЕД можливим
 *    `fix-<concern>.mjs` — плагін із fix-заглушкою (порожній план — сумісна
 *    поведінка v3.0, доккомент `wit/world.wit` біля `export fix`) не має
 *    мовчки вимикати чинний JS T0-фікс концерну;
 * 3. dynamic import() `fix-<concern>.mjs`, якщо файл є.
 *
 * **Порядок масиву — інваріант, не деталь реалізації**: native/wasm-патерн
 * (`guestFix: true`, types.mjs) ЗАВЖДИ йде ПЕРЕД патернами з `fix-<concern>.mjs`.
 * `applyT0` (нижче) покладається саме на цей порядок, щоб зупинити подальші
 * JS-fallback патерни, коли гість реально щось застосував — wit-контракт НЕ
 * несе прапорця «цей concern має реальний, не-заглушковий fix» (`export fix`
 * — один і той самий сигнатурний слот для стабу й реалізації), тож єдиний
 * надійний спосіб відрізнити їх — динамічний: чи дав `apply()` непорожній
 * `touchedFiles` У ЦЬОМУ проході (не декларативний `test()`-прапорець наперед
 * — `test()===true` з подальшим `touchedFiles: []` теж можливий, напр. wasm-план
 * з самими `delete`-правками на вже відсутній файл, `wasmFixPattern.apply` вище).
 * @param {string} concernDir Директорія concern-а, де шукати fix-модуль.
 * @param {string} concernName Ім'я concern-а для формування назви fix-файлу.
 * @param {string} ruleId Id правила (для `ruleId/concernId`-ключа native-fix реєстру).
 * @param {string} cwd Абсолютний корінь consumer-репо (вшивається у синтетичний патерн).
 * @param {string[]} [deltaFiles] Дельта запиту (`item.files`) — вшивається у wasm-патерн, див. {@link wasmFixPattern}.
 * @returns {Promise<T0Pattern[]>} Масив T0-патернів або порожній, якщо немає ані native/wasm, ані fix-файлу.
 */
export async function loadT0Patterns(concernDir, concernName, ruleId, cwd, deltaFiles) {
  const nativeKey = `${ruleId}/${concernName}`
  if (getNativeFixKeys().has(nativeKey)) return [nativeFixPattern(nativeKey, cwd)]
  const patterns = []
  const wasmConcernMap = await resolveWasmConcernMap(cwd)
  const wasmEntry = wasmConcernMap.get(nativeKey)
  if (wasmEntry) patterns.push(wasmFixPattern(nativeKey, cwd, wasmEntry, deltaFiles))
  const fixPath = join(concernDir, `fix-${concernName}.mjs`)
  if (existsSync(fixPath)) {
    try {
      // eslint-disable-next-line no-unsanitized/method
      const mod = await import(pathToFileURL(fixPath).href)
      if (Array.isArray(mod.patterns)) patterns.push(...mod.patterns)
    } catch (error) {
      // Битий fix-модуль (синтаксис, поламаний імпорт) — НЕ мовчазний skip: без цього
      // логу користувач бачить порушення, запускає `--fix`, воно «нічого не робить» —
      // і жодного пояснення (принцип власника: сигналізувати яскраво, не ховати).
      // `console.error` (не throw): `loadT0Patterns` кличеться в циклі по концернах
      // (`runFixPipeline` → `plan.map`, `fixConcernCore`) — падіння ОДНОГО fix-модуля
      // не має вбивати весь прогін, лише позбавляти ЦЕЙ concern JS T0-фікса (concern
      // далі йде в LLM-ladder, як і при повній відсутності `fix-<concern>.mjs`).
      console.error(
        `❌ T0: fix-модуль "${fixPath}" (${ruleId}/${concernName}) не завантажився — ${error.message}. ` +
          'JS T0-фікс цього concern-а пропущено, concern піде в ladder.'
      )
    }
  }
  return patterns
}

/**
 * Резолвить fix-worker concern-а з `fix-worker.mjs` (експорт `fixWorker`).
 * @param {string} concernDir Директорія concern-а, де шукати fix-worker.mjs.
 * @returns {Promise<import('./types.mjs').FixWorkerFn|null>} Функція-worker або null, якщо відсутня.
 */
async function loadFixWorker(concernDir) {
  const workerPath = join(concernDir, 'fix-worker.mjs')
  if (!existsSync(workerPath)) return null
  try {
    // eslint-disable-next-line no-unsanitized/method
    const mod = await import(pathToFileURL(workerPath).href)
    return typeof mod.fixWorker === 'function' ? mod.fixWorker : null
  } catch {
    return null
  }
}

/**
 * Застосовує T0-патерни (детерміновано, permanent — поза rollback). `standalone: true`
 * (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §8, Phase 2) обходить
 * `test()`-гейт: патерн сам ідемпотентний і самоаналізуючий (напр. `oxfmt --write`) — не
 * потребує per-violation даних, щоб вирішити, чи запускати `apply()`.
 *
 * **Гість-пріоритет / double-apply гейт** (`T0Pattern.guestFix`, types.mjs): щойно
 * `guestFix`-патерн (native/wasm, [`nativeFixPattern`]/[`wasmFixPattern`]) реально
 * застосував зміни (`apply()` дав непорожній `touchedFiles`), цикл ЗУПИНЯЄТЬСЯ — подальші
 * патерни того самого concern-а (за інваріантом порядку `loadT0Patterns`: усе, що йде
 * ПІСЛЯ guestFix-патерну, — `fix-<concern>.mjs`) НЕ тестуються й не застосовуються.
 * Без цього `applyT0` ганяв би ОБИДВА фіксери одним і тим самим (уже застарілим після
 * першого запису) масивом `violations` — другий бачив би файл, УЖЕ змінений першим
 * (concern `js/doc_comments` — живий приклад, `fix-doc_comments.mjs` мав власний
 * idempotency-guard саме на цей випадок, доккомент модуля там). Гість-заглушка
 * (порожній план → `touchedFiles: []`, а частіше й `test()===false` — не проходить
 * ґейт вище) цей брейк НЕ зводить: JS-fallback лишається робочим — перехідний період,
 * доккомент `loadT0Patterns`. Гейт — динамічний (за фактичним `touchedFiles`), не за
 * `test()`: `test()===true` з подальшим порожнім `touchedFiles` (напр. wasm-план із
 * самими `delete` на вже відсутній файл) НЕ має глушити fallback, якому справді є що
 * зробити.
 * @param {T0Pattern[]} patterns Список T0-патернів для перевірки й застосування.
 * @param {LintViolation[]} violations Порушення свого concern-а.
 * @param {LintContext} ctx Контекст лінту (cwd, ruleId, concernId тощо).
 * @param {(s: string) => void} log Логер для повідомлень про застосовані патерни.
 * @returns {Promise<Array<{ id: string, message: string|null, touchedFiles: string[] }>>} Застосовані патерни з їхніми змінами.
 */
async function applyT0(patterns, violations, ctx, log) {
  const applied = []
  for (const p of patterns) {
    if (!p.standalone && !p.test(violations)) continue
    const res = await p.apply(violations, ctx)
    if (res && Array.isArray(res.touchedFiles)) {
      applied.push({ id: p.id, message: res.message ?? null, touchedFiles: res.touchedFiles })
      if (res.message) log(`  ⚙️  T0 ${ctx.ruleId}/${ctx.concernId}: ${res.message}\n`)
    }
    if (p.guestFix && res?.touchedFiles?.length > 0) break
  }
  return applied
}

/**
 * Чи всі T0-патерни concern-а позначені `standalone: true` (і їх принаймні один) —
 * такий concern пропускає початковий detect у fix-режимі: `apply()` викликається
 * безумовно (ідемпотентно), а post-T0 re-detect сам стає джерелом правди "чи були
 * порушення" (spec §8, Phase 2). Змішаний набір (частина standalone, частина ні) —
 * НЕ підпадає: бодай один патерн, якому потрібні реальні violations, вимагає
 * початкового detect для всього concern-а.
 * @param {T0Pattern[]} patterns T0-патерни concern-а.
 * @returns {boolean} true — concern можна фіксити без початкового detect.
 */
function isStandaloneConcern(patterns) {
  return patterns.length > 0 && patterns.every(p => p.standalone === true)
}

/**
 * Re-detect одного concern-а (canonical verdict). Кидає DetectorError → пробрасується.
 * Кожен знімок живить ProgressReporter — тикер «знайдено/виправлено» оновлюється
 * саме тут, після кожного canonical detect.
 * @param {PlanItem} item Елемент плану з entry та переліком файлів.
 * @param {string} cwd Робоча директорія для запуску детектора.
 * @param {import('./progress.mjs').ProgressReporter|null} [progress] Reporter прогресу.
 * @param {boolean} [verbose] Детальний вивід (прокидається у ctx concern-а).
 * @param {string[]} [mutationRefreshFiles] Source-файли з cache-independent mutation verdict-ом.
 * @returns {Promise<LintViolation[]>} Актуальні порушення concern-а після re-detect.
 */
async function reDetect(item, cwd, progress = null, verbose = false, mutationRefreshFiles = []) {
  const ctx = {
    cwd,
    ruleId: item.entry.ruleId,
    concernId: item.entry.concern.name,
    files: item.files,
    verbose,
    mutationRefreshFiles
  }
  const res = await runConcernDetector(item.entry.concern, ctx)
  progress?.detectSnapshot(progressKey(item), res.violations.length)
  return res.violations
}

/**
 * Резолвить worker concern-а: override → concern-specific fix-worker.mjs → дефолтний pi-agent.
 * @param {string} concernDir Директорія concern-а.
 * @param {import('./types.mjs').FixWorkerFn|null} [workerOverride] Worker-override для тестів.
 * @returns {Promise<import('./types.mjs').FixWorkerFn|null>} Резолвлений worker або null.
 */
async function resolveWorker(concernDir, workerOverride) {
  const worker = workerOverride ?? (await loadFixWorker(concernDir))
  if (worker) return worker
  const defaultWorkerMod = await import('./default-worker.mjs')
  return defaultWorkerMod.fixWorker
}

/**
 * Фаза T0: застосовує детерміновані патерни й re-detect. Повертає стан фази.
 * @param {PlanItem} item Елемент плану.
 * @param {LintViolation[]} initialViolations Порушення до T0.
 * @param {T0Pattern[]} patterns T0-патерни concern-а.
 * @param {LintContext} lintCtx Контекст лінту.
 * @param {string} cwd Робоча директорія.
 * @param {(s: string) => void} log Логер.
 * @param {import('./progress.mjs').ProgressReporter|null} [progress] Reporter прогресу.
 * @param {boolean} [verbose] Детальний вивід (прокидається у ctx concern-а).
 * @returns {Promise<{ closed: boolean, violations: LintViolation[], applied: Array<{ id: string, message: string|null, touchedFiles: string[] }> }>} closed=true якщо concern закрито T0; applied — застосовані патерни з їхніми змінами.
 */
async function runT0Phase(item, initialViolations, patterns, lintCtx, cwd, log, progress = null, verbose = false) {
  if (patterns.length === 0) return { closed: false, violations: initialViolations, applied: [] }
  progress?.concernStart(progressKey(item), 'T0')
  const applied = await applyT0(patterns, initialViolations, lintCtx, log)
  const afterT0 = await reDetect(item, cwd, progress, verbose)
  if (afterT0.length === 0) {
    log(`  ✅ T0: ${lintCtx.ruleId}/${lintCtx.concernId}\n`)
    return { closed: true, violations: afterT0, applied }
  }
  return { closed: false, violations: afterT0, applied }
}

/**
 * @typedef {{ previousModel: string, previousError: string|null }} FixFeedback
 */

/**
 * @typedef {{ action: 'break'|'skip-model'|null, violations: LintViolation[], feedback: FixFeedback }} RungOutcome
 */

/**
 * Cross-file (§12 addendum 2026-07-05) + in-file hunk-level (addendum 2026-07-24)
 * collateral rung-а: наявні файли, змінені поза target-set, і наявні файли ВСЕРЕДИНІ
 * target-set, змінені поза вікном навколо `violation.data.line`. Чиста функція (без
 * трейсу/side-effects) — виклик trace лишається на caller-і.
 * @param {{ violations: LintViolation[], item: PlanItem, snapshot: ReturnType<typeof createSnapshot>, cwd: string }} args Порушення rung-а, елемент плану, snapshot S1 і робоча директорія.
 * @returns {{ targetFiles: string[], collateral: string[], inFileHunks: Array<{ file: string, start: number, end: number }>, collateralAll: string[], rejectedRel: string[], inFileHunkRel: string[] }} Обидва класи collateral (cross-file, in-file) і їхнє відносне представлення для логу/feedback.
 */
function computeCollateral({ violations, item, snapshot, cwd }) {
  // Semantic-collateral veto (§12 addendum 2026-07-05): clean-вердикт не приймається,
  // якщо rung ЗМІНИВ наявні файли поза target-set порушення (клас «App.vue: хардкод
  // версії замість getVersion»). Нові файли дозволені (scaffold/доки); порожній
  // target-set (whole-repo концерни без file-атрибуції) → veto незастосовний.
  const targetFiles = [...new Set([...violations.map(v => v.file).filter(Boolean), ...(item.files ?? [])])]
  const collateral = findCollateralEdits({ modifiedExisting: snapshot.modifiedExisting(), targetFiles, cwd })

  // In-file hunk-level veto (§12 addendum 2026-07-24): файл — легітимна ціль, але rung
  // зачепив рядки поза вікном навколо порушень ЦЬОГО файлу (upsert-order.js: doc-comment
  // fix + сусіднє видалення intentional-workaround-у, невидиме для cross-file veto вище).
  // Без realpath: snapshot-ключі — це те, що воркер сам передав у recordWrite (як правило
  // `join(cwd, relFile)`), і `resolve(cwd, v.file)` дає той самий рядок за тим самим
  // (не-realpath-нормалізованим) cwd — realpath тут лише зіпсував би збіг ключів мапи.
  const violationLinesByFile = new Map()
  for (const v of violations) {
    const line = v.data?.line
    if (!v.file || typeof line !== 'number') continue
    const abs = isAbsolute(v.file) ? v.file : resolve(cwd, v.file)
    if (!violationLinesByFile.has(abs)) violationLinesByFile.set(abs, [])
    violationLinesByFile.get(abs).push(line)
  }
  const modifiedAbs = new Set(snapshot.modifiedExisting())
  const inFileHunks = []
  for (const [abs, lines] of violationLinesByFile) {
    if (!modifiedAbs.has(abs)) continue
    const pre = snapshot.preImageOf(abs)
    if (pre === null) continue
    let current
    try {
      current = existsSync(abs) ? readFileSync(abs, 'utf8') : null
    } catch {
      continue
    }
    const hunk = findInFileCollateralEdits({ preImage: pre, current, violationLines: lines })
    if (hunk) inFileHunks.push({ file: abs, ...hunk })
  }

  const collateralAll = [...collateral, ...inFileHunks.map(h => h.file)]
  // relative — від так само realpath-нормалізованого cwd, інакше symlink-cwd (macOS
  // /var → /private/var) дає `../../…`-шляхи у телеметрії та feedback.
  const rejectedRel = collateral.map(p => relative(realpathBestEffort(cwd), p))
  const inFileHunkRel = inFileHunks.map(h => `${relative(realpathBestEffort(cwd), h.file)}:${h.start}-${h.end}`)
  return { targetFiles, collateral, inFileHunks, collateralAll, rejectedRel, inFileHunkRel }
}

/**
 * Test-gate (addendum 2026-07-24): collateral-veto (cross-file + in-file hunk) вище
 * ловить лише правки, видимі як diff проти S1. Правки ВСЕРЕДИНІ вже-таргетованого
 * файлу, у ВІКНІ навколо violation.data.line (тому не зловлені in-file hunk-level
 * veto), теж можуть зламати наявний проєктний тест — test-gate це третій, незалежний
 * рубіж. Скоуп — лише наявні файли ВСЕРЕДИНІ target-set, реально змінені цим rung-ом
 * (не колатеральні — ті вже відхилені collateral-veto); caller пропускає виклик, якщо
 * collateralAll уже ветував rung (нема сенсу гонити тести на приреченому rung-у).
 * Fail-open (findBrokenSiblingTests сама fail-open на відсутність test-runner-а/
 * таймаут/відсутність сестринського тесту). Побічний ефект: пише trace на провал.
 * @param {{ targetFiles: string[], snapshot: ReturnType<typeof createSnapshot>, cwd: string, testRunner: typeof import('./test-gate.mjs').runTestFile|undefined, ruleId: string, concernName: string, rung: Rung }} args Файли порушення, snapshot S1, робоча директорія, override test-runner-а і координати rung-а для телеметрії.
 * @returns {{ file: string, testFile: string, output: string } | null} Перший зафіксований провал сестринського тесту, або null якщо test-gate не спрацював.
 */
function detectBrokenTest({ targetFiles, snapshot, cwd, testRunner, ruleId, concernName, rung }) {
  const targets = resolveTargetSet(targetFiles, cwd)
  const modifiedInTarget = snapshot
    .modifiedExisting()
    .map(p => realpathBestEffort(p))
    .filter(abs => targets.has(abs))
  if (modifiedInTarget.length === 0) return null
  // `runTest: testRunner` — default-параметр findBrokenSiblingTests спрацьовує саме
  // на `undefined`, тож відсутній override прозоро падає назад на runTestFile.
  const brokenTest = findBrokenSiblingTests({ files: modifiedInTarget, cwd, runTest: testRunner })
  if (!brokenTest) return null
  writeTrace({
    caller: `fix:${ruleId}/${concernName}:${rung.tier}`,
    backend: 'pi-ai',
    kind: 'test-gate-veto',
    rule: ruleId,
    rung: rung.tier,
    model: rung.model,
    cwd,
    brokenFile: relative(realpathBestEffort(cwd), brokenTest.file),
    brokenTestFile: relative(realpathBestEffort(cwd), brokenTest.testFile),
    targetFiles,
    cleanDetect: true
  })
  return brokenTest
}

/**
 * Опис відхиленого rung-а для логу (`errorSuffix`) і feedback наступному rung-у
 * (`silentFailureNote`) — один пріоритет: worker-помилка → collateral-veto →
 * test-gate-veto → мовчазна невдача (worker нічого не змінив / змінив, але
 * порушення лишилось).
 * @param {object} args Дані одного rung-а, потрібні для опису відхилення.
 * @param {string|null} args.error Повідомлення worker-помилки, якщо rung кинув виняток.
 * @param {string[]} args.collateralAll Об'єднаний список відхилених collateral-правок (cross-file abs).
 * @param {string[]} args.rejectedRel Cross-file collateral (відносні шляхи).
 * @param {string[]} args.inFileHunkRel In-file hunk-level collateral (`file:start-end`).
 * @param {{ file: string, testFile: string } | null} args.brokenTest Результат test-gate.
 * @param {string} args.cwd Робоча директорія (для relative()).
 * @param {string[]} args.targetFiles Файли порушення rung-а.
 * @param {string} args.model Модель rung-а (для тексту feedback).
 * @param {string[]} args.touchedFiles Файли, торкнуті worker-ом.
 * @returns {{ errorSuffix: string, silentFailureNote: string }} Суфікс для логу і нотатка для feedback наступному rung-у.
 */
function describeVetoOutcome({
  error,
  collateralAll,
  rejectedRel,
  inFileHunkRel,
  brokenTest,
  cwd,
  targetFiles,
  model,
  touchedFiles
}) {
  if (error) return { errorSuffix: ` ❌ ${error.slice(0, 120)}`, silentFailureNote: '' }

  if (collateralAll.length > 0) {
    const parts = []
    if (rejectedRel.length > 0) parts.push(`змінила наявні файли поза target-set (${rejectedRel.join(', ')})`)
    if (inFileHunkRel.length > 0) parts.push(`зачепила рядки поза ділянкою порушення (${inFileHunkRel.join(', ')})`)
    return {
      errorSuffix: ` 🚫 collateral-veto: ${[...rejectedRel, ...inFileHunkRel].join(', ')}`,
      silentFailureNote:
        `Попередня спроба (${model}) закрила порушення, але ${parts.join('; ')} — усі правки відхилено. ` +
        `Редагуй ЛИШЕ рядки порушення у файлах: ${targetFiles.join(', ')}.`
    }
  }

  if (brokenTest) {
    const brokenFileRel = relative(realpathBestEffort(cwd), brokenTest.file)
    const brokenTestRel = relative(realpathBestEffort(cwd), brokenTest.testFile)
    return {
      errorSuffix: ` 🚫 test-gate-veto: ${brokenTestRel}`,
      silentFailureNote:
        `Попередня спроба (${model}) закрила порушення, але зламала наявний тест ` +
        `${brokenTestRel} (файл ${brokenFileRel}) — усі правки відхилено. ` +
        'Виправ ЛИШЕ саме порушення, не чіпай навколишню логіку/коментарі-попередження.'
    }
  }

  if (touchedFiles.length === 0) {
    return {
      errorSuffix: ' ❌ досі порушено',
      silentFailureNote: `Попередня спроба (${model}) не внесла жодної зміни у файли; порушення досі активне.`
    }
  }
  return {
    errorSuffix: ' ❌ досі порушено',
    silentFailureNote:
      `Попередня спроба (${model}) торкнулась файлів (${touchedFiles.join(', ')}), ` +
      'але порушення досі активне — той самий підхід не спрацював, спробуй інакше.'
  }
}

/**
 * Проводить один rung ladder-а: worker → canonical re-detect → rollback при провалі.
 * @param {Rung} rung Поточна сходинка ladder-а.
 * @param {import('./types.mjs').FixWorkerFn} worker Fix-worker concern-а.
 * @param {LintViolation[]} violations Актуальні порушення на вході в rung.
 * @param {FixFeedback|null} feedback Feedback з попереднього rung-а.
 * @param {object} rungDeps Залежності rung-а.
 * @param {PlanItem} rungDeps.item Елемент плану.
 * @param {string} rungDeps.cwd Робоча директорія.
 * @param {ReturnType<typeof createSnapshot>} rungDeps.snapshot Snapshot S1.
 * @param {(s: string) => void} rungDeps.log Логер.
 * @param {import('./progress.mjs').ProgressReporter|null} [rungDeps.progress] Reporter прогресу.
 * @param {boolean} [rungDeps.verbose] Детальний вивід (прокидається у ctx concern-а).
 * @param {typeof import('./test-gate.mjs').runTestFile} [rungDeps.testRunner] Override
 *   test-runner-а для test-gate (інжект для тестів).
 * @returns {Promise<{ closed: true, touchedFiles: string[] } | { closed: false, outcome: RungOutcome }>} closed=true якщо concern закрито (touchedFiles — зміни worker-а); інакше результат для наступного кроку.
 */
async function runRung(rung, worker, violations, feedback, rungDeps) {
  const { item, cwd, snapshot, log, progress = null, verbose = false, chain = null, testRunner } = rungDeps
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name
  progress?.concernStart(progressKey(item), rung.tier)

  /** @type {FixContext} */
  const fixCtx = {
    cwd,
    ruleId,
    concernId: concernName,
    files: item.files,
    tier: rung.tier,
    model: rung.model,
    timeoutMs: rung.timeoutMs,
    feedback: rung.feedback ? feedback : undefined,
    recordWrite: absPath => snapshot.record(absPath),
    recordDurableWrite: absPath => snapshot.recordDurable(absPath),
    chain,
    // Evidence-гейт рунга (Фаза A1): item-scoped canonical re-detect для verify-петлі
    // всередині worker-а. ДетекторError тут ковтається у {ok:false} — зовнішній
    // canonical re-detect нижче вдарить у той самий детектор і кине штатно.
    verify: async () => {
      let after
      try {
        after = await reDetect(item, cwd, progress, verbose)
      } catch (detectError) {
        return { ok: false, output: `detector error: ${detectError.message}` }
      }
      return { ok: after.length === 0, output: renderViolations(after) }
    },
    // Local-тири повільні — одна додаткова ітерація; cloud тягне дві.
    verifyMax: isLocalModel(rung.model) ? 1 : 2
  }

  let workerResult = null
  let error = null
  try {
    // Первинний таймаут — у самому worker-і (ctx.timeoutMs → runAgentFix abort-ить
    // сесію). Backstop ×1.25 страхує від worker-а, що ігнорує ctx.timeoutMs
    // (ADR 260620-0556: зависла cloud-SSE без гонки блокувала lint назавжди);
    // запас гарантує, що штатно першим спрацьовує внутрішній abort-шлях.
    // doc-files — явна довга foreground-генерація: не відʼєднуємо її й не обриваємо
    // backstop-ом. Всі інші fix-workers лишаються bounded, як і раніше.
    const backstopMs = ruleId === 'doc-files' ? 0 : Math.round(rung.timeoutMs * 1.25)
    workerResult = await withTimeout(worker(violations, fixCtx), backstopMs, {
      label: 'fix'
    })
  } catch (workerError) {
    error = workerError.message
  }

  // Canonical re-detect = джерело правди. Якщо він сам кидає (напр. worker лишив файл
  // синтаксично невалідним — LLM зламав YAML-структуру, детектор/conftest не може його
  // розпарсити) — rollback МАЄ спрацювати перед перекиданням винятку далі. Без цього
  // зіпсований проміжний стан worker-а лишався б на диску назавжди: виняток з re-detect
  // абортує весь прогін, і код нижче (snapshot.rollback() для звичайного «не чисто»)
  // ніколи не виконується.
  let after
  try {
    after = await reDetect(item, cwd, progress, verbose, workerResult?.mutationRefreshFiles ?? [])
  } catch (detectError) {
    snapshot.rollback()
    throw detectError
  }

  const { targetFiles, collateralAll, rejectedRel, inFileHunkRel } = computeCollateral({
    violations,
    item,
    snapshot,
    cwd
  })
  if (collateralAll.length > 0) {
    // Телеметрія відхилених правок — той самий глобальний llm-trace, що й fix-виклики.
    writeTrace({
      caller: `fix:${ruleId}/${concernName}:${rung.tier}`,
      backend: 'pi-ai',
      kind: 'collateral-veto',
      rule: ruleId,
      rung: rung.tier,
      model: rung.model,
      cwd,
      rejectedFiles: rejectedRel,
      rejectedHunks: inFileHunkRel,
      targetFiles,
      cleanDetect: after.length === 0
    })
  }
  // Test-gate: третій, незалежний рубіж поверх collateral-veto (cross-file + in-file
  // hunk) — пропускається, якщо collateralAll уже ветував rung (нема сенсу гонити
  // тести на приреченому rung-у).
  const brokenTest =
    after.length === 0 && !error && collateralAll.length === 0
      ? detectBrokenTest({ targetFiles, snapshot, cwd, testRunner, ruleId, concernName, rung })
      : null

  const vetoed = after.length === 0 && !error && (collateralAll.length > 0 || brokenTest !== null)
  const touchedFiles = workerResult?.touchedFiles ?? []
  if (after.length === 0 && !error && !vetoed) {
    log(`  ✅ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}\n`)
    // Фаза C: успішний agentic-фікс (canonical clean, без veto) → глобальний
    // distillation-стор (§13 pi-migration: корпус oldText→newText для маховика T0).
    // Best-effort і лише за наявності реальних правок (T0/manual-фікси не пишемо).
    const edits = workerResult?.telemetry?.edits
    if (Array.isArray(edits) && edits.length > 0) {
      const { recordFixTelemetry } = await import('@7n/llm-lib/telemetry-store')
      recordFixTelemetry({
        rule: ruleId,
        concern: concernName,
        rung: rung.tier,
        model: rung.model,
        cwd,
        edits,
        verifyAttempts: workerResult?.telemetry?.verifyAttempts?.length ?? 0,
        anchoredEdits: workerResult?.telemetry?.anchoredEdits ?? false
      })
    }
    return { closed: true, touchedFiles }
  }
  // Provider може повернути quality-verdict без worker exception (наприклад,
  // generated coverage test зелений у Vitest, але не вбив target mutant). Це
  // не змінює retry policy; лише дає наступному ladder rung-у конкретний feedback.
  const workerFeedback = workerResult?.feedback?.previousError ?? null

  const { errorSuffix, silentFailureNote } = describeVetoOutcome({
    error,
    collateralAll,
    rejectedRel,
    inFileHunkRel,
    brokenTest,
    cwd,
    targetFiles,
    model: rung.model,
    touchedFiles
  })
  log(`  ⚡ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}${errorSuffix}\n`)

  // Не clean → restore S1 перед наступним rung-ом (degraded не тече далі).
  // Durable-write-и worker-а (recordDurableWrite) rollback НЕ чіпає: кожен такий файл —
  // самодостатній кінцевий стан (doc-files-батч), і прогрес по ньому вже зарахований
  // canonical re-detect-ом вище — наступний rung/прогін продовжує з решти, не з нуля.
  snapshot.rollback()

  return {
    closed: false,
    outcome: {
      action: decideAfterFailure(rung, error),
      violations: after.length > 0 ? after : violations,
      feedback: { previousModel: rung.model, previousError: error ?? workerFeedback ?? silentFailureNote }
    }
  }
}

/** Кеп telemetry-списку змінених файлів у extra ланцюжка (повний обсяг — touchedTotal). */
const TOUCHED_FILES_CAP = 20

/**
 * Стислий опис проблеми concern-а для шапки ланцюжка (`extra.problem` фінального
 * chain-запису) — щоб в аналітиці (myllm, chains-report) було видно, ЩО саме
 * вирішував ланцюжок, а не лише rule/concern.
 * @param {LintViolation[]} violations Порушення concern-а.
 * @returns {{ violations: number, reasons: string[], files: string[], sample: string|null }|null} Зведення або null, якщо порушень нема.
 */
function summarizeProblem(violations) {
  if (!violations?.length) return null
  return {
    violations: violations.length,
    reasons: [...new Set(violations.map(v => v.reason))].slice(0, 5),
    files: [...new Set(violations.map(v => v.file).filter(Boolean))].slice(0, 10),
    sample: violations[0]?.message?.slice(0, 200) ?? null
  }
}

/**
 * Проводить ОДИН concern по pipeline: T0 → S1 → ladder. Повертає чи закрито.
 * @param {PlanItem} item Елемент плану з entry та переліком файлів.
 * @param {LintViolation[]} initialViolations Початкові порушення concern-а до fix.
 * @param {object} deps Залежності pipeline.
 * @param {string} deps.cwd Робоча директорія.
 * @param {Rung[]} deps.ladder Сходинки ladder-а (tier/model послідовність).
 * @param {() => number} deps.avgRemaining Скільки avg-бюджету лишилось.
 * @param {(n: number) => void} deps.spendAvg Списати n одиниць avg-бюджету.
 * @param {import('./types.mjs').FixWorkerFn|null} [deps.workerOverride] Worker-override для тестів.
 * @param {T0Pattern[]} [deps.t0Override] T0-патерни override для тестів.
 * @param {(s: string) => void} deps.log Логер прогресу.
 * @param {import('./progress.mjs').ProgressReporter|null} [deps.progress] Reporter прогресу.
 * @param {boolean} [deps.verbose] Детальний вивід (прокидається у ctx concern-а).
 * @param {typeof startChain} [deps.chainFactory] Фабрика ланцюжка (інжект для тестів).
 * @param {typeof import('./test-gate.mjs').runTestFile} [deps.testRunner] Override
 *   test-runner-а для test-gate (інжект для тестів цього модуля).
 * @returns {Promise<boolean>} Чи закрито concern (усі порушення усунено).
 */
export async function fixConcern(item, initialViolations, deps) {
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name
  // Ланцюжок concern-а охоплює і T0: закриття без жодного LLM-виклику (steps:0,
  // t0Closed) — золотий baseline для метрики дистиляції.
  const chain = (deps.chainFactory ?? startChain)({
    kind: 'fix-concern',
    unit: `${ruleId}/${concernName}`,
    cwd: deps.cwd
  })
  const chainExtra = {
    t0Closed: false,
    stop: null,
    rungs: [],
    rollbacks: 0,
    avgCapSkipped: 0,
    // Шапка ланцюжка в аналітиці: яку проблему вирішували, хто закрив (t0 |
    // tier:model), і до яких змін файлів це привело (permanent T0 + closing rung;
    // rollback-нуті rung-и сюди не потрапляють).
    problem: summarizeProblem(initialViolations),
    resolvedBy: null,
    t0Applied: [],
    touchedFiles: [],
    touchedTotal: 0
  }
  // Абсолютні шляхи змін накопичуються тут і нормалізуються один раз у finally
  // (cwd-relative, дедуп, кеп) — щоб у trace не текли абсолютні шляхи машини.
  const touchedAbs = []
  let closed = false
  try {
    closed = await fixConcernCore(item, initialViolations, deps, chain, chainExtra, touchedAbs)
    return closed
  } finally {
    const base = realpathBestEffort(deps.cwd)
    const rel = [...new Set(touchedAbs.map(p => relative(base, realpathBestEffort(p))))]
    chainExtra.touchedTotal = rel.length
    chainExtra.touchedFiles = rel.slice(0, TOUCHED_FILES_CAP)
    let outcome = 'fail'
    if (closed) outcome = 'success'
    else if (chainExtra.stop) outcome = 'partial'
    chain.end({ outcome, extra: chainExtra })
  }
}

/**
 * Фіксує результат T0-фази в телеметрії ланцюжка: застосовані патерни, їхні
 * зміни (permanent — рахуються навіть якщо concern далі не закрився) і
 * resolvedBy='t0' при закритті.
 * @param {{ closed: boolean, applied: Array<{ id: string, message: string|null, touchedFiles: string[] }> }} t0 Результат runT0Phase.
 * @param {{ t0Closed: boolean, resolvedBy: string|null, t0Applied: object[] }} chainExtra Акумулятор extra.
 * @param {string[]} touchedAbs Акумулятор абсолютних шляхів змін.
 * @returns {void}
 */
function noteT0Phase(t0, chainExtra, touchedAbs) {
  if (t0.applied.length > 0) {
    chainExtra.t0Applied = t0.applied.map(a => ({ id: a.id, message: a.message }))
    touchedAbs.push(...t0.applied.flatMap(a => a.touchedFiles))
  }
  if (t0.closed) {
    chainExtra.t0Closed = true
    chainExtra.resolvedBy = 't0'
  }
}

/**
 * Ladder concern-а: повний, або без local-tier rung-ів (`concern.skipLocalTier`).
 * Concern може замінити cloud budget своїм `cloudTimeoutMs`; глобальний ladder та
 * всі інші concern-и лишаються без змін.
 * concern-и, де local-min/local-min-retry емпірично не встигають дати результат
 * у межах свого бюджету (concern-meta.mjs).
 * @param {Rung[]} ladder Повний ladder pipeline-у.
 * @param {import('../concern-meta.mjs').ConcernMeta} concern Concern-meta елемента плану.
 * @returns {Rung[]} Ladder, застосовний до цього concern-а.
 */
function selectLadder(ladder, concern) {
  const selected = concern.skipLocalTier ? ladder.filter(rung => !rung.local) : ladder
  return concern.cloudTimeoutMs
    ? selected.map(rung => (rung.local ? rung : { ...rung, timeoutMs: concern.cloudTimeoutMs }))
    : selected
}

/**
 * Тіло fix-pipeline одного concern-а (T0 → S1 → ladder); chain/chainExtra — акумулятори
 * телеметрії ланцюжка (володіє ними fixConcern-обгортка).
 * @param {PlanItem} item Елемент плану.
 * @param {LintViolation[]} initialViolations Початкові порушення.
 * @param {object} deps Залежності pipeline (див. fixConcern).
 * @param {object} chain Chain handle.
 * @param {{ t0Closed: boolean, stop: string|null, rungs: object[], rollbacks: number, avgCapSkipped: number, problem: object|null, resolvedBy: string|null, t0Applied: object[] }} chainExtra Акумулятор extra.
 * @param {string[]} touchedAbs Акумулятор абсолютних шляхів реально збережених змін (T0 + closing rung).
 * @returns {Promise<boolean>} Чи закрито concern.
 */
async function fixConcernCore(item, initialViolations, deps, chain, chainExtra, touchedAbs) {
  const { cwd, ladder, log, progress = null, verbose = false } = deps
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name
  const concernDir = item.entry.concern.dir
  /** @type {LintContext} */
  const lintCtx = { cwd, ruleId, concernId: concernName, concernDir, files: item.files, verbose }

  // ── T0 (детермінований, permanent) ──
  const patterns =
    deps.t0Override ?? (await loadT0Patterns(concernDir, concernName, ruleId, cwd, lintCtx.files))
  const t0 = await runT0Phase(item, initialViolations, patterns, lintCtx, cwd, log, progress, verbose)
  noteT0Phase(t0, chainExtra, touchedAbs)
  if (t0.closed) return true
  initialViolations = t0.violations
  // Standalone-концерни стартують без початкового detect (problem=null) — перший
  // canonical detect відбувається тут, після T0; фіксуємо його як проблему ланцюжка.
  if (!chainExtra.problem) chainExtra.problem = summarizeProblem(initialViolations)

  // ── Fixability-гейт ── config/structural concern-и НЕ йдуть у LLM-ladder: їхній фікс
  // детермінований (T0/regen) або ризикований для авто-правки. T0 уже відпрацював вище —
  // якщо не закрив, це сигнал ручного/config-фіксу, а не привід палити tier-и (fail-fast).
  const fixability = item.entry.concern.fixability ?? 'code'
  if (fixability !== 'code') {
    log(`  ⏹️  ${ruleId}/${concernName}: fixability=${fixability} — LLM-ladder пропущено (T0/manual)\n`)
    chainExtra.stop = 'fixability'
    return false
  }

  // ── Worker ladder ── concern-specific fix-worker.mjs, інакше дефолтний pi-agent worker.
  const worker = await resolveWorker(concernDir, deps.workerOverride)
  const effectiveLadder = selectLadder(ladder, item.entry.concern)
  if (!worker || effectiveLadder.length === 0) {
    chainExtra.stop = 'no-worker'
    return false
  }

  // S1: знімок post-T0. Один tracker акумулює pre-images; rollback цілить у S1.
  const snapshot = createSnapshot()
  let feedback = null
  let violations = initialViolations
  const skipModels = new Set()

  for (const rung of effectiveLadder) {
    if (skipModels.has(rung.model)) continue
    if (rung.isAvg && deps.avgRemaining() <= 0) {
      log(`  ⏭️  ${ruleId}/${concernName}: ${rung.tier} пропущено (avg-кеп вичерпано)\n`)
      chainExtra.avgCapSkipped++
      continue
    }

    const res = await runRung(rung, worker, violations, feedback, {
      item,
      cwd,
      snapshot,
      log,
      progress,
      verbose,
      chain,
      testRunner: deps.testRunner
    })
    if (rung.isAvg) deps.spendAvg(1)
    chainExtra.rungs.push({
      tier: rung.tier,
      model: rung.model,
      error: res.closed ? null : (res.outcome.feedback.previousError ?? '').slice(0, 200)
    })
    if (res.closed) {
      chainExtra.resolvedBy = `${rung.tier}:${rung.model}`
      touchedAbs.push(...res.touchedFiles)
      return true
    }
    chainExtra.rollbacks++

    violations = res.outcome.violations
    feedback = res.outcome.feedback
    if (res.outcome.action === 'break') break
    if (res.outcome.action === 'skip-model') skipModels.add(rung.model)
  }

  return false
}

/**
 * Detect-фаза: прогін усіх concern-ів плану. При `DetectorError` — сигнал коду 2.
 * @param {PlanItem[]} plan План прогону.
 * @param {string} cwd Робоча директорія.
 * @param {boolean} verbose Детальний вивід плану.
 * @param {(s: string) => void} log Логер.
 * @param {import('./progress.mjs').ProgressReporter|null} [progress] Reporter прогресу.
 * @returns {Promise<{ code: 2 } | { detected: Array<{ item: PlanItem, violations: LintViolation[] }> }>} код 2 при DetectorError або зібрані результати detect.
 */
async function detectAllForFix(plan, cwd, verbose, log, progress = null) {
  /** @type {Array<{ item: PlanItem, violations: LintViolation[] }>} */
  const detected = []
  for (const item of plan) {
    const ctx = { cwd, ruleId: item.entry.ruleId, concernId: item.entry.concern.name, files: item.files, verbose }
    progress?.concernStart(progressKey(item), 'detect')
    if (verbose) {
      const countStr = item.files === undefined ? 'весь репо' : `${item.files.length} файл(ів)`
      log(`  🔍 ${ctx.ruleId}/${ctx.concernId}  [${item.entry.concern.lint.scope}]  → ${countStr}\n`)
    }
    try {
      const res = await runConcernDetector(item.entry.concern, ctx)
      progress?.detectSnapshot(progressKey(item), res.violations.length)
      detected.push({ item, violations: res.violations })
    } catch (detectError) {
      if (detectError instanceof DetectorError) {
        log(`💥 ${detectError.message}\n`)
        return { code: 2 }
      }
      throw detectError
    }
  }
  return { detected }
}

/**
 * Фінальний render невирішених порушень (після провального fix-проходу).
 * @param {Array<{ item: PlanItem, violations: LintViolation[] }>} failing Провальні concern-и.
 * @param {string} cwd Робоча директорія.
 * @param {(s: string) => void} log Логер.
 * @param {boolean} [verbose] Детальний вивід (прокидається у ctx concern-а).
 * @returns {Promise<void>} нічого не повертає (тільки лог).
 */
async function renderRemaining(failing, cwd, log, verbose = false) {
  const remaining = []
  for (const { item } of failing) {
    try {
      remaining.push(...(await reDetect(item, cwd, null, verbose)))
    } catch {
      /* DetectorError на фінальному render — ігноруємо, основний verdict уже worst=1 */
    }
  }
  if (remaining.length > 0) log(renderViolations(remaining))
  return remaining
}

/**
 * Фаза B: матеріалізує невиправлений хвіст у вузли MT-графа. Єдиний гейт —
 * **onboarded-репо** (наявність `.mt.json`, перевіряє preflight у materializeTail):
 * не-MT-репо → fail-open skip; MT-репо → хвіст стає графом задач, які виконує
 * вбудований шлях MT (підписочні CLI claude|codex|cursor|pi, user-level ENV
 * `MT_AGENT_CLI*` — mt ADR 260713-2110; власний node_executor видалено). Fail-open
 * на всіх рівнях: lint ніколи не падає через MT.
 * @param {LintViolation[]} remaining Невиправлені порушення (з renderRemaining).
 * @param {string} cwd Робоча директорія.
 * @param {(s: string) => void} log Логер.
 * @returns {Promise<void>} нічого не повертає (side-effect: вузли у mt/).
 */
async function materializeTailToMt(remaining, cwd, log) {
  if (remaining.length === 0) return
  const { materializeTail } = await import('./mt-tail.mjs')
  try {
    materializeTail({ violations: remaining, cwd, createdAt: new Date().toISOString(), log })
  } catch (error) {
    // Ніколи не валимо lint через MT-матеріалізацію (fail-open навіть на неочікуваному).
    log(`  ⏭️  MT-tail помилка (проігноровано): ${error.message}\n`)
  }
}

/**
 * Повний fix-pipeline: detect усе → fix кожен провальний concern → exit code.
 * @param {object} opts Опції запуску pipeline.
 * @param {string} opts.rulesDir Директорія з правилами.
 * @param {string} opts.cwd Робоча директорія.
 * @param {boolean} [opts.full] Прогін по всьому репо замість дельти.
 * @param {string[]} [opts.rules] Перелік ruleId для обмеження прогону.
 * @param {string[]|null} [opts.files] Перелік файлів або null для повного набору.
 * @param {boolean} [opts.verbose] Детальний вивід плану детекції.
 * @param {number} [opts.maxAvg] Ліміт avg-бюджету.
 * @param {(s: string) => void} [opts.log] Логер виводу.
 * @param {boolean} [opts.isTTY] Override TTY-режиму ProgressReporter (тести); типово isTTY stdout.
 * @param {(snap: object) => void} [opts.onProgress] Публікація знімків прогресу назовні (черга lint --full).
 * @param {object} [opts.deps] Інжекти для тестів: { ladder, workerFor, t0For, chainFactory, testRunner }.
 * @returns {Promise<0|1|2>} Exit code: 0 — чисто, 1 — лишились порушення, 2 — DetectorError.
 */
export async function runFixPipeline(opts) {
  const { cwd } = opts
  const baseLog = opts.log ?? (s => process.stdout.write(s))
  const verbose = opts.verbose === true
  const deps = opts.deps ?? {}

  const plan = await buildDetectPlan(opts)

  // ProgressReporter (канон scripts.mdc «Прогрес довгих lint/fix-прогонів»):
  // бар по концернах + тикер порушень; TTY/не-TTY розгалуження всередині.
  // onUpdate → publisher черги (--full): процеси в черзі бачать живий прогрес.
  const progress = createProgressReporter({
    total: plan.length,
    log: baseLog,
    isTTY: opts.isTTY,
    onUpdate: opts.onProgress
  })
  const log = progress.log

  // Преloadимо T0-патерни разом із планом — потрібно, щоб класифікувати standalone-концерни
  // (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §8, Phase 2) ДО початкового
  // detect. Той самий preload передається далі в fixConcern як t0Override — без повторного
  // dynamic import().
  const patternsByItem = new Map(
    await Promise.all(
      plan.map(async item => [
        item,
        deps.t0For
          ? (deps.t0For(item.entry) ?? [])
          : await loadT0Patterns(
              item.entry.concern.dir,
              item.entry.concern.name,
              item.entry.ruleId,
              cwd,
              item.files
            )
      ])
    )
  )
  const standaloneItems = plan.filter(item => isStandaloneConcern(patternsByItem.get(item)))
  const normalPlan = plan.filter(item => !standaloneItems.includes(item))

  // try/finally: stop() гарантовано звільняє TTY-рядок (hideCursor) навіть при
  // DetectorError з глибини fix-циклу; сам stop() ідемпотентний.
  try {
    // ── Detect лише для normal-концернів; standalone апляє одразу (без початкового detect) ──
    const detectResult = await detectAllForFix(normalPlan, cwd, verbose, log, progress)
    if ('code' in detectResult) return detectResult.code

    const failing = detectResult.detected.filter(d => d.violations.length > 0)
    // Чисті концерни закриваються одразу — бар рухається без очікування fix-фази.
    for (const d of detectResult.detected) {
      if (d.violations.length === 0) progress.concernDone(progressKey(d.item))
    }
    if (failing.length === 0 && standaloneItems.length === 0) return 0

    const ladder = deps.ladder ?? buildLadder(resolveFixLadderModels())
    let avgBudget = typeof opts.maxAvg === 'number' ? opts.maxAvg : DEFAULT_MAX_AVG

    /**
     * @param {PlanItem} item Елемент плану.
     * @param {LintViolation[]} violations Початкові порушення (порожньо для standalone).
     * @returns {Promise<boolean>} Чи закрито concern.
     */
    const runOne = (item, violations) =>
      fixConcern(item, violations, {
        cwd,
        ladder,
        log,
        progress,
        verbose,
        avgRemaining: () => avgBudget,
        spendAvg: n => {
          avgBudget -= n
        },
        workerOverride: deps.workerFor ? deps.workerFor(item.entry) : undefined,
        t0Override: patternsByItem.get(item),
        chainFactory: deps.chainFactory,
        testRunner: deps.testRunner
      })

    let worst = 0
    const attemptedForRender = []

    for (const { item, violations } of failing) {
      if (!(await runOne(item, violations))) {
        worst = 1
        attemptedForRender.push({ item })
      }
      progress.concernDone(progressKey(item))
    }

    for (const item of standaloneItems) {
      if (verbose) {
        const label = `${item.entry.ruleId}/${item.entry.concern.name}`
        log(`  🔍 ${label}  [standalone-merge]  → apply без початкового detect\n`)
      }
      if (!(await runOne(item, []))) {
        worst = 1
        attemptedForRender.push({ item })
      }
      progress.concernDone(progressKey(item))
    }

    // Бар звільняє TTY-рядок ДО фінального render-у невирішених порушень.
    progress.stop()
    if (worst === 1) {
      const remaining = await renderRemaining(attemptedForRender, cwd, baseLog, verbose)
      // B1: невиправлений хвіст → вузли MT (за env-гейтом, fail-open).
      await materializeTailToMt(remaining, cwd, baseLog)
    }

    return worst
  } finally {
    progress.stop()
  }
}
