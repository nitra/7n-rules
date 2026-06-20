# Тести для `bun.package_json`. Запуск:
#   conftest verify -p npm/rules/bun/policy/package_json
package bun.package_json_test

import data.bun.package_json
import rego.v1

# Mirrors template/package.json.deny.json (top-level fields заборонені у root package.json).
template_data := {"deny": {
	"packageManager": "видали поле — Bun не потребує packageManager (bun.mdc)",
	"dependencies": "кореневий package.json не повинен містити dependencies — додай у workspace-пакети (bun.mdc)",
}}

valid_pkg := {
	"name": "n-cursor",
	"devDependencies": {"@nitra/eslint-config": "^3.9.2"},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_minimal if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_allow_multiple_nitra_deps if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "@nitra/cspell-dict": "^2.0.0"},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_no_dev_dependencies if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/devDependencies"}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_root_test_peer_deps if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {
			"@nitra/eslint-config": "^3.9.2",
			"@stryker-mutator/vitest-runner": "^9.6.1",
			"@vitest/coverage-v8": "^4.1.7",
			"vitest": "^4.1.7",
		},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_playwright_test if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "@playwright/test": "^1.60.0"},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

# ── deny: devDependencies лише @nitra/* або root-only test peers ─

test_deny_non_nitra_devdep if {
	cases := [{"@cspell/dict-uk-ua": "^2.0.0"}, {"lodash": "*"}, {"@types/node": "^24.0.0"}]
	some bad in cases
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies", "value": bad}])
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_mixed_dev_deps_only_flags_non_nitra if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "lodash": "*"},
	}])
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "lodash")
}

# ── deny: top-level deny fields (з template) ─────────────────────────────

test_deny_package_manager_field if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/packageManager", "value": "pnpm@9.0.0"}])
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "packageManager")
}

test_deny_root_dependencies_present if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"lodash": "*"}}])
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "dependencies")
}

test_deny_empty_dependencies_object if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {}}])
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "dependencies")
}

# Drift test: ensures top-level deny is template-driven.
test_data_template_drives_top_level_deny if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/customField", "value": "x"}])
	some msg in package_json.deny with input as pkg
		with data.template as {"deny": {"customField": "заборонено для тесту"}}
	contains(msg, "customField")
}
