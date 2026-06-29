/**
 * Автовизначення правил для `.n-cursor.json` за meta-даними з `npm/rules/<id>/main.json`.
 *
 * Основна роль: `discoverRuleAutoActivation` читає `npm/rules/<id>/main.json`, виводить
 * `AUTO_RULE_ORDER` (алфавітно) і `AUTO_RULE_DEPENDENCIES` з meta, а потім для кожного правила
 * обчислює spec активації через `specMatches`: `always` — безумовно; `glob` — перевірка
 * файлів через `globToRegex`; `predicate` — незводимий предикат із реєстру `RULE_PREDICATES`
 * (у `lib/rule-predicates.mjs`). Транзитивне розгортання залежностей — `resolveRuleDependencies`.
 *
 * `collectAutoRuleFacts` зберігається для content-фактів (GQL, bun-sql, hasura) і власних тестів.
 *
 * Враховує винятки `disable-rules`: елементи зі списку не додаються автоматично.
 *
 * Автодетект скілів — у `./auto-skills.mjs` (умови — у `npm/skills/<skill>/main.json`).
 * `mergeConfigWithAutoDetected` нижче приймає вже виявлені rules і skills і вливає
 * їх у конфіг із поправкою на legacy-id (`migrateRuleIds`).
 */
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { globby } from 'globby'

import { ALWAYS_IGNORE } from './utils/walkDir.mjs'
import { globToRegex } from '../rules/npm-module/package_structure/main.mjs'
import { textHasBunSqlImport } from '../rules/js-bun-db/lib/bun-sql-scan.mjs'
import {
  isGqlScanSourceFile,
  shouldSkipFileForGqlScan,
  sourceFileHasGqlTaggedTemplate
} from '../rules/graphql/lib/graphql-gql-scan.mjs'
import { contentForVueImportScan } from '../rules/vue/lib/vue-forbidden-imports.mjs'
import { parseRuleAutoSpec, readRuleMetaRaw } from './lib/rule-meta.mjs'
import { migrateRuleIds, normalizeIdList } from './lib/rule-meta-helpers.mjs'
import { RULE_PREDICATES } from './lib/rule-predicates.mjs'

export {
  detectLegacyRuleIds,
  getRepositoryUrl,
  isMonorepoPackage,
  migrateRuleIds,
  normalizeIdList,
  RULE_MIGRATIONS
} from './lib/rule-meta-helpers.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * Скан `npm/rules/<id>/main.json` → мапа id → RuleAutoSpec (лише правила з розпізнаним auto).
 * @param {string} [rulesDir] override для тестів
 * @returns {Record<string, import('./lib/rule-meta.mjs').RuleAutoSpec>} мапа автоактивації
 */
export function discoverRuleAutoActivation(rulesDir = RULES_DIR) {
  /** @type {Record<string, import('./lib/rule-meta.mjs').RuleAutoSpec>} */
  const out = {}
  let entries
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const raw = readRuleMetaRaw(join(rulesDir, entry.name))
    if (!raw) continue
    const spec = parseRuleAutoSpec(raw.auto)
    if (spec) out[entry.name] = spec
  }
  return out
}

const RULE_AUTO_ACTIVATION = discoverRuleAutoActivation()

/** Стабільний алфавітний порядок (замість хардкод-масиву). */
export const AUTO_RULE_ORDER = Object.freeze(Object.keys(RULE_AUTO_ACTIVATION).toSorted((a, b) => a.localeCompare(b)))

/** Граф залежностей із meta (Type C) — замість хардкод-константи. */
export const AUTO_RULE_DEPENDENCIES = Object.freeze(
  Object.fromEntries(
    Object.entries(RULE_AUTO_ACTIVATION)
      .filter(([, s]) => 'rules' in s)
      .map(([id, s]) => [id, Object.freeze(/** @type {{rules:string[]}} */ (s).rules)])
  )
)

const HASURA_CONFIG_MARKER = 'metadata_directory: metadata'
const REGO_RE = /\.rego$/iu
const DEFAULT_DISABLED_LIST = Object.freeze([])

/**
 * Збирає relative-posix шляхи дерева (файли + директорії), **поважаючи `.gitignore`** —
 * через той самий `globby`-канон, що й `walkDir` (звідси `ALWAYS_IGNORE`). Спільне джерело
 * для `collectRepoPaths` (Type A glob-матчинг) і `collectAutoRuleFacts` (content-факти).
 * Раніше тут був ручний `readdir`-обхід із хардкод skip-набором, який ігнорував `.gitignore`
 * і помилково активував правила на згенерованих артефактах (`coverage/*.png` → image-compress).
 * @param {string} root абсолютний шлях кореня репозиторію
 * @returns {Promise<{ files: string[], dirs: string[] }>} relative-posix шляхи файлів і директорій
 */
