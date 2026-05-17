# Перевірка `package.json` для правила security (security.mdc).
# Канон надходить через --data: { "template": { "snippet": ..., "deny": ..., "contains": ... } }
# Структура --data сформована з template/<target>.{snippet,deny,contains}.json концерну.
package security.package_json

import rego.v1

# ── deny: кожен snippet leaf має співпадати з input ──────────────────────────
deny contains msg if {
	some script_name, expected in data.template.snippet.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	actual != expected
	msg := sprintf("package.json: scripts.%s має бути %q (security.mdc)", [script_name, expected])
}

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

# ── deny: рядкові поля з contains мають містити кожен substring ──────────────
# Перевіряємо лише наявні поля (якщо `scripts.<name>` відсутній — поле опціональне).
deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	actual != ""
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (security.mdc)", [script_name, needle])
}
