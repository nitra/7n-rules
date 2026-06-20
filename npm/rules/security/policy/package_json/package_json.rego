# Перевірка `package.json` для правила security (security.mdc).
# Канон надходить через --data: { "template": { "snippet": ..., "deny": ..., "contains": ... } }
# Структура --data сформована з template/<target>.{snippet,deny,contains}.json концерну.
package security.package_json

import rego.v1

# ── deny: жодного ключа з deny у dependencies/devDependencies ────────────────
deny contains msg if {
	some pkg, reason in data.template.deny.dependencies
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("package.json: dependencies.%s — %s (security.mdc)", [pkg, reason])
}

deny contains msg if {
	some pkg, reason in data.template.deny.devDependencies
	pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf("package.json: devDependencies.%s — %s (security.mdc)", [pkg, reason])
}
