package text.cspell_test

import data.text.cspell
import rego.v1

template_data := {
	"snippet": {
		"version": "0.2",
		"useGitignore": true,
		"gitignoreRoot": ".",
		"ignorePaths": [
			"**/node_modules/**",
			"**/vscode-extension/**",
			"**/.git/**",
			".vscode",
			"report",
			"*.svg",
			"**/k8s/**/*.yaml",
			"docs/adr/**",
		],
	},
	"contains": {"import": ["@nitra/cspell-dict"]},
	"deny": {"import-substrings": {"@cspell/dict-": "використовуй лише @nitra/cspell-dict (text.mdc)"}},
}

valid_cfg := {
	"version": "0.2",
	"language": "en,uk",
	"useGitignore": true,
	"gitignoreRoot": ".",
	"import": ["@nitra/cspell-dict/cspell-ext.json"],
	"ignorePaths": [
		"**/node_modules/**",
		"**/vscode-extension/**",
		"**/.git/**",
		".vscode",
		"report",
		"*.svg",
		"**/k8s/**/*.yaml",
		"docs/adr/**",
	],
}

test_allow_canonical if {
	count(cspell.deny) == 0 with input as valid_cfg with data.template as template_data
}

test_deny_wrong_version if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/version", "value": "0.1"}])
	some msg in cspell.deny with input as bad with data.template as template_data
	contains(msg, "version")
}

test_deny_missing_language if {
	bad := json.patch(valid_cfg, [{"op": "remove", "path": "/language"}])
	count(cspell.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_nitra_import if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/import", "value": []}])
	some msg in cspell.deny with input as bad with data.template as template_data
	contains(msg, "@nitra/cspell-dict")
}

test_deny_legacy_dict_import if {
	bad := json.patch(valid_cfg, [{"op": "add", "path": "/import/-", "value": "@cspell/dict-de"}])
	some msg in cspell.deny with input as bad with data.template as template_data
	contains(msg, "@cspell/dict-")
}

test_deny_missing_ignore_path if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/ignorePaths", "value": ["**/.git/**"]}])
	count(cspell.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_use_gitignore if {
	bad := json.patch(valid_cfg, [{"op": "remove", "path": "/useGitignore"}])
	some msg in cspell.deny with input as bad with data.template as template_data
	contains(msg, "useGitignore")
}

# gitignoreRoot обмежує обхід .gitignore коренем репо: без нього cspell у
# git-worktree тягне .gitignore основного дерева і мовчки ігнорує все.
test_deny_missing_gitignore_root if {
	bad := json.patch(valid_cfg, [{"op": "remove", "path": "/gitignoreRoot"}])
	some msg in cspell.deny with input as bad with data.template as template_data
	contains(msg, "gitignoreRoot")
}

# Drift test.
test_data_template_drives_version if {
	drifted := json.patch(template_data, [{"op": "replace", "path": "/snippet/version", "value": "0.3"}])
	some msg in cspell.deny with input as valid_cfg with data.template as drifted
	contains(msg, "0.3")
}

# canon має включати docs/adr/** (адр-чернетки).
test_deny_missing_docs_adr if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/ignorePaths", "value": [
		"**/node_modules/**",
		"**/vscode-extension/**",
		"**/.git/**",
		".vscode",
		"report",
		"*.svg",
		"**/k8s/**/*.yaml",
	]}])
	some msg in cspell.deny with input as bad with data.template as template_data
	contains(msg, "docs/adr/**")
}
