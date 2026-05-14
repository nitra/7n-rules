# Тести для `js_run.jsconfig`. Запуск:
#   conftest verify -p npm/policy/js_run/jsconfig
package js_run.jsconfig_test

import rego.v1

import data.js_run.jsconfig

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

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(jsconfig.deny) == 0 with input as valid_cfg
}

# ── compilerOptions.lib ───────────────────────────────────────────────────

test_deny_lib_not_array if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/lib", "value": "esnext"}])
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_lib_wrong_value if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/lib", "value": ["es2022"]}])
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_lib_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/compilerOptions/lib"}])
	count(jsconfig.deny) > 0 with input as cfg
}

# ── compilerOptions.module / moduleResolution / target / checkJs ──────────

test_deny_module_not_nodenext if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/module", "value": "esnext"}])
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_module_resolution_not_nodenext if {
	cfg := json.patch(
		valid_cfg,
		[{"op": "replace", "path": "/compilerOptions/moduleResolution", "value": "node"}],
	)
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_target_not_esnext if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/target", "value": "es2022"}])
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_check_js_true if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/compilerOptions/checkJs", "value": true}])
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_check_js_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/compilerOptions/checkJs"}])
	count(jsconfig.deny) > 0 with input as cfg
}

# ── include ──────────────────────────────────────────────────────────────

test_deny_include_not_array if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/include", "value": "src/**/*"}])
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_include_wrong_value if {
	cfg := json.patch(valid_cfg, [{"op": "replace", "path": "/include", "value": ["lib/**/*"]}])
	count(jsconfig.deny) > 0 with input as cfg
}

test_deny_include_missing if {
	cfg := json.patch(valid_cfg, [{"op": "remove", "path": "/include"}])
	count(jsconfig.deny) > 0 with input as cfg
}
