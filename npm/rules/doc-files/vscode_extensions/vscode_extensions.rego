# Перевірка `.vscode/extensions.json` для doc-files (doc-files.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
package doc_files.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (doc-files.mdc)", [rec])
}
