// @generated — do not edit
// source-hash: c7ffd13208576d75
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.vscode/extensions.json', required: true },
    missingMessage: '.vscode/extensions.json не існує — додай github.vscode-github-actions (ga.mdc)'
  })
}
