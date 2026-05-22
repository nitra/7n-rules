package ga.workflow_common_test

import data.ga.workflow_common
import rego.v1

# Mirrors template/uses-min-versions.snippet.json
template_data := {"snippet": {"actions/checkout": "6", "Infisical/secrets-action": "1.0.16"}}

wf_ok_v6 := {"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true}, "jobs": {"build": {"steps": [
	{"uses": "actions/checkout@v6"},
	{"uses": "Infisical/secrets-action@v1.0.16"},
]}}}

wf_ok_v6_patch := {"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true}, "jobs": {"build": {"steps": [{"uses": "actions/checkout@v6.0.2"}]}}}

wf_old_checkout := {"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true}, "jobs": {"build": {"steps": [{"uses": "actions/checkout@v5"}]}}}

wf_old_infisical := {"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true}, "jobs": {"build": {"steps": [{"uses": "Infisical/secrets-action@v1.0.8"}]}}}

test_min_versions_pass_v6 if {
	count(workflow_common.deny) == 0 with input as wf_ok_v6
		with data.template as template_data
}

test_min_versions_pass_v6_patch if {
	count(workflow_common.deny) == 0 with input as wf_ok_v6_patch
		with data.template as template_data
}

test_checkout_below_min if {
	some msg in workflow_common.deny with input as wf_old_checkout
		with data.template as template_data
	contains(msg, "actions/checkout")
	contains(msg, "6")
}

test_infisical_below_min if {
	some msg in workflow_common.deny with input as wf_old_infisical
		with data.template as template_data
	contains(msg, "Infisical/secrets-action")
	contains(msg, "1.0.16")
}

wf_sha_checkout := {"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true}, "jobs": {"build": {"steps": [{"uses": "actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}}}

test_sha_pin_skips_min_version if {
	count(workflow_common.deny) == 0 with input as wf_sha_checkout
		with data.template as template_data
}

test_data_template_drives_checkout_min if {
	some msg in workflow_common.deny with input as wf_old_checkout
		with data.template as {"snippet": {"actions/checkout": "99"}}
	contains(msg, "99")
}
