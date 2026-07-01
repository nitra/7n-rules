// @generated — do not edit
// source-hash: 7228f807592ea85f
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/**
 * Detector policy-concern-а (згенеровано codegen-обгорткою).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx Контекст лінту (`cwd`, `ruleId`, `concernId`).
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} Уніфікований результат лінту зі списком violations.
 */
export function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: "rego",
    policyDir: import.meta.dirname,
    files: {"single":".jscpd.json","required":true},
    missingMessage: ".jscpd.json не існує — створи з полями згідно js.mdc"
  })
}
