/**
 * Резолвер wasm-плагінів plugin contract v3 (`n-rules:plugin@3.0.0`, задача K
 * фази 6, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
 * §3.3/§3.4) — читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо, для
 * кожного запису питає napi-міст `wasmPluginConcerns()` (`crates/rules-napi`)
 * і будує мапу «ключ концерну (`ruleId/concernId`) → абсолютний шлях `.wasm`».
 *
 * Формат конфігу — дві форми запису (schema `npm/schemas/n-rules.json`):
 * ```json
 * "wasmPlugins": [
 *   { "name": "lang-js-pilot", "path": "./target/wasm32-wasip2/release/plugin_lang_js_pilot.wasm" },
 *   { "name": "acme-plugin", "url": "https://…/plugin.wasm", "sha256": "…64 hex…" }
 * ]
 * ```
 * `path` — dev-петля: repo-relative чи абсолютний шлях до вже зібраного
 * `.wasm`, без завантаження й без hash-перевірки. Дозволена лише поза CI
 * (`env.CI` truthy) — у CI dev-шлях пропускається з warn (спека §3.4: «`file:`
 * без hash-перевірки — лише поза CI»); детермінований CI-прогін мусить
 * резолвити канонічний пін.
 *
 * `url`+`sha256` — канонічний пін дистрибуції (спека §3.4, рішення Ж).
 * Retrieval-модель, дзеркало `ensure-tool.mjs` (`getCacheDir`/`installFromGithub`):
 * 1. Кеш-файл `<cacheDir>/<sha256>.wasm` (`cacheDir` — конвенція `ensure-tool.mjs`,
 *    `~/.cache/@7n/rules/plugins/` на macOS/Linux, `%LOCALAPPDATA%\@7n\rules\plugins\`
 *    на Windows; `N_RULES_PLUGIN_CACHE_DIR` — explicit override, читається першим
 *    для ізоляції тестів).
 * 2. Кеш-хіт — це `existsSync` **І** реальний sha256 вмісту файлу збігається з
 *    очікуваним (ім'я файлу — не єдина довіра: підмінений/пошкоджений вміст під
 *    правильним ім'ям має тригерити перезавантаження, не мовчазний dispatch у
 *    зіпсований wasm).
 * 3. Кеш-промах чи пошкоджений кеш → `fetchFn(url)` (глобальний `fetch`,
 *    ін'єкція для тестів), sha256 завантаженого вмісту (`node:crypto`)
 *    звіряється з очікуваним.
 * 4. Mismatch після завантаження → skip-not-crash `console.warn`, запис НЕ
 *    кешується (наступний прогін завантажує знову, не застрягає на битому пін-і).
 * 5. Збіг → атомарний запис у кеш: tmp-файл у тому ж `cacheDir` (той самий
 *    filesystem — без EXDEV на `renameSync`) + `renameSync` на фінальне ім'я,
 *    той самий патерн, що `installFromGithub` у `ensure-tool.mjs`.
 *
 * TODO(v3-wasm-first-party-pins): вбудована таблиця `name → url + sha256` для
 * власних плагінів (спека §3.4, рішення Н) — прийде з першим published
 * плагіном; до того ручний пін у `.n-rules.json` обов'язковий для будь-якого
 * плагіна.
 *
 * Свідомо ОКРЕМА секція від `plugins` (масив npm-імен Plugin API v2,
 * `npm/scripts/lib/resolve-plugins.mjs`) — той ключ уже зайнятий закритим
 * контрактом (schema `npm/schemas/n-rules.json`, читачі
 * `read-n-rules-config-lite.mjs`/`resolve-plugins.mjs`/`n-rules-cli.mjs`),
 * перевикористання зламало б і schema-валідацію (v8r), і мовчазно відфільтрувало б
 * записи в чинних читачах (`typeof p === 'string'`).
 *
 * Skip-not-crash (спека §3.3, рішення З): запис із відсутнім/битим `.wasm`,
 * недосяжним `url` чи sha256-mismatch ніколи не кидає — пропускається з
 * warn-попередженням, `runConcernDetector` (`detect.mjs`) падає назад на
 * `main.mjs`, якщо той існує для того самого concern-а (перехідне поводження,
 * задокументоване там же).
 *
 * Резолв — `async` (fetch за мережею неминуче асинхронний); єдиний виклик-сайт
 * (`detect.mjs`, `runConcernDetector`) вже `async`-функція, контракт виклику
 * не ламається — просто додається `await`. Модульний кеш зберігає `Promise`
 * (не готову `Map`), щоб конкурентні виклики до завершення першого резолву
 * (декілька concern-ів стартують паралельно) переюзали той самий in-flight
 * запит замість дублювання fetch/IO.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { loadNative } from '../native.mjs'

/**
 * @typedef {object} WasmPluginPathEntry dev-форма піна (спека §3.4, лише поза CI)
 * @property {string} name ідентифікатор плагіна (лише для diagnostics-повідомлень)
 * @property {string} path repo-relative (від `cwd`) чи абсолютний шлях до `.wasm`
 */

