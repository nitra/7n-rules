# Перевірка `.github/zizmor.yml` для GitHub Actions (ga.mdc).
#
# JS раніше перевіряв сирий текст на `ref-pin`; у policy це робиться по
# JSON-представленню розпарсеного YAML-документа. Коментарі не враховуються,
# тож збіг має бути у фактичній конфігурації.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.zizmor_yml

import rego.v1

deny contains msg if {
	not contains(json.marshal(input), "ref-pin")
	msg := ".github/zizmor.yml: додай policies ref-pin для unpinned-uses (ga.mdc)"
}
