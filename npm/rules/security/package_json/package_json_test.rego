package security.package_json_test

import data.security.package_json
import rego.v1

# Mirrors template/package.json.deny.json
template_data := {"deny": {
	"dependencies": {"trufflehog": "глобальний CLI — не додавай у dependencies"},
	"devDependencies": {"trufflehog": "глобальний CLI — не додавай у devDependencies"},
}}

test_allow_no_forbidden_deps if {
	count(package_json.deny) == 0 with input as {"scripts": {}} with data.template as template_data
}

test_forbid_trufflehog_in_dependencies if {
	some msg in package_json.deny with input as {"dependencies": {"trufflehog": "^3.0.0"}}
		with data.template as template_data
	contains(msg, "dependencies.trufflehog")
}

test_forbid_trufflehog_in_devdependencies if {
	some msg in package_json.deny with input as {"devDependencies": {"trufflehog": "^3.0.0"}}
		with data.template as template_data
	contains(msg, "devDependencies.trufflehog")
}
