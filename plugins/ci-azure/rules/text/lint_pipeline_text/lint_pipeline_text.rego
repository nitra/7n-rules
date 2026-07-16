# Обов'язковий lint-степ домену `text` у `azure-pipelines.yml` (провайдер-аналог
# GitHub-workflow `lint-text.yml` з @7n/rules-ci-github): серед script-кроків pipeline
# на будь-якій глибині має бути запуск `n-rules lint text` (або `@7n/rules lint text`)
# з `--no-fix`. Mixin-концерн правила `text` — активний лише разом із правилом.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package text.lint_pipeline_text

import rego.v1

scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}

script_blob := concat("\n", [s | some s in scripts])

has_lint_step if contains(script_blob, "n-rules lint text")

has_lint_step if contains(script_blob, "@7n/rules lint text")

deny contains msg if {
	not has_lint_step
	msg := "azure-pipelines.yml: має бути script-крок `n-rules lint text --no-fix` (azure-pipelines.mdc)"
}

deny contains msg if {
	has_lint_step
	not contains(script_blob, "--no-fix")
	msg := "azure-pipelines.yml: lint-степ `text` має запускатись з `--no-fix` (CI без мутацій, azure-pipelines.mdc)"
}
