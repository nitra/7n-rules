# Тести для `text.vscode_extensions`. Запуск:
#   conftest verify -p npm/policy/text/vscode_extensions
package text.vscode_extensions_test

import rego.v1

import data.text.vscode_extensions

canonical := {"recommendations": [
	"DavidAnson.vscode-markdownlint",
	"oxc.oxc-vscode",
	"timonwong.shellcheck",
]}

test_allow_canonical if {
	count(vscode_extensions.deny) == 0 with input as canonical
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": [
		"DavidAnson.vscode-markdownlint",
		"oxc.oxc-vscode",
		"timonwong.shellcheck",
		"dbaeumer.vscode-eslint",
		"stylelint.vscode-stylelint",
	]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_deny_missing_markdownlint if {
	cfg := {"recommendations": ["oxc.oxc-vscode", "timonwong.shellcheck"]}
	count(vscode_extensions.deny) > 0 with input as cfg
}

test_deny_missing_oxc if {
	cfg := {"recommendations": ["DavidAnson.vscode-markdownlint", "timonwong.shellcheck"]}
	count(vscode_extensions.deny) > 0 with input as cfg
}

test_deny_missing_shellcheck if {
	cfg := {"recommendations": ["DavidAnson.vscode-markdownlint", "oxc.oxc-vscode"]}
	count(vscode_extensions.deny) > 0 with input as cfg
}

test_deny_empty_recommendations if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": []}
}

test_deny_no_recommendations_field if {
	count(vscode_extensions.deny) > 0 with input as {}
}
