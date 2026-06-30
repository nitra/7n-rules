// @generated — do not edit
// source-hash: 38cbb7026eff0d67
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'template',
    policyDir: import.meta.dirname,
    files: { single: '.github/workflows/npm-publish.yml' }
  })
}
