# Тести text.lint_pipeline_text: наявність доменного lint-степу.
package text.lint_pipeline_text_test

import rego.v1

import data.text.lint_pipeline_text

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint text --no-fix"}]}
	count(lint_pipeline_text.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_text.deny with input as wf
	contains(msg, "n-rules lint text")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint text"}]}
	some msg in lint_pipeline_text.deny with input as wf
	contains(msg, "--no-fix")
}

test_generic_full_lint_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint --no-fix --full"}]}
	count(lint_pipeline_text.deny) == 0 with input as wf
}
