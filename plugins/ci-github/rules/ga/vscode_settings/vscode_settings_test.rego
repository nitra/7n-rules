package ga.vscode_settings_test

import data.ga.vscode_settings
import rego.v1

# Mirrors template/settings.json.snippet.json
template_data := {"snippet": {"[github-actions-workflow]": {"editor.defaultFormatter": "oxc.oxc-vscode"}}}

test_valid_settings if {
	count(vscode_settings.deny) == 0 with input as {"[github-actions-workflow]": {"editor.defaultFormatter": "oxc.oxc-vscode"}}
		with data.template as template_data
}

test_missing_settings if {
	some msg in vscode_settings.deny with input as {}
		with data.template as template_data
	contains(msg, "[github-actions-workflow]")
}

test_wrong_formatter if {
	some msg in vscode_settings.deny with input as {"[github-actions-workflow]": {"editor.defaultFormatter": "other"}}
		with data.template as template_data
	contains(msg, "editor.defaultFormatter")
}

# Drift test: ensures rego reads from data.template, not from inline literal.
test_data_template_drives_check if {
	some msg in vscode_settings.deny with input as {}
		with data.template as {"snippet": {"[custom-lang]": {"editor.tabSize": 4}}}
	contains(msg, "[custom-lang]")
}
