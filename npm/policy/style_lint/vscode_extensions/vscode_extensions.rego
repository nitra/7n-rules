# Перевірка `.vscode/extensions.json` для style-lint (style-lint.mdc).
#
# Запуск (локально):
#   conftest test .vscode/extensions.json -p npm/policy/style_lint/vscode_extensions \
#     --namespace style_lint.vscode_extensions
#
# Canonical (style-lint.mdc):
#   { "recommendations": ["stylelint.vscode-stylelint"] }
#
# Канон задає мінімум — `recommendations` має МІСТИТИ `stylelint.vscode-stylelint`;
# додаткові записи (від інших правил — markdownlint, oxc тощо) дозволені.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package style_lint.vscode_extensions

import rego.v1

deny contains msg if {
	recs := object.get(input, "recommendations", [])
	not "stylelint.vscode-stylelint" in {r | some r in recs}
	msg := ".vscode/extensions.json: recommendations має містити \"stylelint.vscode-stylelint\" (style-lint.mdc)"
}
