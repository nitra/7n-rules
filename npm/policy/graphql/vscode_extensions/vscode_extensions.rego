# Перевірка `.vscode/extensions.json` для graphql (graphql.mdc).
#
# Викликається з `check-graphql.mjs` через `runConftestBatch` лише ПІСЛЯ того,
# як JS виявив `gql\`…\`` tagged template literal у джерелах (умовне правило).
# Тому в `lint-conftest.mjs` TARGETS глобально не реєструється — інакше були б
# false-positive порушення на проєктах без gql.
#
# Canonical (graphql.mdc):
#   { "recommendations": ["graphql.vscode-graphql"] }
#
# Канон задає мінімум; інші записи (від markdownlint/oxc/...) дозволені.
package graphql.vscode_extensions

import rego.v1

deny contains msg if {
	recs := object.get(input, "recommendations", [])
	not "graphql.vscode-graphql" in {r | some r in recs}
	msg := ".vscode/extensions.json: додай у recommendations \"graphql.vscode-graphql\" (graphql.mdc)"
}
