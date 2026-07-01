// @generated — do not edit
// source-hash: ea1030c320eceba7

import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: 'package.json' }
  })
}
