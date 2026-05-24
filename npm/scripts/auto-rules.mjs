/**
 * Автовизначення правил для `.n-cursor.json` за умовами з `npm/rules/<rule>/auto.md`.
 *
 * Модуль аналізує дерево проєкту (наявність файлів/директорій, `gql\`...\`` у source,
 * залежності `mssql` / `pg` / `pg-format` / `mysql2` / `ioredis` / `node-redis` у `package.json`,
 * імпорт `sql`/`SQL` з `bun`, кореневий `package.json`, `config.yaml` з рядком
 * `metadata_directory: metadata` для hasura) та повертає ідентифікатори правил, які потрібно автододати.
 *
 * Враховує винятки `disable-rules`: елементи зі списку не додаються автоматично.
 *
 * Автодетект скілів — у `./auto-skills.mjs` (умови — у `npm/skills/<skill>/auto.md`).
 * `mergeConfigWithAutoDetected` нижче приймає вже виявлені rules і skills і вливає
 * їх у конфіг із поправкою на legacy-id (`migrateRuleIds`).
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

import { textHasBunSqlImport } from '../rules/js-bun-db/lib/bun-sql-scan.mjs'
import {
  isGqlScanSourceFile,
  shouldSkipFileForGqlScan,
  sourceFileHasGqlTaggedTemplate
} from '../rules/graphql/lib/graphql-gql-scan.mjs'
import { contentForVueImportScan } from '../rules/vue/lib/vue-forbidden-imports.mjs'

/** Порядок автододавання правил відповідно до `rules/<rule>/auto.md`. */
export const AUTO_RULE_ORDER = Object.freeze([
  'abie',
  'adr',
  'bun',
  'capacitor',
  'changelog',
  'docker',
  'efes',
  'ga',
  'graphql',
  'hasura',
  'image-avif',
  'image-compress',
  'js-lint',
  'js-mssql',
  'js-bun-db',
  'js-bun-redis',
  'js-run',
  'k8s',
  'nginx-default-tpl',
  'npm-module',
  'php',
  'rego',
  'rust',
  'security',
  'style-lint',
  'text',
  'vue'
])

/**
 * Карта міграції застарілих rule-id у `.n-cursor.json` на актуальні.
 * Застосовується автоматично при читанні конфігу (як для `rules`, так і для `disable-rules`).
 * Приклад: `image` → `image-compress` + `image-avif` (правило розщеплене у 1.8.197).
 */
export const RULE_MIGRATIONS = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    image: Object.freeze(['image-compress', 'image-avif'])
  })
)

/**
 * Розгортає застарілі rule-id у списку згідно з `RULE_MIGRATIONS`. Зберігає порядок,
 * дедуплікує. Чистий хелпер: не мутує вхід, не логує.
 * @param {string[]} ids нормалізований список id (як з `normalizeIdList`)
 * @returns {string[]} список з legacy-id, заміненими на нові; решта без змін
 */
export function migrateRuleIds(ids) {
  /** @type {string[]} */
  const out = []
  for (const id of ids) {
    const replacement = Object.hasOwn(RULE_MIGRATIONS, id) ? RULE_MIGRATIONS[id] : [id]
    for (const newId of replacement) {
      if (!out.includes(newId)) out.push(newId)
    }
  }
  return out
}

/**
 * Повертає лише ті legacy rule-id зі списку, для яких є запис у `RULE_MIGRATIONS`.
 * Використовується для людинозрозумілого логування міграції при синхронізації CLI.
 * @param {string[]} ids нормалізований список id
 * @returns {string[]} legacy id, які потребуватимуть заміни у `migrateRuleIds`
 */
export function detectLegacyRuleIds(ids) {
  return ids.filter(id => Object.hasOwn(RULE_MIGRATIONS, id))
}

/**
 * Граф залежностей між правилами (`rules/<rule>/auto.md` синтаксис `rule - [other]`).
 * Ключ варто автододати, коли всі правила-залежності вже додані до конфігу — щоб
 * не дублювати вихідну умову, достатньо описати її у залежності.
 */
export const AUTO_RULE_DEPENDENCIES = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    changelog: Object.freeze(['bun']),
    'image-avif': Object.freeze(['vue', 'image-compress']),
    'image-compress': Object.freeze(['bun'])
  })
)

