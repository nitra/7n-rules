package rust.vscode_extensions_test

import data.rust.vscode_extensions
import rego.v1

template_data := {"snippet": {"recommendations": ["rust-lang.rust-analyzer", "tamasfe.even-better-toml"]}}

test_allow_with_both_extensions if {
	cfg := {"recommendations": ["rust-lang.rust-analyzer", "tamasfe.even-better-toml"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_allow_with_additional_extensions if {
	cfg := {"recommendations": ["dbaeumer.vscode-eslint", "rust-lang.rust-analyzer", "tamasfe.even-better-toml", "oxc.oxc-vscode"]}
	count(vscode_extensions.deny) == 0 with input as cfg with data.template as template_data
}

test_deny_missing_rust_analyzer if {
	cfg := {"recommendations": ["tamasfe.even-better-toml"]}
	some msg in vscode_extensions.deny with input as cfg with data.template as template_data
	contains(msg, "rust-lang.rust-analyzer")
}

test_deny_missing_even_better_toml if {
	cfg := {"recommendations": ["rust-lang.rust-analyzer"]}
	some msg in vscode_extensions.deny with input as cfg with data.template as template_data
	contains(msg, "tamasfe.even-better-toml")
}

test_deny_no_recommendations_field if {
	count(vscode_extensions.deny) > 0 with input as {} with data.template as template_data
}

# Drift test.
test_data_template_drives_check if {
	some msg in vscode_extensions.deny with input as {"recommendations": []}
		with data.template as {"snippet": {"recommendations": ["custom.ext"]}}
	contains(msg, "custom.ext")
}
