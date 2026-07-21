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
	"name": "n-rules",
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
			"@stryker-mutator/core": "9.6.1",
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

test_allow_7n_test_coverage_orchestrator if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "@7n/test": "^0.13.0"},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

# ── allow: @vitest/browser + @vitest/browser-playwright + playwright — provider factory
#    (vitest@^4) для named vitest project "storybook" ──

test_allow_vitest_browser_and_playwright_provider if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "@vitest/browser": "^4.1.9", "playwright": "^1.55.0"},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_vitest_browser_playwright_provider_package if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {
			"@nitra/eslint-config": "^3.9.2",
			"@vitest/browser": "^4.1.10",
			"@vitest/browser-playwright": "^4.1.10",
			"playwright": "^1.61.1",
		},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_storybook_addon_vitest_root_tooling if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {"@nitra/eslint-config": "^3.9.2", "@storybook/addon-vitest": "^9.1.10"},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

# ── allow: root-only Storybook Vite build-tooling (storybook.mdc scaffold — main.js
#    core.builder/viteFinal-плагіни, preview.js material-icons) ──

test_allow_storybook_vite_build_tooling_root_deps if {
	pkg := json.patch(valid_pkg, [{
		"op": "replace",
		"path": "/devDependencies",
		"value": {
			"@nitra/eslint-config": "^3.9.2",
			"@storybook/builder-vite": "^10.5.3",
			"@vitejs/plugin-vue": "^6.0.8",
			"@quasar/vite-plugin": "^1.12.0",
			"@quasar/extras": "^2.0.2",
		},
	}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

# ── deny: Storybook-специфічні identity-пакети НЕ дозволені у корені (межа з npm-module.mdc) ─

test_deny_storybook_identity_packages_in_root if {
	cases := [{"storybook": "9.1.10"}, {"@storybook/vue3": "9.1.10"}, {"msw": "2.11.3"}]
	some bad in cases
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies", "value": bad}])
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
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

# ── deny: scripts.lint / scripts.lint-* ─────────────────────────────────

test_deny_scripts_lint if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"lint": "bun run lint"}}])
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "scripts.lint")
}

test_deny_scripts_lint_prefixed if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"lint-js": "bunx eslint ."}}])
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "scripts.lint-js")
}

test_deny_scripts_lint_full if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"lint-full": "n-rules lint --full"}}])
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "scripts.lint-full")
}

test_allow_scripts_non_lint if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"build": "bun build", "test": "vitest"}}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_no_scripts if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/devDependencies"}])
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}
