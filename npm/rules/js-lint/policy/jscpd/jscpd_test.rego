package js_lint.jscpd

import rego.v1

test_valid_jscpd if {
	count(deny) == 0 with input as {
		"gitignore": true,
		"exitCode": 1,
		"reporters": ["console"],
		"minLines": 25,
	}
}

test_invalid_jscpd if {
	count(deny) == 4 with input as {
		"gitignore": false,
		"exitCode": 0,
		"reporters": ["json"],
		"minLines": 10,
	}
}
