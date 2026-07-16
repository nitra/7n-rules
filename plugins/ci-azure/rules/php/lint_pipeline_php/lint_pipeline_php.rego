# Обов'язковий lint-степ домену `php` у `azure-pipelines.yml` (провайдер-аналог
# GitHub-workflow `lint-php.yml` з @7n/rules-ci-github): серед script-кроків pipeline
# на будь-якій глибині має бути запуск `n-rules lint php` (або `@7n/rules lint php`)
# з `--no-fix`. Mixin-концерн правила `php` — активний лише разом із правилом.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package php.lint_pipeline_php

import rego.v1

scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}

script_blob := concat("\n", [s | some s in scripts])

has_lint_step if contains(script_blob, "n-rules lint php")

has_lint_step if contains(script_blob, "@7n/rules lint php")

deny contains msg if {
	not has_lint_step
	msg := "azure-pipelines.yml: має бути script-крок `n-rules lint php --no-fix` (azure-pipelines.mdc)"
}

deny contains msg if {
	has_lint_step
	not contains(script_blob, "--no-fix")
	msg := "azure-pipelines.yml: lint-степ `php` має запускатись з `--no-fix` (CI без мутацій, azure-pipelines.mdc)"
}
