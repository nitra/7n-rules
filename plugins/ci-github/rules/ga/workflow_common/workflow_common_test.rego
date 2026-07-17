package ga.workflow_common_test

import data.ga.workflow_common
import rego.v1

# Mirrors template/uses-min-versions.snippet.json
template_data := {"snippet": {"actions/checkout": "6", "Infisical/secrets-action": "1.0.16"}}

wf_ok_v6 := {
	"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true},
	"jobs": {"build": {"steps": [
		{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
		{"uses": "Infisical/secrets-action@v1.0.16"},
	]}},
}

wf_ok_v6_patch := {
	"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true},
	"jobs": {"build": {"steps": [{"uses": "actions/checkout@v6.0.2", "with": {"persist-credentials": false}}]}},
}

wf_old_checkout := {
	"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true},
	"jobs": {"build": {"steps": [{"uses": "actions/checkout@v5"}]}},
}

wf_old_infisical := {
	"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true},
	"jobs": {"build": {"steps": [{"uses": "Infisical/secrets-action@v1.0.8"}]}},
}

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

wf_sha_checkout := {
	"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true},
	"jobs": {"build": {"steps": [{"uses": "actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "with": {"persist-credentials": false}}]}},
}

test_sha_pin_skips_min_version if {
	count(workflow_common.deny) == 0 with input as wf_sha_checkout
		with data.template as template_data
}

test_data_template_drives_checkout_min if {
	some msg in workflow_common.deny with input as wf_old_checkout
		with data.template as {"snippet": {"actions/checkout": "99"}}
	contains(msg, "99")
}

test_deny_checkout_without_persist_credentials if {
	wf := {
		"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true},
		"jobs": {"ci": {"steps": [{"uses": "actions/checkout@v6"}]}},
	}
	some msg in workflow_common.deny with input as wf with data.template as template_data
	contains(msg, "persist-credentials")
}

test_deny_checkout_with_persist_credentials_true if {
	wf := {
		"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}", "cancel-in-progress": true},
		"jobs": {"ci": {"steps": [{"uses": "actions/checkout@v6", "with": {"persist-credentials": true}}]}},
	}
	some msg in workflow_common.deny with input as wf with data.template as template_data
	contains(msg, "persist-credentials")
}

test_allow_checkout_with_persist_credentials_false if {
	count(workflow_common.deny) == 0 with input as wf_ok_v6 with data.template as template_data
}

# ── concurrency: режим release-серіалізації (статичний group + cancel: false) ─

wf_release_lock := {
	"concurrency": {"group": "changelog-release", "cancel-in-progress": false},
	"jobs": {"release": {"steps": [{"run": "echo release"}]}},
}

test_release_lock_pass if {
	count(workflow_common.deny) == 0 with input as wf_release_lock
		with data.template as template_data
}

# Відсутній cancel-in-progress = false за семантикою GitHub — режим lock валідний.
test_release_lock_missing_cancel_pass if {
	wf := {
		"concurrency": {"group": "changelog-release"},
		"jobs": {"release": {"steps": [{"run": "echo release"}]}},
	}
	count(workflow_common.deny) == 0 with input as wf with data.template as template_data
}

test_release_lock_cancel_true_denied if {
	wf := {
		"concurrency": {"group": "changelog-release", "cancel-in-progress": true},
		"jobs": {"release": {"steps": [{"run": "echo release"}]}},
	}
	some msg in workflow_common.deny with input as wf with data.template as template_data
	contains(msg, "cancel-in-progress: false")
}

# Канонічний per-ref group без cancel-in-progress — треба явний true.
test_canonical_group_missing_cancel_denied if {
	wf := {
		"concurrency": {"group": "${{ github.ref }}-${{ github.workflow }}"},
		"jobs": {"ci": {"steps": [{"run": "echo ci"}]}},
	}
	some msg in workflow_common.deny with input as wf with data.template as template_data
	contains(msg, "cancel-in-progress має бути true")
}

# Динамічний, але не канонічний group — не є статичним lock, deny.
test_dynamic_wrong_group_denied if {
	wf := {
		"concurrency": {"group": "${{ github.ref }}", "cancel-in-progress": true},
		"jobs": {"ci": {"steps": [{"run": "echo ci"}]}},
	}
	some msg in workflow_common.deny with input as wf with data.template as template_data
	contains(msg, "concurrency.group має бути")
}

# Порожній/відсутній group — deny по group, а не по режиму lock.
test_missing_group_denied if {
	wf := {
		"concurrency": {"cancel-in-progress": true},
		"jobs": {"ci": {"steps": [{"run": "echo ci"}]}},
	}
	some msg in workflow_common.deny with input as wf with data.template as template_data
	contains(msg, "concurrency.group має бути")
}
