// @generated — do not edit
// source-hash: e0ac7be85535c1bf
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: "template",
    policyDir: import.meta.dirname,
    files: {"single":".vscode/settings.json"}
  })
}
