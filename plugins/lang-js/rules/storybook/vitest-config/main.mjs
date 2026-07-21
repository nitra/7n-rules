/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import { parseSync } from 'oxc-parser'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { collectInScopeVuePackages } from '../scope/main.mjs'
import { detectStoriesGlob } from '../scaffold/main.mjs'

// Канонічні назви vitest-конфіга пакета (пріоритет .mjs — нові файли, js.mdc);
// .ts підтримано для "стійкості до варіацій" (vitest-config.mdc).
export const VITEST_CONFIG_NAMES = ['vitest.config.mjs', 'vitest.config.js', 'vitest.config.ts']
// Ті самі варіанти, що й `vite.config.*` у scope/main.mjs (не експортовано звідти — дублюємо).
const VITE_CONFIG_NAMES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']

/** Import, який має бути присутній у файлі, щоб `storybookTest(...)` резолвився. */
export const STORYBOOK_TEST_IMPORT = "import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'\n"

// Стабільні reasons (namespace: ruleId/concernId/reason).
export const REASON_VITEST_CONFIG_MISSING = 'vitest-config-missing'
export const REASON_STRYKER_CONFIG_MISSING = 'stryker-config-missing'
export const REASON_CONFIG_UNRESOLVABLE = 'vitest-config-unresolvable'
export const REASON_PROJECTS_DYNAMIC = 'projects-dynamic'
export const REASON_UNIT_PROJECT_MISSING = 'unit-project-missing'
export const REASON_STORYBOOK_PROJECT_MISSING = 'storybook-project-missing'
export const REASON_STORYBOOK_PROJECT_MARKER_MISSING = 'storybook-project-marker-missing'

// Маркери канонічного storybook-проєкту (текстовий пошук у зрізі джерела самого
// елемента масиву — стійко до форматування/AST-варіацій, як і scaffold/main.mjs).
// Три останні (chromium/browser/stories) експортовано — переюз у `adopt/main.mjs`.
const UNIT_NAME_RE = /name\s*:\s*['"]unit['"]/u
const STORYBOOK_NAME_RE = /name\s*:\s*['"]storybook['"]/u
export const CHROMIUM_RE = /chromium/u
export const BROWSER_KEY_RE = /\bbrowser\s*:/u
export const STORIES_RE = /stories/iu
const STORIES_GLOB_PREFIX_RE = /^\.\.\//u
// Module-scope (prefer-static-regex): рядок-відступ цілком whitespace; leading
// кома (можливо з whitespace) — спільні з fix-vitest-config.mjs патерном augment-у.
export const WHITESPACE_ONLY_RE = /^\s*$/u
export const LEADING_COMMA_RE = /^\s*,/u

/**
 * Резолвить абсолютний шлях наявного `vitest.config.*` пакета (перший знайдений
 * за пріоритетом {@link VITEST_CONFIG_NAMES}), або `null` якщо жодного немає.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {string | null} абсолютний шлях конфіга або null
 */
export function resolveVitestConfigPath(absPkgDir) {
  const name = VITEST_CONFIG_NAMES.find(n => existsSync(join(absPkgDir, n)))
  return name ? join(absPkgDir, name) : null
}

/**
 * Резолвить ім'я `vite.config.*` пакета для import-шляху в baseline-шаблонах
 * (той самий файл, що й `viteFinal` у `.storybook/main.js`). Пакет у скоупі
 * гарантовано має один із них (`scope/main.mjs#hasStandardBuild`).
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {string} ім'я файлу vite-конфіга (дефолт `vite.config.js`)
 */
export function resolveViteConfigName(absPkgDir) {
  return VITE_CONFIG_NAMES.find(n => existsSync(join(absPkgDir, n))) ?? 'vite.config.js'
}

/**
 * Шлях до ізольованого `vitest.stryker.config.*` — той самий каталог і
 * розширення, що й основний vitest-конфіг пакета.
 * @param {string} vitestConfigPath абсолютний шлях `vitest.config.*`
 * @returns {string} абсолютний шлях `vitest.stryker.config.*`
 */
export function strykerConfigPathFor(vitestConfigPath) {
  return join(dirname(vitestConfigPath), `vitest.stryker.config${extname(vitestConfigPath)}`)
}

/**
 * Stories-glob для vitest-конфіга пакета (на відміну від `detectStoriesGlob`
 * scaffold-концерна — той повертає шлях відносно `.storybook/`, тут vitest-конфіг
 * лежить у корені пакета, тож префікс `../` треба зняти).
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {string} glob відносно кореня пакета
 */
export function storiesGlobForVitestConfig(absPkgDir) {
  return detectStoriesGlob(absPkgDir).replace(STORIES_GLOB_PREFIX_RE, '')
}

/**
 * Парсить JS/TS файл через oxc-parser з обраним lang за розширенням.
 * @param {string} absPath абсолютний шлях файлу (для diagnostics парсера)
 * @param {string} src вміст файлу
 * @returns {{program: object, errors?: Array<{message: string}>}} результат парсингу
 */
export function parseModule(absPath, src) {
  const lang = extname(absPath) === '.ts' ? 'ts' : 'js'
  return parseSync(absPath, src, { lang, sourceType: 'module' })
}

/**
 * Рекурсивно шукає перший `ObjectExpression` у довільному AST-вузлі, що має
 * property `test` зі значенням-`ObjectExpression`.
 * @param {unknown} node довільний AST-вузол/масив/примітив
 * @returns {object | null} `test`-ObjectExpression або null
 */
function findTestObjectIn(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'ObjectExpression') {
    const prop = node.properties?.find(
      p =>
        p.type === 'Property' &&
        !p.computed &&
        p.key &&
        (p.key.name === 'test' || p.key.value === 'test') &&
        p.value?.type === 'ObjectExpression'
    )
    if (prop) return prop.value
  }
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        const res = findTestObjectIn(item)
        if (res) return res
      }
    } else if (val && typeof val === 'object') {
      const res = findTestObjectIn(val)
      if (res) return res
    }
  }
  return null
}

