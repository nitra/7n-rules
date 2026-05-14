# Тести для `text.markdownlint`. Запуск:
#   conftest verify -p npm/policy/text/markdownlint
package text.markdownlint_test

import rego.v1

import data.text.markdownlint

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

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(markdownlint.deny) == 0 with input as valid_cfg
}

test_allow_with_additional_top_level_keys if {
	cfg := json.patch(valid_cfg, [{"op": "add", "path": "/ignores", "value": ["**/adr/**"]}])
	count(markdownlint.deny) == 0 with input as cfg
}

test_allow_with_additional_md_rules if {
	cfg := json.patch(valid_cfg, [{"op": "add", "path": "/config/MD033", "value": {"allowed_elements": ["a"]}}])
	count(markdownlint.deny) == 0 with input as cfg
}

# ── gitignore ─────────────────────────────────────────────────────────────

test_deny_missing_gitignore if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/gitignore"}])
	count(markdownlint.deny) > 0 with input as cfg
}

test_deny_gitignore_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/gitignore", "value": false}])
	count(markdownlint.deny) > 0 with input as cfg
}

# ── config.default ────────────────────────────────────────────────────────

test_deny_default_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/default", "value": false}])
	count(markdownlint.deny) > 0 with input as cfg
}

test_deny_default_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/config/default"}])
	count(markdownlint.deny) > 0 with input as cfg
}

# ── MD013 / MD029 / MD040 / MD041 — повинні бути false ────────────────────

test_deny_md013_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/MD013", "value": true}])
	count(markdownlint.deny) > 0 with input as cfg
}

test_deny_md029_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/config/MD029"}])
	count(markdownlint.deny) > 0 with input as cfg
}

test_deny_md040_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/MD040", "value": true}])
	count(markdownlint.deny) > 0 with input as cfg
}

test_deny_md041_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/MD041", "value": true}])
	count(markdownlint.deny) > 0 with input as cfg
}

# ── MD024.siblings_only ──────────────────────────────────────────────────

test_deny_md024_not_object if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/MD024", "value": false}])
	count(markdownlint.deny) > 0 with input as cfg
}

test_deny_md024_siblings_only_false if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/config/MD024/siblings_only", "value": false}])
	count(markdownlint.deny) > 0 with input as cfg
}

test_deny_md024_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/config/MD024"}])
	count(markdownlint.deny) > 0 with input as cfg
}
