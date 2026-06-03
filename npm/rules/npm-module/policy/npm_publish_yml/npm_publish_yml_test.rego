package npm_module.npm_publish_yml_test

import data.npm_module.npm_publish_yml
import rego.v1

# Mirrors template/npm-publish.yml.snippet.yml. Канонічні літерали — для path
# substring і uses substring читаємо як string-маркери з template's steps.
template_data := {"snippet": {
	"name": "npm-publish",
	"on": {"push": {"paths": ["npm/**"], "branches": ["main"]}},
	"jobs": {"release-publish": {
		"permissions": {"contents": "write", "id-token": "write"},
		"steps": [
			{"uses": "actions/checkout@v6"},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"uses": "actions/setup-node@v6"},
			{"name": "Configure git identity", "run": "git config ..."},
			{"name": "Release (bump + CHANGELOG + tag)", "run": "node npm/bin/n-cursor.js release"},
			{"uses": "JS-DevTools/npm-publish@v4.1.5", "with": {"package": "npm/package.json"}},
		],
	}},
}}

canonical_input := {
	"name": "npm-publish",
	"true": {"push": {"paths": ["npm/**"], "branches": ["main"]}},
	"jobs": {"release-publish": {
		"permissions": {"contents": "write", "id-token": "write"},
		"steps": [
			{"uses": "actions/checkout@v6"},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"uses": "actions/setup-node@v6"},
			{"name": "Configure git identity", "run": "git config ..."},
			{"name": "Release (bump + CHANGELOG + tag)", "run": "node npm/bin/n-cursor.js release"},
			{"uses": "JS-DevTools/npm-publish@v4.1.5", "with": {"package": "npm/package.json"}},
		],
	}},
}

test_allow_canonical if {
	count(npm_publish_yml.deny) == 0 with input as canonical_input
		with data.template as template_data
}

test_deny_missing_npm_glob if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/push/paths", "value": ["src/**"]}])
	some msg in npm_publish_yml.deny with input as bad with data.template as template_data
	contains(msg, "npm/**")
}

test_deny_missing_main_branch if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/push/branches", "value": ["dev"]}])
	some msg in npm_publish_yml.deny with input as bad with data.template as template_data
	contains(msg, "main")
}

test_deny_missing_id_token_write if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/release-publish/permissions", "value": {"contents": "write"}}],
	)
	some msg in npm_publish_yml.deny with input as bad with data.template as template_data
	contains(msg, "id-token")
}

test_deny_missing_npm_publish_step if {
	bad := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/release-publish/steps",
		"value": [{"uses": "actions/checkout@v6"}],
	}])
	some msg in npm_publish_yml.deny with input as bad with data.template as template_data
	contains(msg, "JS-DevTools/npm-publish")
}

test_deny_wrong_package_in_publish_step if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/release-publish/steps/5/with/package", "value": "wrong.json"}],
	)
	some msg in npm_publish_yml.deny with input as bad with data.template as template_data
	contains(msg, "npm/package.json")
}

# Drift test.
test_data_template_drives_expected_branches if {
	drifted := json.patch(template_data, [{"op": "replace", "path": "/snippet/on/push/branches", "value": ["release"]}])
	some msg in npm_publish_yml.deny with input as canonical_input with data.template as drifted
	contains(msg, "release")
}