async function collectTreePaths(root) {
  const opts = { cwd: root, gitignore: true, dot: true, ignore: ALWAYS_IGNORE }
  try {
    const [files, dirs] = await Promise.all([
      globby('**/*', { ...opts, onlyFiles: true }),
      globby('**/*', { ...opts, onlyDirectories: true })
    ])
    return { files, dirs }
  } catch {
    return { files: [], dirs: [] }
  }
}

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
 * Обробляє файл під час обходу дерева — оновлює content-факти, потрібні предикатам,
 * та `hasRegoFile` (тримається для прямих читачів `collectAutoRuleFacts`).
 * @param {string} absPath абсолютний шлях до файлу
 * @param {string} root абсолютний шлях кореня
 * @param {{
 *   hasBunSqlImport: boolean,
 *   hasGqlTaggedTemplates: boolean,
 *   hasHasuraConfig: boolean,
 *   hasRegoFile: boolean
 * }} facts агреговані факти
 * @returns {Promise<void>}
 */
async function processFileEntry(absPath, root, facts) {
  const rel = relative(root, absPath).split('\\').join('/')
  const fileName = basename(absPath)
  if (REGO_RE.test(rel)) {
    facts.hasRegoFile = true
  }
  if (shouldScanFileForGql(rel, facts)) {
    await updateGqlFactFromFile(absPath, rel, facts)
  }
  if (shouldScanFileForBunSql(rel, facts)) {
    await updateBunSqlFactFromFile(absPath, rel, facts)
  }
  await updateHasuraFactFromFile(absPath, fileName, facts)
}

/**
 * Обходить дерево проєкту, збираючи content-факти для предикатів автоувімкнення.
 *
 * `hasRegoFile` і `hasTempoDir` лишаються для зворотної сумісності з прямими читачами
 * фактів (тести, зовнішній код); саме автоувімкнення тепер data-driven через main.json.
 * @param {string} root абсолютний шлях кореня репозиторію
 * @returns {Promise<{
 *   hasBunSqlImport: boolean,
 *   hasGqlTaggedTemplates: boolean,
 *   hasHasuraConfig: boolean,
 *   hasRegoFile: boolean,
 *   hasTempoDir: boolean
 * }>} агреговані факти
 */
export async function collectAutoRuleFacts(root) {
  const facts = {
    hasBunSqlImport: false,
    hasGqlTaggedTemplates: false,
    hasHasuraConfig: false,
    hasRegoFile: false,
    hasTempoDir: false
  }

  const { files, dirs } = await collectTreePaths(root)
  if (dirs.some(d => basename(d) === 'tempo')) {
    facts.hasTempoDir = true
  }
  for (const rel of files) {
    await processFileEntry(join(root, rel), root, facts)
  }
  return facts
}

/**
 * Збирає relative-posix шляхи дерева (і файли, і каталоги) для glob-матчингу Type A.
 *
 * Каталоги теж потрапляють у вихід, бо частина glob-специфікацій вказує на самі директорії
 * (наприклад `npm`, `k8s`, `.github/workflows`), які можуть бути порожніми — без цього
 * правила npm-module/k8s/ga не активувалися б на дереві без файлів усередині.
 * @param {string} root корінь репо
 * @returns {Promise<string[]>} шляхи відносно root у posix-форматі
 */
