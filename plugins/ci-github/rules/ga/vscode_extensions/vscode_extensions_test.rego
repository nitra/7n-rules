package ga.vscode_extensions_test

import data.ga.vscode_extensions
import rego.v1

# Mirrors template/extensions.json.snippet.json
template_data := {"snippet": {"recommendations": ["github.vscode-github-actions"]}}

test_valid_extensions if {
	count(vscode_extensions.deny) == 0 with input as {"recommendations": ["github.vscode-github-actions"]}
		with data.template as template_data
}

test_missing_extensions if {
	some msg in vscode_extensions.deny with input as {"recommendations": []}
		with data.template as template_data
	contains(msg, "github.vscode-github-actions")
}

test_extensions_with_extras_ok if {
	count(vscode_extensions.deny) == 0 with input as {"recommendations": ["other.ext", "github.vscode-github-actions", "another.ext"]}
		with data.template as template_data
}

# Drift test: ensures rego reads from data.template, not from inline literal.
test_data_template_drives_check if {
	some msg in vscode_extensions.deny with input as {"recommendations": []}
		with data.template as {"snippet": {"recommendations": ["custom.ext"]}}
	contains(msg, "custom.ext")
}
