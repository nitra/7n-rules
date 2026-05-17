# Перевірка `package.json` (js-lint.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/package.json.snippet.json
# (canonical `type` + `scripts.lint-js`).
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse, не виноситься у template):
#  - `engines.node` >= 24, `engines.bun` >= 1.3 (semver range parsing);
#  - `@nitra/eslint-config` >= 3.9.2 (semver range parsing).
package js_lint.package_json

import rego.v1

# ── deny: top-level scalar leafs (type) ─────────────────────────────────

deny contains msg if {
	some key, expected_value in data.template.snippet
	not is_object(expected_value)
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf("package.json: \"%s\" має бути %q (js-lint.mdc)", [key, expected_value])
}

# ── deny: scripts (nested) — exact match із normalize ──────────────────

deny contains msg if {
	some script_name, expected in data.template.snippet.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	normalize_script(actual) != expected
	msg := sprintf("package.json: scripts.%s має бути %q (js-lint.mdc)", [script_name, expected])
}

# ── deny: engines.node >= 24 (inverse, у rego) ──────────────────────────

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

# ── deny: @nitra/eslint-config >= 3.9.2 (inverse) ───────────────────────

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

# ── helpers ──────────────────────────────────────────────────────────────

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
