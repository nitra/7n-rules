# Перевірка `.vscode/extensions.json` для GitHub Actions (ga.mdc).
#
# Canonical: у `recommendations` має бути `github.vscode-github-actions`.
# Додаткові рекомендації від інших правил дозволені.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.vscode_extensions

import rego.v1

deny contains msg if {
	not "github.vscode-github-actions" in {r | some r in object.get(input, "recommendations", [])}
	msg := ".vscode/extensions.json: recommendations має містити \"github.vscode-github-actions\" (ga.mdc)"
}
