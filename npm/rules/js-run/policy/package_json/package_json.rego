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

# ── deny: `node` як рантайм у `scripts` (backend-пакети без vite) ─────────

deny contains msg if {
	js_run_backend_package
	is_object(input.scripts)
	some script_name, script_value in input.scripts
	is_string(script_value)
	some rule in object.get(data.template.deny, "scriptsForbidden", [])
	regex.match(rule.pattern, script_value)
	msg := sprintf("package.json: scripts.%s — %s", [script_name, rule.message])
}

# Frontend-пакети (`vite` у devDependencies) — поза js-run (див. js-run.mdc).
js_run_backend_package if {
	not "vite" in object.keys(object.get(input, "devDependencies", {}))
}
