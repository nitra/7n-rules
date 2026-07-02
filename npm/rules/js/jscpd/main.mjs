// @generated — do not edit
// source-hash: d6c6331b2577f806
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/**
 * Detector policy-concern-а (згенеровано codegen-обгорткою).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx Контекст лінту (`cwd`, `ruleId`, `concernId`).
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} Уніфікований результат лінту зі списком violations.
 */
export function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.jscpd.json', required: true },
    missingMessage: '.jscpd.json не існує — створи з полями згідно js.mdc'
  })
}
