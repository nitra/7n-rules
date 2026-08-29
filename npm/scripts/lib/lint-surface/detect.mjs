/**
 * Detect-крок unified lint surface: запуск одного concern-detector-а і нормалізація
 * його `LintResult`. Detector — read-only; тут немає LLM, autofix чи мутацій дерева.
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintResult} LintResult
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').LintDiagnostic} LintDiagnostic
 * @typedef {import('../concern-meta.mjs').ConcernMeta} ConcernMeta
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { loadNative } from '../native.mjs'
import { hasResolvableFiles, isGeneratedFile } from './codegen-opa-wrapper.mjs'
import { evaluatePolicyConcern } from './policy-lint-adapter.mjs'
import { hasBuiltinPinsArtifact, resolveWasmConcernMap } from './wasm-plugins.mjs'

/**
 * Кеш ключів native-портованих concern-ів (`ruleId/concernId`), один на процес.
 * @type {Set<string> | null}
 */
let nativeConcernKeys = null

/**
 * Лениво резолвить множину ключів native-концернів з аддона (`listNativeConcerns()`).
 * Кешується на рівні модуля — один виклик на процес. Коли аддон недоступний,
 * `loadNative()` сам кидає власну зрозумілу помилку (той самий hard error, що й
 * для решти native-поверхні rules-core) — тут вона просто пропагується вгору
 * без обгортання й без нової поведінки понад чинний loader; кеш при цьому НЕ
 * виставляється (присвоєння нижче не встигає виконатись), тож наступний виклик
 * знову спробує завантажити аддон, а не залипає в невдалому стані.
 * @returns {Set<string>} множина ключів native-концернів
 */
function getNativeConcernKeys() {
  if (nativeConcernKeys === null) {
    nativeConcernKeys = new Set(loadNative().listNativeConcerns())
  }
  return nativeConcernKeys
}

/**
 * Чи є `ruleId/concernId` builtin-native концерном (у registry
 * `NATIVE_CONCERNS` аддона) — той самий предикат, що перша гілка
 * {@link runConcernDetector} використовує для маршрутизації, винесений
 * окремо для планувальника batch-сегментів (`run-detectors.mjs`
 * `partitionPlanIntoSegments`, R2 зрізу 3 фази 7): суцільні прогони
 * builtin-native items групуються в один `runNativeConcernsBatch`-виклик
 * замість N окремих `runConcernDetector`.
 * @param {string} ruleId id правила.
 * @param {string} concernId id concern-а.
 * @returns {boolean} true, якщо ключ належить `NATIVE_CONCERNS`.
 */
export function isBuiltinNativeConcern(ruleId, concernId) {
  return getNativeConcernKeys().has(`${ruleId}/${concernId}`)
}

/**
 * Сигнал, що detector кинув виняток / повернув невалідний результат → exit 2.
 */
export class DetectorError extends Error {
  /**
   * @param {string} ruleId id правила, у контексті якого стався збій
   * @param {string} concernId id concern-а, у контексті якого стався збій
   * @param {string} detail деталізація причини збою для повідомлення
   */
  constructor(ruleId, concernId, detail) {
    super(`detector ${ruleId}/${concernId}: ${detail}`)
    this.name = 'DetectorError'
    this.ruleId = ruleId
    this.concernId = concernId
  }
}

/**
 * Нормалізує одне порушення: домішує ruleId/concernId з ctx, валідує file-path.
 * @param {unknown} raw сире порушення від detector-а
 * @param {LintContext} ctx контекст лінту (джерело ruleId/concernId)
 * @returns {LintViolation} нормалізоване порушення
 */
