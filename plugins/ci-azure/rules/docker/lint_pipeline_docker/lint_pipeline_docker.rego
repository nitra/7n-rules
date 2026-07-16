# Обов'язковий lint-степ домену `docker` у `azure-pipelines.yml` (провайдер-аналог
# GitHub-workflow `lint-docker.yml` з @7n/rules-ci-github): серед script-кроків pipeline
# на будь-якій глибині має бути запуск `n-rules lint docker` (або `@7n/rules lint docker`)
# з `--no-fix`. Mixin-концерн правила `docker` — активний лише разом із правилом.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package docker.lint_pipeline_docker

import rego.v1

scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}

script_blob := concat("\n", [s | some s in scripts])

has_lint_step if contains(script_blob, "n-rules lint docker")

has_lint_step if contains(script_blob, "@7n/rules lint docker")

# Загальний full-прогін покриває всі домени — окремий docker-степ не потрібен.
has_lint_step if contains(script_blob, "n-rules lint --no-fix --full")

has_lint_step if contains(script_blob, "@7n/rules lint --no-fix --full")

deny contains msg if {
	not has_lint_step
	msg := "azure-pipelines.yml: має бути script-крок `n-rules lint docker --no-fix` (azure-pipelines.mdc)"
}

deny contains msg if {
	has_lint_step
	not contains(script_blob, "--no-fix")
	msg := "azure-pipelines.yml: lint-степ `docker` має запускатись з `--no-fix` (CI без мутацій, azure-pipelines.mdc)"
}
