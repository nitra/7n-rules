# Перевірка `.vscode/extensions.json` для text (text.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
package text.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (text.mdc)", [rec])
}