const ABIE_REPOSITORY_URL_MARKER = 'https://github.com/abinbevefes/'
const EFES_REPOSITORY_URL_MARKER = 'https://github.com/efes-cloud/'
const HASURA_CONFIG_MARKER = 'metadata_directory: metadata'
const JS_LIKE_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/iu
const REGO_RE = /\.rego$/iu
const STYLE_RE = /\.(?:css|vue)$/iu
const VUE_RE = /\.vue$/iu
const NGINX_DEFAULT_FILES = new Set(['default.conf.template', 'default.conf', 'nginx.conf'])
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])
const DEFAULT_DISABLED_LIST = Object.freeze([])

/**
 * Чи містить текст джерела імпорт імені `sql` або `SQL` з `"bun"` (після витягування `<script>` у `.vue`).
 * @param {string} content вміст файлу
 * @param {string} relativePath шлях posix відносно кореня
 * @returns {boolean} true, якщо знайдено `import { sql }` або `import { SQL }` з `"bun"`
 */
function sourceContentHasBunSqlImport(content, relativePath) {
  return textHasBunSqlImport(contentForVueImportScan(content, relativePath))
}

/**
 * Зчитує `package.json` і додає в `found` усі ключі з `wanted`, що присутні в `dependencies`.
 * @param {string} absPath абсолютний шлях до package.json
 * @param {Set<string>} wanted множина ключів-цілей
 * @param {Set<string>} found буфер знайдених ключів
 * @returns {Promise<void>}
 */
async function collectFoundDependencyKeysFromPackageJson(absPath, wanted, found) {
  try {
    const parsed = JSON.parse(await readFile(absPath, 'utf8'))
    const deps = parsed?.dependencies
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return
    for (const key of wanted) {
      if (Object.hasOwn(deps, key)) {
        found.add(key)
      }
    }
  } catch {
    /* ігноруємо пошкоджені/недоступні package.json */
  }
}

/**
 * Збирає, які з переданих ключів присутні в `dependencies` хоча б одного `package.json`.
 * @param {string} root абсолютний шлях до кореня репозиторію
 * @param {string[]} dependencyKeys імена залежностей (наприклад `mssql`, `pg`)
 * @returns {Promise<Set<string>>} множина знайдених ключів
 */
async function collectDependencyKeysPresentInPackageJsonTree(root, dependencyKeys) {
  const wanted = new Set(dependencyKeys)
  /** @type {Set<string>} */
  const found = new Set()

  /**
   * Обробка одного запису з readdir: рекурсія в підкаталог або зчитування package.json.
   * @param {import('node:fs').Dirent} entry елемент readdir
   * @param {string} dir абсолютний шлях каталогу-власника entry
   * @returns {Promise<void>}
   */
  async function processEntry(entry, dir) {
    const absPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIR_NAMES.has(entry.name)) {
        await walk(absPath)
      }
      return
    }
    if (entry.isFile() && entry.name === 'package.json') {
      await collectFoundDependencyKeysFromPackageJson(absPath, wanted, found)
    }
  }

  /**
   * Рекурсивний обхід каталогу з пропуском службових директорій.
   * @param {string} dir абсолютний шлях каталогу
   * @returns {Promise<void>}
   */
  async function walk(dir) {
    if (found.size === wanted.size) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.size === wanted.size) return
      await processEntry(entry, dir)
    }
  }

  await walk(root)
  return found
}

/**
 * Перевіряє один package.json: повертає true, якщо в `devDependencies` немає `vite`.
 * @param {string} absPath абсолютний шлях до package.json
 * @returns {Promise<boolean>} true, якщо vite відсутній у devDependencies
 */
async function packageJsonLacksViteDevDependency(absPath) {
  try {
    const parsed = JSON.parse(await readFile(absPath, 'utf8'))
    const devDeps = parsed?.devDependencies
    if (!devDeps || typeof devDeps !== 'object' || Array.isArray(devDeps)) {
      return true
    }
    return !Object.hasOwn(devDeps, 'vite')
  } catch {
    return false
  }
}

/**
 * Перевіряє, чи існує хоча б один вкладений `package.json` (не кореневий),
 * у якому в `devDependencies` відсутня залежність `vite`.
 * @param {string} root абсолютний шлях до кореня репозиторію
 * @returns {Promise<boolean>} true, якщо знайдено вкладений package.json без `vite` у devDependencies
 */
