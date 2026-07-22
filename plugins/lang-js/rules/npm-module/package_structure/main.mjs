/** @see ./docs/package_structure.md */
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { globToRegex } from '@7n/rules/scripts/lib/glob-to-regex.mjs'
import { parseSync } from 'oxc-parser'

import {
  dynamicImportModule,
  langFromPath,
  requireCallModule,
  walkAstWithAncestors
} from '@7n/rules/scripts/utils/ast-scan-utils.mjs'
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

// glob → RegExp живе в ядрі (спільний з auto-rules рушієм); ре-експорт зберігає публічний API концерну
export { globToRegex } from '@7n/rules/scripts/lib/glob-to-regex.mjs'

/** Файл проєкту TypeScript для emit без каталогу `src` (див. npm-module.mdc) */
const EMIT_TYPES_CONFIG = 'npm/tsconfig.emit-types.json'

/** Каталоги, які за конвенцією тримають тести / фікстури і не повинні публікуватися. */
const TEST_DIR_NAMES = new Set(['tests', '__tests__', 'fixtures', '__fixtures__', 'spec', 'test'])

/**
 * Імена файлів за патернами test/spec (тільки basename, без path). Rego
 * (`*_test.rego`) свідомо не входить: за конвенцією conftest юніт-тест лежить
 * поруч з полісі у тому самому `package` — і це дозволений виняток усередині
 * опублікованого `policy/`-каталогу (npm-module.mdc).
 * @param {string} cwd корінь репозиторію
 */
const TEST_FILE_PATTERNS = [/^.+\.(test|spec)\.[cm]?[jt]sx?$/iu]

/** Розширення, у яких ловимо імпорти test-фреймворків. */
const JS_LIKE_EXT_RE = /\.[cm]?[jt]sx?$/iu

/** Імпорти/require/dynamic-import, які видають test-файл. */
const TEST_FRAMEWORK_MODULES = new Set([
  'bun:test',
  'node:test',
  'vitest',
  '@jest/globals',
  'jest',
  'mocha',
  'ava',
  'tap',
  'tape'
])

/**
 * Чи є під `npm/src` хоча б один `.js` (рекурсивно).
 * @param {string} cwd корінь репозиторію
 * @param {string[]} [ignorePaths] абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<boolean>} `true`, якщо знайдено хоча б один `.js`
 */
async function npmSrcTreeHasJsFile(cwd, ignorePaths = []) {
  const root = join(cwd, 'npm/src')
  if (!existsSync(root)) {
    return false
  }
  let found = false
  await walkDir(
    root,
    p => {
      if (p.endsWith('.js')) {
        found = true
      }
    },
    ignorePaths
  )
  return found
}

/**
 * Знаходить текстовий вміст конфігурації hk для перевірки npm-module.
 * @returns {Promise<{ path: string, text: string } | null>} знайдений файл або `null`
 * @param {string} cwd корінь репозиторію
 */
async function readHkConfig(cwd) {
  const candidates = ['hk.pkl', '.config/hk.pkl']
  for (const p of candidates) {
    const abs = join(cwd, p)
    if (existsSync(abs)) {
      const text = await readFile(abs, 'utf8')
      return { path: p, text }
    }
  }
  return null
}

/**
 * Підрядки для hk при layout з каталогом `npm/src` і glob `src` + `.js` у команді (див. npm-module.mdc).
 * @param {string} hkText текст конфігурації hk
 * @returns {string[]} відсутні фрагменти
 */
function missingHkSrcLayoutFragments(hkText) {
  const need = [
    '["pre-commit"]',
    'bunx -p typescript tsc',
    'src/**/*.js',
    '--declaration',
    '--allowJs',
    '--emitDeclarationOnly',
    '--outDir types',
    '--skipLibCheck'
  ]
  return need.filter(s => !hkText.includes(s))
}

/**
 * Підрядки для hk при layout з `tsconfig.emit-types.json` (див. npm-module.mdc).
 * @param {string} hkText текст конфігурації hk
 * @returns {string[]} відсутні фрагменти
 */
function missingHkEmitTypesConfigFragments(hkText) {
  const need = ['["pre-commit"]', 'bunx -p typescript tsc', 'tsconfig.emit-types.json']
  return need.filter(s => !hkText.includes(s))
}

/**
 * Застаріла інвокація команди `check`, прибраної в v14 (уніфікована поверхня `lint`).
 * Матч на підрядок "check changelog" незалежно від того, яким бінарем/шляхом викликано.
 */
