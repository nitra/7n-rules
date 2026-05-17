# Перевірка кореневого `package.json` для GitHub Actions tooling (ga.mdc).
#
# Структурні workflow-перевірки живуть у `ga.workflow_common` і per-workflow
# policy-пакетах. JS лишається для PATH-preflight (`shellcheck`) і git-залежної
# перевірки `on.*.paths` через `git ls-files`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.package_json

import rego.v1

deny contains msg if {
	not is_string(object.get(object.get(input, "scripts", {}), "lint-ga", null))
	msg := "package.json: додай скрипт \"lint-ga\" (ga.mdc)"
}

deny contains msg if {
	lint_ga := object.get(object.get(input, "scripts", {}), "lint-ga", "")
	is_string(lint_ga)
	not regex.match(`\bn-cursor\s+lint-ga\b`, lint_ga)
	msg := "lint-ga має делегувати CLI `n-cursor lint-ga` (ga.mdc)"
}