async function hasNestedPackageJsonWithoutViteDevDependency(root) {
  let result = false

  /**
   * Рекурсивний обхід каталогу з пропуском службових директорій.
   * @param {string} dir абсолютний шлях каталогу
   * @returns {Promise<void>} завершується після обходу всього піддерева або встановлення `result`
   */
  async function walk(dir) {
    if (result) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (result) return
      const absPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) {
          await walk(absPath)
        }
        continue
      }
      if (
        entry.isFile() &&
        entry.name === 'package.json' &&
        absPath !== join(root, 'package.json') &&
        (await packageJsonLacksViteDevDependency(absPath))
      ) {
        result = true
        return
      }
    }
  }

  await walk(root)
  return result
}

/**
 * Фіксує ознаки, що залежать лише від імені підкаталогу.
 * @param {string} dirName імʼя каталогу
 * @param {{
 *   hasK8sDir: boolean,
 *   hasTempoDir: boolean
 * }} facts агреговані факти
 * @returns {void}
 */
function updateDirFacts(dirName, facts) {
  if (dirName === 'k8s') {
    facts.hasK8sDir = true
  }
  if (dirName === 'tempo') {
    facts.hasTempoDir = true
  }
}

/**
 * Фіксує ознаки, що визначаються за шляхом/іменем файлу.
 * @param {string} fileName базове імʼя файлу
 * @param {string} relPath шлях відносно кореня
 * @param {{
 *   hasCapacitorConfig: boolean,
 *   hasCargoToml: boolean,
 *   hasDockerfile: boolean,
 *   hasJsLikeSource: boolean,
 *   hasNginxDefaultTplFile: boolean,
 *   hasRegoFile: boolean,
 *   hasVueOrCssSource: boolean,
 *   hasVueSource: boolean
 * }} facts агреговані факти
 * @returns {void}
 */
function updateFileFacts(fileName, relPath, facts) {
  if (fileName === 'capacitor.config.json') {
    facts.hasCapacitorConfig = true
  }
  if (fileName === 'Cargo.toml') {
    facts.hasCargoToml = true
  }
  if (fileName === 'Dockerfile' || fileName.startsWith('Dockerfile.')) {
    facts.hasDockerfile = true
  }
  if (NGINX_DEFAULT_FILES.has(fileName)) {
    facts.hasNginxDefaultTplFile = true
  }
  if (JS_LIKE_RE.test(relPath)) {
    facts.hasJsLikeSource = true
  }
  if (VUE_RE.test(relPath)) {
    facts.hasVueSource = true
  }
  if (STYLE_RE.test(relPath)) {
    facts.hasVueOrCssSource = true
  }
  if (REGO_RE.test(relPath)) {
    facts.hasRegoFile = true
  }
}

/**
 * Чи потрібно сканувати файл на gql tagged template.
 * @param {string} relPath шлях відносно кореня
 * @param {{ hasGqlTaggedTemplates: boolean }} facts агреговані факти
 * @returns {boolean} true, якщо файл варто сканувати
 */
function shouldScanFileForGql(relPath, facts) {
  return !facts.hasGqlTaggedTemplates && isGqlScanSourceFile(relPath) && !shouldSkipFileForGqlScan(relPath)
}

/**
 * Оновлює ознаку `hasGqlTaggedTemplates` за вмістом конкретного файлу.
 * @param {string} absPath абсолютний шлях до файлу
 * @param {string} relPath шлях відносно кореня
 * @param {{ hasGqlTaggedTemplates: boolean }} facts агреговані факти
 * @returns {Promise<void>}
 */
async function updateGqlFactFromFile(absPath, relPath, facts) {
  try {
    const content = await readFile(absPath, 'utf8')
    if (sourceFileHasGqlTaggedTemplate(content, relPath)) {
      facts.hasGqlTaggedTemplates = true
    }
  } catch {
    /* ігноруємо пошкоджені/недоступні файли */
  }
}

/**
 * Чи сканувати файл на імпорт `sql`/`SQL` з `bun` (ті самі розширення й skip, що для gql).
 * @param {string} relPath шлях posix відносно кореня
 * @param {{ hasBunSqlImport: boolean }} facts агреговані факти
 * @returns {boolean} true, якщо файл варто сканувати
 */
function shouldScanFileForBunSql(relPath, facts) {
  return !facts.hasBunSqlImport && isGqlScanSourceFile(relPath) && !shouldSkipFileForGqlScan(relPath)
}

/**
 * Оновлює ознаку `hasBunSqlImport` за вмістом файлу.
 * @param {string} absPath абсолютний шлях до файлу
 * @param {string} relPath шлях posix відносно кореня
 * @param {{ hasBunSqlImport: boolean }} facts агреговані факти
 * @returns {Promise<void>}
 */
