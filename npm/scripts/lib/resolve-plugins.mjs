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
 * `{ "capabilities": ["ci:github"], "contributes": { "rules": true, "handlers": { "<point>": "./mod.mjs" } } }`.
 * `capabilities` живлять гейт концернів (`concern.json` → `requires.capability`);
 * `handlers` — іменовані extension-points правил ядра (v1: лише API, споживачі — v2).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

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
    .map(pluginCategory)
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
 * (через `resolveRulesDirs` тощо) і прямий виклик у sync-CLI інакше дублювали б і файловий
 * скан, і warning про backfill.
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

  const declaredCategories = new Set(names.map(pluginCategory))
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
 * Гарантує, що плагін встановлений: якщо `node_modules/<pkg>` нема — `bun add -d <pkg>`
 * (дописує devDependency і ставить). Фейл — warning + false, без винятку.
 * @param {string} projectRoot корінь репозиторію
 * @param {string} packageName npm-ім'я плагіна
 * @returns {boolean} true — пакет доступний у node_modules після виклику
 */
export function ensurePluginInstalled(projectRoot, packageName) {
  const installed = join(projectRoot, 'node_modules', packageName, 'package.json')
  if (existsSync(installed)) return true
  if (!existsSync(join(projectRoot, 'package.json'))) return false

  const r = spawnSync('bun', ['add', '-d', packageName], { cwd: projectRoot, encoding: 'utf8', shell: false })
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
 * @property {string} rulesDir абсолютний шлях до `rules/` пакета
 * @property {{ capabilities: string[], contributes: { rules?: boolean, handlers?: Record<string, string>, docFilesExtensions?: Record<string, string> } }} manifest нормалізований блок `n-rules` з package.json плагіна
 */

/**
 * Маніфест плагіна з блоку `"n-rules"` його package.json (з дефолтами).
 * @param {string} packageRoot корінь пакета
 * @returns {ResolvedPlugin['manifest']} нормалізований маніфест
 */
function readPluginManifest(packageRoot) {
  /** @type {ResolvedPlugin['manifest']} */
  const fallback = { capabilities: [], contributes: { rules: true, handlers: {}, docFilesExtensions: {} } }
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    const raw = pkg?.['n-rules']
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
    const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.filter(c => typeof c === 'string') : []
    const contributes = raw.contributes && typeof raw.contributes === 'object' ? raw.contributes : {}
    const handlers =
      contributes.handlers && typeof contributes.handlers === 'object' && !Array.isArray(contributes.handlers)
        ? Object.fromEntries(Object.entries(contributes.handlers).filter(([, v]) => typeof v === 'string'))
        : {}
    // Декларативні doc-files-розширення (`docFiles.extensions`: '.rs' → 'Rust Module') —
    // саме в маніфесті, а не в handler-модулі, щоб hot-path (hook per-file) читав їх
    // синхронно без динамічного import.
    const rawDocFiles = contributes.docFiles && typeof contributes.docFiles === 'object' ? contributes.docFiles : {}
    const docFilesExtensions =
      rawDocFiles.extensions && typeof rawDocFiles.extensions === 'object' && !Array.isArray(rawDocFiles.extensions)
        ? Object.fromEntries(
            Object.entries(rawDocFiles.extensions).filter(([k, v]) => k.startsWith('.') && typeof v === 'string')
          )
        : {}
    return { capabilities, contributes: { rules: contributes.rules !== false, handlers, docFilesExtensions } }
  } catch {
    return fallback
  }
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
    const rulesDir = join(packageRoot, 'rules')
    if (manifest.contributes.rules && !existsSync(rulesDir)) {
      // Плагін ДЕКЛАРУЄ правила (rules !== false), але каталогу нема — битий пакет.
      // Плагін без правил (лише handlers, напр. lang-* до фази 3) — легальний.
      if (options.quiet !== true) console.warn(`⚠️  Плагін ${name} без каталогу rules/ — пропускаю\n`)
      continue
    }
    out.push({ name, packageRoot, rulesDir, manifest })
  }
  RESOLVE_CACHE.set(cacheKey, out)
  return out
}

/**
 * Rules-каталоги для всіх поверхонь ядра: ядро першим (його правила/концерни виграють
 * колізії), далі плагіни у порядку списку.
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json`
 * @param {string} bundledRulesDir `rules/` встановленого/вбудованого ядра
 * @param {{ allowInstall?: boolean }} [options] прокидається у `resolvePlugins`
 * @returns {Array<{ name: string, rulesDir: string, packageRoot: string | null }>} джерела правил
 */
export function resolveRulesDirs(projectRoot, config, bundledRulesDir, options = {}) {
  const plugins = resolvePlugins(projectRoot, config, options)
  return [
    { name: '@7n/rules', rulesDir: bundledRulesDir, packageRoot: null },
    ...plugins
      .filter(p => p.manifest.contributes.rules && existsSync(p.rulesDir))
      .map(p => ({ name: p.name, rulesDir: p.rulesDir, packageRoot: p.packageRoot }))
  ]
}

/**
 * Активні capabilities від усіх доступних плагінів (для гейта `requires.capability` у concern.json).
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json`
 * @param {{ allowInstall?: boolean }} [options] прокидається у `resolvePlugins`
 * @returns {Set<string>} набір capability-рядків (напр. `ci:github`)
 */
export function getActiveCapabilities(projectRoot, config, options = {}) {
  const caps = new Set()
  for (const p of resolvePlugins(projectRoot, config, options)) {
    for (const c of p.manifest.capabilities) caps.add(c)
  }
  return caps
}

/**
 * Агреговані doc-files-розширення активних плагінів: '.rs' → 'Rust Module' тощо.
 * Синхронно і без установки (hot-path hook) — лише вже встановлені плагіни.
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json`
 * @returns {Record<string, string>} мапа розширення → тип-мітка доки
 */
export function getDocFilesExtensions(projectRoot, config) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const p of resolvePlugins(projectRoot, config, { allowInstall: false, quiet: true })) {
    Object.assign(out, p.manifest.contributes.docFilesExtensions)
  }
  return out
}

/**
 * Handlers для extension-point правила ядра (v1 — лише API; перший споживач — v2).
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json`
 * @param {string} point ім'я extension-point (напр. `doc-files`)
 * @returns {Array<{ pluginName: string, modulePath: string }>} абсолютні шляхи модулів-обробників
 */
export function getHandlers(projectRoot, config, point) {
  const out = []
  for (const p of resolvePlugins(projectRoot, config, { allowInstall: false })) {
    const rel = p.manifest.contributes.handlers[point]
    if (typeof rel === 'string') out.push({ pluginName: p.name, modulePath: join(p.packageRoot, rel) })
  }
  return out
}

/** Скидає кеш резолву (для тестів). */
export function clearPluginResolveCache() {
  RESOLVE_CACHE.clear()
  PLUGIN_LIST_CACHE.clear()
}
