# Тести js.lint_pipeline_js: наявність доменного lint-степу.
package js.lint_pipeline_js_test

import rego.v1

import data.js.lint_pipeline_js

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint js --no-fix"}]}
	count(lint_pipeline_js.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_js.deny with input as wf
	contains(msg, "n-rules lint js")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint js"}]}
	some msg in lint_pipeline_js.deny with input as wf
	contains(msg, "--no-fix")
}
