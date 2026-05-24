package test.package_json_test

import data.test.package_json
import rego.v1

template_data := {"contains": {"scripts": {"coverage": ["n-cursor coverage"]}}}

valid_pkg := {"scripts": {"coverage": "n-cursor coverage"}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_missing_coverage_script if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/coverage"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_wrong_coverage_command if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/coverage", "value": "echo nope"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "n-cursor coverage")
}

test_allow_extended_coverage_command if {
	# substring-семантика: дозволяємо локальні розширення
	extended := json.patch(valid_pkg, [{
		"op": "replace", "path": "/scripts/coverage",
		"value": "bun run pre-coverage && n-cursor coverage",
	}])
	count(package_json.deny) == 0 with input as extended with data.template as template_data
}

# Drift test: підміна data.template веде перевірку
test_data_template_drives_contains if {
	some msg in package_json.deny with input as valid_pkg
		with data.template as {"contains": {"scripts": {"coverage": ["custom-marker"]}}}
	contains(msg, "custom-marker")
}
