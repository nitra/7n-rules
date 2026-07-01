// @generated — do not edit
// source-hash: 4768e72cd8b98472

import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.github/workflows/lint-security.yml', required: true },
    missingMessage: '.github/workflows/lint-security.yml не знайдено — створи за каноном security.mdc'
  })
}
