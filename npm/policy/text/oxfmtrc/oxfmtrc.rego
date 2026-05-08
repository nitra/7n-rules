# Порт перевірок `.oxfmtrc.json` з `npm/scripts/check-text.mjs` (text.mdc).
#
# Запуск (локально):
#   conftest test .oxfmtrc.json -p npm/policy/text --namespace text.oxfmtrc
#
# Перевіряє: обовʼязкові ключі, канонічні значення (`semi=false`, `singleQuote=true`,
# `tabWidth=2`, `useTabs=false`, `printWidth=120`), масив `ignorePatterns` з
# канонічними glob-ами (hasura/metadata, schema.graphql, auto-imports.d.ts).
#
# FS-перевірки (наявність самого `.oxfmtrc.json`, `.prettierrc.*` файлів) живуть
# у `check-text.mjs`. Тут — лише про вже завантажений input.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package text.oxfmtrc

import rego.v1

# ── Очікувані значення ─────────────────────────────────────────────────────

required_keys := [
	"arrowParens",
	"printWidth",
	"bracketSpacing",
	"bracketSameLine",
	"semi",
	"singleQuote",
	"tabWidth",
	"trailingComma",
	"useTabs",
]

required_ignore_patterns := {
	"**/hasura/metadata/**",
	"**/schema.graphql",
	"**/auto-imports.d.ts",
}

# ── deny: обовʼязкові ключі ────────────────────────────────────────────────

deny contains msg if {
	some key in required_keys
	not key in object.keys(input)
	msg := sprintf(".oxfmtrc.json: відсутній обовʼязковий ключ %q (text.mdc)", [key])
}

# ── deny: канонічні значення ───────────────────────────────────────────────
#
# `object.get(…, sentinel)` робить значення визначеним — інакше при відсутньому
# ключі порівняння дало б `undefined`, не `true`, і правило мовчки не спрацювало б.

deny contains msg if {
	object.get(input, "semi", null) != false
	msg := ".oxfmtrc.json: semi має бути false (text.mdc)"
}

deny contains msg if {
	object.get(input, "singleQuote", null) != true
	msg := ".oxfmtrc.json: singleQuote має бути true (text.mdc)"
}

deny contains msg if {
	object.get(input, "tabWidth", null) != 2
	msg := ".oxfmtrc.json: tabWidth має бути 2 (text.mdc)"
}

deny contains msg if {
	object.get(input, "useTabs", null) != false
	msg := ".oxfmtrc.json: useTabs має бути false (text.mdc)"
}

deny contains msg if {
	object.get(input, "printWidth", null) != 120
	msg := ".oxfmtrc.json: printWidth має бути 120 (text.mdc)"
}

# ── deny: ignorePatterns ───────────────────────────────────────────────────

deny contains msg if {
	not is_array(object.get(input, "ignorePatterns", null))
	msg := ".oxfmtrc.json: додай масив ignorePatterns з канонічними glob-ами (text.mdc)"
}

deny contains msg if {
	is_array(input.ignorePatterns)
	some pattern in required_ignore_patterns
	not pattern in {p | some p in input.ignorePatterns}
	msg := sprintf(".oxfmtrc.json ignorePatterns: додай %q (text.mdc)", [pattern])
}
