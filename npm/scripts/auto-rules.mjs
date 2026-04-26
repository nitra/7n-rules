/**
 * Автовизначення правил і skills для `.n-cursor.json` за умовами з `npm/bin/auto-rules.md`.
 *
 * Модуль аналізує дерево проєкту (наявність файлів/директорій, `gql\`...\`` у source, кореневий
 * `package.json`) та повертає ідентифікатори правил і skills, які потрібно автододати.
 *
 * Також враховує винятки `disable-rules` і `disable-skills`: елементи з цих списків не
 * додаються автоматично.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

import {
  isGqlScanSourceFile,
  shouldSkipFileForGqlScan,
  sourceFileHasGqlTaggedTemplate
} from './utils/graphql-gql-scan.mjs'

/** Порядок автододавання правил відповідно до `auto-rules.md`. */
export const AUTO_RULE_ORDER = Object.freeze([
  'abie',
  'bun',
  'docker',
  'ga',
  'graphql',
  'js-lint',
  'js-mssql',
  'js-pino',
  'k8s',
  'nginx-default-tpl',
  'npm-module',
  'php',
  'style-lint',
  'text',
  'vue'
])

/** Порядок автододавання skills відповідно до `auto-rules.md`. */
export const AUTO_SKILL_ORDER = Object.freeze(['abie-kustomize', 'fix', 'lint'])

const ABIE_REPOSITORY_URL_MARKER = 'https://github.com/abinbevefes/'
const JS_LIKE_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/iu
const STYLE_RE = /\.(?:css|vue)$/iu
const VUE_RE = /\.vue$/iu
const PHP_RE = /\.php$/iu
const NGINX_DEFAULT_FILES = new Set(['default.conf.template', 'default.conf', 'nginx.conf'])
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])
const DEFAULT_DISABLED_LIST = Object.freeze([])

/**
 * Чи є `mssql` у `dependencies` хоча б одного `package.json` у репозиторії.
 * @param {string} root абсолютний шлях до кореня репозиторію
 * @returns {Promise<boolean>} true, якщо знайдено `dependencies.mssql`
 */
async function hasMssqlDependencyInAnyPackageJson(root) {
  let found = false

  /**
   * Рекурсивний обхід каталогу з пропуском службових директорій.
   * @param {string} dir абсолютний шлях каталогу
   * @returns {Promise<void>}
   */
  async function walk(dir) {
    if (found) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found) return
      const absPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const isIgnoredDir = IGNORED_DIR_NAMES.has(entry.name)
        if (!isIgnoredDir) {
          await walk(absPath)
        }
      } else if (entry.isFile() && entry.name === 'package.json') {
        try {
          const parsed = JSON.parse(await readFile(absPath, 'utf8'))
          const deps = parsed?.dependencies
          if (deps && typeof deps === 'object' && !Array.isArray(deps) && Object.hasOwn(deps, 'mssql')) {
            found = true
            return
          }
        } catch {
          /* ігноруємо пошкоджені/недоступні package.json */
        }
      }
    }
  }

  await walk(root)
  return found
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
 *   hasDockerfile: boolean,
 *   hasJsLikeSource: boolean,
 *   hasNginxDefaultTplFile: boolean,
 *   hasPhpSource: boolean,
 *   hasVueOrCssSource: boolean,
 *   hasVueSource: boolean
 * }} facts агреговані факти
 * @returns {void}
 */
