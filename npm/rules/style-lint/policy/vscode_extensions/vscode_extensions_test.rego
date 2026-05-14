# Тести для `style_lint.vscode_extensions`. Запуск:
#   conftest verify -p npm/policy/style_lint/vscode_extensions
package style_lint.vscode_extensions_test

import rego.v1

import data.style_lint.vscode_extensions

# ── happy path ────────────────────────────────────────────────────────────

test_allow_with_required_extension if {
	cfg := {"recommendations": ["stylelint.vscode-stylelint"]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": [
		"dbaeumer.vscode-eslint",
		"stylelint.vscode-stylelint",
		"oxc.oxc-vscode",
		"DavidAnson.vscode-markdownlint",
	]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

# ── deny ──────────────────────────────────────────────────────────────────

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
