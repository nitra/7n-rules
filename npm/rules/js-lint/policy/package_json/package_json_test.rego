package js_lint.package_json_test

import data.js_lint.package_json
import rego.v1

canonical_lint_js := "bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip --no-config-hints"

template_data := {"snippet": {
	"type": "module",
	"scripts": {"lint-js": canonical_lint_js},
}}

valid_pkg := {
	"type": "module",
	"scripts": {"lint-js": canonical_lint_js},
	"engines": {"node": ">=24", "bun": ">=1.3"},
	"devDependencies": {"@nitra/eslint-config": "^3.9.2"},
}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_missing_lint_js if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/lint-js"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_wrong_lint_js if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint-js", "value": "bunx eslint ."}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_type_not_module if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/type", "value": "commonjs"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_node_too_old if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/engines/node", "value": ">=20"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_eslint_config_too_old if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies/@nitra~1eslint-config", "value": "^3.5.0"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

# Drift test.
test_data_template_drives_lint_js if {
	drifted := json.patch(template_data, [{"op": "replace", "path": "/snippet/scripts/lint-js", "value": "custom-cli"}])
	some msg in package_json.deny with input as valid_pkg with data.template as drifted
	contains(msg, "custom-cli")
}
