package php.lint_php_yml_test

import data.php.lint_php_yml
import rego.v1

template_data := {"snippet": {"jobs": {"php": {"steps": [{"run": "n-cursor lint php --no-fix"}]}}}}

test_allow_canonical if {
	pkg := {"jobs": {"php": {"steps": [{"run": "n-cursor lint php --no-fix"}]}}}
	count(lint_php_yml.deny) == 0 with input as pkg with data.template as template_data
}

test_deny_no_lint_php_run if {
	pkg := {"jobs": {"php": {"steps": [{"run": "echo something"}]}}}
	some msg in lint_php_yml.deny with input as pkg with data.template as template_data
	contains(msg, "n-cursor lint php --no-fix")
}

test_deny_empty_jobs if {
	some msg in lint_php_yml.deny with input as {} with data.template as template_data
	contains(msg, "n-cursor lint php --no-fix")
}

# Drift test.
test_data_template_drives_run_marker if {
	pkg := {"jobs": {"php": {"steps": [{"run": "n-cursor lint php --no-fix"}]}}}
	drifted := {"snippet": {"jobs": {"php": {"steps": [{"run": "custom-runner"}]}}}}
	some msg in lint_php_yml.deny with input as pkg with data.template as drifted
	contains(msg, "custom-runner")
}
