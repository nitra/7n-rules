# Перевірка `.gitleaks.toml` для security (security.mdc).
#
# Канонічна мінімальна вимога: `[extend].useDefault = true`, щоб локальний
# конфіг не вимикав стандартні правила gitleaks. Додаткові локальні правила
# дозволені.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package security.gitleaks

import rego.v1

deny contains msg if {
	object.get(object.get(input, "extend", {}), "useDefault", null) != true
	msg := ".gitleaks.toml: [extend].useDefault має бути true (security.mdc)"
}
