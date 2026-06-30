// @generated — do not edit
// source-hash: ae27ed15b2790014
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.vscode/extensions.json', required: true },
    missingMessage: '.vscode/extensions.json не існує — додай recommendations з js.mdc'
  })
}
