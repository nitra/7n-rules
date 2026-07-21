# Тести для `npm_module.npm_package_json`. Запуск:
#   conftest verify -p npm/rules/npm-module/policy/npm_package_json
package npm_module.npm_package_json_test

import data.npm_module.npm_package_json
import rego.v1

# Mirrors template/package.json.snippet.json — лише `files` whitelist.
template_data := {"snippet": {"files": ["types"]}}

valid_pkg := {
	"name": "@7n/rules",
	"version": "1.9.5",
	"types": "./types/bin/n-rules.d.ts",
	"files": ["types", "mdc", "bin", "CHANGELOG.md"],
	"dependencies": {"oxc-parser": "^0.128.0"},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(npm_package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_allow_types_index_d_ts if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/types", "value": "./types/index.d.ts"}])
	count(npm_package_json.deny) == 0 with input as pkg with data.template as template_data
}

# ── types regex (логіка лишається в rego) ────────────────────────────────

test_deny_types_outside_types_dir if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/types", "value": "./dist/index.d.ts"}])
	count(npm_package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_types_wrong_extension if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/types", "value": "./types/index.ts"}])
	count(npm_package_json.deny) > 0 with input as pkg with data.template as template_data
}

# ── files (template-driven snippet-array subset-of) ──────────────────────

test_deny_missing_files if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/files"}])
	count(npm_package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_files_not_array if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/files", "value": "types"}])
	count(npm_package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_files_empty if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/files", "value": []}])
	count(npm_package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_files_without_types if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/files", "value": ["bin", "mdc"]}])
	some msg in npm_package_json.deny with input as pkg with data.template as template_data
	contains(msg, "types")
}

# ── devDependencies (логіка лишається в rego — must be empty АБО Storybook-канон) ─

test_allow_no_dev_dependencies if {
	count(npm_package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_allow_empty_dev_dependencies if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {}}])
	count(npm_package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_deny_dev_dependencies_present if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {"@7n/rules": "^1.9.5"}}])
	count(npm_package_json.deny) > 0 with input as pkg with data.template as template_data
}

# ── devDependencies: Storybook-allowlist виняток (канон Storybook, кластер 7) ────

test_allow_canonical_storybook_dev_deps if {
	pkg := json.patch(valid_pkg, [{
		"op": "add",
		"path": "/devDependencies",
		"value": {
			"storybook": "9.1.10",
			"@storybook/vue3-vite": "9.1.10",
			"@storybook/vue3": "9.1.10",
			"msw": "2.11.3",
			"msw-storybook-addon": "2.0.5",
		},
	}])
	count(npm_package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_single_canonical_storybook_dep if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {"storybook": "9.1.10"}}])
	count(npm_package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_deny_non_storybook_dev_dep_present if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {"lodash": "*"}}])
	some msg in npm_package_json.deny with input as pkg with data.template as template_data
	contains(msg, "lodash")
}

test_deny_mixed_dev_deps_only_flags_non_storybook if {
	pkg := json.patch(valid_pkg, [{
		"op": "add",
		"path": "/devDependencies",
		"value": {"storybook": "9.1.10", "lodash": "*"},
	}])
	msgs := {msg | some msg in npm_package_json.deny with input as pkg with data.template as template_data}
	some msg in msgs
	contains(msg, "lodash")
	not contains(msg, "\"storybook\"")
}

test_deny_storybook_dep_wrong_version if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {"storybook": "8.0.0"}}])
	some msg in npm_package_json.deny with input as pkg with data.template as template_data
	contains(msg, "storybook")
	contains(msg, "8.0.0")
	contains(msg, "9.1.10")
}

test_deny_storybook_addon_wrong_version_does_not_flag_name_allowlist if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {"msw-storybook-addon": "1.0.0"}}])
	msgs := {msg | some msg in npm_package_json.deny with input as pkg with data.template as template_data}
	count(msgs) == 1
	some msg in msgs
	contains(msg, "1.0.0")
}

# Drift test.
test_data_template_drives_files_whitelist if {
	some msg in npm_package_json.deny with input as valid_pkg
		with data.template as {"snippet": {"files": ["custom"]}}
	contains(msg, "custom")
}
