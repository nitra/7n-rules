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
 * @param {{ type: string, filePath?: string, symbol?: string, symbolType?: string, line?: number, col?: number, severity?: string }} issue
 * @param {string} cwd
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation}
 */
function issueToViolation(issue, cwd) {
  const abs = issue.filePath
  const file = abs ? relative(cwd, abs).split('\\').join('/') : undefined
  const where = file ? `${file}${issue.line ? `:${issue.line}` : ''}` : '<unknown>'
  const sym = issue.symbol ? ` \`${issue.symbol}\`${issue.symbolType ? ` (${issue.symbolType})` : ''}` : ''
  /** @type {any} */
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
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const cwd = ctx.cwd

  // knip-package не експортує внутрішні util-и через "exports" — резолвимо dist-каталог
  // від головного entry і імпортуємо `create-options` за абсолютним file:// URL.
  const require = createRequire(import.meta.url)
  const distDir = dirname(require.resolve('knip'))
  const { createOptions } = await import(pathToFileURL(join(distDir, 'util/create-options.js')).href)

  const options = await createOptions({ cwd, isDisableConfigHints: true })
  const results = await knipMain(options)

  /** @type {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} */
  const violations = []
  // results.issues: { <type>: { <file>: { <key>: Issue } } }
  for (const byFile of Object.values(results.issues)) {
    for (const byKey of Object.values(byFile)) {
      for (const issue of Object.values(byKey)) {
        violations.push(issueToViolation(/** @type {any} */ (issue), cwd))
      }
    }
  }
  return { violations }
}
