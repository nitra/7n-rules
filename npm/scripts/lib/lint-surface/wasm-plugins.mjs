/**
 * Резолвер wasm-плагінів plugin contract (`n-rules:plugin@4.0.0`, задача K
 * фази 6 + N1, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
 * §3.3/§3.4) — читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо, для
 * кожного запису питає napi-міст `wasmPluginManifest()` (`crates/rules-napi`)
 * і будує мапу «ключ концерну (`ruleId/concernId`) → `{ wasmPath, toolPaths }`»
 * (значення — НЕ голий рядок шляху, доккомент [`buildWasmConcernMaps`] нижче).
 *
 * **Run-tool контур (задача N1, рішення Д спеки)**: `manifest.tools` —
 * задекларовані зовнішні tool-залежності плагіна (напр. `"shellcheck@^0.9"`,
 * `"path:bun"`, `"npm:stylelint"` — схеми резолву, рішення В спеки
 * `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, [`parseToolRef`]).
 * Для кожного запису резолвер кличе ensure-tool контур (`ensureToolProvisioned`,
 * `../ensure-tool.mjs`, injectable через `opts.ensureToolFn`) — PATH → керований
 * кеш → hard-fail, БЕЗ авто-встановлення (той самий принцип, що вже застосований
 * до нативних concern-ів — `n-rules tools ensure` лишається явним запитом на
 * install, не побічним ефектом резолву wasm-плагіна) — будує мапу
 * «ім'я тула (без semver-суфікса декларації) → абсолютний шлях», яку
 * `run_wasm_concern` (napi) перетворює на host-бічний `ToolResolver`
 * (`crates/rules-plugin-host/src/tool_resolver.rs`). Тул, якого ensure-tool
 * не знає (немає в `TOOLS`-реєстрі), чи він не резолвиться ні з PATH, ні з
 * керованого кешу — `console.warn`, ПРОПУСКАЄТЬСЯ з мапи (skip-not-crash на
 * рівні ОДНОГО tool-у, не плагіна) — виклик `run-tool` у самому
 * wasm-компоненті просто отримає типізовану помилку в `tool-output`
 * (`ToolResolver::run`, доккомент host-боку), не крашиться.
 *
 * Формат конфігу — три явні форми запису (schema `npm/schemas/n-rules.json`),
 * плюс четверта вбудована (`builtin-pins.json`, розділ нижче):
 * ```json
 * "wasmPlugins": [
 *   { "name": "lang-js", "path": "./target/wasm32-wasip3/release/plugin_lang_js.wasm" },
 *   { "name": "acme-plugin", "url": "https://…/plugin.wasm", "sha256": "…64 hex…" },
 *   { "name": "acme-lock", "package": "acme:plugin", "requirement": "=1.2.0" }
 * ]
 * ```
 * `path` — dev-петля: repo-relative чи абсолютний шлях до вже зібраного
 * `.wasm`, без завантаження й без hash-перевірки. Дозволена лише поза CI
 * (`env.CI` truthy) — у CI dev-шлях пропускається з warn (спека §3.4: «`file:`
 * без hash-перевірки — лише поза CI»); детермінований CI-прогін мусить
 * резолвити канонічний пін.
 *
 * `package`+`requirement` — lock-пін (задача Д1 третьої колії дистрибуції,
 * спека `docs/specs/2026-09-01-wasm-plugin-lock-resolve.md`): резолв за
 * пакетною ідентичністю через `.oci-dist.lock` консюмера (формат дослівно
 * `oci_dist_oci::OciPluginLock`, `=0.3.1`), ЧИСТО з локального кешу — БЕЗ
 * мережі в JS ([`resolveLockEntryPath`]). Мережевий OCI-виклик, що заповнює
 * і lock, і кеш, живе виключно в `n-rules plugin fetch`
 * (`crates/rules-cli/src/plugin_cmd.rs`); кеш-промах чи відсутній
 * lock-запис — skip-not-crash `console.warn` із точною командою відновлення
 * (`n-rules plugin fetch --lock … --package … --requirement …`), НЕ авто-fetch.
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
 * **Вбудована таблиця first-party пінів** (задача O1 фази 6 v2, спека §3.4,
 * рішення Н): ТРЕТЄ, найнижче пріоритетне джерело записів `wasmPlugins` —
 * `npm/wasm-plugins/builtin-pins.json` (`readBuiltinPinsConfig`), поряд з
 * яким лежать самі `.wasm`-файли first-party плагінів. Формат:
 * `{ "<name>": { "file": "<basename>.wasm", "sha256": "<64 hex>" } }`.
 * Файл генерується `npm/scripts/build-wasm-plugins.mjs` (локальна dev-петля
 * й CI-крок `npm-publish.yml`) і НЕ комітиться в git — repo-дерево без
 * локальної збірки просто не має файлу (`readBuiltinPinsConfig` мовчить,
 * без `console.warn`, доккомент функції нижче). Записи `.n-rules.json`
 * консюмера з тим самим `name` ПОВНІСТЮ перекривають builtin-запис
 * (`mergeWithBuiltinEntries`) — ручний пін потрібен лише для власних/сторонніх
 * плагінів, не для first-party. sha256-звірка ОБОВ'ЯЗКОВА і для builtin-шляху
 * (`resolveEntryPath`, гілка `'file' in entry`) — той самий мотив, що й для
 * кеш-хіта канонічного піна нижче: захист від пошкодженої інсталяції пакету,
 * ім'я файлу саме по собі не є довірою.
 *
 * **Dispatch-shadowing первого first-party плагіна** (`plugin-lang-js`,
 * `crates/plugin-lang-js`, задача N2): щойно `npm/wasm-plugins/builtin-pins.json`
 * присутній (локальна збірка чи встановлений з npm пакет), builtin-запис
 * `lang-js` резолвиться БЕЗ жодного `.n-rules.json` від консюмера — його
 * контрибуції (`vue/tfm-translations`, `style/gap`) потрапляють у мапу цього
 * модуля автоматично. Диспатч `runConcernDetector` (`detect.mjs`) перевіряє
 * джерела в порядку native (`NATIVE_CONCERNS`) → wasm (ця мапа) → `main.mjs`/
 * policy — тобто для цих двох concern-ів wasm-реалізація ПЕРЕКРИВАЄ JS-реалізацію
 * `plugins/lang-js/rules/{vue/tfm-translations,style/gap}/main.mjs`, щойно
 * builtin-таблиця зібрана. Це свідома мета (перший real-виведення дублювання
 * реалізацій), НЕ помилка конфігурації. JS-реалізації в `plugins/lang-js`
 * фізично НЕ видаляються цією зміною: пакет `@7n/rules-lang-js` має споживачів
 * на старих `@7n/rules` без wasm-хоста (Plugin API v2), і лишається їхнім
 * єдиним шляхом — видалення дублікату заплановане окремим кроком, коли весь
 * плагін переїде на v3 (§3.5.6 спеки, виведення Plugin API v2). Консистентність
 * двох реалізацій (контрибуції, форма повідомлень) звіряють
 * `wasm-plugin-parity.test.mjs` (біт-у-біт `violations`) і
 * `wasm-builtin-pins.test.mjs` (контрибуції маніфесту ⊆ задекларованих).
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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureToolProvisioned } from '../ensure-tool.mjs'
import { loadNative } from '../native.mjs'
import { resolveCmd } from '../../utils/resolve-cmd.mjs'

/**
 * Абсолютний шлях до `npm/wasm-plugins/` — тека, куди `build-wasm-plugins.mjs`
 * (локальна dev-петля й CI, `npm-publish.yml`) кладе `.wasm`-файли first-party
 * плагінів і `builtin-pins.json` (задача O1, спека §3.4, рішення Н). Обчислено
 * від `import.meta.url` ЦЬОГО модуля, не `process.cwd()` — інваріант шляху
 * (`scripts/lib/lint-surface/` → вгору 3 рівні → `wasm-plugins/`) той самий і
 * в repo-дереві (`npm/scripts/lib/lint-surface/…`), і в installed-пакеті
 * (`node_modules/@7n/rules/scripts/lib/lint-surface/…`), бо `npm/` — корінь
 * опублікованого пакету (`npm/package.json` → `files`).
 */
