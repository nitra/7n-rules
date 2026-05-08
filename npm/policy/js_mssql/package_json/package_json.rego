# Порт перевірки версії `mssql` з `npm/scripts/check-js-mssql.mjs` (js-mssql.mdc).
#
# Запуск (локально, для будь-якого `package.json`):
#   conftest test path/to/package.json -p npm/policy/js_mssql \
#     --namespace js_mssql.package_json
#
# Перевіряє: якщо `dependencies.mssql` присутній, версія має бути >= 12.5.0.
# Підтримує `^12.5.0`, `>=12.5.0`, `12.5.0`, `workspace:*` (трактується як OK).
#
# AST-скан коду на per-request `new sql.ConnectionPool(...)` всередині функцій
# (потребує парсингу `.js` / `.ts` через oxc-parser), а також full-semver
# (`major.minor.patch` triple-compare у `check-js-mssql.mjs`) лишаються у JS:
# JS-перевірка authoritative, ця Rego — швидкий gate для одиничного `package.json`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_mssql.package_json

import rego.v1

deny contains msg if {
	range := object.get(object.get(input, "dependencies", {}), "mssql", "")
	range != ""
	not mssql_version_meets_min(range)
	msg := sprintf("dependencies.mssql має бути >= 12.5.0 (зараз %q) (js-mssql.mdc)", [range])
}

# Мінімум — 12.5.0 (js-mssql.mdc). `workspace:*` трактуємо як OK (узгоджено з JS).
mssql_version_meets_min(range) if startswith(trim_space(range), "workspace:")

mssql_version_meets_min(range) if {
	parts := split_to_numbers(range)
	count(parts) >= 3
	parts[0] > 12
}

mssql_version_meets_min(range) if {
	parts := split_to_numbers(range)
	count(parts) >= 3
	parts[0] == 12
	parts[1] > 5
}

mssql_version_meets_min(range) if {
	parts := split_to_numbers(range)
	count(parts) >= 3
	parts[0] == 12
	parts[1] == 5
	parts[2] >= 0
}

split_to_numbers(spec) := nums if {
	tokens := regex.split(`\D+`, spec)
	non_empty := [t | some t in tokens; t != ""]
	nums := [n | some t in non_empty; n := to_number(t)]
}
