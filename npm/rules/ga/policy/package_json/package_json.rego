# Перевірка кореневого `package.json` для GitHub Actions tooling (ga.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/package.json.contains.json.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.package_json

import rego.v1

# Кожне рядкове поле з contains має містити кожен substring.
# Відсутність ключа → `""` → contains() = false → deny.
deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (ga.mdc)", [script_name, needle])
}