const WASM_PLUGINS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'wasm-plugins')

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

/**
 * @typedef {object} WasmPluginLockEntry lock-пін (задача Д1, спека
 *   `docs/specs/2026-09-01-wasm-plugin-lock-resolve.md` §6) — резолв за
 *   пакетною ідентичністю через `.oci-dist.lock`, не за прямим транспортним
 *   адресом.
 * @property {string} name ідентифікатор плагіна (лише для diagnostics-повідомлень)
 * @property {string} package OCI-ідентичність пакета (`OciLockEntry.package`, напр. `"n-rules:lang-js"`)
 * @property {string} requirement точний `=X.Y.Z` (`OciLockEntry.requirement` — те саме M0-обмеження, що сам `oci-dist-oci` валідує)
 */

/** @typedef {WasmPluginPathEntry | WasmPluginUrlEntry | WasmPluginLockEntry} WasmPluginConfigEntry */

/**
 * @typedef {object} WasmPluginBuiltinEntry вбудований пін first-party плагіна з `builtin-pins.json` (задача O1, рішення Н)
 * @property {string} name ідентифікатор плагіна (ключ об'єкта в `builtin-pins.json`, лише для diagnostics)
 * @property {string} file basename `.wasm`-файлу поряд з `builtin-pins.json` у `npm/wasm-plugins/`
 * @property {string} sha256 очікуваний sha256-hex (64 символи) вмісту файлу
 */

/**
 * @typedef {object} WasmConcernMapEntry одне значення резолвленої мапи концернів (задача N1)
 * @property {string} wasmPath абсолютний шлях до `.wasm`-компонента, що реалізує цей концерн
 * @property {Record<string, string>} toolPaths ім'я тула (без semver-суфікса декларації) → абсолютний шлях,
 *   забезпечений ensure-tool контуром для `manifest.tools` цього плагіна (може бути порожнім `{}`)
 */

/** Валідний sha256-hex: рівно 64 hex-символи (нижній регістр — той самий канон, що git/npm-lockfile hash-и). */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/**
 * Валідний digest у формі `.oci-dist.lock` (`OciLockEntry.digest`,
 * `oci_dist_oci` `=0.3.1`) — префікс `sha256:` + 64 hex-символи. Відмінно
 * від [`SHA256_HEX_RE`] (гол hex, конвенція `url`+`sha256`-форми і
 * `builtin-pins.json`) навмисно: це поле дослівний DTO чужого крейта, не
 * наш формат, — переписувати його під наш канон означало б завести другий
 * lock-формат (задача Д1, спека `docs/specs/2026-09-01-wasm-plugin-lock-resolve.md`).
 */
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/**
 * Схема `.oci-dist.lock`, яку валідує сам `OciPluginLock::validate`
 * (`oci_dist_oci`, `graph.rs`) — читач тут звіряє те саме поле, щоб
 * несумісна майбутня схема впала гучним `warn`, а не мовчки віддала
 * структурно інший `packages`.
 */
