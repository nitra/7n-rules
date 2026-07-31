/**
 * Резолвер wasm-плагінів plugin contract v3 (`n-rules:plugin@3.0.0`, задача K
 * фази 6 + N1, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
 * §3.3/§3.4) — читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо, для
 * кожного запису питає napi-міст `wasmPluginManifest()` (`crates/rules-napi`)
 * і будує мапу «ключ концерну (`ruleId/concernId`) → `{ wasmPath, toolPaths }`»
 * (значення — НЕ голий рядок шляху, доккомент [`buildWasmConcernMap`] нижче).
 *
 * **Run-tool контур (задача N1, рішення Д спеки)**: `manifest.tools` —
 * задекларовані зовнішні tool-залежності плагіна (напр. `"shellcheck@^0.9"`).
 * Для кожного запису резолвер кличе ensure-tool контур (`ensureToolAsync`,
 * `../ensure-tool.mjs`, injectable через `opts.ensureToolFn`) — будує мапу
 * «ім'я тула (без semver-суфікса декларації) → абсолютний шлях», яку
 * `run_wasm_concern` (napi) перетворює на host-бічний `ToolResolver`
 * (`crates/rules-plugin-host/src/tool_resolver.rs`). Тул, якого ensure-tool
 * не знає (немає в `TOOLS`-реєстрі) чи не зміг поставити (мережа,
 * rate-limit) — `console.warn`, ПРОПУСКАЄТЬСЯ з мапи (skip-not-crash на
 * рівні ОДНОГО tool-у, не плагіна) — виклик `run-tool` у самому
 * wasm-компоненті просто отримає типізовану помилку в `tool-output`
 * (`ToolResolver::run`, доккомент host-боку), не крашиться.
 *
 * Формат конфігу — дві форми запису (schema `npm/schemas/n-rules.json`):
 * ```json
 * "wasmPlugins": [
 *   { "name": "lang-js", "path": "./target/wasm32-wasip2/release/plugin_lang_js.wasm" },
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
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { ensureToolAsync } from '../ensure-tool.mjs'
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

/**
 * @typedef {object} WasmConcernMapEntry одне значення резолвленої мапи концернів (задача N1)
 * @property {string} wasmPath абсолютний шлях до `.wasm`-компонента, що реалізує цей концерн
 * @property {Record<string, string>} toolPaths ім'я тула (без semver-суфікса декларації) → абсолютний шлях,
 *   забезпечений ensure-tool контуром для `manifest.tools` цього плагіна (може бути порожнім `{}`)
 */

/** Валідний sha256-hex: рівно 64 hex-символи (нижній регістр — той самий канон, що git/npm-lockfile hash-и). */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/**
 * Мапа «ключ концерну → [`WasmConcernMapEntry`]», один на процес (той самий
 * мотив, що `nativeConcernKeys` у `detect.mjs`) — резолв конфігу, retrieval,
 * `wasmPluginManifest()` і ensure-tool контур виконуються раз. Зберігаємо
 * `Promise`, не готовий результат: конкурентні виклики до завершення першого
 * резолву переюзають той самий in-flight запит (доккомент модуля).
 * @type {Promise<Map<string, WasmConcernMapEntry>> | null}
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
 * @param {Record<string, string | undefined>} env джерело env-змінних (ін'єкція для тестів)
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
  const tmpPath = join(cacheDir, `.tmp-${process.pid}-${randomUUID()}`)
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
 * @param {{cwd: string, fetchFn: typeof fetch, cacheDir: string, env: Record<string, string | undefined>}} ctx ін'єктовані залежності
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
 * Ім'я тула без semver-суфікса декларації (`"shellcheck@^0.9"` → `"shellcheck"`)
 * — той самий парсинг, що host-бік `ToolResolver::run`
 * (`crates/rules-plugin-host/src/tool_resolver.rs`, доккомент модуля
 * пояснює версійну політику — вона НЕ тут, ensure-tool ставить канонічну
 * закріплену версію).
 * @param {string} declared запис із `manifest.tools`
 * @returns {string} ім'я тула
 */
function toolName(declared) {
  return declared.split('@', 1)[0]
}

/**
 * Забезпечує наявність кожного задекларованого tool-у плагіна через
 * ensure-tool контур (задача N1, рішення Д спеки). Тул, якого ensure-tool
 * не знає (немає в `TOOLS`-реєстрі `ensure-tool.mjs`) чи не зміг поставити
 * (мережа, rate-limit, hard-fail під `N_CURSOR_NO_AUTO_INSTALL`) —
 * `console.warn`, ПРОПУСКАЄТЬСЯ з результуючої мапи (skip-not-crash на рівні
 * ОДНОГО tool-у, не плагіна загалом) — плагін і решта його tools лишаються
 * робочими; виклик `run-tool` у самому wasm-компоненті для ЦЬОГО tool-у
 * просто отримає типізовану помилку в `tool-output`
 * (`ToolResolver::run`), не крашиться.
 * @param {string} pluginName ім'я плагіна (лише для diagnostics-повідомлень)
 * @param {string[]} declaredTools `manifest.tools` — рядки виду `"shellcheck@^0.9"`
 * @param {(toolId: string) => Promise<string>} ensureToolFn ін'єкція `ensureToolAsync` (тести підміняють)
 * @returns {Promise<Record<string, string>>} ім'я тула (без semver-суфікса) → абсолютний шлях
 */
