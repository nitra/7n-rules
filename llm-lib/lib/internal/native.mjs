/**
 * Loader napi-аддона `llm-lib` (Rust-ядро `llm-lib/crates/llm-lib-napi`
 * → `llm-lib`) — за зразком `mt/npm/lib/core/native.mjs`.
 *
 * Порядок пошуку (залежить від оточення — див. [`isSourceTree`]):
 *   1. N_LLM_LIB_NATIVE_ADDON — явний override шляху до аддона (dev / CI / тести).
 *   2. **Лише у вихідному дереві** (`<repoRoot>/llm-lib/crates/llm-lib-napi/Cargo.toml`
 *      існує): локальна збірка `<repoRoot>/target/release|debug/` (сирий cdylib
 *      з `cargo build -p llm-lib-napi`) та вивід `napi build` у
 *      `llm-lib/crates/llm-lib-napi/`.
 *   3. Platform-підпакет `@7n/llm-lib-<platform>-<arch>` (napi-артефакт
 *      `llm-lib-napi.<triple>.node`).
 *   4. Той самий fallback на локальну збірку поза вихідним деревом
 *      (у продакшені поведінка така сама, як до фіксу).
 *   5. Інакше — зрозуміла помилка з підказкою.
 *
 * ЧОМУ порядок різний (симетрично до `npm/scripts/lib/native.mjs`, фікс
 * 2026-08-03): у репо локальний `cargo build -p llm-lib-napi` мовчки
 * перекривався опублікованим підпакетом із `node_modules` — правки Rust-ядра
 * не проявлялися, а «фейли LLM-контуру» діагностувалися як помилки коду.
 * У користувача ж підпакет — єдине авторитетне джерело (запінений lockstep до
 * версії `@7n/llm-lib`), тож сторонній `target/` поруч не має його перебивати.
 *
 * Аддон завантажується через `process.dlopen` — працює і для `.node`, і для
 * сирих cdylib (`.dylib`/`.so`). Результат кешується (одне завантаження на процес).
 * Без JS-fallback на неоголошеній платформі — hard error, свідома межа v1
 * (darwin-arm64, linux-x64), не регресія.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process, { arch as osArch, env as procEnv, platform as osPlatform } from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
/** Корінь репо: llm-lib/lib/internal → up 3. */
const REPO_ROOT = join(HERE, '..', '..', '..')

/** Підтримувані platform-arch → napi-суфікс артефакта (v1: darwin-arm64, linux-x64). */
const NAPI_SUFFIXES = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu'
}

/** @type {Record<string, unknown> | null} */
let cached = null

/**
 * Завантажує аддон за шляхом через process.dlopen.
 * @param {string} p шлях до .node / .dylib / .so
 * @returns {Record<string, unknown>} exports аддона
 */
function dlopenAddon(p) {
  const mod = { exports: {} }
  process.dlopen(mod, p)
  return mod.exports
}

/**
 * Ім'я cdylib-файлу для платформи (вивід `cargo build -p llm-lib-napi`).
 * @param {string} platform process.platform
 * @returns {string} ім'я бібліотеки
 */
function cdylibName(platform) {
  return platform === 'darwin' ? 'libllm_lib_napi.dylib' : 'libllm_lib_napi.so'
}

/**
 * Чи запущено loader із вихідного дерева репо (dev-машина або CI), а не з
 * встановленого пакета `@7n/llm-lib`. Маркер — `llm-lib/crates/llm-lib-napi/Cargo.toml`
 * поруч із `repoRoot`: у репо він закомічений завжди, а `files` пакета
 * (`bin`, `lib`, …) `crates/` не відвантажує — у проді маркера немає.
 * @param {string} repoRoot корінь, від якого рахуються кандидати
 * @param {(p: string) => boolean} exists перевірка існування (ін'єкція для тестів)
 * @returns {boolean} true — вихідне дерево репо
 */
function isSourceTree(repoRoot, exists) {
  return exists(join(repoRoot, 'llm-lib', 'crates', 'llm-lib-napi', 'Cargo.toml'))
}

/**
 * Кандидати локальної збірки: сирий cdylib з `cargo build -p llm-lib-napi`
 * (release перед debug) і вивід `napi build` у `llm-lib/crates/llm-lib-napi/`.
 * @param {string} repoRoot корінь, від якого рахуються шляхи
 * @param {string} platform process.platform
 * @param {string|undefined} suffix napi-суфікс платформи
 * @returns {string[]} шляхи кандидатів у порядку пріоритету
 */
function localBuildCandidates(repoRoot, platform, suffix) {
  const candidates = Array.from(['release', 'debug'], profile =>
    join(repoRoot, 'target', profile, cdylibName(platform))
  )
  if (suffix) {
    candidates.push(join(repoRoot, 'llm-lib', 'crates', 'llm-lib-napi', `llm-lib-napi.${suffix}.node`))
  }
  return candidates
}

