/**
 * T0-autofix для concern-а `storybook/vitest-config`: детерміноване приведення
 * vitest-конфіга Vue-компонентної бібліотеки у скоупі Storybook до канону
 * `test.projects` (`unit`+`storybook`, browser-mode лише chromium) і генерація
 * ізольованого `vitest.stryker.config.*` (ADR Кластер 5).
 *
 * Стратегія — та сама, що й `test/stryker_config/fix-stryker_config.mjs`:
 * читання/аналіз (oxc-parser) і запис лише тут; detector (`main.mjs`)
 * read-only. Для вже наявного vitest-конфіга — точкові string-splice-и
 * (insert-only), щоб НЕ переписати форматування/коментарі решти файлу;
 * після splice — повторний parse і відкат при невалідному результаті.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classifyProjects,
  findProperty,
  findTestObject,
  LEADING_COMMA_RE,
  parseModule,
  PLAYWRIGHT_PROVIDER_IMPORT,
  REASON_STORYBOOK_PROJECT_MISSING,
  REASON_STRYKER_CONFIG_MISSING,
  REASON_UNIT_PROJECT_MISSING,
  REASON_VITEST_CONFIG_MISSING,
  resolveViteConfigName,
  resolveVitestConfigPath,
  storiesGlobForVitestConfig,
  STORYBOOK_TEST_IMPORT,
  strykerConfigPathFor,
  WHITESPACE_ONLY_RE
} from './main.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(HERE, 'template')
const STORIES_GLOB_TOKEN = '__STORYBOOK_STORIES_GLOB__'
const VITE_CONFIG_IMPORT_TOKEN = '__VITE_CONFIG_IMPORT__'
// Рядок import-у як він буквально лежить у baseline-шаблонах (до token-підстановки) —
// для source-only пакета (без власного vite.config.*, хвиля 1.4) замінюється на порожній
// placeholder, а не на import неіснуючого файлу.
const VITE_CONFIG_IMPORT_LINE = `import viteConfig from './${VITE_CONFIG_IMPORT_TOKEN}'\n`

const TRIGGER_REASONS = new Set([
  REASON_VITEST_CONFIG_MISSING,
  REASON_STRYKER_CONFIG_MISSING,
  REASON_UNIT_PROJECT_MISSING,
  REASON_STORYBOOK_PROJECT_MISSING
])

/**
 * Витягує вміст `export default {...}` із template-модуля (сам файл — валідний
 * модуль лише для JS-лінту цього репо; тут потрібен саме літерал об'єкта).
 * @param {string} absTemplatePath абсолютний шлях template-файлу
 * @returns {Promise<string>} текст `ObjectExpression` (без `export default`)
 */
async function readTemplateExportedObject(absTemplatePath) {
  const src = await readFile(absTemplatePath, 'utf8')
  const parsed = parseModule(absTemplatePath, src)
  const exportDecl = parsed.program.body.find(n => n.type === 'ExportDefaultDeclaration')
  const decl = exportDecl?.declaration
  if (!decl) throw new Error(`template без export default: ${absTemplatePath}`)
  return src.slice(decl.start, decl.end)
}

/**
 * Відступ properties/elements за рядком останнього — дефолт 2 пробіли.
 * @param {string} src вихідний текст
 * @param {Array<{start: number}>} items properties/elements контейнера
 * @param {string} [fallback] дефолтний відступ
 * @returns {string} рядок-відступ
 */
function detectIndent(src, items, fallback = '  ') {
  if (items.length > 0) {
    const start = items.at(-1).start
    const lineStart = src.lastIndexOf('\n', start - 1) + 1
    const ws = src.slice(lineStart, start)
    if (WHITESPACE_ONLY_RE.test(ws)) return ws
  }
  return fallback
}

/**
 * Відступає всі рядки, крім першого (перший отримує відступ ззовні, при
 * розміщенні у вставці).
 * @param {string} text багаторядковий текст (перший рядок — база нульового відступу)
 * @param {string} indent відступ для рядків 2..N
 * @returns {string} відступлений текст
 */
function indentBlock(text, indent) {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : `${indent}${line}`))
    .join('\n')
}

/**
 * Застосовує точкові вставки до тексту (сортує за спаданням `pos`, щоб раніші
 * offsets лишались валідними після вставок справа).
 * @param {string} src вихідний текст
 * @param {Array<{pos: number, text: string}>} edits вставки
 * @returns {string} новий текст
 */
