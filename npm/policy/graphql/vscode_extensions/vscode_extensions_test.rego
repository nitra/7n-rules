# Тести для `graphql.vscode_extensions`. Запуск:
#   conftest verify -p npm/policy/graphql/vscode_extensions
package graphql.vscode_extensions_test

import rego.v1

import data.graphql.vscode_extensions

test_allow_with_required_extension if {
	cfg := {"recommendations": ["graphql.vscode-graphql"]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": [
		"dbaeumer.vscode-eslint",
		"graphql.vscode-graphql",
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