/**
 * Помилка «немає збірки» з підказкою і причиною останньої невдачі.
 * @param {string} key `${platform}-${arch}`
 * @param {string} lastError текст останньої помилки dlopen (може бути порожнім)
 * @returns {Error} готова помилка
 */
function missingAddonError(key, lastError) {
  const tail = lastError ? ` Остання спроба — ${lastError}.` : ''
  return new Error(
    `llm-lib native addon: немає збірки для "${key}". ` +
      `Постав N_LLM_LIB_NATIVE_ADDON=/шлях/до/аддона, додай підпакет @7n/llm-lib-${key}, ` +
      `або збери локально: cargo build --release -p llm-lib-napi.${tail}`
  )
}

/**
 * Ланцюг кандидатів аддона в порядку пріоритету.
 *
 * Повертає СПИСОК, а не один шлях, свідомо: `existsSync` — не доказ, що аддон
 * завантажиться (файл може бути з іншої платформи, побитий, або `existsSync`
 * підмінений моком у тесті, що не має до аддона стосунку — саме так
 * `gen-tests.test.mjs` валив увесь контур). Остаточний вибір робить
 * [`loadNative`], пробуючи кандидатів по черзі.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: string,
 *   arch?: string,
 *   existsSync?: (p: string) => boolean,
 *   requireResolve?: (id: string) => string,
 *   repoRoot?: string
 * }} [deps] ін'єкції для тестів
 * @returns {string[]} шляхи в порядку пріоритету (може бути порожнім)
 */
export function nativeAddonChain(deps = {}) {
  const env = deps.env ?? procEnv
  const platform = deps.platform ?? osPlatform
  const arch = deps.arch ?? osArch
  const exists = deps.existsSync ?? existsSync
  const requireResolve = deps.requireResolve ?? (id => require.resolve(id))
  const repoRoot = deps.repoRoot ?? REPO_ROOT

  // Явний override — єдине джерело: якщо він заданий і не вантажиться,
  // мовчазний відкат приховав би саме те, що просили перевірити.
  const override = env.N_LLM_LIB_NATIVE_ADDON
  if (override) return [override]

  const key = `${platform}-${arch}`
  const suffix = NAPI_SUFFIXES[key]

  // Маркер вихідного дерева перевіряється ПЕРШИМ — саме він обирає порядок
  // джерел, тож рахувати його після кандидатів було б плутаниною (і ламало б
  // гейт на порядок звернень до fs).
  const fromSource = isSourceTree(repoRoot, exists)
  const local = localBuildCandidates(repoRoot, platform, suffix).filter(p => exists(p))

  /** @type {string[]} */
  let subpackage = []
  if (suffix) {
    try {
      subpackage = [requireResolve(`@7n/llm-lib-${key}/llm-lib-napi.${suffix}.node`)]
    } catch {
      // не встановлено — лишається лише локальна збірка
    }
  }

  // Вихідне дерево (dev / CI цього репо): локальна збірка попереду, інакше
  // свіжий `cargo build -p llm-lib-napi` мовчки перекривався б підпакетом.
  // У проді порядок зворотний — підпакет запінений і авторитетний.
  return fromSource ? [...local, ...subpackage] : [...subpackage, ...local]
}

/**
 * Резолвить шлях до napi-аддона `llm-lib` — перший кандидат ланцюга
 * [`nativeAddonChain`]. Фактичний вибір з урахуванням невдалих dlopen
 * робить [`loadNative`].
 * @param {Parameters<typeof nativeAddonChain>[0]} [deps] ін'єкції для тестів
 * @returns {string} шлях до файлу аддона
 */
export function resolveNativeAddon(deps = {}) {
  const chain = nativeAddonChain(deps)
  if (chain.length === 0) {
    const key = `${deps.platform ?? osPlatform}-${deps.arch ?? osArch}`
    throw missingAddonError(key, '')
  }
  return chain[0]
}

/**
 * Кешований доступ до аддона (одне завантаження на процес).
 * @param {{
 *   resolve?: () => string,
 *   resolveChain?: () => string[],
 *   dlopen?: (p: string) => Record<string, unknown>
 * }} [deps] ін'єкції
 * @returns {Record<string, unknown>} exports аддона (oneShotAcp, resolveModel, oneShotLocalCloud)
 */
export function loadNative(deps = {}) {
  if (cached === null) {
    const dlopen = deps.dlopen ?? dlopenAddon
    const chain = deps.resolve ? [deps.resolve()] : (deps.resolveChain ?? nativeAddonChain)()

    /** @type {Record<string, unknown> | null} */
    let addon = null
    let lastError = ''
    for (const candidate of chain) {
      try {
        addon = dlopen(candidate)
        break
      } catch (error) {
        lastError = `${candidate}: ${error.message}`
      }
    }
    if (addon === null) throw missingAddonError(`${osPlatform}-${osArch}`, lastError)
    cached = addon
  }
  return cached
}
