package js_bun_db.package_json_test

import data.js_bun_db.package_json
import rego.v1

template_data := {"deny": {"dependencies": {
	"pg": "заміни на Bun native SQL (js-bun-db.mdc)",
	"pg-format": "заміни на Bun native SQL — без ручного форматування (js-bun-db.mdc)",
	"mysql2": "заміни на Bun native SQL (js-bun-db.mdc)",
}}}

test_allow_no_forbidden if {
	count(package_json.deny) == 0 with input as {"dependencies": {"lodash": "^4.0.0"}}
		with data.template as template_data
}

test_deny_pg if {
	some msg in package_json.deny with input as {"dependencies": {"pg": "^8.0.0"}}
		with data.template as template_data
	contains(msg, "pg")
}

test_deny_mysql2 if {
	some msg in package_json.deny with input as {"dependencies": {"mysql2": "^3.0.0"}}
		with data.template as template_data
	contains(msg, "mysql2")
}

# Drift test.
test_data_template_drives_deny if {
	some msg in package_json.deny with input as {"dependencies": {"custom-db": "1.0"}}
		with data.template as {"deny": {"dependencies": {"custom-db": "заборонено для тесту"}}}
	contains(msg, "custom-db")
}
