package python.package_json_test

import data.python.package_json
import rego.v1

template_data := {"contains": {"scripts": {"lint-python": ["bun"]}}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as {"scripts": {"lint-python": "bun ./node_modules/@nitra/cursor/rules/python/lint/lint.mjs"}}
		with data.template as template_data
}

test_deny_missing_lint_python if {
	some msg in package_json.deny with input as {"scripts": {}} with data.template as template_data
	contains(msg, "lint-python")
}

test_deny_no_scripts if {
	some msg in package_json.deny with input as {} with data.template as template_data
	contains(msg, "lint-python")
}

# Drift test.
test_data_template_drives_substring if {
	some msg in package_json.deny with input as {"scripts": {"lint-python": "bun run-python.mjs"}}
		with data.template as {"contains": {"scripts": {"lint-python": ["custom-cli"]}}}
	contains(msg, "custom-cli")
}
