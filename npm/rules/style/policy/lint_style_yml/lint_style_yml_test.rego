package style_lint.lint_style_yml_test

import data.style_lint.lint_style_yml
import rego.v1

template_data := {"snippet": {"jobs": {"stylelint": {"steps": [{"run": "n-cursor lint style --read-only"}]}}}}

test_allow_canonical if {
	wf := {"jobs": {"stylelint": {"steps": [{"run": "n-cursor lint style --read-only"}]}}}
	count(lint_style_yml.deny) == 0 with input as wf with data.template as template_data
}

test_deny_no_stylelint_run if {
	wf := {"jobs": {"stylelint": {"steps": [{"run": "echo nothing"}]}}}
	some msg in lint_style_yml.deny with input as wf with data.template as template_data
	contains(msg, "n-cursor lint style")
}

test_deny_empty if {
	count(lint_style_yml.deny) > 0 with input as {} with data.template as template_data
}

# Drift test.
test_data_template_drives_substring if {
	wf := {"jobs": {"stylelint": {"steps": [{"run": "npx stylelint"}]}}}
	some msg in lint_style_yml.deny with input as wf
		with data.template as {"snippet": {"jobs": {"stylelint": {"steps": [{"run": "custom-runner"}]}}}}
	contains(msg, "custom-runner")
}
