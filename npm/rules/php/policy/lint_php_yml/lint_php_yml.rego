# Перевірка `lint-php.yml` (php.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-php.yml.snippet.yml.
# Маркер `run:` (bun run lint-php) збирається з template's php-job steps.
# Універсальні workflow-перевірки — у `ga.workflow_common`.
package php.lint_php_yml

import rego.v1

# Очікуваний `run:` маркер — конкатенація всіх run-блоків з template.
expected_run_blob := concat("\n", [r |
	some step in data.template.snippet.jobs.php.steps
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
	msg := sprintf("lint-php.yml: жоден крок run не містить %q (php.mdc)", [expected_run_blob])
}

step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
