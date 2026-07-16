# Перевірка `clean-merged-branch.yml` для abie-проєктів (abie.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/clean-merged-branch.yml.snippet.yml.
# Action-маркер (`uses:` substring) і required branches (parsed з template's
# `ignore_branches`) читаються з template. ga.clean_merged_branch перевіряє
# повний канон workflow окремо; цей пакет — лише abie-specific шар.
package abie.clean_merged_ignore_branches

import rego.v1

# Експектації з template's step (першого з steps).
expected_step := step if some step in data.template.snippet.jobs.cleanup_old_branches.steps

target_action_marker := expected_step.uses

required_branches := parsed_ignore_tokens(expected_step.with.ignore_branches)

step_missing_msg := sprintf(
	"clean-merged-branch.yml: не знайдено крок з uses: %s (abie.mdc)",
	[target_action_marker],
)

ignore_branches_missing_msg := sprintf(
	"clean-merged-branch.yml: не знайдено with.ignore_branches у кроці %s (abie.mdc)",
	[target_action_marker],
)

# ── deny ─────────────────────────────────────────────────────────────────

deny contains step_missing_msg if {
	count(target_steps) == 0
}

deny contains ignore_branches_missing_msg if {
	count(target_steps) > 0
	not has_ignore_branches_value
}

deny contains msg if {
	count(target_steps) > 0
	ignore_branches_value != ""
	missing := required_branches - parsed_ignore_tokens(ignore_branches_value)
	count(missing) > 0
	msg := sprintf(
		"clean-merged-branch.yml: ignore_branches має містити %v (зараз: %q; не вистачає: %v) (abie.mdc)",
		[concat(",", sort(required_branches)), ignore_branches_value, concat(",", sort(missing))],
	)
}

# ── helpers ──────────────────────────────────────────────────────────────

target_steps contains step if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	uses := object.get(step, "uses", "")
	is_string(uses)
	contains(uses, target_action_marker)
}

has_ignore_branches_value if {
	some step in target_steps
	v := object.get(object.get(step, "with", {}), "ignore_branches", null)
	is_string(v)
}

default ignore_branches_value := ""

ignore_branches_value := values[0] if {
	values := [v |
		some step in target_steps
		v := object.get(object.get(step, "with", {}), "ignore_branches", null)
		is_string(v)
	]
	count(values) > 0
}

parsed_ignore_tokens(value) := {lower(trim_space(part)) |
	some part in split(value, ",")
	trim_space(part) != ""
}
