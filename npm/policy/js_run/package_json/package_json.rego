# Порт перевірки залежностей `package.json` з `npm/scripts/check-js-run.mjs`
# (js-run.mdc) — заборона `bunyan` / `@nitra/bunyan`.
#
# Запуск (локально, для будь-якого `package.json` у дереві):
#   conftest test path/to/package.json -p npm/policy/js_run \
#     --namespace js_run.package_json
#
# AST-скан коду на імпорти `bunyan` / `process.env` без `checkEnv`,
# `new Promise(resolve => setTimeout(resolve, ...))`, обмеження `#conn/*`-аліасів —
# у JS (потребує парсингу `.js` / `.ts` через oxc-parser).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_run.package_json

import rego.v1

forbidden_packages := {"bunyan", "@nitra/bunyan"}

deny contains msg if {
	some pkg_name in forbidden_packages
	pkg_name in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("dependencies містить %q — використовуй стандартні логери (js-run.mdc)", [pkg_name])
}

deny contains msg if {
	some pkg_name in forbidden_packages
	pkg_name in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf("devDependencies містить %q — використовуй стандартні логери (js-run.mdc)", [pkg_name])
}
