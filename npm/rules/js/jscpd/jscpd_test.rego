package js_lint.jscpd_test

import data.js_lint.jscpd
import rego.v1

template_data := {"snippet": {
	"gitignore": true,
	"exitCode": 1,
	"reporters": ["console"],
	"minLines": 25,
	"ignore": [".claude/worktrees/**", "**/CHANGELOG.md"],
}}

test_valid_jscpd if {
	count(jscpd.deny) == 0 with input as {
		"gitignore": true,
		"exitCode": 1,
		"reporters": ["console"],
		"minLines": 25,
		"ignore": [".claude/worktrees/**", "**/CHANGELOG.md", "**/extra/**"],
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

# Subset-of для ignore: відсутній канонічний glob → deny з підказкою саме на нього.
test_ignore_subset_of_requires_changelog if {
	some msg in jscpd.deny with input as {
		"gitignore": true,
		"exitCode": 1,
		"reporters": ["console"],
		"minLines": 25,
		"ignore": [".claude/worktrees/**"],
	}
		with data.template as template_data
	contains(msg, "**/CHANGELOG.md")
}

# Drift test.
test_data_template_drives_min_lines if {
	some msg in jscpd.deny with input as {"gitignore": true, "exitCode": 1, "reporters": ["console"], "minLines": 50}
		with data.template as {"snippet": {"gitignore": true, "exitCode": 1, "reporters": ["console"], "minLines": 100}}
	contains(msg, "100")
}
