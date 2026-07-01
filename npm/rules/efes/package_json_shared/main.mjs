// @generated — do not edit
// source-hash: f8cbf07a596a705a
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
    files: {"single":"package.json","required":true},
    missingMessage: "package.json не існує — створи його, додай devDependencies['@nitra/efes-shared'] (efes.mdc)"
  })
}
