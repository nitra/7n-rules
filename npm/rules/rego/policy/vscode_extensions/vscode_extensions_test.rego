# Тести для `rego.vscode_extensions`. Запуск:
#   conftest verify -p npm/rules/rego/policy/vscode_extensions
package rego.vscode_extensions_test

import data.rego.vscode_extensions
import rego.v1

# Mirrors template/extensions.json.snippet.json
template_data := {"snippet": {"recommendations": ["tsandall.opa"]}}

test_allow_with_required_extension if {
	cfg := {"recommendations": ["tsandall.opa"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": [
		"dbaeumer.vscode-eslint",
		"tsandall.opa",
		"oxc.oxc-vscode",
	]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_deny_missing_extension if {
	cfg := {"recommendations": ["dbaeumer.vscode-eslint"]}
	count(vscode_extensions.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_empty_recommendations if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": []}
		with data.template as template_data
}

test_deny_no_recommendations_field if {
	count(vscode_extensions.deny) > 0 with input as {} with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_extensions.deny with input as {"recommendations": []}
		with data.template as {"snippet": {"recommendations": ["custom.opa"]}}
	contains(msg, "custom.opa")
}
