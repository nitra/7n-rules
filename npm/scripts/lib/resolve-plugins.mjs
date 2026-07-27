/**
 * Резолв плагінів `@7n/rules`: які пакети-плагіни активні у проєкті, де їхні `rules/`,
 * які capabilities вони дають і які handlers надають.
 *
 * Джерело правди — поле `plugins: string[]` у `.n-rules.json`. Явний `[]` = «плагіни
 * вимкнено» (автодетект не застосовується). Якщо поля немає взагалі — повний автодетект
 * (`detectPluginsFromRepo`). Якщо `plugins` непорожній і складається **виключно** з пакетів
 * за конвенцією `@7n/rules-<category>-<name>` (напр. `ci`, `lang`) — автодетект домішує
 * лише ті категорії, яких у списку немає (ADR `260719-2154-per-category-автодетект-плагінів`);
 * будь-який сторонній (не `@7n/rules-*`) пакет у списку вимикає backfill повністю — змішаний
 * чи повністю кастомний список означає ручне керування, без сюрпризів. Файлові сигнали
 * автодетекту: `.github/workflows/*.yml` → `@7n/rules-ci-github`; `azure-pipelines.yml` →
 * `@7n/rules-ci-azure`, а без них — fallback за `repository.url` кореневого package.json
 * (`github.com` / `dev.azure.com`).
 *
 * Установка: `ensurePluginInstalled` — плагін стає devDependency через `bun add -d` (bun сам
 * резолвить актуальну версію; зміна видима у diff package.json). Фейл установки (offline,
 * пакет ще не опублікований) — warning + graceful skip, ніколи не hard-fail: лінт/синк
 * мають працювати без мережі. Hot-path (hook) НЕ встановлює — лише резолвить уже встановлені
 * (`allowInstall: false`).
 *
 * Маніфест плагіна — блок `"n-rules"` у його package.json:
 * `{ "requiresPluginApi": 2, "capabilities": ["ci:github"], "slots": { "provides": [...] } }`.
 * `capabilities` живлять гейт концернів (`concern.json` → `requires.capability`) і
 * `requires.capabilities` у slot contributions. Composition-контракт (rules, handlers,
 * doc-files-розширення, skill-фрагменти) повністю на universal slot bus (`plugin-slots.mjs`,
 * spec 2026-07-27-universal-plugin-slots-lang-php-extraction, Фаза 2 — full migration): цей
 * модуль лишається відповідальним ЛИШЕ за низькорівневий резолв — які пакети активні, де їхній
 * `packageRoot`, який у них `n-rules`-маніфест (сире `capabilities`/`requiresPluginApi`/`slots`),
 * без жодної нормалізації composition-полів.
 *
 * Сумісність plugin API (Фаза 0, §10 тієї ж спеки): маніфест може декларувати число
 * `requiresPluginApi`. Якщо воно більше за `PLUGIN_API_VERSION` цього core — плагін несумісний і
 * пропускається у `resolvePlugins()` із warning (окрім `quiet:true`, де пропуск тихий). Відсутнє
 * або нечислове поле — сумісний (та ж перевірка діє і для плагінів, що ще не дійшли до
 * `requiresPluginApi: 2` — цей модуль сам їх не гейтує за версією v2, це робить
 * `plugin-slots.mjs` окремо для slot graph).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { PLUGIN_API_VERSION } from './plugin-api.mjs'

/** Відомі CI-плагіни для автовизначення: сигнал у дереві репо → npm-пакет. */
export const KNOWN_CI_PLUGINS = Object.freeze({
  github: '@7n/rules-ci-github',
  azure: '@7n/rules-ci-azure'
})

/**
 * Відомі мовні плагіни: файловий сигнал екосистеми → npm-пакет. `maxDepth` —
 * до якої глибини шукати сигнал: python — лише корінь (uv-провайдер v1
 * обробляє тільки кореневий pyproject.toml; js — кореневий package.json); rust — до 3 рівнів, бо в
 * монорепо Cargo.toml часто вкладений (Tauri `app/src-tauri/Cargo.toml`),
 * а провайдер обробляє всі знайдені маніфести.
 */