const PLUGIN_LOCK_SCHEMA = 'nitra.plugin-lock/v1'

/**
 * Дефолтна назва lock-файлу (`oci_dist_oci::LOCK_FILE_NAME`) — крейт прямо
 * дозволяє консюмеру тримати іншу назву (доккомент константи в
 * `graph.rs`: «Consumers may keep their own historical file name»), але
 * `n-rules` дефолтить саме на цю, без вигаданого другого імені.
 */
const DEFAULT_PLUGIN_LOCK_FILE = '.oci-dist.lock'

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
 * Чи є значення валідним записом `wasmPlugins` — `{ name, path }` (dev),
 * `{ name, package, requirement }` (lock-пін, задача Д1) АБО
 * `{ name, url, sha256 }` (канонічний hash-пін; `sha256` мусить бути
 * валідним hex-рядком — інакше запис відфільтровується тут же, до
 * retrieval, той самий skip-not-crash дух, що й для `{name,path}` без
 * реального файлу). `requirement` для lock-форми мусить бути точним
 * `=X.Y.Z` — те саме M0-обмеження, що сам `oci-dist-oci` валідує
 * (`exact_requirement`, `graph.rs`); менш строга форма тут відфільтрувалась
 * би так само тихо, як невалідний `sha256`.
 * @param {unknown} entry елемент масиву `wasmPlugins`
 * @returns {entry is WasmPluginConfigEntry} true — валідний запис
 */
function isValidEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return false
  const e = /** @type {Record<string, unknown>} */ (entry)
  if (typeof e.name !== 'string') return false
  if (typeof e.path === 'string') return true
  if (typeof e.package === 'string' && typeof e.requirement === 'string') {
    return e.requirement.startsWith('=') && e.requirement.length > 1
  }
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
 * Читає `builtin-pins.json` — вбудовану таблицю first-party пінів (задача O1,
 * спека §3.4, рішення Н), третє й найнижче пріоритетне джерело `wasmPlugins`
 * (доккомент модуля). Генерується `npm/scripts/build-wasm-plugins.mjs`, НЕ
 * комітиться в git.
 *
 * Відсутність файлу — очікуваний стан repo-дерева без локальної wasm-збірки
 * (чи інсталяції з npm без цього кроку релізу): тиша, БЕЗ `console.warn`
 * (доккомент модуля). Пошкоджений (невалідний JSON чи не-об'єкт) файл — уже
 * аномалія, не "не зібрано": `console.warn` і порожній масив (skip-not-crash,
 * той самий дух, що читач `.n-rules.json` вище). Окремі записи з відсутнім
 * `file`/невалідним `sha256` — тихо відфільтровуються (той самий канон, що
 * `isValidEntry` для конфігу консюмера, без warn на рівні одного запису —
 * warn буде пізніше, при спробі резолву, якщо запис пройшов сюди коректним,
 * але файл/hash не зійшлись).
 * @param {string} builtinPinsDir абсолютний шлях до `npm/wasm-plugins/`
 *   (тестова ін'єкція — `resolveWasmConcernMap` opts.builtinPinsDir; дефолт
 *   у продакшн-виклику — [`WASM_PLUGINS_DIR`])
 * @returns {WasmPluginBuiltinEntry[]} валідні записи вбудованої таблиці
 */
function readBuiltinPinsConfig(builtinPinsDir) {
  const pinsPath = join(builtinPinsDir, 'builtin-pins.json')
  if (!existsSync(pinsPath)) return []
  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(readFileSync(pinsPath, 'utf8'))
  } catch (error) {
    console.warn(`⚠️ builtin-pins.json пошкоджено (невалідний JSON), вбудовані wasm-піни пропущено: ${error.message}`)
    return []
  }
  if (typeof raw !== 'object' || raw === null) return []
  /** @type {WasmPluginBuiltinEntry[]} */
  const entries = []
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue
    const v = /** @type {Record<string, unknown>} */ (value)
    if (typeof v.file !== 'string' || typeof v.sha256 !== 'string' || !SHA256_HEX_RE.test(v.sha256)) continue
    entries.push({ name, file: v.file, sha256: v.sha256 })
  }
  return entries
}

/**
 * Мержить вбудовані піни (найнижчий пріоритет) із записами `.n-rules.json`
 * консюмера — дедуплікація за `name`: запис консюмера з тим самим `name`, що
 * builtin-плагін, ПОВНІСТЮ перекриває builtin-запис (задача O1, рішення Н:
 * "ручні піни потрібні лише для власних/сторонніх плагінів" — перевизначення
 * дефолту, не додавання поруч нього).
 * @param {WasmPluginBuiltinEntry[]} builtinEntries записи [`readBuiltinPinsConfig`]
 * @param {WasmPluginConfigEntry[]} configEntries записи [`readWasmPluginsConfig`]
 * @returns {Array<WasmPluginConfigEntry | WasmPluginBuiltinEntry>} злитий список, консюмер виграє за `name`
 */
