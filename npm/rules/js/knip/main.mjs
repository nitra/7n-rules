/**
 * lint-поверхня js/knip: read-only detector невикористаних залежностей/експортів/файлів.
 * Кожен knip-issue → одне порушення (reason = тип issue, file/line де доступні). Жодних
 * мутацій (knip запускається без `--fix`) і жодного друку звіту — рендерить runner.
 */
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import { main as knipMain } from 'knip'

/**
 * Один knip-issue → LintViolation.
 * @param {{ type: string, filePath?: string, symbol?: string, symbolType?: string, line?: number, col?: number, severity?: string }} issue knip-issue
 * @param {string} cwd робочий каталог
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation} нормалізоване порушення
 */
function issueToViolation(issue, cwd) {
  const abs = issue.filePath
  const file = abs ? relative(cwd, abs).split('\\').join('/') : undefined
  const lineSuffix = issue.line ? `:${issue.line}` : ''
  const where = file ? `${file}${lineSuffix}` : '<unknown>'
  const symbolType = issue.symbolType ? ` (${issue.symbolType})` : ''
  const sym = issue.symbol ? ` \`${issue.symbol}\`${symbolType}` : ''
  /** @type {Partial<import('../../../scripts/lib/lint-surface/types.mjs').LintViolation>} */
  const v = {
    reason: issue.type || 'knip-issue',
    message: `knip: ${issue.type}${sym} — ${where}`,
    severity: issue.severity === 'warn' ? 'warn' : 'error',
    data: { line: issue.line, col: issue.col, symbol: issue.symbol, type: issue.type }
  }
  if (file) v.file = file
  return v
}

/**
 * Detector js/knip: невикористані deps/exports/files через programmatic API knip (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const cwd = ctx.cwd

  // knip-package не експортує внутрішні util-и через "exports" — резолвимо dist-каталог
  // від головного entry і імпортуємо `create-options` за абсолютним file:// URL.
  const require = createRequire(import.meta.url)
  const distDir = dirname(require.resolve('knip'))
  // eslint-disable-next-line no-unsanitized/method -- URL from resolved package path, not user input
  const { createOptions } = await import(pathToFileURL(join(distDir, 'util/create-options.js')).href)

  const options = await createOptions({ cwd, isDisableConfigHints: true })
  const results = await knipMain(options)

  /** @type {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} */
  const violations = []
  // results.issues: { <type>: { <file>: { <key>: Issue } } }
  for (const byFile of Object.values(results.issues)) {
    for (const byKey of Object.values(byFile)) {
      for (const issue of Object.values(byKey)) {
        violations.push(issueToViolation(/** @type {Parameters<typeof issueToViolation>[0]} */ (issue), cwd))
      }
    }
  }
  return { violations }
}
