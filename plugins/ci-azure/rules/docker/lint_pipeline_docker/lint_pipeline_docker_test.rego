# Тести docker.lint_pipeline_docker: наявність доменного lint-степу.
package docker.lint_pipeline_docker_test

import rego.v1

import data.docker.lint_pipeline_docker

test_lint_step_passes if {
	wf := {"steps": [{"script": "bunx n-rules lint docker --no-fix"}]}
	count(lint_pipeline_docker.deny) == 0 with input as wf
}

test_missing_step_denied if {
	wf := {"steps": [{"script": "echo build"}]}
	some msg in lint_pipeline_docker.deny with input as wf
	contains(msg, "n-rules lint docker")
}

test_without_no_fix_denied if {
	wf := {"steps": [{"script": "npx @7n/rules lint docker"}]}
	some msg in lint_pipeline_docker.deny with input as wf
	contains(msg, "--no-fix")
}
