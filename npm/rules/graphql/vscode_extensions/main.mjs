// @generated — do not edit
// source-hash: ef92c1a8f81a2e52

import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.vscode/extensions.json', required: true },
    missingMessage: '.vscode/extensions.json не існує — додай рекомендовані розширення (graphql.mdc)'
  })
}
