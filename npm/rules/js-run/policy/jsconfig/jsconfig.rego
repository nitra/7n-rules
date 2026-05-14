# Порт перевірки `jsconfig.json` з `npm/scripts/check-js-run.mjs` (js-run.mdc).
#
# Запуск (локально, у backend-пакеті з каталогом `src/`):
#   conftest test path/to/jsconfig.json -p npm/policy/js_run \
#     --namespace js_run.jsconfig
#
# Перевіряє: `compilerOptions.{lib, module, moduleResolution, target, checkJs}` і
# `include` мають канонічні значення (js-run.mdc).
#
# FS-перевірка (наявність каталогу `src/` у пакеті, наявність самого `jsconfig.json`)
# і вибір файлу-кандидата — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_run.jsconfig

import rego.v1

# ── deny: compilerOptions ──────────────────────────────────────────────────

deny contains msg if {
	co := object.get(input, "compilerOptions", {})
	not is_array(object.get(co, "lib", null))
	msg := "jsconfig.json: compilerOptions.lib має бути [\"esnext\"] (js-run.mdc)"
}

deny contains msg if {
	co := object.get(input, "compilerOptions", {})
	is_array(co.lib)
	{l | some l in co.lib} != {"esnext"}
	msg := "jsconfig.json: compilerOptions.lib має бути [\"esnext\"] (js-run.mdc)"
}

deny contains msg if {
	object.get(object.get(input, "compilerOptions", {}), "module", null) != "NodeNext"
	msg := "jsconfig.json: compilerOptions.module має бути \"NodeNext\" (js-run.mdc)"
}

deny contains msg if {
	object.get(object.get(input, "compilerOptions", {}), "moduleResolution", null) != "NodeNext"
	msg := "jsconfig.json: compilerOptions.moduleResolution має бути \"NodeNext\" (js-run.mdc)"
}

deny contains msg if {
	object.get(object.get(input, "compilerOptions", {}), "target", null) != "esnext"
	msg := "jsconfig.json: compilerOptions.target має бути \"esnext\" (js-run.mdc)"
}

deny contains msg if {
	object.get(object.get(input, "compilerOptions", {}), "checkJs", null) != false
	msg := "jsconfig.json: compilerOptions.checkJs має бути false (js-run.mdc)"
}

# ── deny: include ──────────────────────────────────────────────────────────

deny contains msg if {
	not is_array(object.get(input, "include", null))
	msg := "jsconfig.json: include має бути [\"src/**/*\"] (js-run.mdc)"
}

deny contains msg if {
	is_array(input.include)
	{p | some p in input.include} != {"src/**/*"}
	msg := "jsconfig.json: include має бути [\"src/**/*\"] (js-run.mdc)"
}