function applyEdits(src, edits) {
  let out = src
  for (const e of edits.toSorted((a, b) => b.pos - a.pos)) {
    out = out.slice(0, e.pos) + e.text + out.slice(e.pos)
  }
  return out
}

/**
 * Вставка нової property (`projects: [...]`) в об'єкт-літерал перед `}`.
 * Поважає trailing comma останньої property, коректно обробляє порожній об'єкт.
 * @param {string} src вихідний текст
 * @param {object} obj ObjectExpression node (`test`-блок)
 * @param {string} indent відступ properties
 * @param {string} propLine рядок нової property (без відступу й коми)
 * @returns {{pos: number, text: string}} одна точкова вставка
 */
function newPropertyEdit(src, obj, indent, propLine) {
  const props = obj.properties
  if (props.length === 0) {
    return { pos: obj.start + 1, text: `\n${indent}${propLine}\n` }
  }
  const lastProp = props.at(-1)
  const tail = src.slice(lastProp.end, obj.end - 1)
  const commaMatch = tail.match(LEADING_COMMA_RE)
  if (commaMatch) {
    return { pos: lastProp.end + commaMatch[0].length, text: `\n${indent}${propLine}` }
  }
  return { pos: lastProp.end, text: `,\n${indent}${propLine}` }
}

/**
 * Вставка елементів перед закривальною `]` масиву — універсально для порожнього
 * й непорожнього масиву (комою керує наявність елементів).
 * @param {object} arr ArrayExpression node
 * @param {string} indent відступ рядка масиву (властивості, що його містить)
 * @param {string[]} entries нові елементи (кожен — багаторядковий об'єкт-літерал)
 * @returns {{pos: number, text: string}} одна точкова вставка
 */
function arrayInsertBeforeClose(arr, indent, entries) {
  const itemIndent = `${indent}  `
  const body = entries.map(e => indentBlock(e, itemIndent)).join(`,\n${itemIndent}`)
  const prefix = arr.elements.length > 0 ? ',\n' : '\n'
  return { pos: arr.end - 1, text: `${prefix}${itemIndent}${body}\n${indent}` }
}

/**
 * Гарантує наявність import-у на самому початку файлу — ESM толерантний до
 * порядку import-ів, тож prepend завжди синтаксично коректний незалежно від
 * наявних import-ів.
 * @param {string} src вихідний текст
 * @param {string} marker підрядок, наявність якого означає "import уже є"
 * @param {string} importLine рядок import-у (з `\n` наприкінці), що вставляється, якщо `marker` відсутній
 * @returns {string} текст з гарантованим import-ом
 */
function ensureImport(src, marker, importLine) {
  return src.includes(marker) ? src : `${importLine}${src}`
}

/**
 * Гарантує наявність обох import-ів, потрібних новому storybook-запису
 * `test.projects`: `storybookTest` (`@storybook/addon-vitest/vitest-plugin`) і
 * `playwright`-provider factory (`@vitest/browser-playwright`, vitest@^4 —
 * рядкове API `provider: 'playwright'` застаріле).
 * @param {string} src вихідний текст
 * @returns {string} текст з гарантованими import-ами
 */
function ensureStorybookEntryImports(src) {
  const withStorybookTest = ensureImport(src, '@storybook/addon-vitest/vitest-plugin', STORYBOOK_TEST_IMPORT)
  return ensureImport(withStorybookTest, '@vitest/browser-playwright', PLAYWRIGHT_PROVIDER_IMPORT)
}

/**
 * Будує рядок нової property `projects: [<unit>, <storybook>]` для вставки в
 * порожній test-блок (де `projects` ще немає взагалі).
 * @param {string} indent відступ properties test-блоку
 * @param {string} unitEntry текст unit-проєкту (`ObjectExpression`, база нульового відступу)
 * @param {string} storybookEntry текст storybook-проєкту (те саме)
 * @returns {string} рядок `projects: [...]` (без завершальної коми)
 */
function buildProjectsPropertyLine(indent, unitEntry, storybookEntry) {
  const itemIndent = `${indent}  `
  return `projects: [\n${itemIndent}${indentBlock(unitEntry, itemIndent)},\n${itemIndent}${indentBlock(storybookEntry, itemIndent)}\n${indent}]`
}

