/** @see ./docs/no-process-chdir.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/** Шукаємо викликний паттерн з відкривною дужкою — не зачепить згадку у docstring. */
const CHDIR_CALL_RE = /process\.chdir\s*\(/u

/**
 * Чи файл — JS-тест (`*.test.mjs` або `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} `true` для імен з `.test.{mjs,js}` суфіксом
 */
function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Detector: жоден `*.test.{mjs,js}` не викликає `process.chdir(` (test.mdc).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const { cwd } = ctx
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

  /** @type {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} */
  const violations = []
  for (const absPath of testFiles) {
    const body = await readFile(absPath, 'utf8')
    if (!CHDIR_CALL_RE.test(body)) continue
    const file = relative(cwd, absPath).split('\\').join('/')
    for (const [i, line] of body.split('\n').entries()) {
      if (!CHDIR_CALL_RE.test(line)) continue
      violations.push(
        /** @type {any} */ ({
          reason: 'process-chdir-in-test',
          message:
            `${file}:${i + 1}: process.chdir() у тесті заборонений — використовуй ` +
            'withTmpDir(async dir => …) + явні join(dir, …) + cwd: dir (test.mdc)',
          file,
          data: { line: i + 1 }
        })
      )
    }
  }

  return { violations }
}
