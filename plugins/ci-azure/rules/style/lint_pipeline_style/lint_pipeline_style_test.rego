# Тести style.lint_pipeline_style: наявність доменного lint-степу.
package style.lint_pipeline_style_test

import rego.v1

import data.style.lint_pipeline_style

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint style --no-fix"}]}
	count(lint_pipeline_style.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_style.deny with input as wf
	contains(msg, "n-rules lint style")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint style"}]}
	some msg in lint_pipeline_style.deny with input as wf
	contains(msg, "--no-fix")
}
