# Перевірка `.vscode/extensions.json` для text (text.mdc).
#
# Запуск (локально):
#   conftest test .vscode/extensions.json -p npm/policy/text/vscode_extensions \
#     --namespace text.vscode_extensions
#
# Canonical (text.mdc): у `recommendations` мають бути три розширення
#   - DavidAnson.vscode-markdownlint
#   - oxc.oxc-vscode
#   - timonwong.shellcheck
#
# Канон задає мінімум — додаткові записи (від інших правил) дозволені.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package text.vscode_extensions

import rego.v1

required_extensions := {
	"DavidAnson.vscode-markdownlint",
	"oxc.oxc-vscode",
	"timonwong.shellcheck",
}

missing_extension_template := ".vscode/extensions.json: recommendations має містити %q (text.mdc)"

# Множина усіх записів `recommendations` (вираз поза deny — щоб regal не лаявся
# performance/non-loop-expression: інакше `object.get` виконувався б на кожній
# ітерації по `required_extensions`).
recommendations_set := {r | some r in object.get(input, "recommendations", [])}

deny contains msg if {
	some required in required_extensions
	not required in recommendations_set
	msg := sprintf(missing_extension_template, [required])
}
