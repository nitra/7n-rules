# Тести для `nginx_default_tpl.vscode_settings`. Запуск:
#   conftest verify -p npm/policy/nginx_default_tpl/vscode_settings
package nginx_default_tpl.vscode_settings_test

import rego.v1

import data.nginx_default_tpl.vscode_settings

valid_cfg := {
	"editor.formatOnSave": true,
	"[nginx]": {"editor.defaultFormatter": "ahmadalli.vscode-nginx-conf"},
}

test_allow_canonical if {
	count(vscode_settings.deny) == 0 with input as valid_cfg
}

test_allow_with_additional_keys if {
	cfg := json.patch(valid_cfg, [{
		"op": "add",
		"path": "/[javascript]",
		"value": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	}])
	count(vscode_settings.deny) == 0 with input as cfg
}

test_deny_format_on_save_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/editor.formatOnSave", "value": false}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_format_on_save_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/editor.formatOnSave"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_nginx_block_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[nginx]"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_nginx_block_wrong_type if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/[nginx]", "value": "ahmadalli.vscode-nginx-conf"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_nginx_wrong_formatter if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "replace", "path": "/[nginx]/editor.defaultFormatter", "value": "ms-vscode.cpptools"}],
	)
	count(vscode_settings.deny) > 0 with input as cfg
}
