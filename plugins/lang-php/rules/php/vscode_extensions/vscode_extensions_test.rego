package php.vscode_extensions_test

import data.php.vscode_extensions
import rego.v1

template_data := {"snippet": {"recommendations": ["bmewburn.vscode-intelephense-client"]}}

test_allow_with_extension if {
	cfg := {"recommendations": ["bmewburn.vscode-intelephense-client"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": ["dbaeumer.vscode-eslint", "bmewburn.vscode-intelephense-client"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_deny_missing_intelephense if {
	cfg := {"recommendations": ["dbaeumer.vscode-eslint"]}
	some msg in vscode_extensions.deny with input as cfg with data.template as template_data
	contains(msg, "bmewburn.vscode-intelephense-client")
}

test_deny_no_recommendations_field if {
	count(vscode_extensions.deny) > 0 with input as {} with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_extensions.deny with input as {"recommendations": []}
		with data.template as {"snippet": {"recommendations": ["custom.ext"]}}
	contains(msg, "custom.ext")
}
