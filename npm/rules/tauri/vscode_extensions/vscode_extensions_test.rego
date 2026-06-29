# Тести для `tauri.vscode_extensions`. Запуск:
#   conftest verify -p npm/policy/tauri/vscode_extensions
package tauri.vscode_extensions_test

import rego.v1

import data.tauri.vscode_extensions

canonical := {"recommendations": ["tauri-apps.tauri-vscode"]}

test_allow_canonical if {
	count(vscode_extensions.deny) == 0 with input as canonical
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": [
		"dbaeumer.vscode-eslint",
		"tauri-apps.tauri-vscode",
		"rust-lang.rust-analyzer",
		"tamasfe.even-better-toml",
		"oxc.oxc-vscode",
	]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_deny_missing_tauri if {
	cfg := {"recommendations": ["rust-lang.rust-analyzer"]}
	some msg in vscode_extensions.deny with input as cfg
	contains(msg, "tauri-apps.tauri-vscode")
}

# rust-lang.rust-analyzer більше НЕ обов'язковий для tauri.vscode_extensions:
# його вимагає правило rust (rust.mdc).
test_allow_without_rust_analyzer if {
	cfg := {"recommendations": ["tauri-apps.tauri-vscode"]}
	count(vscode_extensions.deny) == 0 with input as cfg
}

test_deny_empty_recommendations if {
	count(vscode_extensions.deny) > 0 with input as {"recommendations": []}
}

test_deny_no_recommendations_field if {
	count(vscode_extensions.deny) > 0 with input as {}
}
