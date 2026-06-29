// @generated — do not edit
// source-hash: 84bd749f70b1d30a
/* eslint-disable */
import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx */
export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: "rego",
    policyDir: import.meta.dirname,
    files: {"single":".vscode/settings.json","required":true},
    missingMessage: ".vscode/settings.json не існує — створи згідно rego.mdc (rego.vscode_settings)"
  })
}