function updateFileFacts(fileName, relPath, facts) {
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
  if (PHP_RE.test(relPath)) {
    facts.hasPhpSource = true
  }
  if (STYLE_RE.test(relPath)) {
    facts.hasVueOrCssSource = true
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
 * Обробляє файл під час обходу дерева.
 * @param {string} absPath абсолютний шлях до файлу
 * @param {string} root абсолютний шлях кореня
 * @param {{
 *   hasDockerfile: boolean,
 *   hasGqlTaggedTemplates: boolean,
 *   hasJsLikeSource: boolean,
 *   hasNginxDefaultTplFile: boolean,
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
 *   hasDockerfile: boolean,
 *   hasGaWorkflowsDir: boolean,
 *   hasGqlTaggedTemplates: boolean,
 *   hasJsLikeSource: boolean,
 *   hasK8sDir: boolean,
 *   hasNginxDefaultTplFile: boolean,
 *   hasTempoDir: boolean,
 *   hasPhpSource: boolean,
 *   hasVueSource: boolean,
 *   hasVueOrCssSource: boolean
 * }>} агреговані факти
 */
export async function collectAutoRuleFacts(root) {
  const facts = {
    hasDockerfile: false,
    hasGaWorkflowsDir: existsSync(join(root, '.github', 'workflows')),
    hasGqlTaggedTemplates: false,
    hasJsLikeSource: false,
    hasK8sDir: false,
    hasNginxDefaultTplFile: false,
    hasTempoDir: false,
    hasPhpSource: false,
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
 * Визначає авто-правила та skills згідно з `auto-rules.md`.
 * @param {object} params параметри аналізу
 * @param {string} params.root абсолютний шлях до кореня репозиторію
 * @param {string[]} params.availableRules перелік доступних правил з пакету
 * @param {string[]} params.availableSkills перелік доступних skills з пакету
 * @param {unknown} params.packageJsonParsed кореневий package.json (розпарсений) або null
 * @param {string[]} [params.disableRules] список `disable-rules` з конфігу
 * @param {string[]} [params.disableSkills] список `disable-skills` з конфігу
 * @returns {Promise<{ rules: string[], skills: string[] }>} списки id у стабільному порядку
 */
export async function detectAutoRulesAndSkills({
  root,
  availableRules,
  availableSkills,
  packageJsonParsed,
  disableRules = DEFAULT_DISABLED_LIST,
  disableSkills = DEFAULT_DISABLED_LIST
}) {
  const facts = await collectAutoRuleFacts(root)
  const normalizedRules = new Set(availableRules.map(r => r.trim().toLowerCase()))
  const normalizedSkills = new Set(availableSkills.map(s => s.trim().toLowerCase()))
  const disableRulesSet = new Set(disableRules)
  const disableSkillsSet = new Set(disableSkills)

  const packageJsonExists = existsSync(join(root, 'package.json'))
  const npmDirExists = existsSync(join(root, 'npm'))
  const repositoryUrl = getRepositoryUrl(
    packageJsonParsed && typeof packageJsonParsed === 'object' && !Array.isArray(packageJsonParsed)
      ? /** @type {Record<string, unknown>} */ (packageJsonParsed).repository
      : null
  )
  const isAbie = typeof repositoryUrl === 'string' && repositoryUrl.toLowerCase().includes(ABIE_REPOSITORY_URL_MARKER)
  const isMonorepo = isMonorepoPackage(packageJsonParsed)
  const hasMssqlDependency = await hasMssqlDependencyInAnyPackageJson(root)

  /** @type {string[]} */
  const detectedRules = []
  /** @type {string[]} */
  const detectedSkills = []

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

  /**
   * Додає skill до результату, якщо він доступний і не в disable-списку.
   * @param {string} skillId id skill
   * @returns {void}
   */
  function addSkill(skillId) {
    if (!normalizedSkills.has(skillId) || disableSkillsSet.has(skillId) || detectedSkills.includes(skillId)) {
      return
    }
    detectedSkills.push(skillId)
  }

  const autoRuleChecks = [
    { enabled: isAbie, id: 'abie' },
    { enabled: packageJsonExists, id: 'bun' },
    { enabled: facts.hasDockerfile, id: 'docker' },
    { enabled: facts.hasGaWorkflowsDir, id: 'ga' },
    { enabled: facts.hasGqlTaggedTemplates, id: 'graphql' },
    { enabled: facts.hasJsLikeSource, id: 'js-lint' },
    { enabled: hasMssqlDependency, id: 'js-mssql' },
    { enabled: facts.hasJsLikeSource && !(isMonorepo && facts.hasVueSource && facts.hasTempoDir), id: 'js-pino' },
    { enabled: facts.hasK8sDir, id: 'k8s' },
    { enabled: facts.hasNginxDefaultTplFile, id: 'nginx-default-tpl' },
    { enabled: npmDirExists, id: 'npm-module' },
    { enabled: facts.hasPhpSource, id: 'php' },
    { enabled: facts.hasVueOrCssSource, id: 'style-lint' }
  ]
  for (const item of autoRuleChecks) {
    if (item.enabled) {
      addRule(item.id)
    }
  }
  addRule('text')
  if (facts.hasVueSource) {
    addRule('vue')
  }

  const autoSkillChecks = [
    { enabled: isAbie, id: 'abie-kustomize' },
    { enabled: true, id: 'fix' },
    { enabled: true, id: 'lint' }
  ]
  for (const item of autoSkillChecks) {
    if (item.enabled) {
      addSkill(item.id)
    }
  }

  const rules = AUTO_RULE_ORDER.filter(ruleId => detectedRules.includes(ruleId))
  const skills = AUTO_SKILL_ORDER.filter(skillId => detectedSkills.includes(skillId))
  return { rules, skills }
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
  const existingRules = normalizeIdList(config.rules)
  const existingSkills = normalizeIdList(config.skills)
  const disableRules = normalizeIdList(config['disable-rules'])
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
