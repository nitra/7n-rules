// @generated — do not edit
// source-hash: deb9bfcb9a634554

import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { walkGlob: ['**/k8s/**/base/**/*.yaml', '!**/k8s/**/base/**/kustomization.yaml'] }
  })
}
