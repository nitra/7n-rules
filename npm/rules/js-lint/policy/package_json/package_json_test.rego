# Тести для `js_lint.package_json`. Запуск:
#   conftest verify -p npm/policy/js_lint/package_json
package js_lint.package_json_test

import rego.v1

import data.js_lint.package_json

canonical_lint_js := "bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip --no-config-hints"

valid_pkg := {
	"type": "module",
	"scripts": {"lint-js": canonical_lint_js},
	"engines": {"node": ">=24", "bun": ">=1.3"},
	"devDependencies": {"@nitra/eslint-config": "^3.9.2"},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg
}

test_allow_workspace_eslint_config if {
	pkg := json.patch(
		valid_pkg,
		[{"op": "replace", "path": "/devDependencies/@nitra~1eslint-config", "value": "workspace:*"}],
	)
	count(package_json.deny) == 0 with input as pkg
}

# ── lint-js ───────────────────────────────────────────────────────────────

test_deny_missing_lint_js if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/lint-js"}])
	count(package_json.deny) > 0 with input as pkg
}

test_deny_lint_js_without_knip if {
	pkg := json.patch(
		valid_pkg,
		[{"op": "replace", "path": "/scripts/lint-js", "value": "bunx oxlint --fix && bunx eslint --fix . && bunx jscpd ."}],
	)
	count(package_json.deny) > 0 with input as pkg
}

test_deny_lint_js_without_no_config_hints if {
	without_flag := "bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip"
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint-js", "value": without_flag}])
	count(package_json.deny) > 0 with input as pkg
}

test_deny_lint_js_wrong_order if {
	wrong_order := "bunx eslint --fix . && bunx oxlint --fix && bunx jscpd . && bunx knip --no-config-hints"
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint-js", "value": wrong_order}])
	count(package_json.deny) > 0 with input as pkg
}

test_allow_lint_js_with_extra_whitespace if {
	pkg := json.patch(
		valid_pkg,
		[{"op": "replace", "path": "/scripts/lint-js", "value": concat("  ", ["", canonical_lint_js, ""])}],
	)
	count(package_json.deny) == 0 with input as pkg
}

# ── type: module ──────────────────────────────────────────────────────────

test_deny_type_not_module if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/type", "value": "commonjs"}])
	count(package_json.deny) > 0 with input as pkg
}

test_deny_type_missing if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/type"}])
	count(package_json.deny) > 0 with input as pkg
}

# ── engines ──────────────────────────────────────────────────────────────

test_deny_node_below_24 if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/engines/node", "value": ">=22"}])
	count(package_json.deny) > 0 with input as pkg
}

test_allow_node_above_24 if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/engines/node", "value": ">=25"}])
	count(package_json.deny) == 0 with input as pkg
}

test_deny_bun_below_1_3 if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/engines/bun", "value": ">=1.2"}])
	count(package_json.deny) > 0 with input as pkg
}

test_allow_bun_2_x if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/engines/bun", "value": "^2.0.0"}])
	count(package_json.deny) == 0 with input as pkg
}

# ── @nitra/eslint-config ─────────────────────────────────────────────────

test_deny_eslint_config_below_3_9_2 if {
	cases := [
		"^3.9.1",
		"^3.8.0",
		"^3.6.12",
		"^3.4.3",
	]
	some bad in cases
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies/@nitra~1eslint-config", "value": bad}])
	count(package_json.deny) > 0 with input as pkg
}

test_allow_eslint_config_above_3_9_2 if {
	cases := [
		"^3.9.2",
		"^3.9.10",
		"^3.10.0",
		"^4.0.0",
	]
	some good in cases
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies/@nitra~1eslint-config", "value": good}])
	count(package_json.deny) == 0 with input as pkg
}

test_deny_missing_eslint_config if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/devDependencies/@nitra~1eslint-config"}])
	count(package_json.deny) > 0 with input as pkg
}
