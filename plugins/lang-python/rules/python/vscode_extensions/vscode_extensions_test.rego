package python.vscode_extensions_test

import data.python.vscode_extensions
import rego.v1

template_data := {"snippet": {"recommendations": ["ms-python.python", "charliermarsh.ruff"]}}

test_allow_with_both_extensions if {
	cfg := {"recommendations": ["ms-python.python", "charliermarsh.ruff"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": ["dbaeumer.vscode-eslint", "ms-python.python", "charliermarsh.ruff", "tamasfe.even-better-toml"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_deny_missing_python if {
	cfg := {"recommendations": ["charliermarsh.ruff"]}
	some msg in vscode_extensions.deny with input as cfg with data.template as template_data
	contains(msg, "ms-python.python")
}

test_deny_missing_ruff if {
	cfg := {"recommendations": ["ms-python.python"]}
	some msg in vscode_extensions.deny with input as cfg with data.template as template_data
	contains(msg, "charliermarsh.ruff")
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
