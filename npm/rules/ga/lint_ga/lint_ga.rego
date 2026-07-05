# Перевірка `.github/workflows/lint-ga.yml` (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-ga.yml.snippet.yml.
package ga.lint_ga

import rego.v1

# ── Аліаси ─────────────────────────────────────────────────────────────────

gha_on := input["true"]

job := input.jobs["lint-ga"]

job_uses_set contains job.steps[_].uses

job_run_blob := concat("\n", [run |
	run := job.steps[_].run
])

expected_name := data.template.snippet.name

expected_push_branches := {b | some b in data.template.snippet.on.push.branches}

expected_pr_branches := {b | some b in data.template.snippet.on.pull_request.branches}

expected_push_paths := {p | some p in data.template.snippet.on.push.paths}

expected_runs_on := data.template.snippet.jobs["lint-ga"]["runs-on"]

expected_perms := data.template.snippet.jobs["lint-ga"].permissions

# Required `uses:` зі template — фільтруємо тільки кроки що мають `uses`.
expected_uses_set contains u if {
	some step in data.template.snippet.jobs["lint-ga"].steps
	u := object.get(step, "uses", "")
	u != ""
}

# Required `run:` substrings — collected from steps with `run`.
expected_run_blob := concat("\n", [r |
	some step in data.template.snippet.jobs["lint-ga"].steps
	r := object.get(step, "run", "")
	r != ""
])

# ── deny rules ─────────────────────────────────────────────────────────────

deny contains msg if {
	input.name != expected_name
	msg := sprintf("lint-ga.yml: name має бути %q (ga.mdc)", [expected_name])
}

deny contains msg if {
	not branches_superset_of(gha_on.push.branches, expected_push_branches)
	msg := "lint-ga.yml: on.push.branches має містити dev і main (ga.mdc)"
}

deny contains msg if {
	not branches_superset_of(gha_on.pull_request.branches, expected_pr_branches)
	msg := "lint-ga.yml: on.pull_request.branches має містити dev і main (ga.mdc)"
}

deny contains msg if {
	not paths_superset_of(gha_on.push.paths, expected_push_paths)
	msg := "lint-ga.yml: on.push.paths має містити .github/actions/** і .github/workflows/** (ga.mdc)"
}

deny contains msg if {
	not job
	msg := "lint-ga.yml: jobs.lint-ga відсутній (ga.mdc)"
}

deny contains msg if {
	job["runs-on"] != expected_runs_on
	msg := sprintf("lint-ga.yml: runs-on має бути %s (ga.mdc)", [expected_runs_on])
}

deny contains msg if {
	job.permissions.contents != expected_perms.contents
	msg := sprintf("lint-ga.yml: permissions.contents має бути %s (ga.mdc)", [expected_perms.contents])
}

deny contains msg if {
	count(job.steps) == 0
	msg := "lint-ga.yml: jobs.lint-ga.steps відсутні (ga.mdc)"
}

deny contains msg if {
	some required_use in expected_uses_set
	not job_has_use_satisfying(required_use)
	msg := sprintf("lint-ga.yml: має бути uses: %s (ga.mdc)", [required_use])
}

deny contains msg if {
	expected_run_blob != ""
	not contains(job_run_blob, "open-policy-agent/conftest")
	msg := "lint-ga.yml: має бути крок Install conftest (ga.mdc)"
}

deny contains msg if {
	expected_run_blob != ""
	not contains(job_run_blob, "n-cursor lint ga --read-only")
	msg := "lint-ga.yml: має бути крок run: n-cursor lint ga --read-only (ga.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

# `uses:` з input задовольняє канонічний `owner/action@tag`: точний збіг…
uses_satisfies(actual, expected) if actual == expected

# …або той самий action-slug і ref — повний 40-hex commit SHA (zizmor ref-pin).
# SHA-пін відповідної версії задовольняє вимогу тега — не даунгрейдимо до тега.
uses_satisfies(actual, expected) if {
	slug := split(expected, "@")[0]
	startswith(actual, concat("", [slug, "@"]))
	parts := split(actual, "@")
	regex.match(`^[0-9a-fA-F]{40}$`, parts[count(parts) - 1])
}

job_has_use_satisfying(required) if {
	some u in job_uses_set
	uses_satisfies(u, required)
}

branches_superset_of(actual, expected) if {
	expected & {b | some b in actual} == expected
}

paths_superset_of(actual, expected) if {
	expected & {p | some p in actual} == expected
}
