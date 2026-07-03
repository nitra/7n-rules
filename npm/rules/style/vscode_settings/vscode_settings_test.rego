package style.vscode_settings_test

import data.style.vscode_settings
import rego.v1

template_data := {"snippet": {"css.validate": false, "less.validate": false, "scss.validate": false}}

valid_cfg := {"css.validate": false, "less.validate": false, "scss.validate": false}

test_allow_canonical if {
	count(vscode_settings.deny) == 0 with input as valid_cfg with data.template as template_data
}

test_allow_with_additional_keys if {
	cfg := json.patch(valid_cfg, [{
		"op": "add",
		"path": "/editor.codeActionsOnSave",
		"value": {"source.fixAll": "explicit"},
	}])
	count(vscode_settings.deny) == 0 with input as cfg with data.template as template_data
}

test_deny_css_validate_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/css.validate", "value": true}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_scss_validate_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/scss.validate"}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_less_validate_string if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/less.validate", "value": "off"}])
	count(vscode_settings.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_empty_object if {
	count(vscode_settings.deny) > 0 with input as {} with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_settings.deny with input as {"css.validate": true}
		with data.template as {"snippet": {"custom.flag": false}}
	contains(msg, "custom.flag")
}
