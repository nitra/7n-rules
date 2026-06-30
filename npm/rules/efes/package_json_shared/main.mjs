// @generated — do not edit
// source-hash: 0aec9c6f9d01f4e9
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: 'package.json', required: true },
    missingMessage: "package.json не існує — створи його, додай devDependencies['@nitra/efes-shared'] (efes.mdc)"
  })
}