/**
 * Шукає перший `ObjectExpression` у дереві AST, що має property `test` зі
 * значенням-`ObjectExpression` — незалежно від того, чи огорнутий він у
 * `defineConfig(...)`/`mergeConfig(...)`, чи це простий об'єкт (стійко до
 * варіацій testing.mdc-канону).
 * @param {object} program oxc Program node
 * @returns {object | null} `test`-ObjectExpression або null
 */
export function findTestObject(program) {
  return findTestObjectIn(program)
}

/**
 * Шукає property `name` у `ObjectExpression`.
 * @param {object} objExpr ObjectExpression node
 * @param {string} name ім'я property
 * @returns {object | null} Property node або null
 */
export function findProperty(objExpr, name) {
  return (
    objExpr.properties.find(
      p => p.type === 'Property' && !p.computed && p.key && (p.key.name === name || p.key.value === name)
    ) ?? null
  )
}

/**
 * Класифікує елементи масиву `test.projects`: чи є `unit`-проєкт, і
 * source-зріз елемента `storybook`-проєкту (для marker-перевірки).
 * @param {string} src вихідний текст vitest-конфіга
 * @param {object} arr ArrayExpression node (`test.projects`)
 * @returns {{hasUnit: boolean, storybookSlice: string | null}} стан projects-масиву
 */
export function classifyProjects(src, arr) {
  let hasUnit = false
  let storybookSlice = null
  for (const el of arr.elements) {
    if (!el || el.type !== 'ObjectExpression') continue
    const slice = src.slice(el.start, el.end)
    if (UNIT_NAME_RE.test(slice)) hasUnit = true
    if (STORYBOOK_NAME_RE.test(slice)) storybookSlice = slice
  }
  return { hasUnit, storybookSlice }
}

/**
 * Будує спільний контекст перевірки одного пакета (label/relPrefix/шлях vitest-конфіга).
 * @param {import('../scope/main.mjs').InScopePackage} entry пакет у скоупі
 * @returns {{rootDir: string, absDir: string, label: string, relPrefix: string, vitestConfigPath: string | null}} контекст
 */
function buildPackageCtx({ rootDir, absDir }) {
  return {
    rootDir,
    absDir,
    label: rootDir === '.' ? 'корінь' : rootDir,
    relPrefix: rootDir === '.' ? '' : `${rootDir}/`,
    vitestConfigPath: resolveVitestConfigPath(absDir)
  }
}