function mergeWithBuiltinEntries(builtinEntries, configEntries) {
  const byName = new Map(builtinEntries.map(entry => [entry.name, entry]))
  for (const entry of configEntries) byName.set(entry.name, entry)
  return byName.values().toArray()
}

/**
 * Абсолютний шлях lock-файлу консюмера (задача Д1, спека
 * `docs/specs/2026-09-01-wasm-plugin-lock-resolve.md` §5): `N_RULES_PLUGIN_LOCK_PATH`
 * — explicit override (той самий мотив ізоляції тестів, що `N_RULES_PLUGIN_CACHE_DIR`),
 * інакше [`DEFAULT_PLUGIN_LOCK_FILE`] у корені consumer-репо (`oci_dist_oci::LOCK_FILE_NAME`).
 * @param {string} cwd абсолютний корінь consumer-репо
 * @param {Record<string, string | undefined>} env джерело env-змінних (ін'єкція для тестів)
 * @returns {string} абсолютний шлях до lock-файлу
 */
function resolvePluginLockPath(cwd, env) {
  return env['N_RULES_PLUGIN_LOCK_PATH'] ?? join(cwd, DEFAULT_PLUGIN_LOCK_FILE)
}

/**
 * `package`+`requirement` → ключ пошуку в розпарсеному lock-файлі — один
 * канон ключа для читача й для резолву (доккомент модуля §Д1).
 * @param {string} pkg `OciLockEntry.package`
 * @param {string} requirement `OciLockEntry.requirement`
 * @returns {string} складений ключ
 */
function lockEntryKey(pkg, requirement) {
  return `${pkg}\u0000${requirement}`
}

/**
 * Читає й валідує `.oci-dist.lock` (задача Д1, формат дослівно
 * `oci_dist_oci::OciPluginLock`, схема [`PLUGIN_LOCK_SCHEMA`]) — той самий
 * skip-not-crash дух, що [`readBuiltinPinsConfig`]: відсутній файл — очікуваний
 * стан (консюмер ще не резолвив жодного lock-піна), тиша, `null`. Пошкоджений
 * JSON, невідома схема чи не-масив `packages` — вже аномалія: `console.warn`,
 * `null` (той самий предикат, що «нема жодного валідного піна», — виклик-сайт
 * не розрізняє «файлу нема» від «файл є, але зіпсований», обидва veдуть до
 * того самого skip-повідомлення на рівні запису нижче).
 * @param {string} lockPath абсолютний шлях до lock-файлу
 * @returns {Map<string, {package: string, requirement: string, digest: string}> | null} мапа `package\0requirement → запис`, або `null`
 */
function readPluginLock(lockPath) {
  if (!existsSync(lockPath)) return null
  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch (error) {
    console.warn(`⚠️ ${lockPath} пошкоджено (невалідний JSON), lock-піни пропущено: ${error.message}`)
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const r = /** @type {Record<string, unknown>} */ (raw)
  if (r.schema !== PLUGIN_LOCK_SCHEMA || !Array.isArray(r.packages)) {
    console.warn(
      `⚠️ ${lockPath}: невідома чи відсутня схема lock (очікується "${PLUGIN_LOCK_SCHEMA}"), lock-піни пропущено`
    )
    return null
  }
  const byKey = new Map()
  for (const entry of r.packages) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = /** @type {Record<string, unknown>} */ (entry)
    if (typeof e.package !== 'string' || typeof e.requirement !== 'string' || typeof e.digest !== 'string') continue
    if (!SHA256_DIGEST_RE.test(e.digest)) continue
    byKey.set(lockEntryKey(e.package, e.requirement), { package: e.package, requirement: e.requirement, digest: e.digest })
  }
  return byKey
}

/**
 * Резолвить абсолютний шлях lock-запису (задача Д1) — ЧИСТО з `.oci-dist.lock`
 * і локального кешу, БЕЗ мережі (доккомент модуля §Д1, розділ 4: мережевий
 * OCI-виклик живе виключно в `n-rules plugin fetch`, `crates/rules-cli`).
 * Кеш-хіт перевіряється тим самим [`readValidCacheHit`], що `url`+`sha256`-форма
 * — спільний кеш-неймспейс за вмістом (`<cacheDir>/<sha256-hex>.wasm`), не за
 * джерелом піна. Відсутній/пошкоджений lock, відсутній запис для
 * `package`+`requirement`, чи кеш-промах — skip-not-crash: `console.warn` із
 * точною командою відновлення, `null`.
 * @param {WasmPluginLockEntry} entry запис `{name,package,requirement}`
 * @param {{lockPath: string, cacheDir: string, readLockFn: typeof readPluginLock}} ctx ін'єктовані залежності
 * @returns {string | null} абсолютний шлях до валідного `.wasm` у кеші, або `null`
 */
