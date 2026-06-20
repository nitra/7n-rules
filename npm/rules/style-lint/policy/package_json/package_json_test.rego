package style_lint.package_json_test

import data.style_lint.package_json
import rego.v1

template_data := {"snippet": {"stylelint": {"extends": "@nitra/stylelint-config"}}}

valid_pkg := {"devDependencies": {"@nitra/stylelint-config": "^1.0.0"}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
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
