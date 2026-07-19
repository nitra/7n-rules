# Перевірка `dependencies` (js-bun-db.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/package.json.deny.json.
# AST-скан коду (`new SQL(...)` у функціях, `unsafe()` без маркера, pg-leftover,
# динамічні `IN (…)` через `.join(',')`) лишається у JS.
package js_bun_db.package_json

import rego.v1

deny contains msg if {
	some pkg, reason in data.template.deny.dependencies
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("dependencies.%s — %s", [pkg, reason])
}
