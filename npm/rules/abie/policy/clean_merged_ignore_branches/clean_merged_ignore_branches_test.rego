# Тести для `abie.clean_merged_ignore_branches`. Запуск:
#   conftest verify -p npm/rules/abie/policy/clean_merged_ignore_branches
package abie.clean_merged_ignore_branches_test

import data.abie.clean_merged_ignore_branches
import rego.v1

template_data := {"snippet": {"jobs": {"cleanup_old_branches": {"steps": [{
	"uses": "phpdocker-io/github-actions-delete-abandoned-branches",
	"with": {"ignore_branches": "dev,ua"},
}]}}}}

mk_workflow(step_with) := {"jobs": {"cleanup": {"steps": [{
	"uses": "phpdocker-io/github-actions-delete-abandoned-branches@v2",
	"with": step_with,
}]}}}

other_step_workflow := {"jobs": {"cleanup": {"steps": [{"uses": "actions/checkout@v6"}]}}}

test_deny_step_missing if {
	count(clean_merged_ignore_branches.deny) > 0 with input as other_step_workflow
		with data.template as template_data
}

test_deny_ignore_branches_missing if {
	count(clean_merged_ignore_branches.deny) > 0 with input as mk_workflow({})
		with data.template as template_data
}

test_deny_missing_required_token if {
	count(clean_merged_ignore_branches.deny) > 0 with input as mk_workflow({"ignore_branches": "dev"})
		with data.template as template_data
}

test_allow_required_tokens if {
	count(clean_merged_ignore_branches.deny) == 0 with input as mk_workflow({"ignore_branches": "dev,ua"})
		with data.template as template_data
}

test_allow_uppercase_with_spaces if {
	count(clean_merged_ignore_branches.deny) == 0 with input as mk_workflow({"ignore_branches": " DEV , UA "})
		with data.template as template_data
}

test_allow_extra_branches if {
	count(clean_merged_ignore_branches.deny) == 0 with input as mk_workflow({"ignore_branches": "dev,ua,main,release/*"})
		with data.template as template_data
}

# Drift test.
test_data_template_drives_required_branches if {
	drifted := {"snippet": {"jobs": {"cleanup_old_branches": {"steps": [{
		"uses": "phpdocker-io/github-actions-delete-abandoned-branches",
		"with": {"ignore_branches": "release,ua"},
	}]}}}}
	some msg in clean_merged_ignore_branches.deny with input as mk_workflow({"ignore_branches": "dev,ua"})
		with data.template as drifted
	contains(msg, "release")
}
