package js_lint.vscode_extensions_test

import data.js_lint.vscode_extensions
import rego.v1

template_data := {"snippet": {"recommendations": ["dbaeumer.vscode-eslint", "github.vscode-github-actions", "oxc.oxc-vscode"]}}

test_valid_extensions if {
	count(vscode_extensions.deny) == 0 with input as {"recommendations": [
		"dbaeumer.vscode-eslint", "github.vscode-github-actions", "oxc.oxc-vscode", "Vue.volar",
	]} with data.template as template_data
}

test_missing_extension if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": [
		"dbaeumer.vscode-eslint", "oxc.oxc-vscode",
	]} with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_extensions.deny with input as {"recommendations": []}
		with data.template as {"snippet": {"recommendations": ["custom.ext"]}}
	contains(msg, "custom.ext")
}
