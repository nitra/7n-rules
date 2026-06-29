package text.oxfmtrc_test

import data.text.oxfmtrc
import rego.v1

template_data := {"snippet": {
	"semi": false,
	"singleQuote": true,
	"tabWidth": 2,
	"useTabs": false,
	"printWidth": 120,
	"ignorePatterns": ["**/hasura/metadata/**", "**/schema.graphql", "**/auto-imports.d.ts"],
}}

valid_cfg := {
	"arrowParens": "avoid",
	"printWidth": 120,
	"bracketSpacing": true,
	"bracketSameLine": false,
	"semi": false,
	"singleQuote": true,
	"tabWidth": 2,
	"trailingComma": "all",
	"useTabs": false,
	"ignorePatterns": ["**/hasura/metadata/**", "**/schema.graphql", "**/auto-imports.d.ts"],
}

test_allow_canonical if {
	count(oxfmtrc.deny) == 0 with input as valid_cfg with data.template as template_data
}

test_deny_semi_true if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/semi", "value": true}])
	count(oxfmtrc.deny) > 0 with input as bad with data.template as template_data
}

test_deny_tabwidth_wrong if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/tabWidth", "value": 4}])
	count(oxfmtrc.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_required_key if {
	bad := json.patch(valid_cfg, [{"op": "remove", "path": "/arrowParens"}])
	count(oxfmtrc.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_ignore_pattern if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/ignorePatterns", "value": []}])
	count(oxfmtrc.deny) > 0 with input as bad with data.template as template_data
}

# Drift test.
test_data_template_drives_value if {
	drifted := json.patch(template_data, [{"op": "replace", "path": "/snippet/tabWidth", "value": 4}])
	some msg in oxfmtrc.deny with input as valid_cfg with data.template as drifted
	contains(msg, "4")
}
