# Обов'язковий lint-степ домену `k8s` у `azure-pipelines.yml` (провайдер-аналог
# GitHub-workflow `lint-k8s.yml` з @7n/rules-ci-github): серед script-кроків pipeline
# на будь-якій глибині має бути запуск `n-rules lint k8s` (або `@7n/rules lint k8s`)
# з `--no-fix`. Mixin-концерн правила `k8s` — активний лише разом із правилом.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package k8s.lint_pipeline_k8s

import rego.v1

scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}

script_blob := concat("\n", [s | some s in scripts])

has_lint_step if contains(script_blob, "n-rules lint k8s")

has_lint_step if contains(script_blob, "@7n/rules lint k8s")

deny contains msg if {
	not has_lint_step
	msg := "azure-pipelines.yml: має бути script-крок `n-rules lint k8s --no-fix` (azure-pipelines.mdc)"
}

deny contains msg if {
	has_lint_step
	not contains(script_blob, "--no-fix")
	msg := "azure-pipelines.yml: lint-степ `k8s` має запускатись з `--no-fix` (CI без мутацій, azure-pipelines.mdc)"
}
