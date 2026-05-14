# Перевірка `.vscode/settings.json` для style-lint (style-lint.mdc).
#
# Запуск (локально):
#   conftest test .vscode/settings.json -p npm/policy/style_lint/vscode_settings \
#     --namespace style_lint.vscode_settings
#
# Canonical (style-lint.mdc): вимкнути вбудовану валідацію CSS/SCSS/Less, щоб
# stylelint був єдиним джерелом діагностики.
#   { "css.validate": false, "less.validate": false, "scss.validate": false }
#
# `editor.codeActionsOnSave` у каноні є, але це smell-test — навмисно не deny,
# щоб не падати на пакетах, які мають свій codeActionsOnSave-конфіг.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package style_lint.vscode_settings

import rego.v1

deny contains msg if {
	some key in {"css.validate", "less.validate", "scss.validate"}
	object.get(input, key, null) != false
	msg := sprintf(".vscode/settings.json: \"%s\" має бути false (style-lint.mdc)", [key])
}
