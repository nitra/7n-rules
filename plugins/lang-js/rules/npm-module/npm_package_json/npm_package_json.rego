# Порт перевірок `npm/package.json` (npm-module.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/package.json.snippet.json
# (snippet-array subset-of для whitelist `files`).
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse-patterns, не виносяться у template):
#  - форма поля `types` (regex pattern: `./types/index.d.ts` або `./types/<…>.d.ts|.d.mts`);
#  - `devDependencies` мають бути відсутні/порожні АБО належати канонічному
#    Storybook-allowlist із зафіксованою точною версією (канон Storybook, кластер 7
#    Governance: `docs/adr/канон-storybook-для-vue-компонентних-бібліотек.md`).
#    Storybook-devDeps живуть саме у `npm/package.json` консюмер-пакета
#    (а не в кореневому package.json), бо майбутній `isStorybookRoot()` у
#    `@7n/test` читає саме цей файл, щоб визначити Storybook-скоуп пакета.
#    Канон — static map (той самий підхід, що й `allowed_root_test_deps` у
#    `bun.package_json`), НЕ template: це не mandatory-presence дані (більшість
#    npm-пакетів Storybook не має), тож генеричний T0-fix-writer цього
#    concern-а (`createTemplateFixPattern`, deep-merge усього `template.snippet`
#    у target) канонічні devDeps у кожен package.json не домерджує.
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
	"дозволені лише канонічні Storybook-пакети (isStorybookRoot(), канон Storybook);",
	"dev-інструментарій перенеси у кореневий package.json, а CLI-тули, які пакет",
	"спавнить через bunx у споживачів, — у \"dependencies\": %v (npm-module.mdc)",
])

storybook_version_template := concat(" ", [
	"npm/package.json: devDependencies.%v = %q не відповідає зафіксованій версії",
	"Storybook-канону %q — вирівняй версію пакета до канону (npm-module.mdc, канон Storybook)",
])

# Канонічні Storybook-devDeps (isStorybookRoot()-маркери, канон Storybook кластер 7):
# зафіксована точна версія — єдина дозволена версія для кожного пакета. Оновлення —
# ручна правка цієї map.
storybook_canon_dev_deps := {
	"storybook": "9.1.10",
	"@storybook/vue3-vite": "9.1.10",
	"@storybook/vue3": "9.1.10",
	"msw": "2.11.3",
	"msw-storybook-addon": "2.0.5",
}

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

# ── deny: devDependencies (inverse-pattern + Storybook-allowlist виняток) ─

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	forbidden_names := [n | some n, _ in dev; not n in object.keys(storybook_canon_dev_deps)]
	count(forbidden_names) > 0
	msg := sprintf(dev_deps_template, [concat(", ", sort(forbidden_names))])
}

# ── deny: Storybook-devDep присутній, але версія розходиться з каноном ──

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	some name, version in dev
	canonical := storybook_canon_dev_deps[name]
	version != canonical
	msg := sprintf(storybook_version_template, [name, version, canonical])
}

# ── helpers ────────────────────────────────────────────────────────────────

valid_types_field("./types/index.d.ts")

valid_types_field(t) if regex.match(`^\./types/.+\.d\.(ts|mts)$`, t)
