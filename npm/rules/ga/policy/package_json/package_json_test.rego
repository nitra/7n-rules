package ga.package_json_test

import data.ga.package_json
import rego.v1

# Mirrors template/package.json.contains.json
template_data := {"contains": {"scripts": {"lint-ga": ["n-cursor lint-ga"]}}}

test_valid_package_json if {
	count(package_json.deny) == 0 with input as {"scripts": {"lint-ga": "n-cursor lint-ga"}}
		with data.template as template_data
}

test_missing_lint_ga if {
	some msg in package_json.deny with input as {"scripts": {}}
		with data.template as template_data
	contains(msg, "scripts.lint-ga")
}

test_wrong_lint_ga if {
	some msg in package_json.deny with input as {"scripts": {"lint-ga": "bunx github-actionlint"}}
		with data.template as template_data
	contains(msg, "scripts.lint-ga")
}
