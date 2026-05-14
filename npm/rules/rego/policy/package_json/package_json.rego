# Перевірка `package.json` для rego (rego.mdc).
#
# Викликається з `check-rego.mjs` через `runConftestBatch` лише ПІСЛЯ виявлення
# `.rego` файлів у дереві. Глобально у `lint-conftest` НЕ реєструється.
#
# Canonical (rego.mdc): scripts.lint-rego має бути "bun ./npm/scripts/lint-rego.mjs".
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package rego.package_json

import rego.v1

canonical_lint_rego := "bun ./npm/scripts/lint-rego.mjs"

lint_rego_template := concat(" ", [
	"package.json: scripts.lint-rego має бути %q",
	"(зараз: %q) (rego.mdc)",
])

deny contains msg if {
	scripts := object.get(input, "scripts", {})
	not "lint-rego" in object.keys(scripts)
	msg := concat(" ", [
		"package.json: відсутній scripts.lint-rego — додай",
		"\"lint-rego\": \"bun ./npm/scripts/lint-rego.mjs\" (rego.mdc)",
	])
}

deny contains msg if {
	scripts := object.get(input, "scripts", {})
	lint_rego := object.get(scripts, "lint-rego", "")
	lint_rego != ""
	trim_space(lint_rego) != canonical_lint_rego
	msg := sprintf(lint_rego_template, [canonical_lint_rego, lint_rego])
}
