# Порт перевірок `npm/tsconfig.emit-types.json` з `npm/scripts/check-npm-module.mjs`
# (npm-module.mdc).
#
# Запуск (локально):
#   conftest test npm/tsconfig.emit-types.json -p npm/policy/npm_module \
#     --namespace npm_module.emit_types_config
#
# Перевіряє: `compilerOptions.{allowJs, declaration, emitDeclarationOnly, outDir,
# skipLibCheck}` мають канонічні значення (true/true/true/"types"/true). FS-перевірки
# (наявність самого `tsconfig.emit-types.json`, активність layout-варіанта) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package npm_module.emit_types_config

import rego.v1

required_compiler_options := {
	"allowJs": true,
	"declaration": true,
	"emitDeclarationOnly": true,
	"outDir": "types",
	"skipLibCheck": true,
}

deny contains msg if {
	not is_object(object.get(input, "compilerOptions", null))
	msg := "npm/tsconfig.emit-types.json: відсутній compilerOptions (npm-module.mdc)"
}

deny contains msg if {
	is_object(input.compilerOptions)
	some key, expected in required_compiler_options
	object.get(input.compilerOptions, key, null) != expected
	msg := sprintf("npm/tsconfig.emit-types.json: compilerOptions.%s має бути %v (npm-module.mdc)", [key, expected])
}
