# Тести для `style_lint.vscode_settings`. Запуск:
#   conftest verify -p npm/policy/style_lint/vscode_settings
package style_lint.vscode_settings_test

import rego.v1

import data.style_lint.vscode_settings

valid_cfg := {
	"css.validate": false,
	"less.validate": false,
	"scss.validate": false,
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(vscode_settings.deny) == 0 with input as valid_cfg
}

test_allow_with_additional_keys if {
	cfg := json.patch(valid_cfg, [{
		"op": "add",
		"path": "/editor.codeActionsOnSave",
		"value": {"source.fixAll": "explicit"},
	}])
	count(vscode_settings.deny) == 0 with input as cfg
}

# ── deny ──────────────────────────────────────────────────────────────────

test_deny_css_validate_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/css.validate", "value": true}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_scss_validate_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/scss.validate"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_less_validate_string if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/less.validate", "value": "off"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_empty_object if {
	count(vscode_settings.deny) > 0 with input as {}
}