export const KNOWN_LANG_PLUGINS = Object.freeze({
  js: { signal: 'package.json', pkg: '@7n/rules-lang-js', maxDepth: 0 },
  python: { signal: 'pyproject.toml', pkg: '@7n/rules-lang-python', maxDepth: 0 },
  rust: { signal: 'Cargo.toml', pkg: '@7n/rules-lang-rust', maxDepth: 3 }
})

/** Теки, у які неглибокий скан мовних сигналів не заходить (плюс усі приховані). */
const LANG_SCAN_SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'coverage', 'build', 'vendor'])

/**
 * Чи є файл-сигнал у корені або підтеках до `maxDepth` рівнів — обмежений
 * BFS-обхід (пропускає приховані теки, node_modules, target тощо), щоб
 * лишатись дешевим на hot-path (hook викликається на кожен файл).
 * @param {string} projectRoot корінь репозиторію
 * @param {string} signal ім'я файлу-сигналу (напр. `Cargo.toml`)
 * @param {number} maxDepth 0 — лише корінь; N — до N рівнів підтек
 * @returns {boolean} true — сигнал знайдено
 */
function hasLangSignal(projectRoot, signal, maxDepth) {
  let level = [projectRoot]
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    if (level.some(dir => existsSync(join(dir, signal)))) return true
    if (depth < maxDepth) level = level.flatMap(dir => listScannableSubdirs(dir))
  }
  return false
}

/**
 * Видимі підтеки для неглибокого скану (без прихованих і службових).
 * @param {string} dir тека
 * @returns {string[]} абсолютні шляхи підтек (порожньо, якщо нечитабельна)
 */
function listScannableSubdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !LANG_SCAN_SKIP_DIRS.has(entry.name))
      .map(entry => join(dir, entry.name))
  } catch {
    /* нечитабельна тека — пропускаємо гілку */
    return []
  }
}

const WORKFLOW_YML_RE = /\.ya?ml$/u
const GITHUB_URL_RE = /github\.com/iu
const AZURE_URL_RE = /dev\.azure\.com|visualstudio\.com/iu

/** Кеш резолву на процес: projectRoot → результат `resolvePlugins`. */
const RESOLVE_CACHE = new Map()

/**
 * `repository.url` з кореневого package.json (string або {url}); null, якщо нема/нечитабельний.
 * @param {string} projectRoot корінь репозиторію
 * @returns {string | null} URL або null
 */
function readRepositoryUrl(projectRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    const repo = pkg?.repository
    if (typeof repo === 'string') return repo
    if (repo && typeof repo === 'object' && typeof repo.url === 'string') return repo.url
  } catch {
    /* нема package.json або битий JSON — сигналу нема */
  }
  return null
}

/**
 * Чи є у `.github/workflows/` хоч один yml/yaml.
 * @param {string} projectRoot корінь репозиторію
 * @returns {boolean} true — GitHub Actions присутні
 */
function hasGithubWorkflows(projectRoot) {
  const dir = join(projectRoot, '.github', 'workflows')
  if (!existsSync(dir)) return false
  try {
    return readdirSync(dir).some(name => WORKFLOW_YML_RE.test(name))
  } catch {
    return false
  }
}

/**
 * Автодетект CI-плагінів за станом репозиторію.
 * Файлові сигнали мають пріоритет; `repository.url` — лише коли файлових сигналів нема
 * (свіже репо без CI-конфігів). Обидва сигнали → обидва плагіни; жодного → [].
 * @param {string} projectRoot корінь репозиторію
 * @returns {string[]} npm-імена CI-плагінів
 */
