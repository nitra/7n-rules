# Тести security.lint_pipeline_security: наявність доменного lint-степу.
package security.lint_pipeline_security_test

import rego.v1

import data.security.lint_pipeline_security

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint security --no-fix"}]}
	count(lint_pipeline_security.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_security.deny with input as wf
	contains(msg, "n-rules lint security")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint security"}]}
	some msg in lint_pipeline_security.deny with input as wf
	contains(msg, "--no-fix")
}
