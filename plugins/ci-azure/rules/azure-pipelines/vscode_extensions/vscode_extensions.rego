# Перевірка `.vscode/extensions.json` для Azure Pipelines (azure-pipelines.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/extensions.json.snippet.json.
# `recommendations` — subset-of: кожна рекомендація з template має бути у input.
# Додаткові рекомендації від інших правил дозволені.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package azure_pipelines.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (azure-pipelines.mdc)", [rec])
}
