# Перевірка `.vscode/extensions.json` для js-lint (js-lint.mdc).
#
# Canonical: у `recommendations` мають бути ESLint, GitHub Actions і Oxlint.
# Канон задає мінімум — додаткові рекомендації від інших правил дозволені.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_lint.vscode_extensions

import rego.v1

required_extensions := {
	"dbaeumer.vscode-eslint",
	"github.vscode-github-actions",
	"oxc.oxc-vscode",
}

recommendations_set := {r | some r in object.get(input, "recommendations", [])}

deny contains msg if {
	some required in required_extensions
	not required in recommendations_set
	msg := sprintf(".vscode/extensions.json: recommendations має містити %q (js-lint.mdc)", [required])
}
