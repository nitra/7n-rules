package js_lint.vscode_extensions_test

import data.js_lint.vscode_extensions
import rego.v1

test_valid_extensions if {
	count(vscode_extensions.deny) == 0 with input as {"recommendations": [
		"dbaeumer.vscode-eslint",
		"github.vscode-github-actions",
		"oxc.oxc-vscode",
		"Vue.volar",
	]}
}

test_missing_extension if {
	count(vscode_extensions.deny) == 1 with input as {"recommendations": [
		"dbaeumer.vscode-eslint",
		"oxc.oxc-vscode",
	]}
}
