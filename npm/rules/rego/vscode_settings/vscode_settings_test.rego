# Тести для `rego.vscode_settings`. Запуск:
#   conftest verify -p npm/rules/rego/policy/vscode_settings
package rego.vscode_settings_test

import data.rego.vscode_settings
import rego.v1

# Mirrors template/settings.json.snippet.json
template_data := {"snippet": {"[rego]": {
	"editor.defaultFormatter": "tsandall.opa",
	"editor.formatOnSave": true,
}}}

valid_cfg := {"[rego]": {
	"editor.defaultFormatter": "tsandall.opa",
	"editor.formatOnSave": true,
}}

test_allow_canonical if {
	count(vscode_settings.deny) == 0 with input as valid_cfg with data.template as template_data
}

test_allow_with_additional_lang_blocks if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "add", "path": "/[javascript]", "value": {"editor.defaultFormatter": "oxc.oxc-vscode"}}],
	)
	count(vscode_settings.deny) == 0 with input as cfg with data.template as template_data
}

test_deny_rego_block_missing if {
	count(vscode_settings.deny) > 0 with input as {} with data.template as template_data
}

test_deny_rego_block_not_object if {
	count(vscode_settings.deny) > 0 with input as {"[rego]": "tsandall.opa"}
		with data.template as template_data
}

test_deny_wrong_default_formatter if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "replace", "path": "/[rego]/editor.defaultFormatter", "value": "prettier"}],
	)
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_default_formatter_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[rego]/editor.defaultFormatter"}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_format_on_save_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/[rego]/editor.formatOnSave", "value": false}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_format_on_save_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[rego]/editor.formatOnSave"}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_settings.deny with input as {}
		with data.template as {"snippet": {"[python]": {"editor.tabSize": 2}}}
	contains(msg, "[python]")
}