/**
 * @typedef {object} WasmPluginUrlEntry канонічний hash-пін дистрибуції (спека §3.4, рішення Ж)
 * @property {string} name ідентифікатор плагіна (лише для diagnostics-повідомлень)
 * @property {string} url джерело завантаження `.wasm` (GitHub Releases/OCI/npm-дзеркало/…, транспорт-агностично)
 * @property {string} sha256 очікуваний sha256-hex (64 символи) вмісту `.wasm`
 */

/** @typedef {WasmPluginPathEntry | WasmPluginUrlEntry} WasmPluginConfigEntry */

/** Валідний sha256-hex: рівно 64 hex-символи (нижній регістр — той самий канон, що git/npm-lockfile hash-и). */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/**
 * Мапа «ключ концерну → абсолютний шлях .wasm», один на процес (той самий
 * мотив, що `nativeConcernKeys` у `detect.mjs`) — резолв конфігу, retrieval і
 * `wasmPluginConcerns()` виконується раз. Зберігаємо `Promise`, не готовий
 * результат: конкурентні виклики до завершення першого резолву переюзають
 * той самий in-flight запит (доккомент модуля).
 * @type {Promise<Map<string, string>> | null}
 */
let wasmConcernMapPromise = null

/**
 * Чи є значення валідним записом `wasmPlugins` — АБО `{ name, path }`, АБО
 * `{ name, url, sha256 }` (`sha256` мусить бути валідним hex-рядком — інакше
 * запис відфільтровується тут же, до retrieval, той самий skip-not-crash дух,
 * що й для `{name,path}` без реального файлу).
 * @param {unknown} entry елемент масиву `wasmPlugins`
 * @returns {entry is WasmPluginConfigEntry} true — валідний запис
 */
function isValidEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return false
  const e = /** @type {Record<string, unknown>} */ (entry)
  if (typeof e.name !== 'string') return false
  if (typeof e.path === 'string') return true
  return typeof e.url === 'string' && typeof e.sha256 === 'string' && SHA256_HEX_RE.test(e.sha256)
}

/**
 * Читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо. Відсутній файл,
 * невалідний JSON чи відсутнє/невалідне поле — порожній масив (skip-not-crash,
 * той самий мотив, що читачі `plugins` v2).
 * @param {string} cwd абсолютний корінь consumer-репо
 * @returns {WasmPluginConfigEntry[]} валідні записи `wasmPlugins`
 */
function readWasmPluginsConfig(cwd) {
  const configPath = join(cwd, '.n-rules.json')
  if (!existsSync(configPath)) return []
  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return []
  }
  const entries = /** @type {{ wasmPlugins?: unknown }} */ (raw).wasmPlugins
  return Array.isArray(entries) ? entries.filter(entry => isValidEntry(entry)) : []
}

/**
 * sha256-hex вмісту буфера — єдина точка hashing-у в модулі (кеш-верифікація й
 * post-download звірка йдуть через цю ж функцію).
 * @param {Buffer | ArrayBuffer} bytes вміст для хешування
 * @returns {string} sha256-hex (64 символи, нижній регістр)
 */
function sha256Hex(bytes) {
  return createHash('sha256')
    .update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))
    .digest('hex')
}

