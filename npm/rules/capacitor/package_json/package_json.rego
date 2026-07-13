# Порт перевірки версії `@capacitor/core` з `npm/scripts/rules/capacitor/fix.mjs`
# (capacitor.mdc) — мінімальна мажорна версія = 8.
#
# Запуск (локально, у пакеті з Capacitor):
#   conftest test path/to/package.json -p npm/policy/capacitor \
#     --namespace capacitor.package_json
#
# Перевіряє: якщо в `dependencies['@capacitor/core']` присутній (gating: пакет
# реально використовує Capacitor), то перша мажорна цифра в діапазоні має бути ≥ 8.
# Підтримує `^8.0.0`, `>=8`, `8.x`, `workspace:*` тощо.
#
# Цей порт спрощує JS-логіку — повна семантика OR-діапазонів (`a || b`) і нижня
# межа діапазону лишається в JS (`rules/capacitor/fix.mjs`: `capacitorVersionRangeMinMajor`).
# JS-перевірка лишилась authoritative й бігає через `npx @7n/rules fix capacitor`;
# ця Rego — швидкий gate для одиничного `package.json` (наприклад через IDE).
#
# FS-сканування пакетів через workspaces, iOS-специфічна логіка (Podfile), вибір
# каталогу пакета з Capacitor — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package capacitor.package_json

import rego.v1

deny contains msg if {
	range := object.get(object.get(input, "dependencies", {}), "@capacitor/core", "")
	range != ""
	not capacitor_major_at_least_8(range)
	msg := sprintf("@capacitor/core має бути >= 8 (зараз %q) (capacitor.mdc)", [range])
}

# `workspace:*` / `*` / `x` / `latest` — пропускаємо (як у JS).
capacitor_major_at_least_8(range) if startswith(trim_space(range), "workspace:")

capacitor_major_at_least_8(range) if {
	first_major(range) >= 8
}

first_major(range) := major if {
	match := regex.find_n(`\d+`, range, 1)
	count(match) > 0
	major := to_number(match[0])
}