/**
 * Перевіряє `test.projects` наявного vitest-конфіга: parse-помилки, відсутність
 * test-блоку, відсутність/динамічність `projects`, відсутність unit/storybook-
 * записів і канонічних маркерів storybook-запису (chromium/browser/stories).
 * @param {ReturnType<typeof buildPackageCtx>} pkgCtx контекст пакета
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkVitestConfigContent(pkgCtx, reporter) {
  const { label, relPrefix, rootDir, vitestConfigPath } = pkgCtx
  const relVitestFile = `${relPrefix}${basename(vitestConfigPath)}`
  const src = await readFile(vitestConfigPath, 'utf8')

  let parsed
  try {
    parsed = parseModule(vitestConfigPath, src)
  } catch (error) {
    reporter.fail(`[${label}] ${relVitestFile} не парситься (${error.message}) — перевір вручну (vitest-config.mdc)`, {
      reason: REASON_CONFIG_UNRESOLVABLE,
      file: relVitestFile
    })
    return
  }
  if (parsed.errors?.length) {
    reporter.fail(`[${label}] ${relVitestFile} має syntax error — перевір вручну (vitest-config.mdc)`, {
      reason: REASON_CONFIG_UNRESOLVABLE,
      file: relVitestFile
    })
    return
  }

  const testObj = findTestObject(parsed.program)
  if (!testObj) {
    reporter.fail(
      `[${label}] ${relVitestFile}: не вдалось знайти test-блок (defineConfig({ test: {...} })) — додай unit/storybook-projects вручну за template/ (vitest-config.mdc)`,
      { reason: REASON_CONFIG_UNRESOLVABLE, file: relVitestFile }
    )
    return
  }

  const data = { rootDir, vitestConfigPath }
  const projectsProp = findProperty(testObj, 'projects')
  if (!projectsProp) {
    reporter.fail(
      `[${label}] ${relVitestFile}: бракує test.projects (unit) — npx @7n/rules fix storybook (vitest-config.mdc)`,
      {
        reason: REASON_UNIT_PROJECT_MISSING,
        file: relVitestFile,
        data
      }
    )
    reporter.fail(
      `[${label}] ${relVitestFile}: бракує test.projects (storybook) — npx @7n/rules fix storybook (vitest-config.mdc)`,
      {
        reason: REASON_STORYBOOK_PROJECT_MISSING,
        file: relVitestFile,
        data
      }
    )
    return
  }
  if (projectsProp.value?.type !== 'ArrayExpression') {
    reporter.fail(
      `[${label}] ${relVitestFile}: test.projects — не статичний масив (spread/змінна) — додай unit/storybook-projects вручну (vitest-config.mdc)`,
      { reason: REASON_PROJECTS_DYNAMIC, file: relVitestFile }
    )
    return
  }

  const { hasUnit, storybookSlice } = classifyProjects(src, projectsProp.value)
  if (!hasUnit) {
    reporter.fail(
      `[${label}] ${relVitestFile}: test.projects без 'unit' — npx @7n/rules fix storybook (vitest-config.mdc)`,
      {
        reason: REASON_UNIT_PROJECT_MISSING,
        file: relVitestFile,
        data
      }
    )
  }
  if (storybookSlice) {
    const missingHints = []
    if (!CHROMIUM_RE.test(storybookSlice)) missingHints.push('chromium-інстанс')
    if (!BROWSER_KEY_RE.test(storybookSlice)) missingHints.push('browser-mode')
    if (!STORIES_RE.test(storybookSlice)) missingHints.push('stories-glob')
    if (missingHints.length > 0) {
      reporter.fail(
        `[${label}] ${relVitestFile}: storybook-project без канонічних маркерів — бракує: ${missingHints.join(', ')} (vitest-config.mdc)`,
        { reason: REASON_STORYBOOK_PROJECT_MARKER_MISSING, file: relVitestFile, data: { rootDir } }
      )
    }
  } else {
    reporter.fail(
      `[${label}] ${relVitestFile}: test.projects без 'storybook' — npx @7n/rules fix storybook (vitest-config.mdc)`,
      {
        reason: REASON_STORYBOOK_PROJECT_MISSING,
        file: relVitestFile,
        data
      }
    )
  }
}

/**
 * Перевіряє наявність ізольованого `vitest.stryker.config.*` поруч із
 * наявним vitest-конфігом пакета.
 * @param {ReturnType<typeof buildPackageCtx>} pkgCtx контекст пакета
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {void}
 */
function checkStrykerConfigPresence(pkgCtx, reporter) {
  const { label, relPrefix, rootDir, vitestConfigPath } = pkgCtx
  const strykerPath = strykerConfigPathFor(vitestConfigPath)
  if (existsSync(strykerPath)) return
  const relStrykerFile = `${relPrefix}${basename(strykerPath)}`
  reporter.fail(
    `[${label}] відсутній ізольований ${relStrykerFile} — @stryker-mutator/vitest-runner крашиться на browser-mode projects: npx @7n/rules fix storybook (vitest-config.mdc)`,
    { reason: REASON_STRYKER_CONFIG_MISSING, file: relStrykerFile, data: { rootDir, vitestConfigPath } }
  )
}

/**
 * Перевіряє один пакет у скоупі: наявність/канон `vitest.config.*`
 * (`test.projects` — unit+storybook) і наявність ізольованого
 * `vitest.stryker.config.*`.
 * @param {import('../scope/main.mjs').InScopePackage} entry пакет у скоупі
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkPackage(entry, reporter) {
  const pkgCtx = buildPackageCtx(entry)
  if (!pkgCtx.vitestConfigPath) {
    reporter.fail(
      `[${pkgCtx.label}] відсутній vitest.config.{mjs,js,ts} — канонічні projects unit+storybook (vitest-config.mdc): npx @7n/rules fix storybook`,
      {
        reason: REASON_VITEST_CONFIG_MISSING,
        file: `${pkgCtx.relPrefix}vitest.config.mjs`,
        data: { rootDir: pkgCtx.rootDir }
      }
    )
    return
  }

  await checkVitestConfigContent(pkgCtx, reporter)
  checkStrykerConfigPresence(pkgCtx, reporter)
}

/**
 * Перевіряє канонічний vitest-конфіг (unit+storybook projects) і наявність
 * ізольованого `vitest.stryker.config` для всіх пакетів у скоупі Storybook.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const pkgs = await collectInScopeVuePackages(ctx.cwd)

  if (pkgs.length === 0) {
    reporter.pass('storybook: немає Vue component library пакетів у скоупі (vitest-config.mdc)')
    return reporter.result()
  }

  for (const entry of pkgs) {
    await checkPackage(entry, reporter)
  }

  return reporter.result()
}
