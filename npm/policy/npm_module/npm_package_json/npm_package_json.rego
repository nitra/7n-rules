# Порт перевірок `npm/package.json` з `npm/scripts/check-npm-module.mjs`
# (npm-module.mdc).
#
# Запуск (локально):
#   conftest test npm/package.json -p npm/policy/npm_module \
#     --namespace npm_module.npm_package_json
#
# Перевіряє: поле `types` має будь-який з двох канонічних патернів:
#  - `./types/index.d.ts` (layout `npm/src` з `.js`); або
#  - `./types/<…>.d.ts` чи `.d.mts` (layout `tsconfig.emit-types.json`).
#
# Масив `files` має містити `"types"`. Те, який саме layout активний (зокрема
# наявність `.js` під `npm/src`), а також існування файлу зі шляху `types` —
# у JS-перевірці (`check-npm-module.mjs`).
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

# ── deny: types ────────────────────────────────────────────────────────────

deny contains msg if {
	types_field := object.get(input, "types", "")
	not valid_types_field(types_field)
	msg := sprintf(types_field_template, [types_field])
}

# ── deny: files має містити "types" ───────────────────────────────────────

deny contains msg if {
	not is_array(object.get(input, "files", null))
	msg := "npm/package.json: масив \"files\" відсутній — має містити \"types\" (npm-module.mdc)"
}

deny contains msg if {
	is_array(input.files)
	not "types" in {f | some f in input.files}
	msg := "npm/package.json: масив \"files\" має містити \"types\" (npm-module.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

valid_types_field("./types/index.d.ts")

valid_types_field(t) if regex.match(`^\./types/.+\.d\.(ts|mts)$`, t)
