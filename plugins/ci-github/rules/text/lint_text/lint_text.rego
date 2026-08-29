# Перевірка `.github/workflows/lint-text.yml` (text.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-text.yml.snippet.yml.
# Універсальні workflow-перевірки (checkout, permissions) — у `ga.workflow_common`.
package text.lint_text

import rego.v1

expected_name := data.template.snippet.name

expected_push_branches := {b | some b in data.template.snippet.on.push.branches}

expected_pr_branches := {b | some b in data.template.snippet.on.pull_request.branches}

expected_push_paths := {p | some p in data.template.snippet.on.push.paths}

expected_pr_paths := {p | some p in data.template.snippet.on.pull_request.paths}

actual_pr_paths := object.get(object.get(gha_on, "pull_request", {}), "paths", [])

expected_runs_on := data.template.snippet.jobs.text["runs-on"]

expected_perms := data.template.snippet.jobs.text.permissions

# Conftest поточних версій читає YAML 1.2 (`on`), але старі версії віддавали
# YAML 1.1 boolean-key (`true`). Приймаємо обидві форми, щоб policy не мовчала.
gha_on := object.get(input, "on", object.get(input, "true", {}))

job := input.jobs.text

# LONGHAND, а не shorthand `job_uses_set contains job.steps[_].uses`:
# shorthand-форма падає під regorus з «item cannot be indexed», коли `job`
# undefined (у workflow немає джоби `text`) або коли крок не має `uses:` —
# замість канонічного набору `deny` порт віддавав одну `rego-engine-error`.
# Під OPA обидві форми еквівалентні; longhand — спільний знаменник.
job_uses_set contains u if {
	some step in job.steps
	u := step.uses
}

job_run_blob := concat("\n", [object.get(step, "run", "") |
	some step in job.steps
	object.get(step, "run", "") != ""
])

expected_uses_set contains u if {
	some step in data.template.snippet.jobs.text.steps
	u := object.get(step, "uses", "")
	u != ""
}

expected_run_substrings contains object.get(step, "run", "") if {
	some step in data.template.snippet.jobs.text.steps
	object.get(step, "run", "") != ""
}

deny contains msg if {
	input.name != expected_name
	msg := sprintf("lint-text.yml: name має бути \"%v\" (text.mdc)", [expected_name])
}

# Актуальне значення звʼязується ОКРЕМИМ позитивним виразом перед `not`:
# при undefined-аргументі regorus рахує `not helper(undefined, …)` істиною
# (зайвий deny), тоді як OPA лишає весь body undefined і deny мовчить.
# Звʼязування вирівнює обидва рушії на OPA-семантиці.
deny contains msg if {
	actual_push_branches := gha_on.push.branches
	not branches_superset_of(actual_push_branches, expected_push_branches)
	msg := "lint-text.yml: on.push.branches має містити dev і main (text.mdc)"
}

deny contains msg if {
	actual_pr_branches := gha_on.pull_request.branches
	not branches_superset_of(actual_pr_branches, expected_pr_branches)
	msg := "lint-text.yml: on.pull_request.branches має містити dev і main (text.mdc)"
}

deny contains msg if {
	actual_push_paths := gha_on.push.paths
	not paths_superset_of(actual_push_paths, expected_push_paths)
	msg := "lint-text.yml: on.push.paths має містити очікувані glob-и (text.mdc)"
}

deny contains msg if {
	not paths_superset_of(actual_pr_paths, expected_pr_paths)
	msg := "lint-text.yml: on.pull_request.paths має містити очікувані glob-и (text.mdc)"
}

deny contains msg if {
	not job
	msg := "lint-text.yml: jobs.text відсутній (text.mdc)"
}

deny contains msg if {
	job["runs-on"] != expected_runs_on
	msg := sprintf("lint-text.yml: runs-on має бути %s (text.mdc)", [expected_runs_on])
}

deny contains msg if {
	job.permissions.contents != expected_perms.contents
	msg := sprintf("lint-text.yml: permissions.contents має бути %s (text.mdc)", [expected_perms.contents])
}

deny contains msg if {
	count(job.steps) == 0
	msg := "lint-text.yml: jobs.text.steps відсутні (text.mdc)"
}

deny contains msg if {
	some required_use in expected_uses_set
	not required_use in job_uses_set
	msg := sprintf("lint-text.yml: має бути uses: %s (text.mdc)", [required_use])
}

deny contains msg if {
	some required_run in expected_run_substrings
	not contains(job_run_blob, required_run)
	msg := sprintf("lint-text.yml: жоден крок run не містить \"%v\" (text.mdc)", [required_run])
}

branches_superset_of(actual, expected) if {
	expected & {b | some b in actual} == expected
}

paths_superset_of(actual, expected) if {
	expected & {p | some p in actual} == expected
}
