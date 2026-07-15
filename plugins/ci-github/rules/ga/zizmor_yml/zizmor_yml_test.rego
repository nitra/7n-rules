package ga.zizmor_yml_test

import data.ga.zizmor_yml
import rego.v1

# Mirrors template/zizmor.yml.snippet.yml
template_data := {"snippet": {"rules": {"unpinned-uses": {"config": {"policies": {"*": "ref-pin"}}}}}}

test_valid_zizmor if {
	count(zizmor_yml.deny) == 0 with input as {"rules": {"unpinned-uses": {"config": {"policies": {"*": "ref-pin"}}}}}
		with data.template as template_data
}

test_missing_policy if {
	some msg in zizmor_yml.deny with input as {"rules": {"other": true}}
		with data.template as template_data
	contains(msg, "ref-pin")
}

test_wrong_policy_value if {
	some msg in zizmor_yml.deny with input as {"rules": {"unpinned-uses": {"config": {"policies": {"*": "strict"}}}}}
		with data.template as template_data
	contains(msg, "ref-pin")
}

# Drift test: ensures rego reads expected value from data.template, not from inline literal.
test_data_template_drives_expected_value if {
	some msg in zizmor_yml.deny with input as {}
		with data.template as {"snippet": {"rules": {"unpinned-uses": {"config": {"policies": {"*": "strict"}}}}}}
	contains(msg, "strict")
}
