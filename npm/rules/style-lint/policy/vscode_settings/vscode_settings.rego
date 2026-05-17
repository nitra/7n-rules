# Перевірка `.vscode/settings.json` для style-lint (style-lint.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/settings.json.snippet.json.
# Top-level літеральні keys — leaf-by-leaf walker.
package style_lint.vscode_settings

import rego.v1

deny contains msg if {
	some key, expected_value in data.template.snippet
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf(".vscode/settings.json: \"%s\" має бути %v (style-lint.mdc)", [key, expected_value])
}
