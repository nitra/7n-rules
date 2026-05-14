# Тести для `tauri.vscode_extensions`. Запуск:
#   conftest verify -p npm/policy/tauri/vscode_extensions
package tauri.vscode_extensions_test

import rego.v1

import data.tauri.vscode_extensions

canonical := {"recommendations": [
	"tauri-apps.tauri-vscode",
	"rust-lang.rust-analyzer",
]}

test_allow_canonical if {
	count(vscode_extensions.deny) == 0 with input as canonical
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": [
		"dbaeumer.vscode-eslint",
		"tauri-apps.tauri-vscode",
		"rust-lang.rust-analyzer",
		"oxc.oxc-vscode",
	]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_deny_missing_tauri if {
	cfg := {"recommendations": ["rust-lang.rust-analyzer"]}
	count(vscode_extensions.deny) > 0 with input as cfg
}

test_deny_missing_rust_analyzer if {
	cfg := {"recommendations": ["tauri-apps.tauri-vscode"]}
	count(vscode_extensions.deny) > 0 with input as cfg
}

test_deny_empty_recommendations if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": []}
}

test_deny_no_recommendations_field if {
	count(vscode_extensions.deny) > 0 with input as {}
}