async function updateBunSqlFactFromFile(absPath, relPath, facts) {
  try {
    const content = await readFile(absPath, 'utf8')
    if (sourceContentHasBunSqlImport(content, relPath)) {
      facts.hasBunSqlImport = true
    }
  } catch {
    /* ігноруємо пошкоджені/недоступні файли */
  }
}

/**
 * Оновлює ознаку `hasHasuraConfig`, якщо файл — `config.yaml` із рядком
 * `metadata_directory: metadata` (маркер hasura graphql-engine).
 * @param {string} absPath абсолютний шлях до файлу
 * @param {string} fileName базове імʼя файлу
 * @param {{ hasHasuraConfig: boolean }} facts агреговані факти
 * @returns {Promise<void>}
 */
async function updateHasuraFactFromFile(absPath, fileName, facts) {
  if (facts.hasHasuraConfig || fileName !== 'config.yaml') return
  try {
    const content = await readFile(absPath, 'utf8')
    if (content.includes(HASURA_CONFIG_MARKER)) {
      facts.hasHasuraConfig = true
    }
  } catch {
    /* ігноруємо пошкоджені/недоступні файли */
  }
}

/**
 * Обробляє файл під час обходу дерева.
 * @param {string} absPath абсолютний шлях до файлу
 * @param {string} root абсолютний шлях кореня
 * @param {{
 *   hasBunSqlImport: boolean,
 *   hasCapacitorConfig: boolean,
 *   hasCargoToml: boolean,
 *   hasDockerfile: boolean,
 *   hasGqlTaggedTemplates: boolean,
 *   hasHasuraConfig: boolean,
 *   hasJsLikeSource: boolean,
 *   hasNginxDefaultTplFile: boolean,
 *   hasRegoFile: boolean,
 *   hasVueOrCssSource: boolean,
 *   hasVueSource: boolean
 * }} facts агреговані факти
 * @returns {Promise<void>}
 */
async function processFileEntry(absPath, root, facts) {
  const rel = relative(root, absPath).split('\\').join('/')
  const fileName = basename(absPath)
  updateFileFacts(fileName, rel, facts)
  if (shouldScanFileForGql(rel, facts)) {
    await updateGqlFactFromFile(absPath, rel, facts)
  }
  if (shouldScanFileForBunSql(rel, facts)) {
    await updateBunSqlFactFromFile(absPath, rel, facts)
  }
  await updateHasuraFactFromFile(absPath, fileName, facts)
}

/**
 * Нормалізує список ідентифікаторів (trim + lowercase + унікальність збереженням порядку).
 * @param {unknown} value вихідне значення з `.n-cursor.json`
 * @returns {string[]} масив id у нормалізованому вигляді
 */
export function normalizeIdList(value) {
  if (!Array.isArray(value)) {
    return []
  }
  const out = []
  for (const item of value) {
    const normalized = String(item).trim().toLowerCase()
    if (normalized && !out.includes(normalized)) {
      out.push(normalized)
    }
  }
  return out
}

/**
 * Повертає URL репозиторію з package.json (`repository` може бути рядком або обʼєктом).
 * @param {unknown} repository значення `packageJson.repository`
 * @returns {string | null} URL або null
 */
export function getRepositoryUrl(repository) {
  if (typeof repository === 'string') {
    return repository
  }
  if (repository && typeof repository === 'object' && !Array.isArray(repository)) {
    const url = /** @type {Record<string, unknown>} */ (repository).url
    if (typeof url === 'string') {
      return url
    }
  }
  return null
}

/**
 * Чи package.json виглядає як монорепо (поле `workspaces`).
 * @param {unknown} packageJson кореневий package.json як JS-обʼєкт
 * @returns {boolean} true, якщо оголошено workspaces
 */
export function isMonorepoPackage(packageJson) {
  if (packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    return false
  }
  const workspaces = /** @type {Record<string, unknown>} */ (packageJson).workspaces
  if (Array.isArray(workspaces)) {
    return workspaces.length > 0
  }
  if (workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)) {
    const packages = /** @type {Record<string, unknown>} */ (workspaces).packages
    return Array.isArray(packages) && packages.length > 0
  }
  return false
}

