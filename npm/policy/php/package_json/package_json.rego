# Порт перевірки `package.json` з `npm/scripts/check-php.mjs` (php.mdc).
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/php --namespace php.package_json
#
# Перевіряє: наявність скрипта `lint-php`. FS-перевірки (`composer.json`, наявність
# `package.json` як такого) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package php.package_json

import rego.v1

deny contains msg if {
	not object.get(object.get(input, "scripts", {}), "lint-php", false)
	msg := "package.json: додай скрипт \"lint-php\" (php.mdc)"
}
