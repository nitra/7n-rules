# Тести azure_pipelines.lint_pipeline: наявність lint-степу, --no-fix, вкладені stages.
package azure_pipelines.lint_pipeline_test

import rego.v1

import data.azure_pipelines.lint_pipeline

test_flat_steps_with_lint_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint --no-fix --full", "displayName": "Lint"}]}
	count(lint_pipeline.deny) == 0 with input as wf
}

test_nested_stages_with_lint_passes if {
	wf := {"stages": [{"stage": "ci", "jobs": [{"job": "lint", "steps": [
		{"script": "bun install --frozen-lockfile"},
		{"script": "npx @7n/rules lint text --no-fix"},
	]}]}]}
	count(lint_pipeline.deny) == 0 with input as wf
}

test_missing_lint_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline.deny with input as wf
	contains(msg, "n-rules lint")
}

test_lint_without_no_fix_denied if {
	wf := {"steps": [{"script": "bunx n-rules lint"}]}
	some msg in lint_pipeline.deny with input as wf
	contains(msg, "--no-fix")
}