function detectCiPlugins(projectRoot) {
  const out = []
  if (hasGithubWorkflows(projectRoot)) out.push(KNOWN_CI_PLUGINS.github)
  if (existsSync(join(projectRoot, 'azure-pipelines.yml'))) out.push(KNOWN_CI_PLUGINS.azure)
  if (out.length > 0) return out

  const url = readRepositoryUrl(projectRoot)
  if (typeof url === 'string') {
    if (GITHUB_URL_RE.test(url)) out.push(KNOWN_CI_PLUGINS.github)
    if (AZURE_URL_RE.test(url)) out.push(KNOWN_CI_PLUGINS.azure)
  }
  return out
}

/**
 * Автодетект плагінів за станом репозиторію: CI-плагіни (файлові сигнали з
 * fallback на `repository.url`) + мовні плагіни (лише файлові сигнали —
 * маніфест екосистеми в корені або, для rust, у підтеках до 3 рівнів; URL-fallback для мов безглуздий).
 * @param {string} projectRoot корінь репозиторію
 * @returns {string[]} npm-імена плагінів
 */
export function detectPluginsFromRepo(projectRoot) {
  const out = detectCiPlugins(projectRoot)
  for (const { signal, pkg, maxDepth } of Object.values(KNOWN_LANG_PLUGINS)) {
    if (hasLangSignal(projectRoot, signal, maxDepth)) out.push(pkg)
  }
  return out
}

/** Naming convention плагінів, які розпізнає автодетект: `@7n/rules-<category>-<name>`. */
const PLUGIN_CATEGORY_RE = /^@7n\/rules-([a-z0-9]+)-/u

/**
 * Категорія плагіна за naming convention `@7n/rules-<category>-<name>` (напр. `ci`, `lang`).
 * `null` — пакет поза цією конвенцією (сторонній/кастомний плагін); такий пакет ніколи не
 * зʼявляється сам через автодетект і, якщо присутній у явному `config.plugins`, вимикає
 * per-категорійний backfill для всього списку (див. `resolvePluginList`).
 * @param {string} pkg npm-ім'я плагіна
 * @returns {string | null} категорія або null
 */
export function pluginCategory(pkg) {
  const m = PLUGIN_CATEGORY_RE.exec(pkg)
  return m ? m[1] : null
}

/** Усі категорії, які реально може повернути `detectPluginsFromRepo` — для short-circuit коли declared вже покриває все. */
const ALL_KNOWN_CATEGORIES = new Set(
  [...Object.values(KNOWN_CI_PLUGINS), ...Object.values(KNOWN_LANG_PLUGINS).map(l => l.pkg)]
    .map(pkg => pluginCategory(pkg))
    .filter(c => c !== null)
)

/** Кеш `resolvePluginList` на процес: `root::declared-json` → результат (щоб не дублювати warning). */
const PLUGIN_LIST_CACHE = new Map()

/**
 * Список плагінів проєкту: явний `config.plugins` або автодетект.
 *
 * Явний `plugins` непорожній і складається **виключно** з пакетів `@7n/rules-<category>-*` —
 * автодетект домішує лише категорії, відсутні в списку (ADR
 * `260719-2154-per-category-автодетект-плагінів`); категорія, присутня хоч одним пакетом,
 * лишається зафіксованою користувачем. Якщо `plugins` містить хоча б один сторонній
 * (не `@7n/rules-*`) пакет — це сигнал ручного керування, backfill вимикається повністю
 * (як і раніше: список повертається як є). Явний `[]` — «плагіни вимкнено», без backfill.
 * Поле відсутнє взагалі — повний автодетект.
 *
 * Результат кешується на процес за `(projectRoot, declared)` — виклик з `resolvePlugins`
 * (через `resolveSlotGraph`/`resolveRulesDirs` у `plugin-slots.mjs` тощо) і прямий виклик у
 * sync-CLI інакше дублювали б і файловий скан, і warning про backfill.
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json` (може бути відсутній)
 * @param {{ quiet?: boolean }} [options] `quiet:true` — без warning-у про плагін, доданий автодетектом (hot-path);
 *   ігнорується при cache hit — warning друкується щонайбільше раз на `(root, declared)` за процес
 * @returns {string[]} npm-імена плагінів
 */