async function ensureDeclaredTools(pluginName, declaredTools, ensureToolFn) {
  /** @type {Record<string, string>} */
  const toolPaths = {}
  for (const declared of declaredTools) {
    const name = toolName(declared)
    try {
      toolPaths[name] = await ensureToolFn(name)
    } catch (error) {
      console.warn(
        `⚠️ wasm-плагін "${pluginName}": tool "${name}" (${declared}) не забезпечено ensure-tool контуром — ${error.message}. ` +
          'run-tool для цього tool-у поверне типізовану помилку в tool-output (плагін працює далі)'
      )
    }
  }
  return toolPaths
}

/**
 * Будує мапу «ключ концерну → [`WasmConcernMapEntry`]» — один прохід по
 * валідних записах конфігу: resolve шляху (dev/`url`-retrieval) →
 * `wasmPluginManifest()` (повний DTO, не лише `concerns`) → ensure-tool
 * контур для `manifest.tools` → запис у мапу для кожного `manifest.concerns`.
 * Усі кроки — skip-not-crash (доккомент модуля).
 * @param {string} cwd абсолютний корінь consumer-репо
 * @param {{fetchFn: typeof fetch, cacheDir: string, env: Record<string, string | undefined>, ensureToolFn: (toolId: string) => Promise<string>, nativeFn: typeof loadNative}} ctx ін'єктовані залежності
 * @returns {Promise<Map<string, WasmConcernMapEntry>>} ключ концерну → `{ wasmPath, toolPaths }`
 */
async function buildWasmConcernMap(cwd, ctx) {
  const map = new Map()
  for (const entry of readWasmPluginsConfig(cwd)) {
    const wasmPath = await resolveEntryPath(entry, { cwd, ...ctx })
    if (wasmPath === null) continue
    let manifest
    try {
      manifest = ctx.nativeFn().wasmPluginManifest(wasmPath)
    } catch (error) {
      console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: не вдалось завантажити (${error.message})`)
      continue
    }
    const toolPaths = await ensureDeclaredTools(entry.name, manifest.tools ?? [], ctx.ensureToolFn)
    // `manifest.concerns` — масив структурованих контрибуцій `{ key, scope, glob }`
    // (задача N2, передумова full-scope мосту, доккомент `wit/world.wit`
    // `record concern-contribution`), не голі рядки — мапа концернів індексується
    // за `.key`, `scope`/`glob` тут не потрібні (їх читає `run_wasm_concern`
    // (napi) напряму з `describe()`, коли виклик не передав `files`).
    for (const contribution of manifest.concerns ?? []) map.set(contribution.key, { wasmPath, toolPaths })
  }
  return map
}

/**
 * Лениво резолвить мапу «ключ концерну → [`WasmConcernMapEntry`]» з секції
 * `wasmPlugins` (доккомент модуля). Плагін з відсутнім/битим `.wasm`, недосяжним
 * `url`, sha256-mismatch чи `describe()`, що кидає — пропускається з
 * `console.warn`, не валить резолв решти плагінів.
 *
 * `async` — retrieval канонічного піна (`url`+`sha256`) і ensure-tool контур
 * неминуче асинхронні; єдиний виклик-сайт (`detect.mjs`) вже `async`,
 * контракт виклику не ламається.
 * @param {string} cwd абсолютний корінь consumer-репо (звідки читається `.n-rules.json`)
 * @param {{fetchFn?: typeof fetch, cacheDir?: string, env?: Record<string, string | undefined>, ensureToolFn?: (toolId: string) => Promise<string>, nativeFn?: typeof loadNative}} [opts] ін'єкції для тестів:
 *   `fetchFn` (дефолт — глобальний `fetch`), `cacheDir` (дефолт — `resolvePluginCacheDir`), `env` (дефолт — `process.env`),
 *   `ensureToolFn` (дефолт — `ensureToolAsync`), `nativeFn` (дефолт — `loadNative`, wiring-тести підміняють фейковим addon-ом)
 * @returns {Promise<Map<string, WasmConcernMapEntry>>} ключ концерну (`ruleId/concernId`) → `{ wasmPath, toolPaths }`
 */
export function resolveWasmConcernMap(cwd, opts = {}) {
  if (wasmConcernMapPromise !== null) return wasmConcernMapPromise
  const env = opts.env ?? process.env
  const ctx = {
    fetchFn: opts.fetchFn ?? fetch,
    cacheDir: opts.cacheDir ?? resolvePluginCacheDir(env),
    env,
    ensureToolFn: opts.ensureToolFn ?? ensureToolAsync,
    nativeFn: opts.nativeFn ?? loadNative
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
