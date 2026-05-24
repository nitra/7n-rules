/**
 * Перевіряє, що всі `*.test.mjs` лежать у каталозі `tests/` (а не поряд із джерельним файлом).
 *
 * Конвенція (test.mdc): `dir/foo.mjs` → тест у `dir/tests/foo.test.mjs`.
 * `*_test.rego` виключені: Rego unit-тести живуть поряд із полісі (OPA community convention).
 *
 * Пропускає: `node_modules`, `.git`, `dist`, `build`, `.venv`, `venv` (через `walkDir`)
 * і шляхи з `.n-cursor.json:ignore`.
 */
import { basename, dirname, relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

const TESTS_DIR_NAME = 'tests'

/**
 * Чи файл є JS-тестом (`*.test.mjs`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean}
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
 * @returns {Promise<number>} 0 — всі тести у `tests/`, 1 — є порушення
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const cwd = process.cwd()
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
    return reporter.getExitCode()
  }

  for (const offenderPath of offenders) {
    const parentDir = dirname(offenderPath)
    const base = basename(offenderPath)
    fail(`${offenderPath}: тест має лежати у tests/ — перенеси у ${parentDir}/${TESTS_DIR_NAME}/${base} (test.mdc)`)
  }

  return reporter.getExitCode()
}
