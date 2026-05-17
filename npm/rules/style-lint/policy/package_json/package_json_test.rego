package style_lint.package_json_test

import data.style_lint.package_json
import rego.v1

template_data := {
	"contains": {"scripts": {"lint-style": ["npx stylelint"]}},
	"snippet": {"stylelint": {"extends": "@nitra/stylelint-config"}},
}

valid_pkg := {
	"scripts": {"lint-style": "npx stylelint '**/*.{css,scss}'"},
	"devDependencies": {"@nitra/stylelint-config": "^1.0.0"},
}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_missing_lint_style_script if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/lint-style"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_lint_style_not_npx if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint-style", "value": "bun stylelint"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_stylelint_config_devdep if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/devDependencies/@nitra~1stylelint-config"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_wrong_stylelint_extends if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/stylelint", "value": {"extends": "other"}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "extends")
}

test_allow_no_stylelint_field if {
	# Поле опційне — JS перевіряє альтернативи (`.stylelintrc.*` файли).
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

# Drift test.
test_data_template_drives_contains if {
	some msg in package_json.deny with input as valid_pkg
		with data.template as {
			"contains": {"scripts": {"lint-style": ["custom-cli"]}},
			"snippet": template_data.snippet,
		}
	contains(msg, "custom-cli")
}