function normalizeViolation(raw, ctx) {
  if (typeof raw !== 'object' || raw === null) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, "violation не є об'єктом")
  }
  const v = /** @type {Record<string, unknown>} */ (raw)
  if (typeof v.reason !== 'string' || v.reason.length === 0) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, "violation.reason обов'язковий (непорожній string)")
  }
  if (typeof v.message !== 'string' || v.message.length === 0) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, "violation.message обов'язковий (непорожній string)")
  }
  let file
  if (v.file !== undefined) {
    if (typeof v.file !== 'string') {
      throw new DetectorError(ctx.ruleId, ctx.concernId, 'violation.file має бути string')
    }
    if (v.file.startsWith('/') || v.file.split('/').includes('..')) {
      throw new DetectorError(ctx.ruleId, ctx.concernId, `violation.file має бути posix-relative без "..": ${v.file}`)
    }
    file = v.file
  }
  const severity = v.severity === 'warn' ? 'warn' : 'error'
  /** @type {LintViolation} */
  const out = {
    ruleId: ctx.ruleId,
    concernId: ctx.concernId,
    reason: v.reason,
    message: v.message,
    severity
  }
  if (file !== undefined) out.file = file
  if (v.data !== undefined && typeof v.data === 'object' && v.data !== null) {
    out.data = /** @type {Record<string, unknown>} */ (v.data)
  }
  return out
}

/**
 * Нормалізує сирий результат detector-а. Експортований (не лише внутрішній
 * крок {@link runConcernDetector}) — batch-шлях `run-detectors.mjs`
 * (`runNativeSegmentSync`, R2 зрізу 3 фази 7) прогонить через ЦЮ САМУ
 * функцію кожен успішний item, повернений `runNativeConcernsBatch`, щоб
 * домішати `ruleId`/`concernId` і застосувати ту саму валідацію форми, що
 * й одиночний native-виклик нижче — без цього batch-шлях мав би власну
 * копію нормалізації, яка могла б непомітно розійтись.
 * @param {unknown} raw сирий результат виклику lint()
 * @param {LintContext} ctx контекст лінту (джерело ruleId/concernId)
 * @returns {LintResult} нормалізований результат із violations (і diagnostics)
 */
export function normalizeResult(raw, ctx) {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray(/** @type {Record<string, unknown>} */ (raw).violations)
  ) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'lint() має повернути { violations: [...] }')
  }
  const r = /** @type {{ violations: unknown[], diagnostics?: unknown[] }} */ (raw)
  const violations = r.violations.map(v => normalizeViolation(v, ctx))
  /** @type {LintDiagnostic[]} */
  let diagnostics = []
  if (Array.isArray(r.diagnostics)) {
    diagnostics = r.diagnostics
      .filter(
        d => d && typeof d === 'object' && typeof (/** @type {Record<string, unknown>} */ (d).message) === 'string'
      )
      .map(d => {
        const dd = /** @type {{ level?: unknown, message: string }} */ (d)
        return { level: dd.level === 'warn' ? 'warn' : 'info', message: dd.message }
      })
  }
  return diagnostics.length > 0 ? { violations, diagnostics } : { violations }
}

/**
 * Fail-open результат для транзієнтного збою авто-встановлення зовнішнього тула
 * (`ToolProvisionError` з `ensure-tool.mjs`, розпізнається за `name` — errors можуть
 * приходити з іншого інстансу модуля). GitHub API rate-limit чи мережевий збій на
 * CI-runner-і не має валити весь lint-прогін exit 2: concern пропускається з
 * видимою warn-діагностикою, а не тихо.
 * @param {LintContext} ctx контекст лінту (джерело ruleId/concernId)
 * @param {Error} error транзієнтна помилка встановлення тула
 * @returns {LintResult} порожні violations + warn-діагностика про пропуск
 */
function toolProvisionSkipResult(ctx, error) {
  const message = `⚠️ ${ctx.ruleId}/${ctx.concernId} пропущено (транзієнтний збій встановлення тула): ${error.message}`
  // Diagnostics рендеряться лише у verbose — дублюємо у stderr, щоб пропуск було видно в CI-логах завжди.
  console.warn(message)
  return {
    violations: [],
    diagnostics: [{ level: 'warn', message }]
  }
}

/**
 * Чи має concern ручний (не-`@generated`) `main.mjs`, що перекриває policy-adapter.
 * @param {string} mainPath абсолютний шлях до `main.mjs` concern-а.
 * @returns {boolean} true, якщо файл існує і не є codegen-артефактом.
 */
function hasHandWrittenMain(mainPath) {
  if (!existsSync(mainPath)) return false
  return !isGeneratedFile(readFileSync(mainPath, 'utf8'))
}

