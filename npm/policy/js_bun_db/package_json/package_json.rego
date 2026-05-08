# Порт перевірки залежностей `package.json` з `npm/scripts/check-js-bun-db.mjs`
# (js-bun-db.mdc).
#
# Запуск (локально, для будь-якого `package.json` у дереві):
#   conftest test path/to/package.json -p npm/policy/js_bun_db \
#     --namespace js_bun_db.package_json
#
# Перевіряє: у `dependencies` не повинно бути `pg`, `pg-format`, `mysql2` —
# заміна на Bun native SQL (https://bun.com/docs/runtime/sql).
#
# AST-скан коду (`new SQL(...)` всередині функцій, `unsafe()` без маркера
# `// allow-unsafe`, pg-leftover виклики, динамічні `IN (…)` через `.join(',')`)
# лишається у JS (потребує парсингу `.js` / `.ts` через oxc-parser).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_bun_db.package_json

import rego.v1

forbidden_dependencies := {"pg", "pg-format", "mysql2"}

deny contains msg if {
	some pkg_name in forbidden_dependencies
	pkg_name in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("dependencies містить заборонений %q — заміни на Bun native SQL (js-bun-db.mdc)", [pkg_name])
}
