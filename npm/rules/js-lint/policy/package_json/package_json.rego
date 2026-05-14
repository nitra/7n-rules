# Порт перевірок `package.json` з `npm/scripts/check-js-lint.mjs` (js-lint.mdc).
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/js_lint --namespace js_lint.package_json
#
# Перевіряє: канонічний `lint-js` скрипт, `@nitra/eslint-config` ≥ 3.9.2 у
# `devDependencies`, `engines.node >= 24`, `engines.bun >= 1.3`, `type: "module"`.
#
# Перевірка `.oxlintrc.json` проти канонічного JSON (`utils/oxlint-canonical.json`)
# і дубля JS-перевірок у `lint.yml` — у JS (потребує читання другого файлу
# і порівняння глибокої структури проти embedded snapshot).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_lint.package_json

import rego.v1

canonical_lint_js := "bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip --no-config-hints"

# ── deny: `lint-js` скрипт ─────────────────────────────────────────────────

deny contains msg if {
	scripts := object.get(input, "scripts", {})
	not "lint-js" in object.keys(scripts)
	msg := "package.json: відсутній скрипт `lint-js` (js-lint.mdc)"
}

deny contains msg if {
	lint_js := object.get(object.get(input, "scripts", {}), "lint-js", "")
	lint_js != ""
	normalize_lint_js(lint_js) != canonical_lint_js
	msg := sprintf("package.json: lint-js має бути %q (js-lint.mdc)", [canonical_lint_js])
}

# ── deny: type: "module" ──────────────────────────────────────────────────

deny contains msg if {
	object.get(input, "type", null) != "module"
	msg := "package.json: \"type\" має бути \"module\" (js-lint.mdc)"
}

# ── deny: engines ──────────────────────────────────────────────────────────

deny contains msg if {
	engines := object.get(input, "engines", {})
	not engines_node_meets(object.get(engines, "node", ""))
	msg := "package.json: engines.node має бути >= 24 (js-lint.mdc)"
}

deny contains msg if {
	engines := object.get(input, "engines", {})
	not engines_bun_meets(object.get(engines, "bun", ""))
	msg := "package.json: engines.bun має бути >= 1.3 (js-lint.mdc)"
}

# ── deny: @nitra/eslint-config ≥ 3.9.2 ────────────────────────────────────

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/eslint-config" in object.keys(dev)
	msg := "package.json: відсутній @nitra/eslint-config у devDependencies (js-lint.mdc)"
}

deny contains msg if {
	range := object.get(object.get(input, "devDependencies", {}), "@nitra/eslint-config", "")
	range != ""
	not eslint_config_meets_min(range)
	msg := sprintf("package.json: @nitra/eslint-config має бути >= 3.9.2 (зараз %q) (js-lint.mdc)", [range])
}

# ── helpers ────────────────────────────────────────────────────────────────

# Нормалізація `lint-js`: trim + одиничні пробіли (як у JS).
normalize_lint_js(s) := regex.replace(trim_space(s), `\s+`, " ")

# `engines.node`: дозволяється `>=24`, `^24`, `24.x`, `24.0.0` тощо. Дістаємо
# першу мажорну цифру; вона має бути ≥ 24.
engines_node_meets(spec) if {
	major := first_major(spec)
	major >= 24
}

# `engines.bun`: дозволяється `>=1.3`, `^1.3.0`, `1.3.x` тощо. Перша мажор-мінор
# пара має бути ≥ 1.3.
engines_bun_meets(spec) if {
	parts := split_to_numbers(spec)
	count(parts) >= 2
	parts[0] > 1
}

engines_bun_meets(spec) if {
	parts := split_to_numbers(spec)
	count(parts) >= 2
	parts[0] == 1
	parts[1] >= 3
}

# `@nitra/eslint-config`: ≥ 3.9.2; `workspace:*` теж OK.
eslint_config_meets_min(range) if startswith(trim_space(range), "workspace:")

eslint_config_meets_min(range) if {
	parts := split_to_numbers(range)
	count(parts) >= 3
	parts[0] > 3
}

eslint_config_meets_min(range) if {
	parts := split_to_numbers(range)
	count(parts) >= 3
	parts[0] == 3
	parts[1] > 9
}

eslint_config_meets_min(range) if {
	parts := split_to_numbers(range)
	count(parts) >= 3
	parts[0] == 3
	parts[1] == 9
	parts[2] >= 2
}

# Перша мажорна цифра з рядка-діапазону (наприклад `^24.1.0` → 24).
first_major(spec) := major if {
	parts := split_to_numbers(spec)
	count(parts) >= 1
	major := parts[0]
}

# Розкидати рядок версії на список чисел (відкидаючи range-оператори і нечислові
# фрагменти). `^24.1.0` → [24, 1, 0]; `>=1.3` → [1, 3]; `workspace:*` → [].
split_to_numbers(spec) := nums if {
	tokens := regex.split(`\D+`, spec)
	non_empty := [t | some t in tokens; t != ""]
	nums := [n | some t in non_empty; n := to_number(t)]
}
