package npm_module.emit_types_config_test

import data.npm_module.emit_types_config
import rego.v1

# Mirrors template/tsconfig.emit-types.json.snippet.json
template_data := {"snippet": {"compilerOptions": {
	"allowJs": true,
	"declaration": true,
	"emitDeclarationOnly": true,
	"outDir": "types",
	"skipLibCheck": true,
}}}

canonical_input := {"compilerOptions": {
	"allowJs": true,
	"declaration": true,
	"emitDeclarationOnly": true,
	"outDir": "types",
	"skipLibCheck": true,
}}

test_allow_canonical if {
	count(emit_types_config.deny) == 0 with input as canonical_input
		with data.template as template_data
}

test_allow_canonical_plus_extras if {
	pkg := json.patch(canonical_input, [{"op": "add", "path": "/compilerOptions/rootDir", "value": "src"}])
	count(emit_types_config.deny) == 0 with input as pkg with data.template as template_data
}

test_deny_missing_compiler_options if {
	some msg in emit_types_config.deny with input as {} with data.template as template_data
	contains(msg, "compilerOptions")
}

test_deny_wrong_allow_js if {
	pkg := json.patch(canonical_input, [{"op": "replace", "path": "/compilerOptions/allowJs", "value": false}])
	some msg in emit_types_config.deny with input as pkg with data.template as template_data
	contains(msg, "allowJs")
}

test_deny_wrong_out_dir if {
	pkg := json.patch(canonical_input, [{"op": "replace", "path": "/compilerOptions/outDir", "value": "dist"}])
	some msg in emit_types_config.deny with input as pkg with data.template as template_data
	contains(msg, "outDir")
}

test_deny_missing_skip_lib_check if {
	pkg := json.patch(canonical_input, [{"op": "remove", "path": "/compilerOptions/skipLibCheck"}])
	some msg in emit_types_config.deny with input as pkg with data.template as template_data
	contains(msg, "skipLibCheck")
}

# Drift test.
test_data_template_drives_expected if {
	drifted := {"snippet": {"compilerOptions": {"outDir": "custom"}}}
	some msg in emit_types_config.deny with input as canonical_input with data.template as drifted
	contains(msg, "custom")
}
