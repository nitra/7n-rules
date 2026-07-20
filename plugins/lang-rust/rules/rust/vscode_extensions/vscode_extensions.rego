# Перевірка `.vscode/extensions.json` для правила rust (rust.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/extensions.json.snippet.json.
# Semantics: subset-of для recommendations — кожен з канону має бути присутнім,
# інші екстеншени дозволені.
package rust.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (rust.mdc)", [rec])
}
