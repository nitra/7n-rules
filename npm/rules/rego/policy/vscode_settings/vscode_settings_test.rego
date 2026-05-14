# Тести для `rego.vscode_settings`. Запуск:
#   conftest verify -p npm/policy/rego/vscode_settings
package rego.vscode_settings_test

import rego.v1

import data.rego.vscode_settings

valid_cfg := {"[rego]": {
	"editor.defaultFormatter": "tsandall.opa",
	"editor.formatOnSave": true,
}}

test_allow_canonical if {
	count(vscode_settings.deny) == 0 with input as valid_cfg
}

test_allow_with_additional_lang_blocks if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "add", "path": "/[javascript]", "value": {"editor.defaultFormatter": "oxc.oxc-vscode"}}],
	)
	count(vscode_settings.deny) == 0 with input as cfg
}

test_deny_rego_block_missing if {
	count(vscode_settings.deny) > 0 with input as {}
}

test_deny_rego_block_not_object if {
	count(vscode_settings.deny) > 0 with input as {"[rego]": "tsandall.opa"}
}

test_deny_wrong_default_formatter if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "replace", "path": "/[rego]/editor.defaultFormatter", "value": "prettier"}],
	)
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_default_formatter_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[rego]/editor.defaultFormatter"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_format_on_save_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/[rego]/editor.formatOnSave", "value": false}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_format_on_save_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[rego]/editor.formatOnSave"}])
	count(vscode_settings.deny) > 0 with input as cfg
}
