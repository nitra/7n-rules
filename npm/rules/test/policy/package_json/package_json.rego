# Перевірка `package.json` для правила test (test.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/package.json.contains.json.
# Перевіряємо substring-вимоги до scripts.coverage:
# рядок має містити "n-cursor coverage" (локальні розширення дозволені).
package test.package_json

import rego.v1

deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (test.mdc)", [script_name, needle])
}
