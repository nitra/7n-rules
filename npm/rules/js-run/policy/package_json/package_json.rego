# Перевірка `package.json` (js-run.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/package.json.deny.json.
# AST-скан коду (`bunyan`/`process.env`/`#conn/*`) — у JS.
package js_run.package_json

import rego.v1

deny contains msg if {
	some pkg, reason in data.template.deny.dependencies
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("dependencies.%s — %s", [pkg, reason])
}

deny contains msg if {
	some pkg, reason in data.template.deny.devDependencies
	pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf("devDependencies.%s — %s", [pkg, reason])
}
