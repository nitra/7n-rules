# Тести для `nginx_default_tpl.vscode_extensions`. Запуск:
#   conftest verify -p npm/policy/nginx_default_tpl/vscode_extensions
package nginx_default_tpl.vscode_extensions_test

import rego.v1

import data.nginx_default_tpl.vscode_extensions

test_allow_with_required_extension if {
	cfg := {"recommendations": ["ahmadalli.vscode-nginx-conf"]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": ["dbaeumer.vscode-eslint", "ahmadalli.vscode-nginx-conf"]}
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
