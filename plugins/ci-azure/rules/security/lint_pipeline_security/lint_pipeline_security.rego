# Обов'язковий lint-степ домену `security` у `azure-pipelines.yml` (провайдер-аналог
# GitHub-workflow `lint-security.yml` з @7n/rules-ci-github): серед script-кроків pipeline
# на будь-якій глибині має бути запуск `n-rules lint security` (або `@7n/rules lint security`)
# з `--no-fix`. Mixin-концерн правила `security` — активний лише разом із правилом.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package security.lint_pipeline_security

import rego.v1

scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}

script_blob := concat("\n", [s | some s in scripts])

has_lint_step if contains(script_blob, "n-rules lint security")

has_lint_step if contains(script_blob, "@7n/rules lint security")

# Загальний full-прогін покриває всі домени — окремий security-степ не потрібен.
has_lint_step if contains(script_blob, "n-rules lint --no-fix --full")

has_lint_step if contains(script_blob, "@7n/rules lint --no-fix --full")

deny contains msg if {
	not has_lint_step
	msg := "azure-pipelines.yml: має бути script-крок `n-rules lint security --no-fix` (azure-pipelines.mdc)"
}

deny contains msg if {
	has_lint_step
	not contains(script_blob, "--no-fix")
	msg := "azure-pipelines.yml: lint-степ `security` має запускатись з `--no-fix` (CI без мутацій, azure-pipelines.mdc)"
}
