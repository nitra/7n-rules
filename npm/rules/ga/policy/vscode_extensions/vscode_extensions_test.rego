package ga.vscode_extensions

import rego.v1

test_valid_extensions if {
	count(deny) == 0 with input as {"recommendations": ["github.vscode-github-actions"]}
}

test_missing_extensions if {
	count(deny) == 1 with input as {"recommendations": []}
}
