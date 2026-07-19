/** @see ./docs/location.md */
import { basename, dirname, relative } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

const TESTS_DIR_NAME = 'tests'

/**
 * Чи файл є JS-тестом (`*.test.mjs`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} true для шляхів із суфіксом `.test.mjs`
 */
function isTestFile(absPath) {
  return basename(absPath).endsWith('.test.mjs')
}

/**
 * Перевіряє, чи лежить тест у каталозі з іменем `tests`.
 * @param {string} absPath абсолютний шлях до тесту
 * @returns {boolean} `true`, якщо басенейм батьківської директорії — `tests`
 */
function isInsideTestsDir(absPath) {
  return basename(dirname(absPath)) === TESTS_DIR_NAME
}

/**
 * Перевіряє розміщення тестових файлів у каталозі `tests/` (test.mdc).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd
  const ignorePaths = await loadCursorIgnorePaths(cwd)

  /** @type {string[]} */
  const offenders = []
  let totalTests = 0

  await walkDir(
    cwd,
    absPath => {
      if (!isTestFile(absPath)) {
        return
      }
      totalTests++
      if (!isInsideTestsDir(absPath)) {
        offenders.push(relative(cwd, absPath))
      }
    },
    ignorePaths
  )

  if (offenders.length === 0) {
    pass(`Всі ${totalTests} файлів *.test.mjs у каталозі tests/ (test.mdc)`)
    return reporter.result()
  }

  for (const offenderPath of offenders) {
    const parentDir = dirname(offenderPath)
    const base = basename(offenderPath)
    fail(`${offenderPath}: тест має лежати у tests/ — перенеси у ${parentDir}/${TESTS_DIR_NAME}/${base} (test.mdc)`)
  }

  return reporter.result()
}
