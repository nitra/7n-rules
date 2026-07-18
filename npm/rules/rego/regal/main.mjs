/**
 * lint-поверхня rego/regal: read-only detector (`regal lint`). Per-file: приймає `ctx.files`
 * (конкретні `.rego`), інакше `npm/rules` (весь policy-корінь, якщо існує). Виділено з
 * колишнього bundled `rego/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego") —
 * `regal lint` стилістично per-file-безпечний (не потребує сусідніх файлів).
 */
import { resolve } from 'node:path'

import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveTargets, runStep } from '../lib/run-external-tool.mjs'

/**
 * Detector rego/regal (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат зі зібраними violations
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = resolve(ctx.cwd)

  const targets = resolveTargets(ctx.files, root)
  if (targets.length === 0) return reporter.result()

  const regal = ensureTool('regal')
  const regalRes = await runStep(regal, ['lint', ...targets], root)
  if (regalRes.status !== 0) {
    const regalSuffix = regalRes.output ? `\n${regalRes.output}` : ''
    fail(`lint-rego: regal lint — помилка (код ${regalRes.status})${regalSuffix}`, 'regal-lint-violation')
  }
  return reporter.result()
}