export function resolvePluginList(projectRoot, config, options = {}) {
  const root = resolve(projectRoot)
  const declared = config?.plugins
  const cacheKey = `${root}::${Array.isArray(declared) ? JSON.stringify(declared) : '∅'}`
  const cached = PLUGIN_LIST_CACHE.get(cacheKey)
  if (cached) return cached

  const result = computePluginList(root, declared, options)
  PLUGIN_LIST_CACHE.set(cacheKey, result)
  return result
}

/**
 * Обчислення `resolvePluginList` без кешу (винесено окремо, щоб кеш-обгортка лишалась тонкою).
 * @param {string} root абсолютний корінь репозиторію (вже пройшов через `resolve()`)
 * @param {unknown} declared сире значення `config.plugins`
 * @param {{ quiet?: boolean }} options прокинуті опції виклику
 * @returns {string[]} npm-імена плагінів
 */
function computePluginList(root, declared, options) {
  if (!Array.isArray(declared)) return detectPluginsFromRepo(root)

  const names = declared.filter(p => typeof p === 'string' && p.trim() !== '')
  if (names.length === 0) return names

  const declaredCategories = new Set(names.map(pkg => pluginCategory(pkg)))
  // Хоч один сторонній пакет у списку — не вгадуємо намір, повертаємо як є.
  if (declaredCategories.has(null)) return names
  // Усі відомі категорії вже покриті явним списком — не марнуємо файлові сигнали.
  if ([...ALL_KNOWN_CATEGORIES].every(c => declaredCategories.has(c))) return names

  const missing = detectPluginsFromRepo(root).filter(pkg => !declaredCategories.has(pluginCategory(pkg)))
  if (missing.length > 0 && options.quiet !== true) {
    const word = missing.length > 1 ? 'плагіни' : 'плагін'
    console.warn(
      `⚠️  Додано автодетектом ${word} ${missing.join(', ')} — категорія не задекларована явно в .n-rules.json\n`
    )
  }
  return [...names, ...missing]
}

/**
 * Сумісний semver-range для first-party плагінів: обмежує автоматичну інсталяцію (`ensurePluginInstalled`)
 * поточною core-сумісною лінією, щоб майбутній несумісний major/minor плагіна не встановився
 * мовчки поверх старого core (Фаза 0, spec 2026-07-27-universal-plugin-slots-lang-php-extraction.md
 * §10). Для `0.x`-пакетів — caret на поточний minor (`^0.22`, а не голий `^0`, який під caret-
 * семантикою розгортається у весь діапазон `0.x`); для `>=1` — caret на поточний major (`^1`).
 * Невідомий (сторонній, не з цієї таблиці) пакет інсталюється без обмеження версії — як і раніше.
 */
export const KNOWN_PLUGIN_RANGES = Object.freeze({
  '@7n/rules-ci-github': '^1',
  '@7n/rules-ci-azure': '^1',
  '@7n/rules-lang-js': '^0.22',
  '@7n/rules-lang-python': '^0.10',
  '@7n/rules-lang-rust': '^0.13'
})

/**
 * Гарантує, що плагін встановлений: якщо `node_modules/<pkg>` нема — `bun add -d <pkg>`
 * (дописує devDependency і ставить). Для first-party пакетів з `KNOWN_PLUGIN_RANGES` версія
 * обмежується сумісним range (`<pkg>@^<major>` або `@^<major>.<minor>` для `0.x`); сторонні
 * пакети встановлюються без обмеження, bun сам резолвить latest. Фейл — warning + false, без
 * винятку.
 * @param {string} projectRoot корінь репозиторію
 * @param {string} packageName npm-ім'я плагіна
 * @param {typeof import('node:child_process').spawnSync} [spawnFn] інжект для тестів (типово — реальний `spawnSync`)
 * @returns {boolean} true — пакет доступний у node_modules після виклику
 */
