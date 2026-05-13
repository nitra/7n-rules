# Тести для `bun.package_json`. Запуск:
#   conftest verify -p npm/policy/bun/package_json
package bun.package_json_test

import rego.v1

import data.bun.package_json

valid_pkg := {
	"name": "n-cursor",
	"devDependencies": {"@nitra/eslint-config": "^3.9.2"},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_minimal if {
	count(package_json.deny) == 0 with input as valid_pkg
}

test_allow_multiple_nitra_deps if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "@nitra/cspell-dict": "^2.0.0", "@nitra/stylelint-config": "^1.0.0"},
	}])
	count(package_json.deny) == 0 with input as pkg
}

test_allow_no_dev_dependencies if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/devDependencies"}])
	count(package_json.deny) == 0 with input as pkg
}

# ── deny: devDependencies лише @nitra/* ──────────────────────────────────

test_deny_non_nitra_devdep if {
	cases := [
		{"@cspell/dict-uk-ua": "^2.0.0"},
		{"@cspell/cspell-lib": "^9.0.0"},
		{"lodash": "*"},
		{"@types/node": "^24.0.0"},
	]
	some bad in cases
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies", "value": bad}])
	count(package_json.deny) > 0 with input as pkg
}

test_deny_mixed_dev_deps_only_flags_non_nitra if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "lodash": "*"},
	}])
	some msg in package_json.deny with input as pkg
	contains(msg, "lodash")
}

# ── deny: packageManager ─────────────────────────────────────────────────

test_deny_package_manager_field if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/packageManager", "value": "pnpm@9.0.0"}])
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: dependencies у кореневому ──────────────────────────────────────

test_deny_root_dependencies_present if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"lodash": "*"}}])
	count(package_json.deny) > 0 with input as pkg
}

test_deny_empty_dependencies_object if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {}}])
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: агрегований lint ───────────────────────────────────────────────

test_deny_lint_prefixed_without_aggregate if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"lint-js": "echo"}}])
	count(package_json.deny) > 0 with input as pkg
}

test_allow_lint_aggregate_calls_subscript_and_oxfmt if {
	pkg := json.patch(valid_pkg, [{
		"op": "add",
		"path": "/scripts",
		"value": {"lint-js": "echo", "lint": "bun run lint-js && oxfmt ."},
	}])
	count(package_json.deny) == 0 with input as pkg
}

test_deny_lint_aggregate_missing_oxfmt if {
	pkg := json.patch(valid_pkg, [{
		"op": "add",
		"path": "/scripts",
		"value": {"lint-js": "echo", "lint": "bun run lint-js"},
	}])
	count(package_json.deny) > 0 with input as pkg
}

test_deny_lint_aggregate_missing_subscript_via_bun_run if {
	pkg := json.patch(valid_pkg, [{
		"op": "add",
		"path": "/scripts",
		"value": {"lint-js": "echo", "lint-text": "echo", "lint": "bun run lint-js && oxfmt ."},
	}])
	count(package_json.deny) > 0 with input as pkg
}
