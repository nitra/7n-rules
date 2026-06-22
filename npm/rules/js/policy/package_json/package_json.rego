# Перевірка `package.json` (js.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/package.json.snippet.json
# (canonical `type` + `scripts.lint-js` + `devDependencies.@nitra/eslint-config` як мін-поріг).
#
# Мінімальна версія `@nitra/eslint-config` — ЄДИНЕ джерело в snippet
# (`devDependencies.@nitra/eslint-config`); rego лише парсить поріг і робить semver-порівняння.
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse, без template-значення):
#  - `engines.node` >= 24, `engines.bun` >= 1.3 (semver range parsing).
package js_lint.package_json

import rego.v1

# ── deny: top-level scalar leafs (type) ─────────────────────────────────

deny contains msg if {
	some key, expected_value in data.template.snippet
	not is_object(expected_value)
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf("package.json: \"%s\" має бути %q (js.mdc)", [key, expected_value])
}

# ── deny: scripts (nested) — exact match із normalize ──────────────────

deny contains msg if {
	some script_name, expected in data.template.snippet.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	normalize_script(actual) != expected
	msg := sprintf("package.json: scripts.%s має бути %q (js.mdc)", [script_name, expected])
}

# ── deny: engines.node >= 24 (inverse, у rego) ──────────────────────────

deny contains msg if {
	engines := object.get(input, "engines", {})
	not engines_node_meets(object.get(engines, "node", ""))
	msg := "package.json: engines.node має бути >= 24 (js.mdc)"
}

deny contains msg if {
	engines := object.get(input, "engines", {})
	not engines_bun_meets(object.get(engines, "bun", ""))
	msg := "package.json: engines.bun має бути >= 1.3 (js.mdc)"
}

# ── deny: @nitra/eslint-config >= snippet-поріг ─────────────────────────

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/eslint-config" in object.keys(dev)
	msg := "package.json: відсутній @nitra/eslint-config у devDependencies (js.mdc)"
}

deny contains msg if {
	range := object.get(object.get(input, "devDependencies", {}), "@nitra/eslint-config", "")
	range != ""
	not eslint_config_meets_min(range)
	msg := sprintf("package.json: @nitra/eslint-config має бути >= %s (зараз %q) (js.mdc)", [eslint_min_display, range])
}

# ── helpers ──────────────────────────────────────────────────────────────

# Канонічний мін-поріг `@nitra/eslint-config` із snippet (напр. "^3.10.0").
eslint_min_range := object.get(object.get(data.template.snippet, "devDependencies", {}), "@nitra/eslint-config", "")

# Поріг для повідомлення без діапазонних префіксів (напр. "3.10.0").
eslint_min_display := trim_left(eslint_min_range, "^~>=v ")

normalize_script(s) := regex.replace(trim_space(s), `\s+`, " ")

engines_node_meets(spec) if {
	major := first_major(spec)
	major >= 24
}

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

eslint_config_meets_min(range) if startswith(trim_space(range), "workspace:")

eslint_config_meets_min(range) if {
	actual := split_to_numbers(range)
	count(actual) >= 3
	min_parts := split_to_numbers(eslint_min_range)
	count(min_parts) >= 3
	semver_gte(actual, min_parts)
}

# actual >= min_parts за major.minor.patch (лексикографічно).
semver_gte(a, b) if a[0] > b[0]

semver_gte(a, b) if {
	a[0] == b[0]
	a[1] > b[1]
}

semver_gte(a, b) if {
	a[0] == b[0]
	a[1] == b[1]
	a[2] >= b[2]
}

first_major(spec) := major if {
	parts := split_to_numbers(spec)
	count(parts) >= 1
	major := parts[0]
}

split_to_numbers(spec) := nums if {
	tokens := regex.split(`\D+`, spec)
	non_empty := [t | some t in tokens; t != ""]
	nums := [n | some t in non_empty; n := to_number(t)]
}
