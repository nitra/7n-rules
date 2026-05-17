package npm_module.root_package_json_test

import data.npm_module.root_package_json
import rego.v1

# Mirrors template/package.json.snippet.json
template_data := {"snippet": {"workspaces": ["npm"]}}

test_allow_workspaces_with_npm if {
	count(root_package_json.deny) == 0 with input as {"workspaces": ["npm"]}
		with data.template as template_data
}

test_allow_workspaces_with_extras if {
	count(root_package_json.deny) == 0 with input as {"workspaces": ["demo", "npm", "tests"]}
		with data.template as template_data
}

test_deny_missing_workspaces if {
	some msg in root_package_json.deny with input as {"name": "monorepo"}
		with data.template as template_data
	contains(msg, "workspaces")
}

test_deny_workspaces_not_array if {
	some msg in root_package_json.deny with input as {"workspaces": "npm"}
		with data.template as template_data
	contains(msg, "workspaces")
}

test_deny_workspaces_without_npm if {
	some msg in root_package_json.deny with input as {"workspaces": ["demo"]}
		with data.template as template_data
	contains(msg, "npm")
}

# Drift test.
test_data_template_drives_expected if {
	some msg in root_package_json.deny with input as {"workspaces": ["npm"]}
		with data.template as {"snippet": {"workspaces": ["packages/*"]}}
	contains(msg, "packages/*")
}
