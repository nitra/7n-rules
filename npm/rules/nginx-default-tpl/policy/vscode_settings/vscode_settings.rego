# Перевірка `.vscode/settings.json` для nginx-default-tpl (nginx-default-tpl.mdc).
#
# Викликається з `check-nginx-default-tpl.mjs` через `runConftestBatch` лише
# ПІСЛЯ того, як JS виявив `default.conf.template`. Без `target.json` поруч
# не реєструється.
#
# Canonical:
#   { "editor.formatOnSave": true,
#     "[nginx]": { "editor.defaultFormatter": "ahmadalli.vscode-nginx-conf" } }
package nginx_default_tpl.vscode_settings

import rego.v1

deny contains msg if {
	object.get(input, "editor.formatOnSave", null) != true
	msg := ".vscode/settings.json: \"editor.formatOnSave\" має бути true (nginx-default-tpl.mdc)"
}

deny contains msg if {
	nginx_block := object.get(input, "[nginx]", {})
	not is_object(nginx_block)
	msg := concat(" ", [
		".vscode/settings.json: \"[nginx]\" має бути обʼєктом з",
		"\"editor.defaultFormatter\": \"ahmadalli.vscode-nginx-conf\" (nginx-default-tpl.mdc)",
	])
}

deny contains msg if {
	nginx_block := object.get(input, "[nginx]", {})
	is_object(nginx_block)
	object.get(nginx_block, "editor.defaultFormatter", null) != "ahmadalli.vscode-nginx-conf"
	msg := concat(" ", [
		".vscode/settings.json: \"[nginx].editor.defaultFormatter\" має бути",
		"\"ahmadalli.vscode-nginx-conf\" (nginx-default-tpl.mdc)",
	])
}
