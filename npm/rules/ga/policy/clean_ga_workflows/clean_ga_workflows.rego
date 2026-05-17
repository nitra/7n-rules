# Перевірка `.github/workflows/clean-ga-workflows.yml` (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/clean-ga-workflows.yml.snippet.yml
# (повний YAML канон). Path-and-value перевірки — у цьому rego (per-concern
# field-by-field з .data.template.snippet.<path>); жодних inline literals.
package ga.clean_ga_workflows

import rego.v1

# ── Аліаси на input ────────────────────────────────────────────────────────
# GHA YAML quirk: ключ `on:` — YAML 1.1 boolean `true`, у conftest серіалізується
# як рядковий ключ "true". Template (через --data JSON) має ключ "on".

gha_on := input["true"]

step0 := input.jobs.cleanup_old_workflows.steps[0]

# Експектації з template.
expected_name := data.template.snippet.name

expected_cron := data.template.snippet.on.schedule[0].cron

expected_step0 := data.template.snippet.jobs.cleanup_old_workflows.steps[0]

expected_perms := data.template.snippet.jobs.cleanup_old_workflows.permissions

expected_runs_on := data.template.snippet.jobs.cleanup_old_workflows["runs-on"]

# ── deny rules ─────────────────────────────────────────────────────────────

deny contains msg if {
	input.name != expected_name
	msg := sprintf("clean-ga-workflows.yml: name має бути %q (ga.mdc)", [expected_name])
}

deny contains msg if {
	not has_expected_cron
	msg := sprintf("clean-ga-workflows.yml: on.schedule має містити cron: '%s' (ga.mdc)", [expected_cron])
}

deny contains msg if {
	not is_object(object.get(gha_on, "workflow_dispatch", null))
	msg := "clean-ga-workflows.yml: має бути workflow_dispatch: {} (ga.mdc)"
}

deny contains msg if {
	not input.jobs.cleanup_old_workflows
	msg := "clean-ga-workflows.yml: jobs.cleanup_old_workflows відсутній (ga.mdc)"
}

deny contains msg if {
	job := input.jobs.cleanup_old_workflows
	job["runs-on"] != expected_runs_on
	msg := sprintf("clean-ga-workflows.yml: runs-on має бути %s (ga.mdc)", [expected_runs_on])
}

deny contains msg if {
	perms := input.jobs.cleanup_old_workflows.permissions
	not perms_match(perms, expected_perms)
	msg := "clean-ga-workflows.yml: permissions мають бути actions: write, contents: read (ga.mdc)"
}

deny contains msg if {
	step0.name != expected_step0.name
	msg := sprintf("clean-ga-workflows.yml: перший крок має мати name: %s (ga.mdc)", [expected_step0.name])
}

deny contains msg if {
	step0.uses != expected_step0.uses
	msg := sprintf("clean-ga-workflows.yml: перший крок має uses: %s (ga.mdc)", [expected_step0.uses])
}

deny contains msg if {
	not step0_with_canonical
	msg := "clean-ga-workflows.yml: with має містити token/save_period/save_min_runs_number як у template (ga.mdc)"
}

deny contains msg if {
	step0.with.save_period != expected_step0.with.save_period
	msg := sprintf("clean-ga-workflows.yml: with.save_period має бути %d (ga.mdc)", [expected_step0.with.save_period])
}

# ── helpers ────────────────────────────────────────────────────────────────

has_expected_cron if {
	gha_on.schedule[_].cron == expected_cron
}

perms_match(actual, expected) if {
	actual.actions == expected.actions
	actual.contents == expected.contents
}

step0_with_canonical if {
	step0.with.token == expected_step0.with.token
	step0.with.save_period == expected_step0.with.save_period
	step0.with.save_min_runs_number == expected_step0.with.save_min_runs_number
}
