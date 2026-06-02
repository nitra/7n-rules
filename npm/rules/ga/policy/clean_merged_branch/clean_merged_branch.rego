# Перевірка `.github/workflows/clean-merged-branch.yml` (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/clean-merged-branch.yml.snippet.yml.
package ga.clean_merged_branch

import rego.v1

# ── Аліаси ─────────────────────────────────────────────────────────────────

gha_on := input["true"]

steps := input.jobs.cleanup_old_branches.steps

step0 := steps[0]

step1 := steps[1]

expected_name := data.template.snippet.name

expected_cron := data.template.snippet.on.schedule[0].cron

expected_step0 := data.template.snippet.jobs.cleanup_old_branches.steps[0]

expected_step1 := data.template.snippet.jobs.cleanup_old_branches.steps[1]

expected_perms := data.template.snippet.jobs.cleanup_old_branches.permissions

# ── deny rules ─────────────────────────────────────────────────────────────

deny contains msg if {
	input.name != expected_name
	msg := sprintf("clean-merged-branch.yml: name має бути %q (ga.mdc)", [expected_name])
}

deny contains msg if {
	not has_expected_cron
	msg := sprintf("clean-merged-branch.yml: on.schedule має містити cron: '%s' (ga.mdc)", [expected_cron])
}

deny contains msg if {
	not is_object(object.get(gha_on, "workflow_dispatch", null))
	msg := "clean-merged-branch.yml: має бути workflow_dispatch: {} (ga.mdc)"
}

deny contains msg if {
	not input.jobs.cleanup_old_branches
	msg := "clean-merged-branch.yml: jobs.cleanup_old_branches відсутній (ga.mdc)"
}

deny contains msg if {
	some permission, expected in expected_perms
	object.get(input.jobs.cleanup_old_branches.permissions, permission, null) != expected
	msg := sprintf("clean-merged-branch.yml: permissions.%s має бути %s (ga.mdc)", [permission, expected])
}

deny contains msg if {
	count(steps) < 2
	msg := "clean-merged-branch.yml: steps має містити 2 кроки як у template (ga.mdc)"
}

# ── Step 0 (delete_stuff) ──────────────────────────────────────────────────

deny contains msg if {
	step0.id != expected_step0.id
	msg := sprintf("clean-merged-branch.yml: перший крок має id: %s (ga.mdc)", [expected_step0.id])
}

deny contains msg if {
	step0.uses != expected_step0.uses
	msg := sprintf("clean-merged-branch.yml: перший крок має uses: %s (ga.mdc)", [expected_step0.uses])
}

deny contains msg if {
	step0.with.github_token != expected_step0.with.github_token
	msg := sprintf(
		"clean-merged-branch.yml: with.github_token має бути %s (ga.mdc)",
		[expected_step0.with.github_token],
	)
}

deny contains msg if {
	step0.with.last_commit_age_days != expected_step0.with.last_commit_age_days
	msg := sprintf(
		"clean-merged-branch.yml: with.last_commit_age_days має бути %d (ga.mdc)",
		[expected_step0.with.last_commit_age_days],
	)
}

deny contains msg if {
	not ignore_branches_subset
	msg := sprintf(
		"clean-merged-branch.yml: with.ignore_branches має містити %s (ga.mdc)",
		[expected_step0.with.ignore_branches],
	)
}

# YAML 1.1 quirk: `dry_run: no` парситься як boolean false у Go-yaml (conftest).
# Template (від `yaml` npm) читає `no` як рядок, тому нормалізуємо обидві форми.
deny contains msg if {
	normalize_dry_run(step0.with.dry_run) != normalize_dry_run(expected_step0.with.dry_run) # noqa: rules-style-no-equality-with-false
	msg := "clean-merged-branch.yml: with.dry_run має бути no (ga.mdc)"
}

# ── Step 1 (Get output) ────────────────────────────────────────────────────

deny contains msg if {
	step1.name != expected_step1.name
	msg := sprintf("clean-merged-branch.yml: другий крок має name: %s (ga.mdc)", [expected_step1.name])
}

deny contains msg if {
	step1.env.DELETED_BRANCHES != expected_step1.env.DELETED_BRANCHES
	msg := "clean-merged-branch.yml: env.DELETED_BRANCHES має бути як у template (ga.mdc)"
}

deny contains msg if {
	not echo_deleted_branches
	msg := "clean-merged-branch.yml: run має echo Deleted branches як у template (ga.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

has_expected_cron if {
	gha_on.schedule[_].cron == expected_cron
}

# Кожна гілка з template-літералу (через кому) має бути присутня у actual.
ignore_branches_subset if {
	required_branches := split(expected_step0.with.ignore_branches, ",")
	actual := step0.with.ignore_branches
	every b in required_branches {
		contains(actual, trim_space(b))
	}
}

echo_deleted_branches if {
	# Звіряємо substring "echo "Deleted branches: …${DELETED_BRANCHES}…"" — формується з template run.
	contains(step1.run, "Deleted branches:")
	contains(step1.run, "${DELETED_BRANCHES}")
}

normalize_dry_run(false) := false

normalize_dry_run(value) := false if lower(sprintf("%v", [value])) == "no"

normalize_dry_run(value) := value if {
	value != false # noqa: equals-pattern-matching
	lower(sprintf("%v", [value])) != "no"
}
