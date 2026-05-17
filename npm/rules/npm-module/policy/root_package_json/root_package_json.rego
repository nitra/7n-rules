# Перевірка кореневого `package.json` для npm-module (npm-module.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/package.json.snippet.json.
# Snippet-array subset-of: кожне значення з template-масиву має бути у input-масиві.
# Решта кореневих `package.json`-перевірок (заборонені поля, devDeps лише @nitra/*)
# — у `bun.package_json`. FS-перевірки (наявність каталогу `npm/`, `npm/package.json`)
# — у JS.
package npm_module.root_package_json

import rego.v1

# Поле має бути масивом — інакше окрема deny.
deny contains msg if {
	some field in object.keys(data.template.snippet)
	not is_array(object.get(input, field, null))
	msg := sprintf("package.json: масив %s відсутній або не масив (npm-module.mdc)", [field])
}

# Subset-of: кожне значення з template має бути в input-масиві.
deny contains msg if {
	some field, expected_values in data.template.snippet
	is_array(object.get(input, field, null))
	actual_set := {v | some v in input[field]}
	some required in expected_values
	not required in actual_set
	msg := sprintf("package.json: %s має містити %q (npm-module.mdc)", [field, required])
}