/**
 * Запускає detector одного concern-а і нормалізує результат. Кидає `DetectorError`
 * при будь-якій аномалії (→ exit 2).
 *
 * Native-портовані concern-и (`NATIVE_CONCERNS` registry аддона, E1/E2 фази 5)
 * мають абсолютний пріоритет — перевіряються ДО резолву `main.mjs`/policy: якщо
 * `ruleId/concernId` у registry, виклик іде в `runNativeConcern` замість
 * `import(main.mjs)` (перехідне співіснування двох реалізацій під час міграції
 * закінчується видаленням JS-гілки — тут вона вже видалена для пілотів).
 *
 * Далі — wasm-плагіни plugin contract v3 (`resolveWasmConcernMap`,
 * `wasm-plugins.mjs`, задача K фази 6, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.3/§3.4): якщо
 * `ruleId/concernId` є ключем резолвленої мапи, виклик іде в `runWasmConcern`.
 * `resolveWasmConcernMap` — `async` (канонічний `url`+`sha256`-пін тягне
 * мережевий retrieval-контур, кеш-верифікацію й запис на диск, доккомент
 * `wasm-plugins.mjs`), тому тут `await`; `runConcernDetector` уже `async` —
 * контракт виклику не змінюється, лише додається один `await`.
 * Skip-not-crash transition-поводження (рішення З спеки): якщо wasm-плагін
 * падає ПІД ЧАС `detect()` (на відміну від помилки резолву/завантаження, яку
 * `resolveWasmConcernMap` уже відфільтрувала при побудові мапи — такий запис
 * туди просто не потрапляє), concern не валить прогін — попереджає й падає
 * назад на `main.mjs`/policy-гілки нижче, якщо для цього ж concern-а є
 * ручна реалізація; інакше дійде до фінального `DetectorError` нижче, як
 * і будь-який concern без жодної реалізації — те саме повідомлення умовно
 * доповнюється підказкою про відсутній `npm/wasm-plugins/builtin-pins.json`,
 * коли той файл справді відсутній ([`hasBuiltinPinsArtifact`],
 * `wasm-plugins.mjs`) — не можна відрізнити «concern портовано у wasm, але
 * локальна збірка не робилась» від «concern справді без реалізації», тож
 * повідомлення лише доповнюється, не замінюється (доккомент виклику нижче).
 *
 * Інакше — чисті policy-concern-и (rego/template, без ручного `main.mjs`)
 * оцінюються напряму через `evaluatePolicyConcern` з даних `concern.json` —
 * генерований `main.mjs` для них не потрібен. Ручний (не-`@generated`)
 * `main.mjs` — escape-hatch, він завжди має пріоритет. Concern-и без native,
 * без policy й без main.mjs — помилка конфігурації.
 * @param {ConcernMeta} concern метадані concern-а, чий detector запускаємо
 * @param {LintContext} ctx контекст лінту, що передається у lint()
 * @returns {Promise<LintResult>} нормалізований результат detector-а
 */