function resolveLockEntryPath(entry, ctx) {
  const remedy = `n-rules plugin fetch --lock ${ctx.lockPath} --package ${entry.package} --requirement ${entry.requirement}`
  const lock = ctx.readLockFn(ctx.lockPath)
  if (lock === null) {
    console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: немає валідного lock-файлу (${ctx.lockPath}) — ${remedy}`)
    return null
  }
  const lockEntry = lock.get(lockEntryKey(entry.package, entry.requirement))
  if (lockEntry === undefined) {
    console.warn(
      `⚠️ wasm-плагін "${entry.name}" пропущено: немає запису "${entry.package}" "${entry.requirement}" у ${ctx.lockPath} — ${remedy}`
    )
    return null
  }
  const digestHex = lockEntry.digest.slice('sha256:'.length)
  const cachePath = join(ctx.cacheDir, `${digestHex}.wasm`)
  const cacheHit = readValidCacheHit(cachePath, digestHex)
  if (cacheHit === null) {
    console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: не закешовано (${cachePath}) — ${remedy}`)
    return null
  }
  return cacheHit
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
 * Резолвить абсолютний шлях builtin-запису (`readBuiltinPinsConfig`) —
 * файл уже локальний (бандл у пакеті чи локальна wasm-збірка), мережевий
 * retrieval не потрібен. sha256-звірка ОБОВ'ЯЗКОВА (доккомент модуля): захист
 * від пошкодженої інсталяції — підмінений/пошкоджений вміст під правильним
 * ім'ям не має тихо потрапити в dispatch wasmtime. `null` — пропуск
 * (skip-not-crash), причина вже в `console.warn`.
 * @param {WasmPluginBuiltinEntry} entry запис `{name,file,sha256}`
 * @param {string} builtinPinsDir абсолютний шлях до `npm/wasm-plugins/`
 * @returns {string | null} абсолютний шлях до валідного `.wasm`, або `null`
 */
function resolveBuiltinEntryPath(entry, builtinPinsDir) {
  const wasmPath = join(builtinPinsDir, entry.file)
  if (!existsSync(wasmPath)) {
    console.warn(
      `⚠️ builtin wasm-плагін "${entry.name}" пропущено: файл не знайдено (${wasmPath}) — пошкоджена інсталяція`
    )
    return null
  }
  const actualSha256 = sha256Hex(readFileSync(wasmPath))
  if (actualSha256 !== entry.sha256) {
    console.warn(
      `⚠️ builtin wasm-плагін "${entry.name}" пропущено: sha256 не збігається ` +
        `(очікував ${entry.sha256}, отримав ${actualSha256}) — пошкоджена інсталяція`
    )
    return null
  }
  return wasmPath
}

/**
 * Резолвить `.wasm`-шлях одного запису `wasmPlugins` — builtin first-party пін
 * (`file`+`sha256`, найнижчий пріоритет, доккомент модуля), dev-форма (`path`,
 * лише поза CI), lock-пін (`package`+`requirement`, задача Д1 — БЕЗ мережі,
 * [`resolveLockEntryPath`]) чи канонічний пін (`url`+`sha256`, retrieval-модель
 * doc-коментаря модуля). `null` — запис пропущено (skip-not-crash), причина
 * вже в `console.warn`.
 * @param {WasmPluginConfigEntry | WasmPluginBuiltinEntry} entry валідний запис
 *   (після `isValidEntry` для конфігу консюмера, чи з `readBuiltinPinsConfig`)
 * @param {{cwd: string, fetchFn: typeof fetch, cacheDir: string, env: Record<string, string | undefined>, builtinPinsDir: string, lockPath: string, readLockFn: typeof readPluginLock}} ctx ін'єктовані залежності
 * @returns {Promise<string | null>} абсолютний шлях `.wasm`, або `null`
 */
async function resolveEntryPath(entry, ctx) {
  if ('file' in entry) return resolveBuiltinEntryPath(entry, ctx.builtinPinsDir)
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
  if ('package' in entry && 'requirement' in entry) return resolveLockEntryPath(entry, ctx)
  // `await` тут не зайвий: він тримає функцію `async`, а отже — єдиний
  // `Promise<string|null>` контракт для ВСІХ гілок (builtin/dev/lock повертають
  // синхронні значення, url-гілка — проміс).
  return await resolveUrlEntry(entry, ctx)
}

/**
 * Схеми резолву тула в рядку `manifest.tools` (рішення В спеки
 * `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`). Дзеркало
 * Rust-боку (`rules_contract::validators::tool::ToolScheme`) — і саме
 * ДЗЕРКАЛО, а не незалежний список: розбіжність означала б, що маніфест,
 * прийнятий хостом, мовчки не резолвиться оркестрацією.
 */
const TOOL_SCHEMES = {
  /** Github-реліз із закріпленою версією (`TOOLS` + `tool-pins.json`) — дефолт за відсутності схеми. */
  PINNED: 'pinned',
  /** Резолв по `PATH` (`bun`, `bunx` — ensure-tool не вміє і не має їх завантажувати). */
  PATH: 'path',
  /**
   * `<cwd>/node_modules/.bin/<name>`, фолбек `PATH` (зріз 6 контракту v3.1):
   * `stylelint` — задекларована залежність npm-пакета плагіна
   * (`@7n/rules-lang-js`), тобто вже лежить у дереві консюмера після
   * `npm install`; тягнути його github-релізом було б і зайво, і неможливо.
   * Порядок резолву дослівно повторює `resolveStylelint` JS-канону
   * `style/lint` — саме тому схема окрема, а не «`path:` з фолбеком».
   */
  NPM: 'npm'
}

