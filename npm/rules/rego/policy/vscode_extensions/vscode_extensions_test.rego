# Тести для `rego.vscode_extensions`. Запуск:
#   conftest verify -p npm/policy/rego/vscode_extensions
package rego.vscode_extensions_test

import rego.v1

import data.rego.vscode_extensions

test_allow_with_required_extension if {
	cfg := {"recommendations": ["tsandall.opa"]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": [
		"dbaeumer.vscode-eslint",
		"tsandall.opa",
		"oxc.oxc-vscode",
	]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_deny_missing_extension if {
	cfg := {"recommendations": ["dbaeumer.vscode-eslint"]}
	count(vscode_extensions.deny) > 0 with input as cfg
}

test_deny_empty_recommendations if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": []}
}

test_deny_no_recommendations_field if {
	count(vscode_extensions.deny) > 0 with input as {}
}
