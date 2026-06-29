# Перевірка `.vscode/extensions.json` для ci4 (ci4.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
package ci4.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (ci4.mdc)", [rec])
}
