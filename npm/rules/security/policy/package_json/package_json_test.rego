# Тести для `security.package_json`. Запуск:
#   conftest verify -p npm/policy/security/package_json
package security.package_json_test

import rego.v1

import data.security.package_json

valid_pkg := {
	"name": "demo",
	"scripts": {
		"lint-security": "gitleaks detect --no-banner",
		"lint": "bun run lint-text && bun run lint-security",
	},
}

# ── happy path ───────────────────────────────────────────────────────────

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg
}

test_allow_without_aggregator_lint if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/lint"}])
	count(package_json.deny) == 0 with input as pkg
}

test_allow_gitleaks_git_subcommand if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint-security", "value": "gitleaks git --no-banner"}])
	count(package_json.deny) == 0 with input as pkg
}

# ── deny: scripts.lint-security відсутній ────────────────────────────────

test_deny_lint_security_missing if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/lint-security"}])
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: lint-security без `gitleaks` ───────────────────────────────────

test_deny_lint_security_not_gitleaks if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint-security", "value": "trufflehog filesystem ."}])
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: lint-security з gitleaks без detect/git subcommand ─────────────

test_deny_lint_security_gitleaks_without_subcommand if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint-security", "value": "gitleaks --help"}])
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: агрегатор `lint` без `bun run lint-security` ──────────────────

test_deny_lint_aggregator_without_lint_security if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/scripts/lint", "value": "bun run lint-text && oxfmt ."}])
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: gitleaks у dependencies/devDependencies ───────────────────────

test_deny_gitleaks_in_dependencies if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"gitleaks": "^8.0.0"}}])
	count(package_json.deny) > 0 with input as pkg
}

test_deny_gitleaks_in_devDependencies if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {"gitleaks": "^8.0.0"}}])
	count(package_json.deny) > 0 with input as pkg
}
