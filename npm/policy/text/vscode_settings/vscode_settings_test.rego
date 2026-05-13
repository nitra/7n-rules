# Тести для `text.vscode_settings`. Запуск:
#   conftest verify -p npm/policy/text/vscode_settings
package text.vscode_settings_test

import rego.v1

import data.text.vscode_settings

valid_cfg := {
	"editor.formatOnSave": true,
	"[javascript]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[typescript]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[json]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[vue]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[css]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	"[html]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(vscode_settings.deny) == 0 with input as valid_cfg
}

test_allow_with_additional_lang_block if {
	cfg := json.patch(valid_cfg, [{
		"op": "add",
		"path": "/[python]",
		"value": {"editor.defaultFormatter": "ms-python.python"},
	}])
	count(vscode_settings.deny) == 0 with input as cfg
}

# ── deny: editor.formatOnSave ────────────────────────────────────────────

test_deny_format_on_save_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/editor.formatOnSave", "value": false}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_format_on_save_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/editor.formatOnSave"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

# ── deny: lang formatters (per-key) ──────────────────────────────────────

test_deny_javascript_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[javascript]"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_typescript_wrong_formatter if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "replace", "path": "/[typescript]/editor.defaultFormatter", "value": "prettier"}],
	)
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_json_block_not_object if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/[json]", "value": "oxc.oxc-vscode"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_vue_missing_default_formatter if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/[vue]", "value": {"editor.tabSize": 2}}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_css_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[css]"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

test_deny_html_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/[html]"}])
	count(vscode_settings.deny) > 0 with input as cfg
}

# ── deny: empty object ───────────────────────────────────────────────────

test_deny_empty_object if {
	count(vscode_settings.deny) > 0 with input as {}
}
