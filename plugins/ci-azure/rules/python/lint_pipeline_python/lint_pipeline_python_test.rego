# Тести python.lint_pipeline_python: наявність доменного lint-степу.
package python.lint_pipeline_python_test

import rego.v1

import data.python.lint_pipeline_python

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint python --no-fix"}]}
	count(lint_pipeline_python.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_python.deny with input as wf
	contains(msg, "n-rules lint python")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint python"}]}
	some msg in lint_pipeline_python.deny with input as wf
	contains(msg, "--no-fix")
}

test_generic_full_lint_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint --no-fix --full"}]}
	count(lint_pipeline_python.deny) == 0 with input as wf
}
