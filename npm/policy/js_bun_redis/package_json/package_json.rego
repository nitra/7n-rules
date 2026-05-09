# Перевірка `dependencies` для правила `js-bun-redis.mdc` — паралель до
# `npm/policy/js_bun_db/package_json/package_json.rego`.
#
# Запуск (локально, для будь-якого `package.json` у дереві):
#   conftest test path/to/package.json -p npm/policy/js_bun_redis \
#     --namespace js_bun_redis.package_json
#
# Перевіряє: у `dependencies` не повинно бути `ioredis`, `node-redis`,
# `redis` або жодного з підпакетів `@redis/*` — заміна на Bun native Redis
# (https://bun.com/docs/runtime/redis).
#
# AST-скан коду (`import` / `require` / dynamic `import()` тих самих пакетів)
# лишається у `npm/scripts/check-js-bun-redis.mjs` (потребує `oxc-parser`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_bun_redis.package_json

import rego.v1

forbidden_dependencies := {
	"ioredis",
	"node-redis",
	"redis",
	"@redis/client",
	"@redis/json",
	"@redis/search",
	"@redis/time-series",
	"@redis/bloom",
}

deny contains msg if {
	some pkg_name in forbidden_dependencies
	pkg_name in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("dependencies містить заборонений %q — заміни на Bun native Redis (js-bun-redis.mdc)", [pkg_name])
}