export function ensurePluginInstalled(projectRoot, packageName, spawnFn = spawnSync) {
  const installed = join(projectRoot, 'node_modules', packageName, 'package.json')
  if (existsSync(installed)) return true
  if (!existsSync(join(projectRoot, 'package.json'))) return false

  const range = KNOWN_PLUGIN_RANGES[packageName]
  const spec = range ? `${packageName}@${range}` : packageName
  const r = spawnFn('bun', ['add', '-d', spec], { cwd: projectRoot, encoding: 'utf8', shell: false })
  if (r.error || r.status !== 0) {
    const reason = r.error ? r.error.message : `bun add exit ${r.status}`
    console.warn(`⚠️  Плагін ${packageName} не встановився (${reason}) — пропускаю\n`)
    return false
  }
  return existsSync(installed)
}

/**
 * @typedef {object} ResolvedPlugin
 * @property {string} name npm-ім'я пакета (`@7n/rules` для ядра)
 * @property {string} packageRoot абсолютний корінь пакета
 * @property {{
 *   capabilities: string[],
 *   requiresPluginApi: unknown,
 *   slots: { provides?: unknown, consumes?: unknown } | null,
 *   manifestError: string | null
 * }} manifest нормалізований блок `n-rules` з package.json плагіна (composition-поля —
 *   `slots.provides`/`slots.consumes` — сирі, без нормалізації; їх валідує/матеріалізує
 *   `plugin-slots.mjs`)
 */

/**
 * Маніфест плагіна з блоку `"n-rules"` його package.json (з дефолтами). Повертає лише
 * низькорівневі поля — `capabilities`, СИРІ `requiresPluginApi`/`slots` (universal slot bus,
 * spec 2026-07-27-universal-plugin-slots-lang-php-extraction) — без будь-якої
 * composition-нормалізації (legacy `contributes.rules/handlers/docFiles` видалено Фазою 2, spec
 * §5.1.10): це відповідальність `plugin-slots.mjs` (`resolveSlotGraph`), яка перетворює
 * `slots.*` на граф із envelope validation і diagnostics. Тут лише структурний guard
 * верхнього рівня (об'єкт, не масив) — щоб споживач не впав на `undefined.provides`.
 * @param {string} packageRoot корінь пакета
 * @returns {ResolvedPlugin['manifest']} нормалізований маніфест
 */
function readPluginManifest(packageRoot) {
  /** @type {ResolvedPlugin['manifest']} */
  const fallback = { capabilities: [], requiresPluginApi: undefined, slots: null, manifestError: null }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  } catch (error) {
    // Битий/нечитабельний package.json — окремо від «нема поля n-rules»: slot-graph (§9.1
    // spec 2026-07-27-universal-plugin-slots) мусить дати diagnostic саме на цей випадок,
    // тоді як відсутність "n-rules" — легітимний стан (пакет без плагін-маніфесту).
    return { ...fallback, manifestError: error instanceof Error ? error.message : String(error) }
  }
  try {
    const raw = pkg?.['n-rules']
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
    const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.filter(c => typeof c === 'string') : []
    // `slots` — сирий блок { provides, consumes } як є в JSON (лише guard "це plain object,
    // не масив"); plugin-slots.mjs сам валідує кожен елемент provides/consumes і форму масивів.
    const slots = raw.slots && typeof raw.slots === 'object' && !Array.isArray(raw.slots) ? raw.slots : null
    return { capabilities, requiresPluginApi: raw.requiresPluginApi, slots, manifestError: null }
  } catch {
    return fallback
  }
}

/**
 * Чи декларує маніфест plugin API, несумісний із цією core-лінією (Фаза 0 передумова повної
 * slots-міграції: `requiresPluginApi > PLUGIN_API_VERSION`). Друкує warning (окрім
 * `quiet:true`) — виносить умову й побічний ефект з `resolvePlugins()`, щоб не роздувати її
 * cognitive complexity.
 * Маніфест тримає СИРЕ значення `requiresPluginApi` (його друкує в diagnostics slot-broker),
 * тому числова нормалізація «нечислове/відсутнє → сумісний» живе саме тут.
 * @param {string} name npm-ім'я плагіна (для повідомлення)
 * @param {ResolvedPlugin['manifest']} manifest нормалізований маніфест плагіна
 * @param {boolean} quiet без warning-у
 * @returns {boolean} true — плагін несумісний, пропускаємо
 */
