package text.vscode_settings_test

import data.text.vscode_settings
import rego.v1

template_data := {"snippet": {
	"editor.formatOnSave": true,
	"[javascript]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[typescript]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[json]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[vue]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[css]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[html]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
}}

valid_cfg := {
	"editor.formatOnSave": true,
	"[javascript]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[typescript]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[json]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[vue]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[css]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[html]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
}

test_allow_canonical if {
	count(vscode_settings.deny) == 0 with input as valid_cfg with data.template as template_data
}

test_deny_format_on_save_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/editor.formatOnSave", "value": false}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_javascript_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[javascript]"}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_typescript_wrong_formatter if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "replace", "path": "/[typescript]/editor.defaultFormatter", "value": "prettier"}],
	)
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_empty_object if {
	count(vscode_settings.deny) > 0 with input as {} with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_settings.deny with input as {}
		with data.template as {"snippet": {"editor.customFlag": true}}
	contains(msg, "editor.customFlag")
}
