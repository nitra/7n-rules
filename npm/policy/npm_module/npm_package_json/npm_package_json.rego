# Порт перевірок `npm/package.json` з `npm/scripts/check-npm-module.mjs`
# (npm-module.mdc).
#
# Запуск (локально):
#   conftest test npm/package.json -p npm/policy/npm_module \
#     --namespace npm_module.npm_package_json
#
# Перевіряє:
#  - поле `types` має один із двох канонічних патернів: `./types/index.d.ts`
#    (layout `npm/src` з `.js`) або `./types/<…>.d.ts`/`.d.mts` (emit-types);
#  - масив `files` присутній, непорожній і містить `"types"` (whitelist
#    обовʼязковий — без нього npm пакує майже все);
#  - `devDependencies` відсутні або порожні: dev-інструментарій тримаємо у
#    кореневому `package.json` монорепо, щоб `npm install @nitra/<pkg>` його
#    не тягнув (npm-module.mdc: компактний пакет).
#
# Те, який саме типовий layout активний (наявність `.js` під `npm/src`),
# існування файлу зі шляху `types` і скан тест-патернів у tarball — у
# JS-перевірці (`check-npm-module.mjs`: cross-file / FS-access / AST).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package npm_module.npm_package_json

import rego.v1

# Шаблон повідомлення про неканонічне поле `types` — через `concat` для
# regal style/line-length.
types_field_template := concat(" ", [
	"npm/package.json: поле \"types\" має бути \"./types/index.d.ts\"",
	"або \"./types/<…>.d.ts|.d.mts\" (зараз: %v) (npm-module.mdc)",
])

# Шаблон повідомлення про присутність `devDependencies`.
dev_deps_template := concat(" ", [
	"npm/package.json: \"devDependencies\" не публікуються користувачам пакета —",
	"перенеси у кореневий package.json: %v (npm-module.mdc: компактний пакет)",
])

# ── deny: types ────────────────────────────────────────────────────────────

deny contains msg if {
	types_field := object.get(input, "types", "")
	not valid_types_field(types_field)
	msg := sprintf(types_field_template, [types_field])
}

# ── deny: files має існувати, бути непорожнім, містити "types" ────────────

deny contains msg if {
	not is_array(object.get(input, "files", null))
	msg := "npm/package.json: обовʼязковий whitelist \"files\" (без нього npm пакує майже все) (npm-module.mdc)"
}

deny contains msg if {
	is_array(input.files)
	count(input.files) == 0
	msg := "npm/package.json: масив \"files\" не повинен бути порожнім (npm-module.mdc: компактний пакет)"
}

deny contains msg if {
	is_array(input.files)
	count(input.files) > 0
	not "types" in {f | some f in input.files}
	msg := "npm/package.json: масив \"files\" має містити \"types\" (npm-module.mdc)"
}

# ── deny: жодних devDependencies у npm/package.json ───────────────────────

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	count(dev) > 0
	names := concat(", ", sort([n | some n, _ in dev]))
	msg := sprintf(dev_deps_template, [names])
}

# ── helpers ────────────────────────────────────────────────────────────────

valid_types_field("./types/index.d.ts")

valid_types_field(t) if regex.match(`^\./types/.+\.d\.(ts|mts)$`, t)