/**
 * Розбирає запис `manifest.tools` у `{ scheme, name }`: відрізає схему
 * (якщо є), потім semver-суфікс декларації (`"path:bun@^1.2"` →
 * `{ scheme: 'path', name: 'bun' }`). Порт
 * `rules_contract::validators::tool::parse_tool_ref` — дзеркальний тест
 * конвенції: `tests/wasm-plugins.test.mjs`.
 *
 * Невідома схема НЕ інтерпретується як частина імені: [`ensureDeclaredTools`]
 * пропускає такий запис із warn, бо резолвити його однаково нема чим (та
 * сама поведінка, що host-валідатор `validate_tool_ref`).
 * @param {string} declared запис із `manifest.tools`
 * @returns {{ scheme: string | null, name: string }} схема (`null` — невідома) й ім'я тула
 */
function parseToolRef(declared) {
  const separator = declared.indexOf(':')
  if (separator === -1) return { scheme: TOOL_SCHEMES.PINNED, name: declared.split('@', 1)[0] }
  const prefix = declared.slice(0, separator)
  const rest = declared.slice(separator + 1)
  if (!Object.values(TOOL_SCHEMES).includes(prefix)) return { scheme: null, name: declared }
  return { scheme: prefix, name: rest.split('@', 1)[0] }
}

/**
 * Забезпечує наявність кожного задекларованого tool-у плагіна через
 * ensure-tool контур (задача N1, рішення Д спеки). Тул, якого ensure-tool
 * не знає (немає в `TOOLS`-реєстрі `ensure-tool.mjs`) чи не резолвиться ні з
 * PATH, ні з керованого кешу (`ensureToolProvisioned` — БЕЗ авто-install,
 * remedy — `n-rules tools ensure`) — `console.warn`, ПРОПУСКАЄТЬСЯ з
 * результуючої мапи (skip-not-crash на рівні
 * ОДНОГО tool-у, не плагіна загалом) — плагін і решта його tools лишаються
 * робочими; виклик `run-tool` у самому wasm-компоненті для ЦЬОГО tool-у
 * просто отримає типізовану помилку в `tool-output`
 * (`ToolResolver::run`), не крашиться.
 * @param {string} pluginName ім'я плагіна (лише для diagnostics-повідомлень)
 * @param {string[]} declaredTools `manifest.tools` — рядки виду `"shellcheck@^0.9"`
 * @param {(toolId: string) => Promise<string>} ensureToolFn ін'єкція `ensureToolProvisioned` (тести підміняють)
 * @param {(cmd: string) => string | null} resolveCmdFn ін'єкція `resolveCmd` для схем `path:`/`npm:` (тести підміняють — інакше результат залежав би від PATH машини)
 * @param {string} cwd абсолютний корінь consumer-репо — база `node_modules/.bin` для схеми `npm:`
 * @returns {Promise<Record<string, string>>} ім'я тула (без semver-суфікса) → абсолютний шлях
 */