const DEPRECATED_CHECK_CHANGELOG_RE = /\bcheck\s+changelog\b/u

/**
 * Підрядки канонічного кроку `npm-changelog` у hk.pkl (fix-only, autofix через env
 * `N_RULES_CHANGELOG_AUTOFIX=1`; сам крок ставить change-файл у git-індекс, `stage`
 * не потрібен). Див. npm-module.mdc.
 * @param {string} hkText текст конфігурації hk
 * @returns {string[]} відсутні фрагменти
 */
function missingHkNpmChangelogFragments(hkText) {
  const need = ['["npm-changelog"]', 'N_RULES_CHANGELOG_AUTOFIX=1', 'lint changelog']
  return need.filter(s => !hkText.includes(s))
}

/**
 * Шлях на дискі до файлу з поля `types` у `npm/package.json` (значення на кшталт `./types/bin/x.d.ts`).
 * @param {string} typesField значення поля `types` з `package.json`
 * @returns {string | null} абсолютний шлях або `null`
 */
function npmTypesFileFromPackageField(typesField) {
  if (typeof typesField !== 'string' || !typesField.startsWith('./types/')) {
    return null
  }
  const rel = typesField.slice(2)
  return join('npm', rel)
}

/**
 * Перевіряє наявність на диску файлу зі значення `types` у `npm/package.json`
 * (cross-file: JSON-поле + FS). Структуру самого поля валідує
 * `npm/policy/npm_module/npm_package_json/`; тут — лише чи файл реально існує.
 * @param {boolean} useSrcJsLayout чи використовується layout з npm/src
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkNpmPackageJson(useSrcJsLayout, passFn, failFn, cwd) {
  const npmPkgPath = join(cwd, 'npm/package.json')
  if (!existsSync(npmPkgPath)) return
  const npmPkg = JSON.parse(await readFile(npmPkgPath, 'utf8'))
  const typesField = npmPkg.types

  const typesRel = useSrcJsLayout ? join('npm', 'types', 'index.d.ts') : npmTypesFileFromPackageField(typesField)
  const missingTypesMsg = useSrcJsLayout
    ? `Відсутній ${join('npm', 'types', 'index.d.ts')} (згенеруй tsc з npm-module.mdc)`
    : `Файл для поля types не знайдено або шлях не під ./types/ — ${String(typesField)}`
  if (typesRel && existsSync(join(cwd, typesRel))) {
    passFn(`${typesRel} існує`)
  } else {
    failFn(missingTypesMsg)
  }
}

/**
 * FS-existence для `npm/tsconfig.emit-types.json` (структуру `compilerOptions`
 * валідує `npm/policy/npm_module/emit_types_config/`).
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
function checkEmitTypesConfig(passFn, failFn, cwd) {
  if (!existsSync(join(cwd, EMIT_TYPES_CONFIG))) {
    failFn(
      `Без .js під npm/src потрібен ${EMIT_TYPES_CONFIG} (див. npm-module.mdc: emit через tsconfig, без штучного src/index.js)`
    )
    return
  }
  passFn(`${EMIT_TYPES_CONFIG} є (структуру перевіряє npx @7n/rules fix → npm_module.emit_types_config)`)
}

/**
 * FS-existence для `npm-publish.yml` workflow. Поля workflow (`on.push.paths`,
 * `branches`, `id-token: write`, JS-DevTools/npm-publish step) валідує
 * `npm/policy/npm_module/npm_publish_yml/`.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при виявленому порушенні
 * @param {string} cwd корінь репозиторію
 */
function checkPublishWorkflow(passFn, failFn, cwd) {
  const publishWf = '.github/workflows/npm-publish.yml'
  if (existsSync(join(cwd, publishWf))) {
    passFn(`${publishWf} є (структуру перевіряє npx @7n/rules fix → npm_module.npm_publish_yml)`)
  } else {
    failFn(`Відсутній ${publishWf} (npm-module.mdc: npm publish)`)
  }
}

/**
 * Збирає список файлів, що потраплять у tarball, виходячи з `files` у
 * `npm/package.json`. Підтримує позитивні patterns (директорії або файли) і
 * негативні (`!…`). Шляхи повертаються у posix-формі, відносно `npm/`.
 * Не пробує дублювати всю логіку `npm pack` (license/readme/тощо) — тут лише
 * простір імен `files`, бо саме його сканує check.
 * @param {string[]} filesField значення поля `files`
 * @returns {Promise<string[]>} відсортовані posix-шляхи без `npm/` префікса
 * @param {string} cwd корінь репозиторію
 */
