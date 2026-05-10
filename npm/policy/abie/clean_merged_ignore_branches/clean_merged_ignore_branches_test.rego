# Тести для `abie.clean_merged_ignore_branches`. Запуск:
#   conftest verify -p npm/policy/abie/clean_merged_ignore_branches
package abie.clean_merged_ignore_branches_test

import rego.v1

import data.abie.clean_merged_ignore_branches

# Каркас workflow з одним job, що містить step із заданим with.
mk_workflow(step_with) := {"jobs": {"cleanup": {"steps": [{
	"uses": "phpdocker-io/github-actions-delete-abandoned-branches@v2",
	"with": step_with,
}]}}}

other_step_workflow := {"jobs": {"cleanup": {"steps": [{"uses": "actions/checkout@v6"}]}}}

# Workflow без потрібного кроку.
test_deny_step_missing if {
	count(clean_merged_ignore_branches.deny) > 0 with input as other_step_workflow
}

test_deny_ignore_branches_missing if {
	count(clean_merged_ignore_branches.deny) > 0 with input as mk_workflow({})
}

test_deny_missing_required_token if {
	count(clean_merged_ignore_branches.deny) > 0 with input as mk_workflow({"ignore_branches": "dev,ua"})
}

test_deny_completely_wrong_tokens if {
	count(clean_merged_ignore_branches.deny) > 0 with input as mk_workflow({"ignore_branches": "main,develop"})
}

test_allow_all_three_tokens if {
	count(clean_merged_ignore_branches.deny) == 0 with input as mk_workflow({"ignore_branches": "dev,ua,ru"})
}

# Регістронезалежне порівняння і пропуск пробілів.
test_allow_uppercase_with_spaces if {
	count(clean_merged_ignore_branches.deny) == 0 with input as mk_workflow({"ignore_branches": " DEV , UA , RU "})
}

extra_branches_workflow := mk_workflow({"ignore_branches": "dev,ua,ru,main,release/*"})

# Додаткові гілки після обов'язкових — дозволено.
test_allow_extra_branches if {
	count(clean_merged_ignore_branches.deny) == 0 with input as extra_branches_workflow
}
