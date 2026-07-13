package text.package_json_test

import data.text.package_json
import rego.v1

template_data := {"deny": {
	"top-level": {"prettier": "Prettier заборонено — використовуй oxfmt (text.mdc)"},
	"dependencies": {
		"prettier": "Prettier заборонено — використовуй oxfmt (text.mdc)",
		"@nitra/prettier-config": "Prettier-конфіг заборонено — використовуй oxfmt (text.mdc)",
		"markdownlint-cli2": "використовуй bunx у lint-text (text.mdc)",
	},
	"devDependencies": {
		"prettier": "Prettier заборонено — використовуй oxfmt (text.mdc)",
		"@nitra/prettier-config": "Prettier-конфіг заборонено — використовуй oxfmt (text.mdc)",
		"markdownlint-cli2": "використовуй bunx у lint-text (text.mdc)",
	},
}}

valid_pkg := {"devDependencies": {"@nitra/cspell-dict": "^2.0.0"}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_prettier_field if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/prettier", "value": "rc"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "prettier")
}

test_deny_prettier_dep if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"prettier": "^3.0.0"}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "prettier")
}

test_deny_markdownlint_devdep if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies/markdownlint-cli2", "value": "^0.13.0"}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "markdownlint-cli2")
}

test_deny_cspell_dict_missing if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/devDependencies/@nitra~1cspell-dict"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_cspell_dict_version_too_old if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies/@nitra~1cspell-dict", "value": "^1.0.0"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

# Drift test.
test_data_template_drives_deny if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/customField", "value": "x"}])
	some msg in package_json.deny with input as bad
		with data.template as {"deny": {"top-level": {"customField": "заборонено для тесту"}}}
	contains(msg, "customField")
}

test_deny_scripts_bunx_prettier if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"fix": "bunx prettier --write ."}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "scripts.fix")
	contains(msg, "prettier")
}

test_deny_scripts_npx_prettier if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"format": "npx prettier --check ."}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "scripts.format")
}

test_deny_scripts_bare_prettier if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"f": "prettier --write src"}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "scripts.f")
}

test_deny_scripts_path_prettier if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"f": "./node_modules/.bin/prettier --check ."}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "scripts.f")
}

test_allow_scripts_without_prettier if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {
		"lint": "n-rules lint text",
		"format": "oxfmt --write .",
	}}])
	count(package_json.deny) == 0 with input as bad with data.template as template_data
}

# Уникнути false-positive на слово `prettier-ignore` всередині іншого ідентифікатора.
test_allow_scripts_prettier_ignore_substring if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/scripts", "value": {"f": "echo not-prettier-thing"}}])
	count(package_json.deny) == 0 with input as bad with data.template as template_data
}