async function collectPublishedFiles(filesField, cwd) {
  const positives = filesField.filter(p => typeof p === 'string' && !p.startsWith('!'))
  const negatives = filesField.filter(p => typeof p === 'string' && p.startsWith('!')).map(p => globToRegex(p.slice(1)))
  /** @type {Set<string>} */
  const collected = new Set()
  const npmRoot = join(cwd, 'npm')
  for (const entry of positives) {
    const fullPath = join(npmRoot, entry)
    if (!existsSync(fullPath)) continue
    const s = await stat(fullPath)
    if (s.isFile()) {
      collected.add(entry)
      continue
    }
    if (!s.isDirectory()) continue
    await walkDir(fullPath, p => {
      const rel = p
        .slice(npmRoot.length + 1)
        .split(sep)
        .join('/')
      collected.add(rel)
    })
  }
  const filtered = [...collected].filter(rel => negatives.every(re => !re.test(rel)))
  filtered.sort()
  return filtered
}

/**
 * Чи є у файлі імпорт/require/dynamic-import з модуля тест-фреймворку.
 * Парсимо через oxc-parser (як `bunyan-imports`/`redis-imports`). При помилці
 * парсингу повертаємо `null` — це не наш checker для синтаксису.
 * @param {string} content повний текст файлу
 * @param {string} virtualPath шлях для вибору `lang`
 * @returns {string | null} модуль, через який видно тест, або `null`
 */
export function findTestFrameworkImport(content, virtualPath) {
  const lang = langFromPath(virtualPath)
  let result
  try {
    result = parseSync(virtualPath, content, { lang, sourceType: 'module' })
  } catch {
    return null
  }
  if (result.errors?.length) return null
  for (const imp of result.module?.staticImports ?? []) {
    const mod = imp.moduleRequest?.value
    if (typeof mod === 'string' && TEST_FRAMEWORK_MODULES.has(mod)) return mod
  }
  /** @type {string | null} */
  let found = null
  walkAstWithAncestors(result.program, [], node => {
    if (found) return
    const reqMod = requireCallModule(node)
    if (reqMod && TEST_FRAMEWORK_MODULES.has(reqMod)) {
      found = reqMod
      return
    }
    const dynMod = dynamicImportModule(node)
    if (dynMod && TEST_FRAMEWORK_MODULES.has(dynMod)) {
      found = dynMod
    }
  })
  return found
}

/**
 * Класифікує опублікований файл як test/fixture, якщо хоча б одна з ознак:
 * (1) у шляху є каталог із `TEST_DIR_NAMES`; (2) basename відповідає
 * `TEST_FILE_PATTERNS`; (3) для JS/TS-розширень — імпорт test-фреймворку.
 *
 * Carve-out: для шляху `rules/<rule-name>/...` сегмент `<rule-name>` (індекс 1)
 * — це ім'я правила, а не каталог. Зокрема, правило з id `test` (або `tests`)
 * описує конвенцію розміщення тестів і саме по собі не є test-fixture'ом.
 * Подальші сегменти (наприклад, `rules/<r>/js/<c>/tests/`) продовжують перевірятись.
 * @param {string} relPath posix-шлях відносно `npm/`
 * @returns {Promise<string | null>} причина порушення або `null`
 * @param {string} [cwd] корінь репозиторію
 */
export async function classifyPublishedFileAsTest(relPath, cwd = process.cwd()) {
  const segments = relPath.split('/')
  const base = segments.at(-1)
  const dirs = segments.slice(0, -1)
  const testDir = dirs.find((seg, idx) => {
    if (idx === 1 && dirs[0] === 'rules') {
      return false
    }
    return TEST_DIR_NAMES.has(seg.toLowerCase())
  })
  if (testDir) return `test-style каталог "${testDir}/"`
  if (TEST_FILE_PATTERNS.some(re => re.test(base))) return `test-style ім'я файлу`
  if (JS_LIKE_EXT_RE.test(base)) {
    const content = await readFile(join(cwd, 'npm', relPath), 'utf8')
    const mod = findTestFrameworkImport(content, relPath)
    if (mod) return `імпорт test-фреймворку "${mod}"`
  }
  return null
}

/**
 * Для всіх файлів, що потрапили б у tarball (positive `files` мінус negative
 * patterns), забороняє test-style каталоги/імена/імпорти. Так пакет лишається
 * компактним і не везе користувачам тести й фікстури.
 * @param {(msg: string) => void} pass callback при успіху
 * @param {(msg: string) => void} fail callback при порушенні
 * @returns {Promise<void>}
 * @param {string} cwd корінь репозиторію
 */
