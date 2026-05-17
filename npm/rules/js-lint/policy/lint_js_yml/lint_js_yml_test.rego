package js_lint.lint_js_yml_test

import data.js_lint.lint_js_yml
import rego.v1

template_data := {"snippet": {"jobs": {"eslint": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"name": "Eslint", "run": "bunx oxlint\nbunx eslint .\nbunx jscpd .\nbunx knip --no-config-hints\n"},
]}}}}

canonical_input := {"jobs": {"eslint": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"name": "Eslint", "run": "bunx oxlint\nbunx eslint .\nbunx jscpd .\nbunx knip --no-config-hints\n"},
]}}}

test_allow_canonical if {
	count(lint_js_yml.deny) == 0 with input as canonical_input with data.template as template_data
}

test_deny_missing_checkout if {
	wf := {"jobs": {"eslint": {"steps": [{"uses": "./.github/actions/setup-bun-deps"}]}}}
	some msg in lint_js_yml.deny with input as wf with data.template as template_data
	contains(msg, "checkout")
}

test_deny_missing_oxlint_run if {
	wf := {"jobs": {"eslint": {"steps": [{"run": "bunx eslint ."}]}}}
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

# Drift test.
test_data_template_drives_required_substring if {
	drifted := {"snippet": {"jobs": {"eslint": {"steps": [{"run": "custom-runner"}]}}}}
	some msg in lint_js_yml.deny with input as canonical_input with data.template as drifted
	contains(msg, "custom-runner")
}
