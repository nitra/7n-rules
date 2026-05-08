# Порт перевірки кореневого `package.json` з `npm/scripts/check-npm-module.mjs`
# (npm-module.mdc) — масив `workspaces` має містити "npm".
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/npm_module \
#     --namespace npm_module.root_package_json
#
# Решта кореневих `package.json`-перевірок (заборонені поля, devDeps лише @nitra/*)
# — у `bun.package_json`. FS-перевірки (наявність каталогу `npm/`,
# `npm/package.json`) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package npm_module.root_package_json

import rego.v1

deny contains msg if {
	not is_array(object.get(input, "workspaces", null))
	msg := "package.json: масив workspaces відсутній — має містити \"npm\" (npm-module.mdc)"
}

deny contains msg if {
	is_array(input.workspaces)
	not "npm" in {w | some w in input.workspaces}
	msg := "package.json: workspaces має містити \"npm\" (npm-module.mdc)"
}
