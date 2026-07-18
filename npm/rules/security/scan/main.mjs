/**
 * lint-поверхня security/scan: read-only detector секретів (`trufflehog` filesystem скан
 * усього репо). Фіксу немає — детектор лише сигналить про знайдені секрети.
 */
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/**
 * Detector security/scan: trufflehog filesystem скан (read-only). Якщо бінарника немає —
 * скан пропускається (як і раніше при відсутності інструмента). Async (не блокує event loop) —
 * детектор може виконуватись у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
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

  const r = await spawnAsync(
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
    { cwd }
  )
  if (r.exitCode !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 4000)
    const outSuffix = out ? `\n${out}` : ''
    fail(`security/scan: trufflehog знайшов секрети (код ${r.exitCode})${outSuffix}`, 'secret-found')
  }
  return reporter.result()
}
