/**
 * lint-поверхня security/scan: read-only detector секретів (`trufflehog` filesystem скан
 * усього репо). Фіксу немає — детектор лише сигналить про знайдені секрети.
 */
import { spawnSync } from 'node:child_process'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/**
 * Detector security/scan: trufflehog filesystem скан (read-only). Якщо бінарника немає —
 * скан пропускається (як і раніше при відсутності інструмента).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult}
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  const trufflehog = resolveCmd('trufflehog')
  if (!trufflehog) {
    return {
      violations: [],
      diagnostics: [{ level: 'info', message: 'security/scan: `trufflehog` не знайдено в PATH — скан пропущено' }]
    }
  }

  const r = spawnSync(
    trufflehog,
    [
      'filesystem',
      '.',
      '--no-update',
      '--exclude-paths',
      '.trufflehog-exclude',
      '--results=verified,unknown',
      '--fail'
    ],
    { cwd, encoding: 'utf8', shell: false }
  )
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 4000)
    const outSuffix = out ? `\n${out}` : ''
    fail(`security/scan: trufflehog знайшов секрети (код ${r.status})${outSuffix}`, 'secret-found')
  }
  return reporter.result()
}
