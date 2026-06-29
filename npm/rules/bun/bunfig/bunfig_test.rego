package bun.bunfig_test

import data.bun.bunfig
import rego.v1

# Mirrors template/bunfig.toml.snippet.toml
template_data := {"snippet": {"install": {"linker": "hoisted"}}}

test_allow_canonical if {
	count(bunfig.deny) == 0 with input as {"install": {"linker": "hoisted"}}
		with data.template as template_data
}

test_allow_extra_fields if {
	count(bunfig.deny) == 0 with input as {
		"install": {"linker": "hoisted", "auto": true},
		"run": {"silent": true},
	}
		with data.template as template_data
}

test_deny_missing_install_section if {
	some msg in bunfig.deny with input as {} with data.template as template_data
	contains(msg, "install")
}

test_deny_missing_linker_field if {
	some msg in bunfig.deny with input as {"install": {}} with data.template as template_data
	contains(msg, "linker")
}

test_deny_wrong_linker_value if {
	some msg in bunfig.deny with input as {"install": {"linker": "isolated"}}
		with data.template as template_data
	contains(msg, "hoisted")
}

# Drift test.
test_data_template_drives_expected if {
	some msg in bunfig.deny with input as {"install": {"linker": "hoisted"}}
		with data.template as {"snippet": {"install": {"linker": "isolated"}}}
	contains(msg, "isolated")
}
