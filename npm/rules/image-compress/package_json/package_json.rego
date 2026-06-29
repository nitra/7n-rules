# Перевірка `package.json` (image-compress.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }.
# Структура --data сформована з template/package.json.deny.json.
package image_compress.package_json

import rego.v1

# ── deny: top-level deps/devDeps з template.deny ─────────────────────────

deny contains msg if {
	some pkg, reason in data.template.deny.dependencies
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("package.json: dependencies.%s — %s", [pkg, reason])
}

deny contains msg if {
	some pkg, reason in data.template.deny.devDependencies
	pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf("package.json: devDependencies.%s — %s", [pkg, reason])
}
