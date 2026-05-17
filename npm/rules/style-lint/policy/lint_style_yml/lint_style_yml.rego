# Перевірка `lint-style.yml` (style-lint.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-style.yml.snippet.yml.
# Маркер `run:` (npx stylelint substring) збирається з template's stylelint-job steps.
# Універсальні workflow-перевірки — у `ga.workflow_common`.
package style_lint.lint_style_yml

import rego.v1

expected_run_blob := concat("\n", [r |
	some step in data.template.snippet.jobs.stylelint.steps
	r := object.get(step, "run", "")
	r != ""
])

all_run_text := concat("\n", [run_text |
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	run_text := step_run_to_text(step)
])

deny contains msg if {
	expected_run_blob != ""
	not contains(all_run_text, expected_run_blob)
	msg := sprintf("lint-style.yml: жоден крок run не містить %q (style-lint.mdc)", [expected_run_blob])
}

step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
