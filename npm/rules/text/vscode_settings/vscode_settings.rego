# Перевірка `.vscode/settings.json` для text (text.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/settings.json.snippet.json.
package text.vscode_settings

import rego.v1

deny contains msg if {
	some key, expected_value in data.template.snippet
	not is_object(expected_value)
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf(".vscode/settings.json: \"%s\" має бути %v (text.mdc)", [key, expected_value])
}

deny contains msg if {
	some block_key, expected_inner in data.template.snippet
	is_object(expected_inner)
	inner := object.get(input, block_key, {})
	is_object(inner)
	some leaf_key, expected_value in expected_inner
	actual := object.get(inner, leaf_key, null)
	actual != expected_value
	msg := sprintf(".vscode/settings.json: %s.%s має бути %v (text.mdc)", [block_key, leaf_key, expected_value])
}

deny contains msg if {
	some block_key, expected_inner in data.template.snippet
	is_object(expected_inner)
	raw := object.get(input, block_key, null)
	not is_object(raw)
	msg := sprintf(".vscode/settings.json: %s має бути обʼєктом (text.mdc)", [block_key])
}