async function collectRepoPaths(root) {
  const { files, dirs } = await collectTreePaths(root)
  return [...dirs, ...files]
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
 * Чи активується правило за його spec.
 *
 * Диспетчинг предикатів за іменем (сигнатури неоднорідні — див. `rule-predicates.mjs`):
 *  - `repoUrlMarker` читає кореневий `package.json` + маркер-arg;
 *  - `gqlTaggedTemplate`, `hasuraConfigMarker` читають content-`facts`;
 *  - `jsBunDbSignal` бере `(root, facts)`;
 *  - решта (`depInAnyPackageJson`, `nestedPackageWithoutVite`) — `(root, arg)`.
 * @param {import('./lib/rule-meta.mjs').RuleAutoSpec} spec нормалізований auto
 * @param {{root:string, facts:object, paths:string[], packageJsonParsed:unknown}} ctx контекст
 * @returns {Promise<boolean>} true, якщо правило активне
 */
function specMatches(spec, ctx) {
  if ('always' in spec) return true
  if ('glob' in spec) {
    const res = spec.glob.map(g => globToRegex(g))
    return ctx.paths.some(p => res.some(re => re.test(p)))
  }
  if ('predicate' in spec) {
    const fn = RULE_PREDICATES[spec.predicate]
    if (!fn) return false
    if (spec.predicate === 'repoUrlMarker') return fn(ctx.packageJsonParsed, spec.arg)
    if (spec.predicate === 'gqlTaggedTemplate' || spec.predicate === 'hasuraConfigMarker') return fn(ctx.facts)
    if (spec.predicate === 'jsBunDbSignal') return fn(ctx.root, ctx.facts)
    return fn(ctx.root, spec.arg)
  }
  return false
}

/**
 * Визначає авто-правила згідно з `rules/<rule>/main.json`.
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
  const paths = await collectRepoPaths(root)
  const normalizedRules = new Set(availableRules.map(r => r.trim().toLowerCase()))
  const disableRulesSet = new Set(disableRules)

  /** @type {string[]} */
  const detectedRules = []
  /**
   * Додає правило до результату, якщо воно доступне і не в disable-списку.
   * @param {string} ruleId id правила
   * @returns {void}
   */
  function addRule(ruleId) {
    if (!normalizedRules.has(ruleId) || disableRulesSet.has(ruleId) || detectedRules.includes(ruleId)) return
    detectedRules.push(ruleId)
  }

  for (const [ruleId, spec] of Object.entries(RULE_AUTO_ACTIVATION)) {
    if ('rules' in spec) continue
    if (await specMatches(spec, { root, facts, paths, packageJsonParsed })) addRule(ruleId)
  }
  resolveRuleDependencies(detectedRules, addRule)

  const rules = AUTO_RULE_ORDER.filter(r => detectedRules.includes(r))
  return { rules }
}

/**
 * Розділяє список id на доступні в пакеті й застарілі (відсутні).
 * Без `available` нічого не прибирає — усе вважається доступним.
 * @param {string[]} ids перелік id (rules або skills)
 * @param {string[] | undefined} available id, що реально є у каталозі пакета
 * @returns {{ kept: string[], pruned: string[] }} відфільтровані й прибрані id
 */
function partitionByAvailability(ids, available) {
  if (!available) return { kept: ids, pruned: [] }
  const availableSet = new Set(available)
  const kept = []
  const pruned = []
  for (const id of ids) {
    if (availableSet.has(id)) kept.push(id)
    else pruned.push(id)
  }
  return { kept, pruned }
}

/**
 * Доповнює конфіг автодетектом (лише додає; існуючі вручну задані елементи не прибирає),
 * а за наявності `availableRules`/`availableSkills` ще й прибирає з `rules`/`skills`
 * неактуальні id, яких уже немає у пакеті (наприклад, правило чи скіл видалено з нової
 * версії \@nitra/cursor) — інакше sync щоразу падав би на завантаженні відсутнього
 * `rules/<id>.mdc` чи `skills/<id>/`. Прибрані id повертаються у полі `pruned` (для логу).
 * @param {object} params параметри оновлення
 * @param {{ rules: unknown, skills?: unknown, ['disable-rules']?: unknown, ['disable-skills']?: unknown }} params.config розпарсений `.n-cursor.json`
 * @param {string[]} params.detectedRules правила, визначені автодетектом
 * @param {string[]} params.detectedSkills skills, визначені автодетектом
 * @param {string[]} [params.availableRules] id правил, наявних у каталозі `rules/` пакета (для відсіву неактуальних)
 * @param {string[]} [params.availableSkills] id skills, наявних у каталозі `skills/` пакета (для відсіву неактуальних)
 * @returns {{ rules: string[], skills: string[], pruned?: { rules: string[], skills: string[] } } & Record<string, unknown>} новий нормалізований конфіг
 */
export function mergeConfigWithAutoDetected({
  config,
  detectedRules,
  detectedSkills,
  availableRules,
  availableSkills
}) {
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

  const { kept: keptRules, pruned: prunedRules } = partitionByAvailability(rules, availableRules)
  const { kept: keptSkills, pruned: prunedSkills } = partitionByAvailability(skills, availableSkills)

  /** @type {{ rules: string[], skills: string[], pruned?: { rules: string[], skills: string[] } } & Record<string, unknown>} */
  const normalized = { rules: keptRules, skills: keptSkills }
  if (disableRules.length > 0) {
    normalized['disable-rules'] = disableRules
  }
  if (disableSkills.length > 0) {
    normalized['disable-skills'] = disableSkills
  }
  if (prunedRules.length > 0 || prunedSkills.length > 0) {
    normalized.pruned = { rules: prunedRules, skills: prunedSkills }
  }
  return normalized
}
