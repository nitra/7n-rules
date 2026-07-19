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

# ── devDependencies (логіка лишається в rego — must be empty) ────────────

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

# Drift test.
test_data_template_drives_files_whitelist if {
	some msg in npm_package_json.deny with input as valid_pkg
		with data.template as {"snippet": {"files": ["custom"]}}
	contains(msg, "custom")
}
