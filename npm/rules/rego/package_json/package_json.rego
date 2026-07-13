# Перевірка `package.json` (rego.mdc / rego-lint.mdc).
#
# `opa` і `regal` не додаються у dependencies / devDependencies — вони мають бути
# лише у PATH (встановлені глобально або через CI-крок). Rego-лінт запускається
# через `n-rules lint rego`, а не через package.json-залежності.
package rego.package_json

import rego.v1

banned_opa_tools := {"opa", "regal"}

deny contains msg if {
	some field in {"dependencies", "devDependencies", "peerDependencies"}
	deps := object.get(input, field, {})
	some name, _ in deps
	name in banned_opa_tools
	msg := sprintf(
		"package.json: %s.%s заборонений — opa/regal встановлюються глобально або через CI, не через npm (rego.mdc)",
		[field, name],
	)
}
