package python.lint_python_yml_test

import data.python.lint_python_yml
import rego.v1

template_data := {"snippet": {"jobs": {"python": {"steps": [
	{"uses": "actions/checkout@v6"},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"uses": "astral-sh/setup-uv@v8.0.0"},
	{"run": "uv sync --frozen"},
	{"run": "n-cursor lint python --no-fix"},
]}}}}

canonical_wf := {"jobs": {"python": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"uses": "astral-sh/setup-uv@v8.0.0"},
	{"run": "uv sync --frozen"},
	{"run": "n-cursor lint python --no-fix"},
]}}}

test_allow_canonical if {
	count(lint_python_yml.deny) == 0 with input as canonical_wf with data.template as template_data
}

test_deny_missing_setup_uv_uses if {
	wf := {"jobs": {"python": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"run": "uv sync --frozen"},
		{"run": "n-cursor lint python --no-fix"},
	]}}}
	some msg in lint_python_yml.deny with input as wf with data.template as template_data
	contains(msg, "astral-sh/setup-uv@v8.0.0")
}

test_deny_missing_uv_sync_run if {
	wf := {"jobs": {"python": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"uses": "astral-sh/setup-uv@v8.0.0"},
		{"run": "n-cursor lint python --no-fix"},
	]}}}
	some msg in lint_python_yml.deny with input as wf with data.template as template_data
	contains(msg, "uv sync --frozen")
}

test_deny_missing_lint_python_run if {
	wf := {"jobs": {"python": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"uses": "astral-sh/setup-uv@v8.0.0"},
		{"run": "uv sync --frozen"},
	]}}}
	some msg in lint_python_yml.deny with input as wf with data.template as template_data
	contains(msg, "n-cursor lint python --no-fix")
}

test_deny_empty if {
	count(lint_python_yml.deny) > 0 with input as {} with data.template as template_data
}

test_deny_checkout_without_persist_credentials if {
	wf := {"jobs": {"python": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"uses": "astral-sh/setup-uv@v8.0.0"},
		{"run": "uv sync --frozen"},
		{"run": "n-cursor lint python --no-fix"},
	]}}}
	some msg in lint_python_yml.deny with input as wf with data.template as template_data
	contains(msg, "persist-credentials")
}

test_deny_checkout_with_persist_credentials_true if {
	wf := {"jobs": {"python": {"steps": [
		{"uses": "actions/checkout@v6", "with": {"persist-credentials": true}},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"uses": "astral-sh/setup-uv@v8.0.0"},
		{"run": "uv sync --frozen"},
		{"run": "n-cursor lint python --no-fix"},
	]}}}
	some msg in lint_python_yml.deny with input as wf with data.template as template_data
	contains(msg, "persist-credentials")
}

test_allow_checkout_with_persist_credentials_false if {
	count(lint_python_yml.deny) == 0 with input as canonical_wf with data.template as template_data
}

# Drift test.
test_data_template_drives_substring if {
	some msg in lint_python_yml.deny with input as canonical_wf
		with data.template as {"snippet": {"jobs": {"python": {"steps": [{"run": "custom-runner"}]}}}}
	contains(msg, "custom-runner")
}
