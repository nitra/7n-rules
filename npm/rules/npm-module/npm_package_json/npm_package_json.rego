# Порт перевірок `npm/package.json` (npm-module.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/package.json.snippet.json
# (snippet-array subset-of для whitelist `files`).
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse-patterns, не виносяться у template):
#  - форма поля `types` (regex pattern: `./types/index.d.ts` або `./types/<…>.d.ts|.d.mts`);
#  - `devDependencies` мають бути відсутні або порожні (inverse-pattern — заборона будь-яких).
#
# FS-перевірки (наявність файлу зі шляху `types`, скан tarball на тест-патерни) — у JS.
package npm_module.npm_package_json

import rego.v1

types_field_template := concat(" ", [
	"npm/package.json: поле \"types\" має бути \"./types/index.d.ts\"",
	"або \"./types/<…>.d.ts|.d.mts\" (зараз: %v) (npm-module.mdc)",
])

dev_deps_template := concat(" ", [
	"npm/package.json: \"devDependencies\" не публікуються користувачам пакета —",
	"перенеси у кореневий package.json: %v (npm-module.mdc: компактний пакет)",
])

# ── deny: types (regex — лишається в rego) ───────────────────────────────

deny contains msg if {
	types_field := object.get(input, "types", "")
	not valid_types_field(types_field)
	msg := sprintf(types_field_template, [types_field])
}

# ── deny: files має існувати та бути масивом ─────────────────────────────

deny contains msg if {
	not is_array(object.get(input, "files", null))
	msg := "npm/package.json: обовʼязковий whitelist \"files\" (без нього npm пакує майже все) (npm-module.mdc)"
}

deny contains msg if {
	is_array(input.files)
	count(input.files) == 0
	msg := "npm/package.json: масив \"files\" не повинен бути порожнім (npm-module.mdc: компактний пакет)"
}

# ── deny: files subset-of з template (template-driven) ──────────────────

deny contains msg if {
	some field, expected_values in data.template.snippet
	is_array(object.get(input, field, null))
	count(input[field]) > 0
	actual_set := {v | some v in input[field]}
	some required in expected_values
	not required in actual_set
	msg := sprintf("npm/package.json: масив \"%s\" має містити %q (npm-module.mdc)", [field, required])
}

# ── deny: devDependencies (inverse-pattern, лишається в rego) ────────────

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	count(dev) > 0
	names := concat(", ", sort([n | some n, _ in dev]))
	msg := sprintf(dev_deps_template, [names])
}

# ── helpers ────────────────────────────────────────────────────────────────

valid_types_field("./types/index.d.ts")

valid_types_field(t) if regex.match(`^\./types/.+\.d\.(ts|mts)$`, t)
