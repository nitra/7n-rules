package js_run.package_json_test

import data.js_run.package_json
import rego.v1

template_data := {"deny": {
	"dependencies": {
		"bunyan": "використовуй стандартні логери (js-run.mdc)",
		"@nitra/bunyan": "використовуй стандартні логери (js-run.mdc)",
	},
	"devDependencies": {
		"bunyan": "використовуй стандартні логери (js-run.mdc)",
		"@nitra/bunyan": "використовуй стандартні логери (js-run.mdc)",
	},
}}

test_allow_clean if {
	count(package_json.deny) == 0 with input as {"dependencies": {"lodash": "^4.0.0"}}
		with data.template as template_data
}

test_deny_bunyan_in_deps if {
	some msg in package_json.deny with input as {"dependencies": {"bunyan": "^1.0.0"}}
		with data.template as template_data
	contains(msg, "bunyan")
}

test_deny_nitra_bunyan_in_devdeps if {
	some msg in package_json.deny with input as {"devDependencies": {"@nitra/bunyan": "^1.0.0"}}
		with data.template as template_data
	contains(msg, "@nitra/bunyan")
}

# Drift test.
test_data_template_drives_deny if {
	some msg in package_json.deny with input as {"dependencies": {"custom-log": "1.0"}}
		with data.template as {"deny": {"dependencies": {"custom-log": "заборонено для тесту"}}}
	contains(msg, "custom-log")
}
