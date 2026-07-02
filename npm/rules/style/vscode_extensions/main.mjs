// @generated — do not edit
// source-hash: c6179fbc321f474a
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
    files: { single: '.vscode/extensions.json' }
  })
}