/**
 * Обходить дерево проєкту, збираючи факти для автоувімкнення правил.
 * @param {string} root абсолютний шлях кореня репозиторію
 * @returns {Promise<{
 *   hasCapacitorConfig: boolean,
 *   hasCargoToml: boolean,
 *   hasDockerfile: boolean,
 *   hasGaWorkflowsDir: boolean,
 *   hasBunSqlImport: boolean,
 *   hasGqlTaggedTemplates: boolean,
 *   hasHasuraConfig: boolean,
 *   hasJsLikeSource: boolean,
 *   hasK8sDir: boolean,
 *   hasNginxDefaultTplFile: boolean,
 *   hasRegoFile: boolean,
 *   hasTempoDir: boolean,
 *   hasVueSource: boolean,
 *   hasVueOrCssSource: boolean
 * }>} агреговані факти
 */
export async function collectAutoRuleFacts(root) {
  const facts = {
    hasBunSqlImport: false,
    hasCapacitorConfig: false,
    hasCargoToml: false,
    hasDockerfile: false,
    hasGaWorkflowsDir: existsSync(join(root, '.github', 'workflows')),
    hasGqlTaggedTemplates: false,
    hasHasuraConfig: false,
    hasJsLikeSource: false,
    hasK8sDir: false,
    hasNginxDefaultTplFile: false,
    hasRegoFile: false,
    hasTempoDir: false,
    hasVueSource: false,
    hasVueOrCssSource: false
  }

  /**
   * Рекурсивний обхід каталогу з пропуском службових директорій.
   * @param {string} dir абсолютний шлях каталогу
   * @returns {Promise<void>}
   */
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const absPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const isIgnoredDir = IGNORED_DIR_NAMES.has(entry.name)
        if (!isIgnoredDir) {
          updateDirFacts(entry.name, facts)
          await walk(absPath)
        }
      } else if (entry.isFile()) {
        await processFileEntry(absPath, root, facts)
      }
    }
  }

  await walk(root)
  return facts
}

/**
 * Транзитивно розгортає правила за `AUTO_RULE_DEPENDENCIES`: повторно проходить
 * усіма парами «правило → залежності» доки на одному з проходів не зʼявляється
 * нове додавання. Це дозволяє ланцюги (`a → b → c`) і не вимагає від автора правил
 * стежити за порядком викликів `addRule`.
 * @param {string[]} detectedRules уже зібрані id правил (мутується через addRule)
 * @param {(ruleId: string) => void} addRule callback із спільної фабрики (поважає `disable-rules` і дублі)
 * @returns {void}
 */
function resolveRuleDependencies(detectedRules, addRule) {
  let changed = true
  while (changed) {
    changed = false
    for (const [ruleId, deps] of Object.entries(AUTO_RULE_DEPENDENCIES)) {
      if (detectedRules.includes(ruleId)) continue
      if (deps.every(d => detectedRules.includes(d))) {
        const before = detectedRules.length
        addRule(ruleId)
        if (detectedRules.length > before) changed = true
      }
    }
  }
}

/**
 * Визначає авто-правила згідно з `rules/<rule>/auto.md`.
 * @param {object} params параметри аналізу
 * @param {string} params.root абсолютний шлях до кореня репозиторію
 * @param {string[]} params.availableRules перелік доступних правил з пакету
 * @param {unknown} params.packageJsonParsed кореневий package.json (розпарсений) або null
 * @param {string[]} [params.disableRules] список `disable-rules` з конфігу
 * @returns {Promise<{ rules: string[] }>} список id у стабільному порядку (за `AUTO_RULE_ORDER`)
 */
