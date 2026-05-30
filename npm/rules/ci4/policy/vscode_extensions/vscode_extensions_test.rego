package ci4.vscode_extensions_test

import data.ci4.vscode_extensions
import rego.v1

template_data := {"snippet": {"recommendations": ["arr.marksman"]}}

canonical := {"recommendations": ["arr.marksman"]}

test_allow_canonical if {
	count(vscode_extensions.deny) == 0 with input as canonical with data.template as template_data
}

test_deny_missing_marksman if {
	cfg := {"recommendations": ["DavidAnson.vscode-markdownlint"]}
	count(vscode_extensions.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_empty_recommendations if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": []} with data.template as template_data
}

test_allow_extra_recommendations if {
	cfg := {"recommendations": ["arr.marksman", "bierner.markdown-mermaid", "DavidAnson.vscode-markdownlint"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_extensions.deny with input as canonical
		with data.template as {"snippet": {"recommendations": ["custom.ext"]}}
	contains(msg, "custom.ext")
}
