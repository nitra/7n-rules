package ga.lint_ga_test

import data.ga.lint_ga
import rego.v1

# Mirrors template/lint-ga.yml.snippet.yml.
template_data := {"snippet": {
	"name": "Lint GA",
	"on": {
		"push": {"branches": ["dev", "main"], "paths": [".github/actions/**", ".github/workflows/**"]},
		"pull_request": {"branches": ["dev", "main"]},
	},
	"jobs": {"lint-ga": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"uses": "astral-sh/setup-uv@v8.0.0"},
			{"name": "Lint GA", "run": "bun run lint-ga"},
		],
	}},
}}

canonical_input := {
	"name": "Lint GA",
	"true": {
		"push": {"branches": ["dev", "main"], "paths": [".github/actions/**", ".github/workflows/**"]},
		"pull_request": {"branches": ["dev", "main"]},
	},
	"jobs": {"lint-ga": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"uses": "astral-sh/setup-uv@v8.0.0"},
			{"name": "Lint GA", "run": "bun run lint-ga"},
		],
	}},
}

test_allow_canonical if {
	count(lint_ga.deny) == 0 with input as canonical_input with data.template as template_data
}

test_deny_wrong_name if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/name", "value": "Other"}])
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "name")
}

test_deny_missing_dev_branch_in_push if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/push/branches", "value": ["main"]}])
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "push.branches")
}

test_deny_missing_required_path if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/push/paths", "value": [".github/workflows/**"]}])
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "push.paths")
}

test_deny_missing_required_uses if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/lint-ga/steps", "value": [{"name": "Lint GA", "run": "bun run lint-ga"}]}],
	)
	count(lint_ga.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_run_command if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/lint-ga/steps/3/run", "value": "echo nothing"}],
	)
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "bun run lint-ga")
}

# Drift test.
test_data_template_drives_name if {
	drifted := {"snippet": object.union(template_data.snippet, {"name": "Custom"})}
	some msg in lint_ga.deny with input as canonical_input with data.template as drifted
	contains(msg, "Custom")
}
