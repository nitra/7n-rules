// @generated — do not edit
// source-hash: 561fbed781b47430

import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.github/zizmor.yml', required: true },
    missingMessage: '.github/zizmor.yml не існує — потрібен для zizmor (ga.mdc)'
  })
}
