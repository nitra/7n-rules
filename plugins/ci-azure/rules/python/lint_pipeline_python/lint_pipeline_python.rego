# Обов'язковий lint-степ домену `python` у `azure-pipelines.yml` (провайдер-аналог
# GitHub-workflow `lint-python.yml` з @7n/rules-ci-github): серед script-кроків pipeline
# на будь-якій глибині має бути запуск `n-rules lint python` (або `@7n/rules lint python`)
# з `--no-fix`. Mixin-концерн правила `python` — активний лише разом із правилом.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package python.lint_pipeline_python

import rego.v1

scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}

script_blob := concat("\n", [s | some s in scripts])

has_lint_step if contains(script_blob, "n-rules lint python")

has_lint_step if contains(script_blob, "@7n/rules lint python")

# Загальний full-прогін покриває всі домени — окремий python-степ не потрібен.
has_lint_step if contains(script_blob, "n-rules lint --no-fix --full")

has_lint_step if contains(script_blob, "@7n/rules lint --no-fix --full")

deny contains msg if {
	not has_lint_step
	msg := "azure-pipelines.yml: має бути script-крок `n-rules lint python --no-fix` (azure-pipelines.mdc)"
}

deny contains msg if {
	has_lint_step
	not contains(script_blob, "--no-fix")
	msg := "azure-pipelines.yml: lint-степ `python` має запускатись з `--no-fix` (CI без мутацій, azure-pipelines.mdc)"
}
