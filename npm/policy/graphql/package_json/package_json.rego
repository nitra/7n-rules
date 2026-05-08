# Порт перевірки `package.json` з `npm/scripts/check-graphql.mjs` (graphql.mdc).
#
# Запуск (локально, ЯКЩО проект містить `gql\`…\`` теги — gating робить JS-частина
# через oxc-parser-скан):
#   conftest test package.json -p npm/policy/graphql --namespace graphql.package_json
#
# Перевіряє: `scripts.dump-schema` точно відповідає канону graphql.mdc.
#
# AST-скан коду на `gql\`…\`` template literals і FS-перевірки (наявність
# `.graphqlrc.yml`, `.vscode/extensions.json` з `graphql.vscode-graphql`) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package graphql.package_json

import rego.v1

required_dump_schema := concat("", [
	"bunx graphqurl http://localhost:4040/v1/graphql ",
	"-H 'X-Hasura-Admin-Secret: secret' --introspect > schema.graphql",
])

deny contains msg if {
	scripts := object.get(input, "scripts", {})
	not "dump-schema" in object.keys(scripts)
	msg := "package.json: відсутній scripts.dump-schema (graphql.mdc)"
}

deny contains msg if {
	dump := object.get(object.get(input, "scripts", {}), "dump-schema", "")
	dump != ""
	dump != required_dump_schema
	msg := sprintf("package.json: scripts.dump-schema має бути канонічним з graphql.mdc (зараз %q)", [dump])
}
