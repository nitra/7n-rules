# Тести php.lint_pipeline_php: наявність доменного lint-степу.
package php.lint_pipeline_php_test

import rego.v1

import data.php.lint_pipeline_php

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint php --no-fix"}]}
	count(lint_pipeline_php.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_php.deny with input as wf
	contains(msg, "n-rules lint php")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint php"}]}
	some msg in lint_pipeline_php.deny with input as wf
	contains(msg, "--no-fix")
}

test_generic_full_lint_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint --no-fix --full"}]}
	count(lint_pipeline_php.deny) == 0 with input as wf
}