/**
 * Обчислює план правки для наявного `test.projects` (нова property, або
 * відсутні unit/storybook-записи в наявний масив). `null` — augment
 * неможливий/не потрібен (dynamic-масив або вже канонічно).
 * @param {string} src вихідний текст vitest-конфіга
 * @param {object} testObj `test`-ObjectExpression node
 * @param {string} unitEntry текст unit-проєкту
 * @param {string} storybookEntry текст storybook-проєкту
 * @returns {{edit: {pos: number, text: string}, needsImport: boolean} | null} план правки
 */
function planProjectsEdit(src, testObj, unitEntry, storybookEntry) {
  const indent = detectIndent(src, testObj.properties)
  const projectsProp = findProperty(testObj, 'projects')

  if (projectsProp) {
    if (projectsProp.value?.type !== 'ArrayExpression') return null // dynamic — projects-dynamic вже у детекторі
    const { hasUnit, storybookSlice } = classifyProjects(src, projectsProp.value)
    const missing = []
    if (!hasUnit) missing.push(unitEntry)
    let needsImport = false
    if (!storybookSlice) {
      missing.push(storybookEntry)
      needsImport = true
    }
    if (missing.length === 0) return null
    return { edit: arrayInsertBeforeClose(projectsProp.value, indent, missing), needsImport }
  }

  const propLine = buildProjectsPropertyLine(indent, unitEntry, storybookEntry)
  return { edit: newPropertyEdit(src, testObj, indent, propLine), needsImport: true }
}

/**
 * Обчислює новий вміст наявного vitest-конфіга: дописує `projects`
 * (нову property або відсутні unit/storybook-записи в наявний масив).
 * `null` — правку застосовувати не треба (усе вже канонічно).
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @param {string} vitestConfigPath абсолютний шлях vitest-конфіга
 * @param {'library'|'app'} [type] тип пакета — впливає лише на stories-glob нового запису
 * @returns {Promise<string | null>} новий вміст файлу або null
 */
async function computeVitestConfigAugment(absPkgDir, vitestConfigPath, type) {
  const src = await readFile(vitestConfigPath, 'utf8')
  const parsed = parseModule(vitestConfigPath, src)
  if (parsed.errors?.length) return null
  const testObj = findTestObject(parsed.program)
  if (!testObj) return null

  const storiesGlob = storiesGlobForVitestConfig(absPkgDir, type)
  const unitEntry = await readTemplateExportedObject(join(TEMPLATE_DIR, 'unit-project-entry.js'))
  const storybookEntryRaw = await readTemplateExportedObject(join(TEMPLATE_DIR, 'storybook-project-entry.js'))
  const storybookEntry = storybookEntryRaw.split(STORIES_GLOB_TOKEN).join(storiesGlob)

  const plan = planProjectsEdit(src, testObj, unitEntry, storybookEntry)
  if (!plan) return null

  let next = applyEdits(src, [plan.edit])
  if (plan.needsImport) next = ensureStorybookEntryImports(next)

  // Safety: результат має компілюватися; інакше не пишемо (fail-closed, як у test/stryker_config).
  let recheck
  try {
    recheck = parseModule(vitestConfigPath, next)
  } catch {
    return null
  }
  if (recheck.errors?.length) return null

  return next === src ? null : next
}

/**
 * Підставляє в baseline-шаблон або import наявного `vite.config.*` пакета (звичайний
 * шлях), або — для source-only пакета без жодного `vite.config.*` (хвиля 1.4,
 * `resolveViteConfigName` повертає `null`) — порожній локальний placeholder замість
 * import-у неіснуючого файлу. `mergeConfig({}, defineConfig({...}))` еквівалентний
 * самому `defineConfig({...})`, тож решта структури шаблону (сама `mergeConfig`-обгортка)
 * лишається незмінною — не потрібен окремий "плоский" варіант шаблону.
 * @param {string} template вихідний текст baseline-шаблону (з токеном `__VITE_CONFIG_IMPORT__`)
 * @param {string | null} viteConfigName ім'я `vite.config.*` пакета або `null`
 * @returns {string} текст з підставленим import-ом чи placeholder-ом
 */
function applyViteConfigImport(template, viteConfigName) {
  if (viteConfigName) return template.split(VITE_CONFIG_IMPORT_TOKEN).join(viteConfigName)
  return template.replace(VITE_CONFIG_IMPORT_LINE, 'const viteConfig = {}\n')
}

