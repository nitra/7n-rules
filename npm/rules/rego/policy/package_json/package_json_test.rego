# Тести для `rego.package_json`. Запуск:
#   conftest verify -p npm/policy/rego/package_json
package rego.package_json_test

import rego.v1

import data.rego.package_json

canonical_lint_rego := "n-cursor lint-rego"

test_allow_canonical if {
	pkg := {"scripts": {"lint-rego": canonical_lint_rego}}
	count(package_json.deny) == 0 with input as pkg
}

test_allow_with_other_scripts if {
	pkg := {"scripts": {"lint-rego": canonical_lint_rego, "test": "bun test"}}
	count(package_json.deny) == 0 with input as pkg
}

test_allow_with_whitespace if {
	pkg := {"scripts": {"lint-rego": concat("", ["  ", canonical_lint_rego, " "])}}
	count(package_json.deny) == 0 with input as pkg
}

test_deny_missing_lint_rego if {
	count(package_json.deny) > 0 with input as {"scripts": {}}
}

test_deny_no_scripts if {
	count(package_json.deny) > 0 with input as {"name": "x"}
}

test_deny_wrong_value if {
	pkg := {"scripts": {"lint-rego": "opa check ."}}
	count(package_json.deny) > 0 with input as pkg
}

test_deny_npx_form if {
	pkg := {"scripts": {"lint-rego": "npx opa check ."}}
	count(package_json.deny) > 0 with input as pkg
}
