package php.package_json_test

import data.php.package_json
import rego.v1

template_data := {"contains": {"scripts": {"lint-php": ["bun"]}}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as {"scripts": {"lint-php": "bun ./npm/scripts/run-php.mjs"}}
		with data.template as template_data
}

test_deny_missing_lint_php if {
	some msg in package_json.deny with input as {"scripts": {}} with data.template as template_data
	contains(msg, "lint-php")
}

test_deny_no_scripts if {
	some msg in package_json.deny with input as {} with data.template as template_data
	contains(msg, "lint-php")
}

# Drift test.
test_data_template_drives_substring if {
	some msg in package_json.deny with input as {"scripts": {"lint-php": "bun ./npm/scripts/run-php.mjs"}}
		with data.template as {"contains": {"scripts": {"lint-php": ["custom-cli"]}}}
	contains(msg, "custom-cli")
}