/**
 * Генерує повністю новий `vitest.config.mjs` (unit+storybook projects) для
 * пакета без жодного наявного vitest-конфіга. Експортовано — переюз у
 * `adopt/main.mjs` (генерація лише для повністю відсутніх файлів).
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @param {'library'|'app'} [type] тип пакета — впливає лише на stories-glob
 * @returns {Promise<{ path: string, content: string }>} шлях і вміст нового файлу
 */
export async function buildFreshVitestConfig(absPkgDir, type) {
  const template = await readFile(join(TEMPLATE_DIR, 'vitest.config.baseline.mjs'), 'utf8')
  const storiesGlob = storiesGlobForVitestConfig(absPkgDir, type)
  const viteConfigName = resolveViteConfigName(absPkgDir)
  const withStories = template.split(STORIES_GLOB_TOKEN).join(storiesGlob)
  const content = applyViteConfigImport(withStories, viteConfigName)
  return { path: join(absPkgDir, 'vitest.config.mjs'), content }
}

/**
 * Генерує ізольований `vitest.stryker.config.*` (той самий basename/ext що
 * й основний vitest-конфіг пакета) з canonical baseline-шаблону. Експортовано —
 * переюз у `adopt/main.mjs`.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {Promise<string>} вміст нового файлу
 */
export async function buildStrykerConfig(absPkgDir) {
  const template = await readFile(join(TEMPLATE_DIR, 'vitest.stryker.config.baseline.mjs'), 'utf8')
  const viteConfigName = resolveViteConfigName(absPkgDir)
  return applyViteConfigImport(template, viteConfigName)
}

/**
 * Обробляє один пакет (rootDir) — обчислює й пише всі потрібні зміни:
 * fresh vitest.config.mjs (якщо був відсутній), augment наявного конфіга,
 * генерацію ізольованого vitest.stryker.config.*.
 * @param {string} rootDir root dir пакета
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} ctx fix-контекст
 * @param {'library'|'app'} [type] тип пакета (`violation.data.type`) — впливає лише на stories-glob
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів
 */
async function fixOnePackage(rootDir, absPkgDir, ctx, type) {
  const touchedFiles = []
  const existingVitestConfigPath = resolveVitestConfigPath(absPkgDir)
  let vitestConfigPath = existingVitestConfigPath

  if (existingVitestConfigPath) {
    const augmented = await computeVitestConfigAugment(absPkgDir, existingVitestConfigPath, type)
    if (augmented !== null) {
      ctx.recordWrite?.(existingVitestConfigPath)
      await writeFile(existingVitestConfigPath, augmented, 'utf8')
      touchedFiles.push(existingVitestConfigPath)
    }
  } else {
    const fresh = await buildFreshVitestConfig(absPkgDir, type)
    ctx.recordWrite?.(fresh.path)
    await writeFile(fresh.path, fresh.content, 'utf8')
    touchedFiles.push(fresh.path)
    vitestConfigPath = fresh.path
  }

  const strykerPath = strykerConfigPathFor(vitestConfigPath)
  if (!existsSync(strykerPath)) {
    const content = await buildStrykerConfig(absPkgDir)
    ctx.recordWrite?.(strykerPath)
    await writeFile(strykerPath, content, 'utf8')
    touchedFiles.push(strykerPath)
  }

  return touchedFiles
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'storybook-vitest-config-fix',
    test: violations => violations.some(v => TRIGGER_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const rootDirs = new Map()
      for (const v of violations) {
        if (!TRIGGER_REASONS.has(v.reason)) continue
        const rootDir = v.data?.rootDir
        if (typeof rootDir !== 'string') continue
        if (!rootDirs.has(rootDir)) {
          rootDirs.set(rootDir, { absPkgDir: rootDir === '.' ? ctx.cwd : join(ctx.cwd, rootDir), type: v.data?.type })
        }
      }

      const touchedFiles = []
      for (const [rootDir, { absPkgDir, type }] of rootDirs) {
        const files = await fixOnePackage(rootDir, absPkgDir, ctx, type)
        touchedFiles.push(...files)
      }

      return touchedFiles.length > 0
        ? { touchedFiles, message: `vitest-config storybook-канон: ${touchedFiles.join(', ')}` }
        : { touchedFiles: [] }
    }
  }
]
