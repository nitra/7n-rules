# Тести для `js_run.jsconfig`. Запуск:
#   conftest verify -p npm/rules/js-run/policy/jsconfig
package js_run.jsconfig_test

import data.js_run.jsconfig
import rego.v1

# Mirrors template/jsconfig.json.snippet.json
template_data := {"snippet": {
	"compilerOptions": {
		"lib": ["esnext"],
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"target": "esnext",
		"checkJs": false,
	},
	"include": ["src/**/*"],
}}

valid_cfg := {
	"compilerOptions": {
		"lib": ["esnext"],
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"target": "esnext",
		"checkJs": false,
	},
	"include": ["src/**/*"],
}

test_allow_canonical if {
	count(jsconfig.deny) == 0 with input as valid_cfg with data.template as template_data
}

test_deny_module_not_nodenext if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/module", "value": "esnext"}])
	some msg in jsconfig.deny with input as cfg with data.template as template_data
	contains(msg, "module")
}

test_deny_target_not_esnext if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/target", "value": "es2022"}])
	some msg in jsconfig.deny with input as cfg with data.template as template_data
	contains(msg, "target")
}

test_deny_check_js_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/checkJs", "value": true}])
	some msg in jsconfig.deny with input as cfg with data.template as template_data
	contains(msg, "checkJs")
}

test_deny_lib_wrong_value if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/lib", "value": ["es2022"]}])
	some msg in jsconfig.deny with input as cfg with data.template as template_data
	contains(msg, "lib")
}

test_deny_include_wrong_value if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/include", "value": ["lib/**/*"]}])
	some msg in jsconfig.deny with input as cfg with data.template as template_data
	contains(msg, "include")
}

# Drift test.
test_data_template_drives_target if {
	drifted := json.patch(template_data, [{"op": "replace", "path": "/snippet/compilerOptions/target", "value": "custom"}])
	some msg in jsconfig.deny with input as valid_cfg with data.template as drifted
	contains(msg, "custom")
}
