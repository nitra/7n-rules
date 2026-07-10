package js.lint_js_yml_test

import data.js.lint_js_yml
import rego.v1

template_data := {"snippet": {"jobs": {"eslint": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"name": "Eslint", "run": "n-cursor lint js --no-fix"},
]}}}}

canonical_input := {"jobs": {"eslint": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"name": "Eslint", "run": "n-cursor lint js --no-fix"},
]}}}

test_allow_canonical if {
	count(lint_js_yml.deny) == 0 with input as canonical_input with data.template as template_data
}

test_deny_missing_checkout if {
	wf := {"jobs": {"eslint": {"steps": [{"uses": "./.github/actions/setup-bun-deps"}]}}}
	some msg in lint_js_yml.deny with input as wf with data.template as template_data
	contains(msg, "checkout")
}

test_deny_missing_required_run if {
	wf := {"jobs": {"eslint": {"steps": [{"run": "echo nothing"}]}}}
	count(lint_js_yml.deny) > 0 with input as wf with data.template as template_data
}

test_deny_oxlint_fix_in_ci if {
	wf := {"jobs": {"eslint": {"steps": [{"run": "bunx oxlint --fix"}]}}}
	some msg in lint_js_yml.deny with input as wf with data.template as template_data
	contains(msg, "fix")
}

test_deny_eslint_fix_in_ci if {
	wf := {"jobs": {"eslint": {"steps": [{"run": "bunx eslint --fix ."}]}}}
	some msg in lint_js_yml.deny with input as wf with data.template as template_data
	contains(msg, "fix")
}

# SHA-пін (zizmor ref-pin) задовольняє канонічний тег — фіксер не даунгрейдить.
sha_pinned_input := {"jobs": {"eslint": {"steps": [
	{"uses": "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"name": "Eslint", "run": "n-cursor lint js --no-fix"},
]}}}

test_allow_sha_pinned_checkout if {
	count(lint_js_yml.deny) == 0 with input as sha_pinned_input with data.template as template_data
}

test_deny_sha_pinned_checkout_without_persist_credentials if {
	wf := json.patch(sha_pinned_input, [{"op": "remove", "path": "/jobs/eslint/steps/0/with"}])
	some msg in lint_js_yml.deny with input as wf with data.template as template_data
	contains(msg, "persist-credentials")
}

test_deny_short_sha_is_not_pin if {
	wf := json.patch(
		sha_pinned_input,
		[{"op": "replace", "path": "/jobs/eslint/steps/0/uses", "value": "actions/checkout@df4cb1c"}],
	)
	some msg in lint_js_yml.deny with input as wf with data.template as template_data
	contains(msg, "actions/checkout@v6")
}

# Drift test.
test_data_template_drives_required_substring if {
	drifted := {"snippet": {"jobs": {"eslint": {"steps": [{"run": "custom-runner"}]}}}}
	some msg in lint_js_yml.deny with input as canonical_input with data.template as drifted
	contains(msg, "custom-runner")
}
