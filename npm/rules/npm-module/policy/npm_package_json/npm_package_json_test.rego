# Тести для `npm_module.npm_package_json`. Запуск:
#   conftest verify -p npm/policy/npm_module/npm_package_json
package npm_module.npm_package_json_test

import rego.v1

import data.npm_module.npm_package_json

valid_pkg := {
	"name": "@nitra/cursor",
	"version": "1.9.5",
	"types": "./types/bin/n-cursor.d.ts",
	"files": [
		"types",
		"mdc",
		"bin",
		"CHANGELOG.md",
	],
	"dependencies": {"oxc-parser": "^0.128.0"},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(npm_package_json.deny) == 0 with input as valid_pkg
}

test_allow_types_index_d_ts if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/types", "value": "./types/index.d.ts"}])
	count(npm_package_json.deny) == 0 with input as pkg
}

# ── types ─────────────────────────────────────────────────────────────────

test_deny_types_outside_types_dir if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/types", "value": "./dist/index.d.ts"}])
	count(npm_package_json.deny) > 0 with input as pkg
}

test_deny_types_wrong_extension if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/types", "value": "./types/index.ts"}])
	count(npm_package_json.deny) > 0 with input as pkg
}

# ── files ─────────────────────────────────────────────────────────────────

test_deny_missing_files if {
	pkg := json.patch(valid_pkg, [{"op": "remove", "path": "/files"}])
	count(npm_package_json.deny) > 0 with input as pkg
}

test_deny_files_not_array if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/files", "value": "types"}])
	count(npm_package_json.deny) > 0 with input as pkg
}

test_deny_files_empty if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/files", "value": []}])
	count(npm_package_json.deny) > 0 with input as pkg
}

test_deny_files_without_types if {
	pkg := json.patch(valid_pkg, [{"op": "replace", "path": "/files", "value": ["bin", "mdc"]}])
	count(npm_package_json.deny) > 0 with input as pkg
}

# ── devDependencies ──────────────────────────────────────────────────────

test_allow_no_dev_dependencies if {
	count(npm_package_json.deny) == 0 with input as valid_pkg
}

test_allow_empty_dev_dependencies if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {}}])
	count(npm_package_json.deny) == 0 with input as pkg
}

test_deny_dev_dependencies_present if {
	pkg := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies", "value": {"@nitra/cursor": "^1.9.5"}}])
	count(npm_package_json.deny) > 0 with input as pkg
}
