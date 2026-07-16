# Тести k8s.lint_pipeline_k8s: наявність доменного lint-степу.
package k8s.lint_pipeline_k8s_test

import rego.v1

import data.k8s.lint_pipeline_k8s

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint k8s --no-fix"}]}
	count(lint_pipeline_k8s.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_k8s.deny with input as wf
	contains(msg, "n-rules lint k8s")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint k8s"}]}
	some msg in lint_pipeline_k8s.deny with input as wf
	contains(msg, "--no-fix")
}
