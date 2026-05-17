# Тести для `rego.package_json`. Запуск:
#   conftest verify -p npm/rules/rego/policy/package_json
package rego.package_json_test

import data.rego.package_json
import rego.v1

# Mirrors template/package.json.snippet.json
template_data := {"snippet": {"scripts": {"lint-rego": "n-cursor lint-rego"}}}

test_allow_canonical if {
	pkg := {"scripts": {"lint-rego": "n-cursor lint-rego"}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_with_other_scripts if {
	pkg := {"scripts": {"lint-rego": "n-cursor lint-rego", "test": "bun test"}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_with_whitespace if {
	pkg := {"scripts": {"lint-rego": "  n-cursor lint-rego "}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_deny_missing_lint_rego if {
	count(package_json.deny) > 0 with input as {"scripts": {}}
		with data.template as template_data
}

test_deny_no_scripts if {
	count(package_json.deny) > 0 with input as {"name": "x"}
		with data.template as template_data
}

test_deny_wrong_value if {
	pkg := {"scripts": {"lint-rego": "opa check ."}}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_npx_form if {
	pkg := {"scripts": {"lint-rego": "npx opa check ."}}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

# Drift test: ensures rego reads expected value from data.template.
test_data_template_drives_expected_value if {
	some msg in package_json.deny with input as {"scripts": {"lint-rego": "n-cursor lint-rego"}}
		with data.template as {"snippet": {"scripts": {"lint-rego": "custom-cli check"}}}
	contains(msg, "custom-cli")
}
