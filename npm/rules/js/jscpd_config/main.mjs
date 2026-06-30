// @generated — do not edit
// source-hash: 51d4db02d7bc6044
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.jscpd.json', required: true },
    missingMessage: '.jscpd.json не існує — створи з полями згідно js.mdc'
  })
}
