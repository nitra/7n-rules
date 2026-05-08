# Порт перевірки `.markdownlint-cli2.jsonc` з `npm/scripts/check-text.mjs` (text.mdc).
#
# Запуск (локально):
#   conftest test .markdownlint-cli2.jsonc -p npm/policy/text \
#     --namespace text.markdownlint --parser json
#
# Конфтест парсить `.jsonc` як JSON лише якщо файл — валідний JSON (без коментарів).
# У випадку справжнього JSONC з `//` коментарями цей крок мовчки ігноруватиметься
# (conftest skip). FS-перевірка (наявність файлу) живе у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package text.markdownlint

import rego.v1

deny contains msg if {
	object.get(input, "gitignore", null) != true
	msg := ".markdownlint-cli2.jsonc: додай на верхньому рівні \"gitignore\": true (text.mdc)"
}
