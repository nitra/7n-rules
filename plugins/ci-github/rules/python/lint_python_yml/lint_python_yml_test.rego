package python.lint_python_yml_test

import data.python.lint_python_yml
import rego.v1

pr_paths := ["**/*.py", "pyproject.toml"]

template_data := {"snippet": {"on": {"pull_request": {"paths": pr_paths}}, "jobs": {"python": {"steps": [
	{"uses": "actions/checkout@v6"},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"uses": "astral-sh/setup-uv@v8.0.0"},
	{"run": "uv sync --frozen"},
	{"run": "n-rules lint python --no-fix"},
]}}}}

canonical_wf := {"true": {"pull_request": {"paths": pr_paths}}, "jobs": {"python": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"uses": "astral-sh/setup-uv@v8.0.0"},
	{"run": "uv sync --frozen"},
	{"run": "n-rules lint python --no-fix"},
]}}}

test_allow_canonical if {
	count(lint_python_yml.deny) == 0 with input as canonical_wf with data.template as template_data
}

test_deny_missing_setup_uv_uses if {
	wf := {"jobs": {"python": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"run": "uv sync --frozen"},
		{"run": "n-rules lint python --no-fix"},
	]}}}
	some msg in lint_python_yml.deny with input as wf with data.template as template_data
	contains(msg, "astral-sh/setup-uv@v8.0.0")
}

test_deny_missing_uv_sync_run if {
	wf := {"jobs": {"python": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"uses": "astral-sh/setup-uv@v8.0.0"},
		{"run": "n-rules lint python --no-fix"},
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
	contains(msg, "n-rules lint python --no-fix")
}

test_deny_missing_required_pr_path if {
	wf := json.patch(canonical_wf, [{"op": "replace", "path": "/true/pull_request/paths", "value": ["**/*.py"]}])
	some msg in lint_python_yml.deny with input as wf with data.template as template_data
	contains(msg, "pull_request.paths")
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
		{"run": "n-rules lint python --no-fix"},
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
		{"run": "n-rules lint python --no-fix"},
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
