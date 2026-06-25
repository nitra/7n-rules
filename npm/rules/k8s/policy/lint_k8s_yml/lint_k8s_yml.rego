# Перевірка `.github/workflows/lint-k8s.yml` (k8s.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-k8s.yml.snippet.yml.
# Перевіряємо (drift-safe — усе ведеться з template, без inline-літералів):
#   - кожен `uses` з template: actions/checkout@v6, setup-bun-deps;
#   - кожен `run` з template (як substring): install kubeconform, kubescape,
#     n-cursor lint k8s --read-only.
# Універсальні workflow-перевірки (name, concurrency, branches,
# persist-credentials) — у `ga.workflow_common`.
package k8s.lint_k8s_yml

import rego.v1

# Усі `uses` з канону workflow (по всіх job'ах template).
expected_uses contains u if {
	some job in data.template.snippet.jobs
	some step in job.steps
	u := object.get(step, "uses", "")
	u != ""
}

# Усі `uses` з input workflow.
actual_uses contains u if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	u := object.get(step, "uses", "")
	u != ""
}

# Конкатенація всіх `run`-кроків з input workflow.
all_run_text := concat("\n", [run_text |
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	run_text := step_run_to_text(step)
])

deny contains msg if {
	some required_use in expected_uses
	not required_use in actual_uses
	msg := sprintf("lint-k8s.yml: відсутній step з `uses: %s` (k8s.mdc)", [required_use])
}

deny contains msg if {
	some job in data.template.snippet.jobs
	some step in job.steps
	expected_run := object.get(step, "run", "")
	expected_run != ""
	not contains(all_run_text, expected_run)
	msg := sprintf("lint-k8s.yml: жоден крок run не містить %q (k8s.mdc)", [expected_run])
}

step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