/**
 * Кеш-директорія wasm-плагінів — та сама base-конвенція, що `getCacheDir` у
 * `ensure-tool.mjs` (`~/.cache/@7n/rules/…` mac/linux, `%LOCALAPPDATA%\@7n\rules\…`
 * win32), але окрема піддиректорія (`plugins`, не `bin` — бінарники тулів і
 * wasm-компоненти плагінів не змішуються). `N_RULES_PLUGIN_CACHE_DIR` —
 * explicit override, читається першим (ізоляція тестів, той самий мотив, що
 * `N_CURSOR_TOOL_CACHE_DIR` для тулів).
 * @param {NodeJS.ProcessEnv} env джерело env-змінних (ін'єкція для тестів)
 * @returns {string} абсолютний шлях до кеш-директорії
 */
function resolvePluginCacheDir(env) {
  const override = env['N_RULES_PLUGIN_CACHE_DIR']
  if (override) return override
  if (process.platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, '@7n', 'rules', 'plugins')
  }
  return join(homedir(), '.cache', '@7n', 'rules', 'plugins')
}

/**
 * Читає кеш-файл і повертає його шлях, лише якщо реальний sha256 вмісту
 * збігається з очікуваним (доккомент модуля, п.2) — ім'я файлу саме по собі
 * не є довірою, підмінений/пошкоджений вміст під правильним ім'ям не має
 * тихо потрапити в диспатч wasmtime.
 * @param {string} cachePath абсолютний шлях кандидата в кеші (`<cacheDir>/<sha256>.wasm`)
 * @param {string} expectedSha256 очікуваний hash з конфігу
 * @returns {string | null} `cachePath`, якщо кеш валідний; інакше `null`
 */
function readValidCacheHit(cachePath, expectedSha256) {
  if (!existsSync(cachePath)) return null
  const cached = readFileSync(cachePath)
  return sha256Hex(cached) === expectedSha256 ? cachePath : null
}

/**
 * Атомарно публікує завантажені байти в кеш — tmp-файл у тому ж `cacheDir`
 * (спільний filesystem, без EXDEV на `renameSync`) + rename на фінальне ім'я,
 * той самий патерн, що `installFromGithub` у `ensure-tool.mjs`.
 * @param {string} cacheDir абсолютна кеш-директорія (створюється за потреби)
 * @param {string} cachePath фінальний абсолютний шлях (`<cacheDir>/<sha256>.wasm`)
 * @param {Buffer} bytes перевірений (sha256 звірено) вміст `.wasm`
 * @returns {void}
 */
function publishToCache(cacheDir, cachePath, bytes) {
  mkdirSync(cacheDir, { recursive: true })
  const tmpPath = join(cacheDir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  writeFileSync(tmpPath, bytes)
  renameSync(tmpPath, cachePath)
}

/**
 * Резолвить `.wasm`-шлях для `url`+`sha256`-запису (доккомент модуля,
 * retrieval-модель): кеш-хіт → без мережі; інакше `fetchFn(url)` + sha256-звірка
 * + атомарна публікація в кеш. Skip-not-crash на будь-якій аномалії (мережа,
 * не-2xx, mismatch) — `console.warn`, `null` (запис не потрапляє в мапу
 * концернів, кеш не чіпається).
 * @param {WasmPluginUrlEntry} entry запис `{name,url,sha256}`
 * @param {{fetchFn: typeof fetch, cacheDir: string}} ctx ін'єктовані залежності
 * @returns {Promise<string | null>} абсолютний шлях до валідного `.wasm` у кеші, або `null`
 */
async function resolveUrlEntry(entry, ctx) {
  const cachePath = join(ctx.cacheDir, `${entry.sha256}.wasm`)
  const cacheHit = readValidCacheHit(cachePath, entry.sha256)
  if (cacheHit !== null) return cacheHit

  /** @type {Response} */
  let response
  try {
    response = await ctx.fetchFn(entry.url)
  } catch (error) {
    console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: завантаження не вдалось (${error.message})`)
    return null
  }
  if (!response.ok) {
    console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: завантаження не вдалось (HTTP ${response.status})`)
    return null
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const actualSha256 = sha256Hex(bytes)
  if (actualSha256 !== entry.sha256) {
    console.warn(
      `⚠️ wasm-плагін "${entry.name}" пропущено: sha256 не збігається (очікував ${entry.sha256}, отримав ${actualSha256})`
    )
    return null
  }

  publishToCache(ctx.cacheDir, cachePath, bytes)
  return cachePath
}

/**
 * Резолвить `.wasm`-шлях одного запису `wasmPlugins` — dev-форма (`path`, лише
 * поза CI) чи канонічний пін (`url`+`sha256`, retrieval-модель doc-коментаря
 * модуля). `null` — запис пропущено (skip-not-crash), причина вже в `console.warn`.
 * @param {WasmPluginConfigEntry} entry валідний запис (після `isValidEntry`)
 * @param {{cwd: string, fetchFn: typeof fetch, cacheDir: string, env: NodeJS.ProcessEnv}} ctx ін'єктовані залежності
 * @returns {Promise<string | null>} абсолютний шлях `.wasm`, або `null`
 */
async function resolveEntryPath(entry, ctx) {
  if ('path' in entry) {
    // Спека §3.4: `file:`/repo-relative dev-пін без hash-перевірки — лише поза CI.
    if (ctx.env['CI']) {
      console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: path-пін недоступний у CI (лише поза CI, спека §3.4)`)
      return null
    }
    const wasmPath = resolve(ctx.cwd, entry.path)
    if (!existsSync(wasmPath)) {
      console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: файл не знайдено (${wasmPath})`)
      return null
    }
    return wasmPath
  }
  return resolveUrlEntry(entry, ctx)
}

