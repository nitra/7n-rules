# Перевірка `.vscode/settings.json` для style (style.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/settings.json.snippet.json.
# Top-level літеральні keys — leaf-by-leaf walker.
package style.vscode_settings

import rego.v1

deny contains msg if {
	some key, expected_value in data.template.snippet
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf(".vscode/settings.json: \"%s\" має бути %v (style.mdc)", [key, expected_value])
}
