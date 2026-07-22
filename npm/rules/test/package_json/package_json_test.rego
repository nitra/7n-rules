package test.package_json_test

import data.test.package_json
import rego.v1

template_data := {"contains": {"scripts": {
	"coverage": ["@7n/test coverage"],
	"test": ["vitest", "--bun"],
}}}

valid_pkg := {"scripts": {
	"coverage": "@7n/test coverage",
	"test": "bun run --bun vitest run",
}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_missing_coverage_script if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/coverage"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_wrong_coverage_command if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/coverage", "value": "echo nope"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "@7n/test coverage")
}

test_allow_extended_coverage_command if {
	# substring-семантика: дозволяємо локальні розширення
	extended := json.patch(valid_pkg, [{
		"op": "replace", "path": "/scripts/coverage",
		"value": "bun run pre-coverage && @7n/test coverage",
	}])
	count(package_json.deny) == 0 with input as extended with data.template as template_data
}

test_deny_missing_test_script if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/test"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "vitest")
}

test_deny_test_script_not_vitest if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/test", "value": "bun test"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "vitest")
}

test_deny_test_script_missing_bun if {
	# "vitest" присутнє, але без --bun — Bun-нативні built-in модулі не резолвуються у forked pool
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/test", "value": "vitest run"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "--bun")
	contains(msg, "forked")
}

test_allow_extended_test_command if {
	# substring-семантика: `bun run pre-test && bun run --bun vitest run` — ОК, містить "vitest" і "--bun"
	extended := json.patch(valid_pkg, [{
		"op": "replace", "path": "/scripts/test",
		"value": "bun run pre-test && bun run --bun vitest run",
	}])
	count(package_json.deny) == 0 with input as extended with data.template as template_data
}

# Drift test: підміна data.template веде перевірку
test_data_template_drives_contains if {
	some msg in package_json.deny with input as valid_pkg
		with data.template as {"contains": {"scripts": {"coverage": ["custom-marker"]}}}
	contains(msg, "custom-marker")
}