function isIncompatiblePluginApi(name, manifest, quiet) {
  const required =
    typeof manifest.requiresPluginApi === 'number' && Number.isFinite(manifest.requiresPluginApi)
      ? manifest.requiresPluginApi
      : null
  if (required === null || required <= PLUGIN_API_VERSION) return false
  // Плагін декларує plugin API, несумісний із цією core-лінією — пропускаємо, а не
  // завантажуємо його як rules-only з мовчазною втратою handlers/doc-files/fragments.
  if (!quiet) {
    console.warn(
      `⚠️  Плагін ${name} потребує plugin API v${required}, ця core-лінія підтримує v${PLUGIN_API_VERSION} — пропускаю, онови @7n/rules\n`
    )
  }
  return true
}

/**
 * Повний резолв плагінів проєкту (з кешем на процес).
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json`
 * @param {{ allowInstall?: boolean, quiet?: boolean }} [options] `allowInstall:false` (hot-path hook/lint) —
 *   лише вже встановлені пакети, без `bun add`; `quiet` — без warning-ів (hook на кожен файл)
 * @returns {ResolvedPlugin[]} доступні плагіни (без ядра)
 */
export function resolvePlugins(projectRoot, config, options = {}) {
  const root = resolve(projectRoot)
  const names = resolvePluginList(root, config, { quiet: options.quiet })
  const cacheKey = `${root} ${names.join(',')} ${options.allowInstall !== false}`
  const cached = RESOLVE_CACHE.get(cacheKey)
  if (cached) return cached

  /** @type {ResolvedPlugin[]} */
  const out = []
  for (const name of names) {
    const packageRoot = join(root, 'node_modules', name)
    const available =
      existsSync(join(packageRoot, 'package.json')) ||
      (options.allowInstall !== false && ensurePluginInstalled(root, name))
    if (!available) {
      if (options.allowInstall === false && options.quiet !== true) {
        console.warn(`⚠️  Плагін ${name} не встановлений — пропускаю (запусти npx @7n/rules)\n`)
      }
      continue
    }
    const manifest = readPluginManifest(packageRoot)
    if (isIncompatiblePluginApi(name, manifest, options.quiet === true)) continue
    out.push({ name, packageRoot, manifest })
  }
  RESOLVE_CACHE.set(cacheKey, out)
  return out
}

/**
 * Задекларовані у `config.plugins` пакети, недоступні в `node_modules` (не встановлені).
 * Не встановлює нічого (`allowInstall: false`) і не друкує — чистий предикат для
 * explicit CLI-діагностики (напр. doc-files: 0 кандидатів через невстановлений плагін),
 * яка сама вирішує, коли й де показати попередження. Автодетектовані (не задекларовані
 * явно) плагіни тут не враховуються — сигнал стосується саме явного `.n-rules.json`.
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json`
 * @returns {string[]} npm-імена задекларованих, але не встановлених плагінів (порожньо — усе гаразд)
 */
export function getUnavailableDeclaredPlugins(projectRoot, config) {
  const declared = Array.isArray(config?.plugins)
    ? config.plugins.filter(p => typeof p === 'string' && p.trim() !== '')
    : []
  if (declared.length === 0) return []
  const root = resolve(projectRoot)
  const availableNames = new Set(resolvePlugins(root, config, { allowInstall: false, quiet: true }).map(p => p.name))
  return declared.filter(name => !availableNames.has(name))
}

/** Скидає кеш резолву (для тестів). */
export function clearPluginResolveCache() {
  RESOLVE_CACHE.clear()
  PLUGIN_LIST_CACHE.clear()
}
