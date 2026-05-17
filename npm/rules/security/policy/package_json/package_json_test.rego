package security.package_json_test

import data.security.package_json
import rego.v1

# Canonical template data — mirrors template/package.json.{snippet,deny,contains}.json
template_data := {
	"snippet": {"scripts": {"lint-security": "gitleaks detect --no-banner"}},
	"deny": {
		"dependencies": {"gitleaks": "глобальний CLI — не додавай у dependencies"},
		"devDependencies": {"gitleaks": "глобальний CLI — не додавай у devDependencies"},
	},
	"contains": {"scripts": {"lint": ["bun run lint-security"]}},
}

test_required_lint_security_missing if {
	some msg in package_json.deny with input as {"scripts": {}} with data.template as template_data
	contains(msg, "scripts.lint-security")
}

test_required_lint_security_present if {
	count(package_json.deny) == 0 with input as {"scripts": {"lint-security": "gitleaks detect --no-banner"}}
		with data.template as template_data
}

test_forbid_gitleaks_in_dependencies if {
	some msg in package_json.deny with input as {
		"scripts": {"lint-security": "gitleaks detect --no-banner"},
		"dependencies": {"gitleaks": "^8.0.0"},
	}
		with data.template as template_data
	contains(msg, "dependencies.gitleaks")
}

test_contains_lint_aggregator_missing_substring if {
	some msg in package_json.deny with input as {"scripts": {"lint-security": "gitleaks detect --no-banner", "lint": "oxfmt ."}}
		with data.template as template_data
	contains(msg, "scripts.lint")
}

test_contains_lint_aggregator_with_substring_ok if {
	count(package_json.deny) == 0 with input as {"scripts": {
		"lint-security": "gitleaks detect --no-banner",
		"lint": "bun run lint-security && oxfmt .",
	}}
		with data.template as template_data
}
