# Перевірка `.github/workflows/lint-rust.yml` для правила rust (rust.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-rust.yml.snippet.yml.
# Перевіряємо:
#   - кожен `uses` з template (підмножина): actions/checkout@v6,
#     dtolnay/rust-toolchain@stable, Swatinem/rust-cache@v2;
#   - кожен `run` з template має бути присутнім (як substring) серед
#     run-кроків input'а — drift-safe: зміна template одразу рухає перевірку.
# Універсальні workflow-перевірки (name, concurrency, branches) — у `ga.workflow_common`.
package rust.lint_rust_yml

import rego.v1

# Усі `uses` з канону workflow.
expected_uses contains u if {
	some step in data.template.snippet.jobs.lint.steps
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

# Крок dtolnay/rust-toolchain@stable має мати with.components з rustfmt і clippy.
toolchain_step(step) if {
	uses := object.get(step, "uses", "")
	startswith(uses, "dtolnay/rust-toolchain@")
}

deny contains msg if {
	some required_use in expected_uses
	not required_use in actual_uses
	msg := sprintf("lint-rust.yml: відсутній step з `uses: %s` (rust.mdc)", [required_use])
}

deny contains msg if {
	some step in data.template.snippet.jobs.lint.steps
	expected_run := object.get(step, "run", "")
	expected_run != ""
	not contains(all_run_text, expected_run)
	msg := sprintf("lint-rust.yml: жоден крок run не містить %q (rust.mdc)", [expected_run])
}

deny contains msg if {
	msg := "lint-rust.yml: dtolnay/rust-toolchain step потребує with.components: rustfmt, clippy (rust.mdc)"
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	toolchain_step(step)
	components := object.get(object.get(step, "with", {}), "components", "")
	not contains(components, "rustfmt")
}

deny contains msg if {
	msg := "lint-rust.yml: dtolnay/rust-toolchain step потребує with.components: rustfmt, clippy (rust.mdc)"
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	toolchain_step(step)
	components := object.get(object.get(step, "with", {}), "components", "")
	not contains(components, "clippy")
}

step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
