# Перевірка `.github/workflows/lint-docker.yml` (docker.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-docker.yml.snippet.yml.
# Path-маркери, hadolint версія (substring "v2.12.0" у run), setup-bun-deps
# composite, `n-cursor lint docker --read-only` substring — все читається з template's snippet.
# Універсальні workflow-перевірки — у `ga.workflow_common`.
package docker.lint_docker_yml

import rego.v1

# Очікувані літерали з template.
expected_paths := {p | some p in data.template.snippet.on.push.paths}

# Required uses set — з template's steps.
expected_uses_set contains u if {
	some step in data.template.snippet.jobs["lint-docker"].steps
	u := object.get(step, "uses", "")
	u != ""
}

# Required run substrings — collected per-step з template.
expected_run_substrings contains r if {
	some step in data.template.snippet.jobs["lint-docker"].steps
	r := object.get(step, "run", "")
	r != ""
}

# Аліаси на input.
all_step_uses contains u if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	u := object.get(step, "uses", "")
	u != ""
}

all_run_text := concat("\n", [run_text |
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	run_text := step_run_to_text(step)
])

# conftest парсить YAML 1.1, тож канонічний `on:` без лапок стає булевим ключем
# `true` (як у `ga.lint_ga`). Тому читаємо через `input["true"]`.
push_paths_set := {p |
	some p in object.get(object.get(object.get(input, "true", {}), "push", {}), "paths", [])
}

# ── deny: on.push.paths subset-of ──────────────────────────────────────

deny contains msg if {
	some required in expected_paths
	not required in push_paths_set
	msg := sprintf("lint-docker.yml: on.push.paths має містити %q (docker.mdc)", [required])
}

# ── deny: required uses present ────────────────────────────────────────

deny contains msg if {
	some required_use in expected_uses_set
	not required_use in all_step_uses
	msg := sprintf("lint-docker.yml: відсутній крок `uses: %s` (docker.mdc)", [required_use])
}

# ── deny: required run substrings ──────────────────────────────────────

deny contains msg if {
	some required_run in expected_run_substrings
	not contains(all_run_text, required_run)
	msg := sprintf("lint-docker.yml: жоден крок run не містить %q (docker.mdc)", [required_run])
}

# ── helpers ────────────────────────────────────────────────────────────

step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
