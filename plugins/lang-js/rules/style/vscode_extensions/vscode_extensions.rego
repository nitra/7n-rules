# Перевірка `.vscode/extensions.json` для style (style.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/extensions.json.snippet.json.
package style.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (style.mdc)", [rec])
}
