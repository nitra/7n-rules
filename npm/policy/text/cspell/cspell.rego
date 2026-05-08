# Порт перевірок `.cspell.json` з `npm/scripts/check-text.mjs` (text.mdc).
#
# Запуск (локально):
#   conftest test .cspell.json -p npm/policy/text --namespace text.cspell
#
# Перевіряє: `version: "0.2"`, наявність `language`, імпорт `@nitra/cspell-dict`,
# відсутність прямих імпортів `@cspell/dict-*`, обовʼязкові glob-и в `ignorePaths`
# (text.mdc).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package text.cspell

import rego.v1

# ── Очікувані значення ─────────────────────────────────────────────────────

# Канонічні `ignorePaths` з text.mdc — кожен має бути присутнім.
required_ignore_paths := {
	"**/node_modules/**",
	"**/vscode-extension/**",
	"**/.git/**",
	".vscode",
	"report",
	"*.svg",
	"**/k8s/**/*.yaml",
}

nitra_cspell_dict_marker := "@nitra/cspell-dict"

legacy_dict_marker := "@cspell/dict-"

# Шаблон повідомлення про заборонений імпорт `@cspell/dict-*` — через `concat`
# для regal style/line-length.
legacy_dict_import_template := concat(" ", [
	".cspell.json не має імпортувати @cspell/dict-* —",
	"використовуй лише @nitra/cspell-dict (знайдено: %s) (text.mdc)",
])

# ── deny: version / language ──────────────────────────────────────────────

deny contains msg if {
	object.get(input, "version", null) != "0.2"
	msg := ".cspell.json: version має бути \"0.2\" (text.mdc)"
}

deny contains msg if {
	not object.get(input, "language", false)
	msg := ".cspell.json: відсутнє поле language (text.mdc)"
}

# ── deny: imports ─────────────────────────────────────────────────────────

deny contains msg if {
	imports := object.get(input, "import", [])
	is_array(imports)
	not has_nitra_dict_import(imports)
	msg := ".cspell.json не імпортує @nitra/cspell-dict/cspell-ext.json (text.mdc)"
}

deny contains msg if {
	imports := object.get(input, "import", [])
	is_array(imports)
	some imp in imports
	is_string(imp)
	contains(imp, legacy_dict_marker)
	msg := sprintf(legacy_dict_import_template, [imp])
}

# ── deny: ignorePaths ─────────────────────────────────────────────────────

deny contains msg if {
	not is_array(object.get(input, "ignorePaths", null))
	msg := ".cspell.json: додай масив ignorePaths з канонічними glob-ами (text.mdc)"
}

deny contains msg if {
	is_array(input.ignorePaths)
	some path in required_ignore_paths
	not path in {p | some p in input.ignorePaths}
	msg := sprintf(".cspell.json ignorePaths: додай %q (text.mdc)", [path])
}

# ── helpers ────────────────────────────────────────────────────────────────

has_nitra_dict_import(imports) if {
	some imp in imports
	is_string(imp)
	contains(imp, nitra_cspell_dict_marker)
}