/**
 * Будує мапу «ключ концерну → абсолютний шлях .wasm» — один прохід по
 * валідних записах конфігу, для кожного: resolve шляху (dev/`url`-retrieval),
 * потім `wasmPluginConcerns()`. Обидва кроки — skip-not-crash.
 * @param {string} cwd абсолютний корінь consumer-репо
 * @param {{fetchFn: typeof fetch, cacheDir: string, env: NodeJS.ProcessEnv}} ctx ін'єктовані залежності
 * @returns {Promise<Map<string, string>>} ключ концерну → абсолютний шлях `.wasm`
 */
async function buildWasmConcernMap(cwd, ctx) {
  const map = new Map()
  for (const entry of readWasmPluginsConfig(cwd)) {
    const wasmPath = await resolveEntryPath(entry, { cwd, ...ctx })
    if (wasmPath === null) continue
    let concerns
    try {
      concerns = loadNative().wasmPluginConcerns(wasmPath)
    } catch (error) {
      console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: не вдалось завантажити (${error.message})`)
      continue
    }
    for (const key of concerns) map.set(key, wasmPath)
  }
  return map
}

/**
 * Лениво резолвить мапу «ключ концерну → абсолютний шлях .wasm» з секції
 * `wasmPlugins` (доккомент модуля). Плагін з відсутнім/битим `.wasm`, недосяжним
 * `url`, sha256-mismatch чи `describe()`, що кидає — пропускається з
 * `console.warn`, не валить резолв решти плагінів.
 *
 * `async` — retrieval канонічного піна (`url`+`sha256`) неминуче мережевий;
 * єдиний виклик-сайт (`detect.mjs`) вже `async`, контракт виклику не ламається.
 * @param {string} cwd абсолютний корінь consumer-репо (звідки читається `.n-rules.json`)
 * @param {{fetchFn?: typeof fetch, cacheDir?: string, env?: NodeJS.ProcessEnv}} [opts] ін'єкції для тестів:
 *   `fetchFn` (дефолт — глобальний `fetch`), `cacheDir` (дефолт — `resolvePluginCacheDir`), `env` (дефолт — `process.env`)
 * @returns {Promise<Map<string, string>>} ключ концерну (`ruleId/concernId`) → абсолютний шлях `.wasm`
 */
export function resolveWasmConcernMap(cwd, opts = {}) {
  if (wasmConcernMapPromise !== null) return wasmConcernMapPromise
  const env = opts.env ?? process.env
  const ctx = {
    fetchFn: opts.fetchFn ?? fetch,
    cacheDir: opts.cacheDir ?? resolvePluginCacheDir(env),
    env
  }
  wasmConcernMapPromise = buildWasmConcernMap(cwd, ctx)
  return wasmConcernMapPromise
}

/**
 * Тестовий хук: скидає модульний кеш [`resolveWasmConcernMap`] — ізольовані
 * тести пишуть власний `.n-rules.json` на кожен `withTmpDir` і мають бачити
 * свіжий резолв, не кеш попереднього тесту.
 */
export function resetWasmConcernMapForTests() {
  wasmConcernMapPromise = null
}
