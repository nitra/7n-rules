# Порт перевірки `lint-php.yml` з `npm/scripts/check-php.mjs` (php.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/lint-php.yml -p npm/policy/php \
#     --namespace php.lint_php_yml
#
# Перевіряє: хоча б один крок `run` містить `bun run lint-php`. Універсальні
# workflow-перевірки — у `ga.workflow_common`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package php.lint_php_yml

import rego.v1

all_run_text := concat("\n", [run_text |
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	run_text := step_run_to_text(step)
])

deny contains msg if {
	not contains(all_run_text, "bun run lint-php")
	msg := "lint-php.yml: жоден крок run не містить `bun run lint-php` (php.mdc)"
}

step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
