# Перевірка `package.json` для rego (rego.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/package.json.snippet.json.
# Дозволяємо whitespace навколо значення (trim_space) — допуск, який мав
# попередній inline-варіант.
package rego.package_json

import rego.v1

deny contains msg if {
	some script_name, expected in data.template.snippet.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	trim_space(actual) != expected
	msg := sprintf("package.json: scripts.%s має бути %q (rego.mdc)", [script_name, expected])
}
