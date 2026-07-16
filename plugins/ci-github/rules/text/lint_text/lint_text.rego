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

expected_runs_on := data.template.snippet.jobs.text["runs-on"]

expected_perms := data.template.snippet.jobs.text.permissions

# conftest парсить YAML 1.1, де канонічний `on:` без лапок стає булевим ключем
# `true` (як у `ga.lint_ga`). Тому читаємо on-блок через `input["true"]`.
gha_on := input["true"]

job := input.jobs.text

job_uses_set contains job.steps[_].uses

job_run_blob := concat("\n", [run |
	run := job.steps[_].run
])

expected_uses_set contains u if {
	some step in data.template.snippet.jobs.text.steps
	u := object.get(step, "uses", "")
	u != ""
}

expected_run_substrings contains r if {
	some step in data.template.snippet.jobs.text.steps
	r := object.get(step, "run", "")
	r != ""
}

deny contains msg if {
	input.name != expected_name
	msg := sprintf("lint-text.yml: name має бути %q (text.mdc)", [expected_name])
}

deny contains msg if {
	not branches_superset_of(gha_on.push.branches, expected_push_branches)
	msg := "lint-text.yml: on.push.branches має містити dev і main (text.mdc)"
}

deny contains msg if {
	not branches_superset_of(gha_on.pull_request.branches, expected_pr_branches)
	msg := "lint-text.yml: on.pull_request.branches має містити dev і main (text.mdc)"
}

deny contains msg if {
	not paths_superset_of(gha_on.push.paths, expected_push_paths)
	msg := "lint-text.yml: on.push.paths має містити очікувані glob-и (text.mdc)"
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
	msg := sprintf("lint-text.yml: жоден крок run не містить %q (text.mdc)", [required_run])
}

branches_superset_of(actual, expected) if {
	expected & {b | some b in actual} == expected
}

paths_superset_of(actual, expected) if {
	expected & {p | some p in actual} == expected
}
