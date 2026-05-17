# Перевірка `.jscpd.json` для js-lint (js-lint.mdc).
#
# JS-частина лишається для FS/cross-file: наявність workflow, flat ESLint config,
# `.oxlintrc.json` проти embedded canonical snapshot, `knip.json` autofill.
# Цей пакет покриває лише структуру одного JSON-документа.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_lint.jscpd

import rego.v1

deny contains msg if {
	input.gitignore != true
	msg := ".jscpd.json має містити \"gitignore\": true (js-lint.mdc)"
}

deny contains msg if {
	input.exitCode != 1
	msg := ".jscpd.json має містити \"exitCode\": 1 (інакше CI не впаде на клонах) (js-lint.mdc)"
}

deny contains msg if {
	not "console" in {r | some r in object.get(input, "reporters", [])}
	msg := ".jscpd.json має містити \"reporters\": [\"console\"] або масив із \"console\" (js-lint.mdc)"
}

deny contains msg if {
	not is_number(object.get(input, "minLines", null))
	msg := ".jscpd.json має містити \"minLines\" як число >= 25 (js-lint.mdc)"
}

deny contains msg if {
	is_number(input.minLines)
	input.minLines < 25
	msg := ".jscpd.json має містити \"minLines\" як число >= 25 (js-lint.mdc)"
}
