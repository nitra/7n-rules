package js_lint.jscpd_test

import data.js_lint.jscpd
import rego.v1

template_data := {"snippet": {"gitignore": true, "exitCode": 1, "reporters": ["console"], "minLines": 25}}

test_valid_jscpd if {
	count(jscpd.deny) == 0 with input as {
		"gitignore": true,
		"exitCode": 1,
		"reporters": ["console"],
		"minLines": 25,
	}
		with data.template as template_data
}

test_invalid_jscpd if {
	count(jscpd.deny) > 0 with input as {
		"gitignore": false,
		"exitCode": 0,
		"reporters": ["json"],
		"minLines": 10,
	}
		with data.template as template_data
}

# Drift test.
test_data_template_drives_min_lines if {
	some msg in jscpd.deny with input as {"gitignore": true, "exitCode": 1, "reporters": ["console"], "minLines": 50}
		with data.template as {"snippet": {"gitignore": true, "exitCode": 1, "reporters": ["console"], "minLines": 100}}
	contains(msg, "100")
}
