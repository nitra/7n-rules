/** @see ./docs/sandbox-aware-test.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/**
 * Чи файл — JS-тест (`*.test.mjs` / `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} `true` для `.test.{mjs,js}` файлів
 */
function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Чи файл містить `import.meta.dirname`/`import.meta.url`-навігацію з ≥4 `..`-рівнів.
 * Для кожного вживання `import.meta.dirname|url` рахує `'..'`/`".."` у вікні 400 символів.
 * @param {string} body вміст файлу
 * @returns {boolean} `true` якщо знайдено глибоку навігацію
 */
function hasDeepMetaNavigation(body) {
  const RE = /import\.meta\.(?:dirname|url)\b/gu
  let match
  while ((match = RE.exec(body)) !== null) {
    const chunk = body.slice(match.index, match.index + 400)
    const dots = (chunk.match(/'\.\.'|"\.\."/gu) ?? []).length
    if (dots >= 4) return true
  }
  return false
}

/** Захист через тимчасову пісочницю — `withTmpDir`. */
const WITH_TMP_DIR_RE = /\bwithTmpDir\b/u

/** Захист через явний skip у Stryker-sandbox (`test.skipIf`). */
const SKIP_IF_STRYKER_RE = /\btest\.skipIf\s*\(\s*(?:env|process\.env)\.STRYKER_MUTATOR_WORKER\b/u

/**
 * Перевіряє, що `*.test.{mjs,js}` з глибокою `import.meta`-навігацією (≥4 `..`-рівнів)
 * захищені `withTmpDir` або `test.skipIf(env.STRYKER_MUTATOR_WORKER)`.
 * Без ізоляції Stryker-sandbox (`reports/stryker/.tmp/sandbox-XXX/`) не має `.git/`,
 * тому git-операції у таких тестах падають і мутаційний прогін не стартує.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd
  const ignorePaths = await loadCursorIgnorePaths(cwd)

  /** @type {string[]} */
  const testFiles = []
  await walkDir(
    cwd,
    absPath => {
      if (isTestFile(absPath)) testFiles.push(absPath)
    },
    ignorePaths
  )

  /** @type {string[]} */
  const offenders = []
  for (const absPath of testFiles) {
    const body = await readFile(absPath, 'utf8')
    if (!hasDeepMetaNavigation(body)) continue
    if (WITH_TMP_DIR_RE.test(body) || SKIP_IF_STRYKER_RE.test(body)) continue
    offenders.push(relative(cwd, absPath))
  }

  if (offenders.length === 0) {
    pass(`Усі ${testFiles.length} тестові файли sandbox-aware (test.mdc)`)
    return reporter.result()
  }

  for (const file of offenders) {
    fail(
      `${file}: import.meta deep navigation (≥4 рівні ..) без ізоляції — ` +
        `оберни у withTmpDir() або захисти test.skipIf(env.STRYKER_MUTATOR_WORKER) (test.mdc, sandbox-aware-test)`
    )
  }

  return reporter.result()
}
