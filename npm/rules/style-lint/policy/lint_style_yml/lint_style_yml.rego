# Порт перевірки `lint-style.yml` з `npm/scripts/check-style-lint.mjs` (style-lint.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/lint-style.yml -p npm/policy/style_lint \
#     --namespace style_lint.lint_style_yml
#
# Перевіряє: хоча б один крок `run` містить `npx stylelint` (саме через npx, не
# `bun run lint-style`). Універсальні workflow-перевірки (concurrency, заборонені
# setup-bun/cache/install) — у `ga.workflow_common`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package style_lint.lint_style_yml

import rego.v1

# Усі тексти `run:` зі steps усіх jobs, склеєні в один blob — для substring-перевірки.
all_run_text := concat("\n", [run_text |
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	run_text := step_run_to_text(step)
])

deny contains msg if {
	not contains(all_run_text, "npx stylelint")
	msg := "lint-style.yml: жоден крок run не містить `npx stylelint` (style-lint.mdc)"
}

# Текст `run:` як один рядок: підтримує string і array форми (YAML).
step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
