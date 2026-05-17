# Перевірка `.github/workflows/npm-publish.yml` (npm-module.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/npm-publish.yml.snippet.yml.
# Per-concern field-by-field: path/substring-маркери з expected_uses_set читаються
# зі steps template, експектації branches/paths — subset-of.
#
# Універсальні workflow-перевірки (concurrency, заборонені setup-bun/cache/install,
# shell line-continuation) — у `ga.workflow_common`.
package npm_module.npm_publish_yml

import rego.v1

# YAML 1.1 quirk: ключ `on:` → boolean true → у конфтесті ключ "true".
gha_on := input["true"]

# Required marker — substring у `uses` для ідентифікації npm-publish кроку.
publish_action_marker := "JS-DevTools/npm-publish"

# Очікувані літерали з template.
expected_paths := {p | some p in data.template.snippet.on.push.paths}

expected_branches := {b | some b in data.template.snippet.on.push.branches}

expected_permissions := data.template.snippet.jobs.publish.permissions

# Required publish-step (за маркером): expected `with.package` value з template.
expected_publish_with_package := s.with.package if {
	some s in data.template.snippet.jobs.publish.steps
	contains(object.get(s, "uses", ""), publish_action_marker)
}

# ── deny: paths містить кожне з expected_paths (subset-of) ───────────────

deny contains msg if {
	some required_path in expected_paths
	not path_present(required_path)
	msg := sprintf("npm-publish.yml: у on.push.paths має бути `%s` (npm-module.mdc)", [required_path])
}

# ── deny: branches містить кожне з expected_branches (subset-of) ─────────

deny contains msg if {
	some required_branch in expected_branches
	not required_branch in {b | some b in gha_on.push.branches}
	msg := sprintf("npm-publish.yml: on.push.branches має містити `%s` (npm-module.mdc)", [required_branch])
}

# ── deny: id-token: write у permissions хоч одного job ────────────────────

deny contains msg if {
	required := expected_permissions["id-token"]
	not any_job_has_id_token(required)
	msg := sprintf("npm-publish.yml: permissions має містити `id-token: %s` (OIDC) (npm-module.mdc)", [required])
}

# ── deny: крок з uses-маркером npm-publish та канонічним with.package ────

deny contains msg if {
	not has_npm_publish_step
	msg := sprintf(
		"npm-publish.yml: очікується `uses: %s` з `with.package: %s` (npm-module.mdc)",
		[publish_action_marker, expected_publish_with_package],
	)
}

# ── helpers ────────────────────────────────────────────────────────────────

# Path присутній, якщо хоч один шлях у actual містить required як substring
# (npm/** glob у workflow може бути записаний як `npm/**` або `'npm/**'`).
path_present(required) if {
	some p in gha_on.push.paths
	is_string(p)
	contains(p, required)
}

any_job_has_id_token(required) if {
	some job in object.get(input, "jobs", {})
	job.permissions["id-token"] == required
}

has_npm_publish_step if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	contains(object.get(step, "uses", ""), publish_action_marker)
	step.with.package == expected_publish_with_package
}