async function ensureDeclaredTools(pluginName, declaredTools, ensureToolFn, resolveCmdFn, cwd) {
  /** @type {Record<string, string>} */
  const toolPaths = {}
  for (const declared of declaredTools) {
    const { scheme, name } = parseToolRef(declared)
    try {
      if (scheme === null)
        throw new Error(
          `невідома схема резолву (відомі ${Object.values(TOOL_SCHEMES)
            .map(s => `"${s}:"`)
            .join(', ')})`
        )
      if (scheme === TOOL_SCHEMES.PATH) {
        // `path:` НЕ йде в ensure-tool контур узагалі: той уміє лише
        // github-релізи, а `bun`/`bunx` встановлює користувач. Відсутність —
        // не помилка резолву плагіна, а звичайний skip одного тула.
        const fromPath = resolveCmdFn(name)
        if (!fromPath) throw new Error('не знайдено в PATH')
        toolPaths[name] = fromPath
        continue
      }
      if (scheme === TOOL_SCHEMES.NPM) {
        // `npm:` — локальний `.bin` консюмера, потім PATH: дослівно
        // `resolveStylelint` JS-канону `style/lint`. Так само повз
        // ensure-tool контур (npm-залежність ставить `npm install`, не
        // github-реліз).
        const local = join(cwd, 'node_modules', '.bin', name)
        if (existsSync(local)) {
          toolPaths[name] = local
          continue
        }
        const fromPath = resolveCmdFn(name)
        if (!fromPath) throw new Error('немає ні в node_modules/.bin, ні в PATH')
        toolPaths[name] = fromPath
        continue
      }
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
 * Будує ДВІ мапи «ключ концерну → [`WasmConcernMapEntry`]» (детект-контрибуції
 * і fix-only, мажор `4.0.0`) — один прохід по
 * записах builtin-таблиці (найнижчий пріоритет) і конфігу консюмера, злитих
 * за `name` через [`mergeWithBuiltinEntries`] (доккомент модуля): resolve
 * шляху (builtin-файл/dev/`url`-retrieval) → `wasmPluginManifest()` (повний
 * DTO, не лише `concerns`) → ensure-tool контур для `manifest.tools` →
 * запис у мапу для кожного `manifest.concerns`. Усі кроки — skip-not-crash
 * (доккомент модуля).
 * @param {string} cwd абсолютний корінь consumer-репо
 * @param {{fetchFn: typeof fetch, cacheDir: string, env: Record<string, string | undefined>, ensureToolFn: (toolId: string) => Promise<string>, resolveCmdFn: (cmd: string) => string | null, nativeFn: typeof loadNative, builtinPinsDir: string}} ctx ін'єктовані залежності
 * @returns {Promise<{map: Map<string, WasmConcernMapEntry>, fixOnlyMap: Map<string, WasmConcernMapEntry>}>} `map` — контрибуції `concerns` (детект+fix), `fixOnlyMap` — `fixOnlyConcerns` (лише fix)
 */
async function buildWasmConcernMaps(cwd, ctx) {
  const map = new Map()
  const fixOnlyMap = new Map()
  const entries = mergeWithBuiltinEntries(readBuiltinPinsConfig(ctx.builtinPinsDir), readWasmPluginsConfig(cwd))
  for (const entry of entries) {
    const wasmPath = await resolveEntryPath(entry, { cwd, ...ctx })
    if (wasmPath === null) continue
    let manifest
    try {
      manifest = ctx.nativeFn().wasmPluginManifest(wasmPath)
    } catch (error) {
      console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: не вдалось завантажити (${error.message})`)
      continue
    }
    const toolPaths = await ensureDeclaredTools(
      entry.name,
      manifest.tools ?? [],
      ctx.ensureToolFn,
      ctx.resolveCmdFn,
      cwd
    )
    // `manifest.concerns` — масив структурованих контрибуцій
    // `{ key, scope, glob, fixGlob }` (задача N2 + мажор 4.0.0, доккомент
    // `wit/world.wit` `record concern-contribution`), не голі рядки — мапи
    // індексуються за `.key`, решта полів тут не потрібна (їх читає
    // `run_wasm_concern`/`run_wasm_concern_fix` (napi) напряму з `describe()`).
    for (const contribution of manifest.concerns ?? []) map.set(contribution.key, { wasmPath, toolPaths })
    // `manifest.fixOnlyConcerns` — ДРУГИЙ список (мажор `4.0.0`, §2.84):
    // плагін дає для цих ключів лише `fix`, детект лишається за чинною
    // реалізацією. Окрема мапа, а не прапорець у спільній: місце виклику
    // детекту (`detect.mjs`) фізично не бачить fix-only ключів, тож
    // «забути фільтр» тут неможливо — саме заради цього контракт і несе
    // два поля замість одного з предикатом.
    // Поле — snake_case: napi віддає `describe()` як є, серіалізований serde
    // (`serde_json::to_value(plugin.describe())`, `wasm_plugin_manifest`), без
    // camelCase-конверсії — так само, як уже читаються `concerns`/`tools`.
    if (!Array.isArray(manifest.fix_only_concerns)) {
      // Плагін контракту 4.x ЗАВЖДИ несе це поле (serde серіалізує його
      // безумовно). Відсутність = маніфест не з цього контракту; мовчазний
      // `?? []` тут приховав би саме той стан, який треба показати.
      console.warn(
        `⚠️ wasm-плагін "${entry.name}": маніфест без поля fix_only_concerns — fix-only контрибуції ` +
          'проігноровано (очікується контракт n-rules:plugin@4.x)'
      )
    } else {
      for (const contribution of manifest.fix_only_concerns)
        fixOnlyMap.set(contribution.key, { wasmPath, toolPaths })
    }
  }
  return { map, fixOnlyMap }
}

/**
 * Лениво резолвить мапу «ключ концерну → [`WasmConcernMapEntry`]» (детект +
 * fix) з секції
 * `wasmPlugins` (доккомент модуля). Плагін з відсутнім/битим `.wasm`, недосяжним
 * `url`, sha256-mismatch чи `describe()`, що кидає — пропускається з
 * `console.warn`, не валить резолв решти плагінів.
 *
 * `async` — retrieval канонічного піна (`url`+`sha256`) і ensure-tool контур
 * неминуче асинхронні; єдиний виклик-сайт (`detect.mjs`) вже `async`,
 * контракт виклику не ламається.
 * @param {string} cwd абсолютний корінь consumer-репо (звідки читається `.n-rules.json`)
 * @param {{fetchFn?: typeof fetch, cacheDir?: string, env?: Record<string, string | undefined>, ensureToolFn?: (toolId: string) => Promise<string>, resolveCmdFn?: (cmd: string) => string | null, nativeFn?: typeof loadNative, builtinPinsDir?: string, lockPath?: string, readLockFn?: typeof readPluginLock}} [opts] ін'єкції для тестів:
 *   `fetchFn` (дефолт — глобальний `fetch`), `cacheDir` (дефолт — `resolvePluginCacheDir`), `env` (дефолт — `process.env`),
 *   `ensureToolFn` (дефолт — `ensureToolProvisioned`), `resolveCmdFn` (дефолт — `resolveCmd`; тести підміняють, бо інакше
 *   схеми `path:`/`npm:` давали б різний `toolPaths` залежно від PATH машини), `nativeFn` (дефолт — `loadNative`, wiring-тести підміняють фейковим addon-ом),
 *   `builtinPinsDir` (дефолт — [`WASM_PLUGINS_DIR`], реальна `npm/wasm-plugins/`; тести ізолюють неіснуючим каталогом,
 *   щоб локальна wasm-збірка в робочому дереві не підмішувала builtin-контрибуції в контрольовані сценарії),
 *   `lockPath` (дефолт — [`resolvePluginLockPath`], задача Д1), `readLockFn` (дефолт — [`readPluginLock`]; тести
 *   підміняють, щоб перевірити резолв lock-піна без реального `.oci-dist.lock` на диску)
 * @returns {Promise<Map<string, WasmConcernMapEntry>>} ключ концерну (`ruleId/concernId`) → `{ wasmPath, toolPaths }`
 */
export async function resolveWasmConcernMap(cwd, opts = {}) {
  return (await resolveWasmConcernMaps(cwd, opts)).map
}

/**
 * Мапа концернів, для яких плагін дає ЛИШЕ `fix` (`manifest.fixOnlyConcerns`,
 * мажор контракту `4.0.0`, §2.84) — та сама форма значення, що
 * [`resolveWasmConcernMap`], але СПОЖИВАЄ її лише fix-контур
 * (`loadT0Patterns`, `run-fix.mjs`).
 *
 * Ключ звідси НЕ вмикає detect-шедоуїнг: `detect.mjs` цієї мапи не читає
 * взагалі, тож `main.mjs`/policy-детект концерну лишається чинним. Це і є
 * вся суть другого списку — до `4.0.0` єдиним способом дістати wasm-фікс
 * було оголосити концерн у `concerns`, що мовчки вимикало його детект.
 * @param {string} cwd абсолютний корінь consumer-репо
 * @param {Parameters<typeof resolveWasmConcernMap>[1]} [opts] ті самі ін'єкції, що {@link resolveWasmConcernMap}
 * @returns {Promise<Map<string, WasmConcernMapEntry>>} ключ концерну → `{ wasmPath, toolPaths }`
 */
export async function resolveWasmFixOnlyConcernMap(cwd, opts = {}) {
  return (await resolveWasmConcernMaps(cwd, opts)).fixOnlyMap
}

/**
 * Спільний ленивий резолв ОБОХ мап за один прохід по плагінах — окремі
 * `resolveWasmConcernMap`/`resolveWasmFixOnlyConcernMap` лише вибирають
 * половину результату. Один кеш-проміс на обидві: другий прохід означав би
 * повторний retrieval і повторний `describe()` кожного плагіна.
 * @param {string} cwd абсолютний корінь consumer-репо
 * @param {Parameters<typeof resolveWasmConcernMap>[1]} [opts] ін'єкції для тестів
 * @returns {Promise<{map: Map<string, WasmConcernMapEntry>, fixOnlyMap: Map<string, WasmConcernMapEntry>}>} обидві мапи
 */
function resolveWasmConcernMaps(cwd, opts = {}) {
  if (wasmConcernMapPromise !== null) return wasmConcernMapPromise
  const env = opts.env ?? process.env
  const ctx = {
    fetchFn: opts.fetchFn ?? fetch,
    cacheDir: opts.cacheDir ?? resolvePluginCacheDir(env),
    env,
    ensureToolFn: opts.ensureToolFn ?? ensureToolProvisioned,
    resolveCmdFn: opts.resolveCmdFn ?? resolveCmd,
    nativeFn: opts.nativeFn ?? loadNative,
    builtinPinsDir: opts.builtinPinsDir ?? WASM_PLUGINS_DIR,
    lockPath: opts.lockPath ?? resolvePluginLockPath(cwd, env),
    readLockFn: opts.readLockFn ?? readPluginLock
  }
  wasmConcernMapPromise = buildWasmConcernMaps(cwd, ctx)
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

/**
 * Точковий предикат «чи існує `builtin-pins.json`» — без читання/валідації
 * вмісту (на відміну від [`readBuiltinPinsConfig`], яка мовчить при
 * відсутності файлу, доккомент модуля §O1). Диспатчер (`detect.mjs`,
 * `runConcernDetector`) звіряє цей прапорець у ЄДИНІЙ точці, де вже
 * вичерпані всі джерела реалізації concern-а (native, wasm-мапа, main.mjs,
 * policy) — якщо файла немає, `DetectorError('немає main.mjs')` не може
 * розрізнити «concern портовано у wasm, але локальна збірка не робилась» від
 * «concern справді зламаний», тож повідомлення лише ДОПОВНЮЄ підказкою
 * (не замінює — заміна брехала б у другому випадку), доккомент виклику.
 *
 * Свідомо НЕ інтегровано в [`resolveWasmConcernMap`]/[`readBuiltinPinsConfig`]
 * як `console.warn`: відсутність файлу там — задокументований очікуваний стан
 * repo-дерева без локальної wasm-збірки (доккомент [`readBuiltinPinsConfig`]),
 * і мовчання там звірене тестом (`wasm-plugins.test.mjs`, «немає
 * builtin-pins.json → тиша, порожня мапа»); резолв викликається для КОЖНОГО
 * concern-а незалежно від того, чи той concern узагалі стосується wasm —
 * warn там гримів би і тоді, коли жодна причина для нього немає (задача,
 * що ставила цей предикат, явно застерігала не робити артефакт обов'язковим
 * для сценаріїв, де wasm не потрібен). Тут же виклик стається лише в
 * останній інстанції, коли concern УЖЕ не резолвився жодним іншим шляхом —
 * природне місце для підказки, не для сигналу за замовчуванням.
 * @param {string} [builtinPinsDir] абсолютний шлях до `npm/wasm-plugins/`
 *   (дефолт — [`WASM_PLUGINS_DIR`]; тести підміняють неіснуючою текою)
 * @returns {boolean} true, якщо `builtin-pins.json` присутній у теці
 */
export function hasBuiltinPinsArtifact(builtinPinsDir = WASM_PLUGINS_DIR) {
  return existsSync(join(builtinPinsDir, 'builtin-pins.json'))
}
