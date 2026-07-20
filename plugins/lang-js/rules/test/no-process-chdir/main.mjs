/** @see ./docs/no-process-chdir.md */
import { readFile } from 'node:fs/promises'

import { collectTestFiles, toRelPosix } from '@7n/rules/scripts/lib/collect-test-files.mjs'

/** Шукаємо викликний паттерн з відкривною дужкою — не зачепить згадку у docstring. */
const CHDIR_CALL_RE = /process\.chdir\s*\(/u

/**
 * Detector: жоден `*.test.{mjs,js}` не викликає `process.chdir(` (test.mdc).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx Контекст лінту (`cwd` тощо).
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} Результат лінту зі списком violations.
 */
export async function lint(ctx) {
  const { cwd } = ctx
  const testFiles = await collectTestFiles(cwd)

  /** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]} */
  const violations = []
  for (const absPath of testFiles) {
    const body = await readFile(absPath, 'utf8')
    if (!CHDIR_CALL_RE.test(body)) continue
    const file = toRelPosix(cwd, absPath)
    for (const [i, line] of body.split('\n').entries()) {
      if (!CHDIR_CALL_RE.test(line)) continue
      violations.push(
        /** @type {Partial<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation>} */ ({
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
