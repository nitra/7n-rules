package text.vscode_extensions_test

import data.text.vscode_extensions
import rego.v1

template_data := {"snippet": {"recommendations": ["DavidAnson.vscode-markdownlint", "oxc.oxc-vscode", "timonwong.shellcheck"]}}

canonical := {"recommendations": ["DavidAnson.vscode-markdownlint", "oxc.oxc-vscode", "timonwong.shellcheck"]}

test_allow_canonical if {
	count(vscode_extensions.deny) == 0 with input as canonical with data.template as template_data
}

test_deny_missing_markdownlint if {
	cfg := {"recommendations": ["oxc.oxc-vscode", "timonwong.shellcheck"]}
	count(vscode_extensions.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_missing_oxc if {
	cfg := {"recommendations": ["DavidAnson.vscode-markdownlint", "timonwong.shellcheck"]}
	count(vscode_extensions.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_empty_recommendations if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": []} with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_extensions.deny with input as canonical
		with data.template as {"snippet": {"recommendations": ["custom.ext"]}}
	contains(msg, "custom.ext")
}
