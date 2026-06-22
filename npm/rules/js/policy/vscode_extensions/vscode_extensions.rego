# Перевірка `.vscode/extensions.json` для js (js.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
package js_lint.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (js.mdc)", [rec])
}
