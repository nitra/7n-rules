package ga.vscode_settings

import rego.v1

test_valid_settings if {
	count(deny) == 0 with input as {
		"[github-actions-workflow]": {"editor.defaultFormatter": "oxc.oxc-vscode"},
	}
}

test_missing_settings if {
	count(deny) == 1 with input as {}
}

test_wrong_formatter if {
	count(deny) == 1 with input as {
		"[github-actions-workflow]": {"editor.defaultFormatter": "other"},
	}
}