export async function runConcernDetector(concern, ctx) {
  const nativeKey = `${ctx.ruleId}/${ctx.concernId}`
  if (getNativeConcernKeys().has(nativeKey)) {
    let raw
    try {
      raw = loadNative().runNativeConcern(nativeKey, ctx.cwd, ctx.files ?? null)
    } catch (error) {
      throw new DetectorError(ctx.ruleId, ctx.concernId, `native concern кинув: ${error.message}`)
    }
    return normalizeResult(raw, ctx)
  }

  const wasmConcernMap = await resolveWasmConcernMap(ctx.cwd)
  const wasmEntry = wasmConcernMap.get(nativeKey)
  if (wasmEntry !== undefined) {
    try {
      // `ctx.files ?? null` (не `?? []`) — обидва мають різну семантику
      // (задача N2, передумова full-scope мосту): `undefined` тут означає
      // «планувальник (`run-detectors.mjs::buildFullPlan`/
      // `planConcernForDelta`) не має явного списку файлів для цього
      // concern-а» — napi-міст (`run_wasm_concern`, `crates/rules-napi`)
      // розрізняє `None` («host сам будує batch за задекларованим glob-ом
      // контрибуції — для `scope: full` І для `scope: per-file` однаково,
      // §2.65») від `Some([])` («явно порожній batch»), тож підміна на `[]`
      // тут зробила б повний прогін мовчки порожнім замість того, щоб дати
      // host-у побудувати batch самостійно. Контрибуція, за якою batch
      // побудувати НЕМОЖЛИВО (немає в `describe().concerns` або `per-file`
      // без glob-а), тепер дає типізовану помилку napi — її ловить
      // skip-not-crash нижче й ГУЧНО попереджає, замість мовчазного
      // «чисто».
      const raw = loadNative().runWasmConcern(
        wasmEntry.wasmPath,
        nativeKey,
        ctx.cwd,
        ctx.files ?? null,
        wasmEntry.toolPaths
      )
      return normalizeResult(raw, ctx)
    } catch (error) {
      // Skip-not-crash (доккомент функції вище): wasm-плагін впав під час detect() —
      // попереджаємо і провалюємось у main.mjs/policy-гілки нижче замість DetectorError.
      console.warn(
        `⚠️ ${ctx.ruleId}/${ctx.concernId}: wasm-плагін впав під час detect(), fallback на main.mjs/policy якщо є (${error.message})`
      )
    }
  }

  const mainPath = join(concern.dir, 'main.mjs')

  if (!hasHandWrittenMain(mainPath) && concern.policy && hasResolvableFiles(concern.policy.files)) {
    let raw
    try {
      raw = await evaluatePolicyConcern(ctx, {
        engine: concern.policy.engine,
        policyDir: concern.dir,
        files: concern.policy.files,
        missingMessage: concern.policy.missingMessage
      })
    } catch (error) {
      if (error?.name === 'ToolProvisionError') return toolProvisionSkipResult(ctx, error)
      throw new DetectorError(ctx.ruleId, ctx.concernId, `policy-adapter кинув: ${error.message}`)
    }
    return normalizeResult(raw, ctx)
  }

  if (!existsSync(mainPath)) {
    // Дефект з сесії 2026-08-26 (§2.38): `builtin-pins.json` відсутній (репо-дерево
    // без локальної wasm-збірки, `.gitignore`) → `resolveWasmConcernMap` мовчки
    // повертає порожню мапу (доккомент `hasBuiltinPinsArtifact`) → для ПОРТОВАНИХ
    // у wasm concern-ів (яким `main.mjs` видалено під час міграції) диспатч
    // провалюється сюди і повідомлення називало наслідок («немає main.mjs»), а не
    // причину. Тут неможливо відрізнити «concern портовано у wasm, артефакт не
    // зібраний» від «concern справді зламаний» (для другого випадку стара коротка
    // фраза лишається правильною) — тому підказка лише ДОПОВНЮЄ повідомлення
    // умовним «якщо портовано», а не замінює його (заміна брехала б у другому
    // випадку). Коли `builtin-pins.json` присутній, причина explicitly НЕ в
    // відсутній збірці — підказку не додаємо, щоб не шуміти невлучним натяком.
    const detail = hasBuiltinPinsArtifact()
      ? 'немає main.mjs'
      : 'немає main.mjs (якщо цей концерн портовано у wasm-плагін — перевірте npm/wasm-plugins/builtin-pins.json: файл відсутній; згенеруйте його: node npm/scripts/build-wasm-plugins.mjs)'
    throw new DetectorError(ctx.ruleId, ctx.concernId, detail)
  }
  let mod
  try {
    // file:// URL — інакше відносний шлях трактується як bare package specifier
    // eslint-disable-next-line no-unsanitized/method
    mod = await import(pathToFileURL(mainPath).href)
  } catch (error) {
    throw new DetectorError(ctx.ruleId, ctx.concernId, `import впав: ${error.message}`)
  }
  if (typeof mod.lint !== 'function') {
    throw new DetectorError(ctx.ruleId, ctx.concernId, 'main.mjs не експортує lint(ctx)')
  }
  let raw
  try {
    raw = await mod.lint(ctx)
  } catch (error) {
    if (error?.name === 'ToolProvisionError') return toolProvisionSkipResult(ctx, error)
    throw new DetectorError(ctx.ruleId, ctx.concernId, `lint() кинув: ${error.message}`)
  }
  return normalizeResult(raw, ctx)
}
