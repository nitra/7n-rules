# Перевірка `package.json` (php.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/package.json.contains.json.
# FS-перевірки (`composer.json`, наявність `package.json` як такого) — у JS.
package php.package_json

import rego.v1

deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (php.mdc)", [script_name, needle])
}