async function checkNoTestsInPublishedFiles(pass, fail, cwd) {
  if (!existsSync(join(cwd, 'npm/package.json'))) return
  const pkg = JSON.parse(await readFile(join(cwd, 'npm/package.json'), 'utf8'))
  if (!Array.isArray(pkg.files)) return
  const files = await collectPublishedFiles(pkg.files, cwd)
  /** @type {{ file: string, reason: string }[]} */
  const violations = []
  for (const rel of files) {
    const reason = await classifyPublishedFileAsTest(rel, cwd)
    if (reason) violations.push({ file: rel, reason })
  }
  if (violations.length === 0) {
    pass(`npm/: усі ${files.length} опублікованих файли без тестів і fixtures`)
    return
  }
  for (const v of violations) {
    fail(
      `npm/${v.file}: ${v.reason} — додай у "files" у npm/package.json негативний glob, ` +
        'що виключає цей файл з tarball (наприклад "!**/*.test.mjs", "!**/fixtures/**", "!**/*_test.rego") (npm-module.mdc)'
    )
  }
}

/**
 * Перевіряє базову структуру монорепо: наявність каталогу `npm/` і
 * `npm/package.json`. Поле `workspaces ∋ "npm"` у кореневому `package.json`
 * валідує `npm/policy/npm_module/root_package_json/`.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkNpmModuleBasicStructure(pass, fail, cwd) {
  if (existsSync(join(cwd, 'package.json'))) {
    pass('package.json існує')
  } else {
    fail('package.json не існує')
  }

  const npmDir = join(cwd, 'npm')
  if (existsSync(npmDir)) {
    const s = await stat(npmDir)
    if (s.isDirectory()) {
      pass('npm/ директорія існує')
    } else {
      fail('npm має бути директорією')
    }
  } else {
    fail('npm/ директорія не існує')
  }

  if (existsSync(join(cwd, 'npm/package.json'))) {
    pass('npm/package.json існує')
  } else {
    fail('npm/package.json не існує — створи package.json для npm модуля')
  }
}

/**
 * Перевіряє відповідність проєкту правилам npm-module.mdc
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  await checkNpmModuleBasicStructure(pass, fail, cwd)
  await checkNoTestsInPublishedFiles(pass, fail, cwd)

  const ignorePaths = await loadCursorIgnorePaths(cwd)
  const useSrcJsLayout = await npmSrcTreeHasJsFile(cwd, ignorePaths)

  await checkNpmPackageJson(useSrcJsLayout, pass, fail, cwd)

  if (!useSrcJsLayout) {
    await checkEmitTypesConfig(pass, fail, cwd)
  }

  const layoutLabel = useSrcJsLayout ? 'layout src' : 'tsconfig emit-types'
  const hk = await readHkConfig(cwd)
  if (hk) {
    pass(`${hk.path} існує`)
    const missing = useSrcJsLayout ? missingHkSrcLayoutFragments(hk.text) : missingHkEmitTypesConfigFragments(hk.text)
    if (missing.length === 0) {
      pass(`${hk.path}: pre-commit містить очікуваний виклик tsc (${layoutLabel})`)
    } else {
      fail(`${hk.path}: онови pre-commit крок (npm-module.mdc); не знайдено: ${missing.join(', ')}`)
    }

    if (DEPRECATED_CHECK_CHANGELOG_RE.test(hk.text)) {
      fail(
        `${hk.path}: крок містить застарілий виклик "check changelog" — команду \`check\` прибрано в v14 ` +
          '(уніфікована поверхня `lint`). Заміни на "npx @7n/rules lint changelog" (npm-module.mdc)'
      )
    } else {
      const missingChangelogStep = missingHkNpmChangelogFragments(hk.text)
      if (missingChangelogStep.length === 0) {
        pass(`${hk.path}: pre-commit містить крок npm-changelog (npm-module.mdc)`)
      } else {
        fail(`${hk.path}: онови крок npm-changelog (npm-module.mdc); не знайдено: ${missingChangelogStep.join(', ')}`)
      }
    }
  } else {
    fail('Очікується hk.pkl або .config/hk.pkl з pre-commit і tsc (npm-module.mdc)')
  }

  if (existsSync(join(cwd, '.github/workflows'))) {
    pass('.github/workflows/ існує')
  } else {
    fail('.github/workflows/ не існує')
  }

  await checkPublishWorkflow(pass, fail, cwd)

  return reporter.result()
}
