// @generated — do not edit
// source-hash: df2d1d134bcdb2dd
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: "rego",
    policyDir: import.meta.dirname,
    files: {"walkGlob":["hasura/k8s/base/svc.yaml","hasura/k8s/base/svc-hl.yaml"]}
  })
}
