package ga.package_json

import rego.v1

test_valid_package_json if {
	count(deny) == 0 with input as {"scripts": {"lint-ga": "n-cursor lint-ga"}}
}

test_missing_lint_ga if {
	count(deny) == 1 with input as {"scripts": {}}
}

test_wrong_lint_ga if {
	count(deny) == 1 with input as {"scripts": {"lint-ga": "bunx github-actionlint"}}
}
