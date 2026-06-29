// @generated — do not edit
// source-hash: f7f46fedbbcb0d1a
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: "rego",
    policyDir: import.meta.dirname,
    files: {"single":"package.json","required":false}
  })
}
