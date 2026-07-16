# Тести rust.lint_pipeline_rust: наявність доменного lint-степу.
package rust.lint_pipeline_rust_test

import rego.v1

import data.rust.lint_pipeline_rust

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint rust --no-fix"}]}
	count(lint_pipeline_rust.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_rust.deny with input as wf
	contains(msg, "n-rules lint rust")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint rust"}]}
	some msg in lint_pipeline_rust.deny with input as wf
	contains(msg, "--no-fix")
}
