# Перевірка `.vscode/settings.json` для rego (rego.mdc).
#
# Викликається з `check-rego.mjs` через `runConftestBatch` лише ПІСЛЯ виявлення
# `.rego` файлів у дереві. Глобально без `target.json` поруч (не auto-discoverable через `n-cursor check`).
#
# Canonical (rego.mdc):
#   { "[rego]": { "editor.defaultFormatter": "tsandall.opa",
#                 "editor.formatOnSave": true } }
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package rego.vscode_settings

import rego.v1

# ── deny: [rego] block ──────────────────────────────────────────────────

deny contains msg if {
	not is_object(object.get(input, "[rego]", null))
	msg := concat(" ", [
		".vscode/settings.json: \"[rego]\" має бути обʼєктом з",
		"\"editor.defaultFormatter\": \"tsandall.opa\" і",
		"\"editor.formatOnSave\": true (rego.mdc)",
	])
}

deny contains msg if {
	rego_block := object.get(input, "[rego]", {})
	is_object(rego_block)
	object.get(rego_block, "editor.defaultFormatter", null) != "tsandall.opa"
	msg := ".vscode/settings.json: \"[rego].editor.defaultFormatter\" має бути \"tsandall.opa\" (rego.mdc)"
}

deny contains msg if {
	rego_block := object.get(input, "[rego]", {})
	is_object(rego_block)
	object.get(rego_block, "editor.formatOnSave", null) != true
	msg := ".vscode/settings.json: \"[rego].editor.formatOnSave\" має бути true (rego.mdc)"
}