export async function detectAutoRules({
  root,
  availableRules,
  packageJsonParsed,
  disableRules = DEFAULT_DISABLED_LIST
}) {
  const facts = await collectAutoRuleFacts(root)
  const normalizedRules = new Set(availableRules.map(r => r.trim().toLowerCase()))
  const disableRulesSet = new Set(disableRules)

  const packageJsonExists = existsSync(join(root, 'package.json'))
  const npmDirExists = existsSync(join(root, 'npm'))
  const composerJsonExists = existsSync(join(root, 'composer.json'))
  const repositoryUrl = getRepositoryUrl(
    packageJsonParsed && typeof packageJsonParsed === 'object' && !Array.isArray(packageJsonParsed)
      ? /** @type {Record<string, unknown>} */ (packageJsonParsed).repository
      : null
  )
  const isAbie = typeof repositoryUrl === 'string' && repositoryUrl.toLowerCase().includes(ABIE_REPOSITORY_URL_MARKER)
  const isEfes = typeof repositoryUrl === 'string' && repositoryUrl.toLowerCase().includes(EFES_REPOSITORY_URL_MARKER)
  const depHits = await collectDependencyKeysPresentInPackageJsonTree(root, [
    'mssql',
    'pg',
    'pg-format',
    'mysql2',
    'ioredis',
    'node-redis'
  ])
  const hasMssqlDependency = depHits.has('mssql')
  const hasJsBunDbSignal =
    depHits.has('pg') || depHits.has('pg-format') || depHits.has('mysql2') || facts.hasBunSqlImport
  const hasJsBunRedisSignal = depHits.has('ioredis') || depHits.has('node-redis')
  const hasNestedNodePackage = await hasNestedPackageJsonWithoutViteDevDependency(root)

  /** @type {string[]} */
  const detectedRules = []

  /**
   * Додає правило до результату, якщо воно доступне і не в disable-списку.
   * @param {string} ruleId id правила
   * @returns {void}
   */
  function addRule(ruleId) {
    if (!normalizedRules.has(ruleId) || disableRulesSet.has(ruleId) || detectedRules.includes(ruleId)) {
      return
    }
    detectedRules.push(ruleId)
  }

  const autoRuleChecks = [
    { enabled: isAbie, id: 'abie' },
    { enabled: packageJsonExists, id: 'bun' },
    { enabled: facts.hasCapacitorConfig, id: 'capacitor' },
    { enabled: facts.hasDockerfile, id: 'docker' },
    { enabled: isEfes, id: 'efes' },
    { enabled: facts.hasGaWorkflowsDir, id: 'ga' },
    { enabled: facts.hasGqlTaggedTemplates, id: 'graphql' },
    { enabled: facts.hasHasuraConfig, id: 'hasura' },
    { enabled: facts.hasJsLikeSource, id: 'js-lint' },
    { enabled: hasMssqlDependency, id: 'js-mssql' },
    { enabled: hasJsBunDbSignal, id: 'js-bun-db' },
    { enabled: hasJsBunRedisSignal, id: 'js-bun-redis' },
    { enabled: hasNestedNodePackage, id: 'js-run' },
    { enabled: facts.hasK8sDir, id: 'k8s' },
    { enabled: facts.hasNginxDefaultTplFile, id: 'nginx-default-tpl' },
    { enabled: npmDirExists, id: 'npm-module' },
    { enabled: composerJsonExists, id: 'php' },
    { enabled: facts.hasRegoFile, id: 'rego' },
    { enabled: facts.hasCargoToml, id: 'rust' },
    { enabled: facts.hasVueOrCssSource, id: 'style-lint' }
  ]
  for (const item of autoRuleChecks) {
    if (item.enabled) {
      addRule(item.id)
    }
  }
  addRule('adr')
  addRule('security')
  addRule('text')
  if (facts.hasVueSource) {
    addRule('vue')
  }
  resolveRuleDependencies(detectedRules, addRule)

  const rules = AUTO_RULE_ORDER.filter(ruleId => detectedRules.includes(ruleId))
  return { rules }
}

/**
 * Доповнює конфіг автодетектом (лише додає; існуючі вручну задані елементи не прибирає).
 * @param {object} params параметри оновлення
 * @param {{ rules: unknown, skills?: unknown, ['disable-rules']?: unknown, ['disable-skills']?: unknown }} params.config розпарсений `.n-cursor.json`
 * @param {string[]} params.detectedRules правила, визначені автодетектом
 * @param {string[]} params.detectedSkills skills, визначені автодетектом
 * @returns {{ rules: string[], skills: string[] } & Record<string, unknown>} новий нормалізований конфіг
 */
export function mergeConfigWithAutoDetected({ config, detectedRules, detectedSkills }) {
  const existingRules = migrateRuleIds(normalizeIdList(config.rules))
  const existingSkills = normalizeIdList(config.skills)
  const disableRules = migrateRuleIds(normalizeIdList(config['disable-rules']))
  const disableSkills = normalizeIdList(config['disable-skills'])

  const rules = [...existingRules]
  for (const id of detectedRules) {
    if (!rules.includes(id) && !disableRules.includes(id)) {
      rules.push(id)
    }
  }

  const skills = [...existingSkills]
  for (const id of detectedSkills) {
    if (!skills.includes(id) && !disableSkills.includes(id)) {
      skills.push(id)
    }
  }

  /** @type {{ rules: string[], skills: string[] } & Record<string, unknown>} */
  const normalized = { rules, skills }
  if (disableRules.length > 0) {
    normalized['disable-rules'] = disableRules
  }
  if (disableSkills.length > 0) {
    normalized['disable-skills'] = disableSkills
  }
  return normalized
}
