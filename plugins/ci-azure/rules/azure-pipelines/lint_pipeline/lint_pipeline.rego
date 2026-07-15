# Перевірка обов'язкового lint-степу у `azure-pipelines.yml` (azure-pipelines.mdc).
#
# Substring-перевірки по сукупному тексту всіх `script`-кроків (на будь-якій глибині —
# плоскі steps, jobs, stages): Azure YAML допускає різні розкладки, а команда може мати
# додаткові аргументи (`--full`, конкретні правила), тож exact-match був би крихким.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package azure_pipelines.lint_pipeline

import rego.v1

# Усі script-рядки pipeline на будь-якій глибині.
scripts contains s if {
	walk(input, [_, node])
	is_object(node)
	s := node.script
	is_string(s)
}

script_blob := concat("\n", [s | some s in scripts])

# Обидві канонічні форми запуску: `bunx n-rules lint …` і `npx @7n/rules lint …`.
has_lint_step if contains(script_blob, "n-rules lint")

has_lint_step if contains(script_blob, "@7n/rules lint")

deny contains msg if {
	not has_lint_step
	msg := "azure-pipelines.yml: має бути script-крок з `n-rules lint` (azure-pipelines.mdc)"
}

deny contains msg if {
	has_lint_step
	not contains(script_blob, "--no-fix")
	msg := "azure-pipelines.yml: lint-степ має запускатись з `--no-fix` (CI без мутацій, azure-pipelines.mdc)"
}
