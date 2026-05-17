package js_lint.vscode_extensions

import rego.v1

test_valid_extensions if {
	count(deny) == 0 with input as {
		"recommendations": [
			"dbaeumer.vscode-eslint",
			"github.vscode-github-actions",
			"oxc.oxc-vscode",
			"Vue.volar",
		],
	}
}

test_missing_extension if {
	count(deny) == 1 with input as {
		"recommendations": [
			"dbaeumer.vscode-eslint",
			"oxc.oxc-vscode",
		],
	}
}
