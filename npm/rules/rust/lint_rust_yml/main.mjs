// @generated — do not edit
// source-hash: 0f9145604e837639
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
    files: {"single":".github/workflows/lint-rust.yml","required":true},
    missingMessage: ".github/workflows/lint-rust.yml не існує — створи з канонічним вмістом (rust.mdc)"
  })
}
