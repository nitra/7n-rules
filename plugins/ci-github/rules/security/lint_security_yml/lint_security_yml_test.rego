package security.lint_security_yml_test

import data.security.lint_security_yml
import rego.v1

template_data := {"snippet": {"jobs": {"security": {"steps": [
	{"uses": "actions/checkout@v6"},
	{"uses": "trufflesecurity/trufflehog@main", "with": {"extra_args": "--results=verified,unknown"}},
]}}}}

test_allow_canonical if {
	wf := {"jobs": {"security": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "trufflesecurity/trufflehog@main"},
	]}}}
	count(lint_security_yml.deny) == 0 with input as wf with data.template as template_data
}

test_deny_no_trufflehog_uses if {
	wf := {"jobs": {"security": {"steps": [{"uses": "actions/checkout@v6"}]}}}
	some msg in lint_security_yml.deny with input as wf with data.template as template_data
	contains(msg, "trufflesecurity/trufflehog")
}

test_deny_empty if {
	count(lint_security_yml.deny) > 0 with input as {} with data.template as template_data
}

# Drift test — template change рухає очікувану substring.
test_data_template_drives_substring if {
	wf := {"jobs": {"security": {"steps": [{"uses": "trufflesecurity/trufflehog@main"}]}}}
	some msg in lint_security_yml.deny with input as wf
		with data.template as {"snippet": {"jobs": {"security": {"steps": [{"uses": "custom/secret-scanner@v1"}]}}}}
	contains(msg, "custom/secret-scanner")
}
