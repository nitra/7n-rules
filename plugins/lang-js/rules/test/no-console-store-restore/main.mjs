/** @see ./docs/no-console-store-restore.md */
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { collectTestFileOffenders } from '../lib/collect-test-file-offenders.mjs'

/**
 * Ловить пряме присвоєння `console.<method> = …` у `*.test.{js,mjs}`.
 * `console.log = fn` — process-wide мутація; канон: `vi.spyOn(console, 'log')`.
 * `(?!=)` виключає `==` та `===` (лише одиночний `=`).
 */
const CONSOLE_ASSIGN_RE =
  /\bconsole\.(?:log|error|warn|info|debug|dir|table|trace|group|groupEnd|time|timeEnd)\s*=(?!=)/u

/**
 * Знаходить рядки з прямим присвоєнням `console.<method> = …`.
 * @param {string} body вміст файлу
 * @returns {Array<{line: number}>} знайдені порушення
 */
function findOffenders(body) {
  const offenders = []
  const lines = body.split('\n')
  for (const [i, line] of lines.entries()) {
    if (CONSOLE_ASSIGN_RE.test(line)) {
      offenders.push({ line: i + 1 })
    }
  }
  return offenders
}

/**
 * Перевіряє, що жоден `*.test.{mjs,js}` файл не перевизначає `console.<method>`
 * через пряме присвоєння. Канон — `vi.spyOn(console, 'log').mockReturnValue()`.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки з порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd
  const { testFiles, offenders } = await collectTestFileOffenders(cwd, findOffenders)

  if (offenders.length === 0) {
    pass(`Жоден з ${testFiles.length} тестових файлів не присвоює console.<method> = … (test.mdc)`)
    return reporter.result()
  }

  for (const { file, line } of offenders) {
    fail(
      `${file}:${line}: пряме присвоєння console.<method> = … заборонено — ` +
        `використовуй vi.spyOn(console, 'method').mockReturnValue() (test.mdc, no-console-store-restore)`
    )
  }

  return reporter.result()
}
