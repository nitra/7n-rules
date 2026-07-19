# Перевірка `dependencies` (js-bun-redis.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/package.json.deny.json.
# AST-скан коду (`import`/`require`/dynamic `import()` тих самих пакетів)
# лишається у `js-bun-redis/js/imports.mjs`.
package js_bun_redis.package_json

import rego.v1

deny contains msg if {
	some pkg, reason in data.template.deny.dependencies
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("dependencies.%s — %s", [pkg, reason])
}
