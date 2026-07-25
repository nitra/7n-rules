# Перевірка `.github/workflows/lint-python.yml` для правила python (python.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-python.yml.snippet.yml.
# Перевіряємо (drift-safe — усе ведеться з template, без inline-літералів):
#   - кожен `uses` з template (підмножина): actions/checkout@v6,
#     ./.github/actions/setup-bun-deps, astral-sh/setup-uv@v8.0.0;
#   - кожен `run` з template має бути присутнім (як substring) серед run-кроків
#     input'а: `uv sync --frozen`, `n-rules lint python --no-fix`.
# Заборона Poetry-кроків (snok/install-poetry, `poetry install`) — через відсутність
# у каноні: правило вимагає uv-кроки, а нав'язаних poetry-кроків у template немає.
# Універсальні workflow-перевірки (name, concurrency, branches) — у `ga.workflow_common`.
package python.lint_python_yml

import rego.v1

# Conftest поточних версій читає YAML 1.2 (`on`), але старі версії віддавали
# YAML 1.1 boolean-key (`true`). Приймаємо обидві форми, щоб policy не мовчала.
gha_on := object.get(input, "on", object.get(input, "true", {}))

expected_pr_paths := {p | some p in data.template.snippet.on.pull_request.paths}

actual_pr_paths := object.get(object.get(gha_on, "pull_request", {}), "paths", [])

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
	msg := sprintf("lint-python.yml: відсутній step з `uses: %s` (python.mdc)", [required_use])
}

deny contains msg if {
	not paths_superset_of(actual_pr_paths, expected_pr_paths)
	msg := "lint-python.yml: on.pull_request.paths має містити очікувані glob-и (python.mdc)"
}

deny contains msg if {
	msg := "lint-python.yml: actions/checkout@v6 потребує `with: persist-credentials: false` (python.mdc)"
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	step.uses == "actions/checkout@v6"
	creds := object.get(object.get(step, "with", {}), "persist-credentials", true)
	creds != false
}

deny contains msg if {
	some job in data.template.snippet.jobs
	some step in job.steps
	expected_run := object.get(step, "run", "")
	expected_run != ""
	not contains(all_run_text, expected_run)
	msg := sprintf("lint-python.yml: жоден крок run не містить %q (python.mdc)", [expected_run])
}

step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""

paths_superset_of(actual, expected) if {
	expected & {p | some p in actual} == expected
}
