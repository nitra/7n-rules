package text.markdownlint_test

import data.text.markdownlint
import rego.v1

template_data := {"snippet": {
	"gitignore": true,
	"config": {
		"default": true,
		"MD013": false,
		"MD024": {"siblings_only": true},
		"MD029": false,
		"MD040": false,
		"MD041": false,
	},
}}

valid_cfg := {
	"gitignore": true,
	"config": {
		"default": true,
		"MD013": false,
		"MD024": {"siblings_only": true},
		"MD029": false,
		"MD040": false,
		"MD041": false,
	},
}

test_allow_canonical if {
	count(markdownlint.deny) == 0 with input as valid_cfg with data.template as template_data
}

test_allow_with_additional_keys if {
	cfg := json.patch(valid_cfg, [{"op": "add", "path": "/config/MD033", "value": {"allowed_elements": ["a"]}}])
	count(markdownlint.deny) == 0 with input as cfg with data.template as template_data
}

test_deny_missing_gitignore if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/gitignore"}])
	count(markdownlint.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_default_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/default", "value": false}])
	count(markdownlint.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_md013_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/MD013", "value": true}])
	count(markdownlint.deny) > 0 with input as cfg with data.template as template_data
}

test_deny_md024_siblings_only_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/MD024/siblings_only", "value": false}])
	count(markdownlint.deny) > 0 with input as cfg with data.template as template_data
}

# Drift test.
test_data_template_drives_expected if {
	drifted := json.patch(template_data, [{"op": "replace", "path": "/snippet/gitignore", "value": "custom"}])
	some msg in markdownlint.deny with input as valid_cfg with data.template as drifted
	contains(msg, "custom")
}
