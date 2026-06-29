// @generated — do not edit
// source-hash: daf42c8463d65a29
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: "rego",
    policyDir: import.meta.dirname,
    files: {"walkGlob":"**/k8s/**/base/**/kustomization.yaml"}
  })
}
