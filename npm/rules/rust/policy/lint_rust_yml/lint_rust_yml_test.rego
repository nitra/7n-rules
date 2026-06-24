package rust.lint_rust_yml_test

import data.rust.lint_rust_yml
import rego.v1

template_data := {"snippet": {"jobs": {"lint": {"steps": [
	{"uses": "actions/checkout@v6"},
	{"uses": "dtolnay/rust-toolchain@stable", "with": {"components": "rustfmt, clippy"}},
	{"uses": "Swatinem/rust-cache@v2"},
	{"run": "cargo fmt --all -- --check"},
	{"run": "cargo clippy --all-targets --all-features -- -D warnings"},
]}}}}

canonical_wf := {"jobs": {"lint": {"steps": [
	{"uses": "actions/checkout@v6"},
	{"uses": "dtolnay/rust-toolchain@stable", "with": {"components": "rustfmt, clippy"}},
	{"uses": "Swatinem/rust-cache@v2"},
	{"run": "cargo fmt --all -- --check"},
	{"run": "cargo clippy --all-targets --all-features -- -D warnings"},
]}}}

test_allow_canonical if {
	count(lint_rust_yml.deny) == 0 with input as canonical_wf with data.template as template_data
}

test_deny_missing_fmt_run if {
	wf := {"jobs": {"lint": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "dtolnay/rust-toolchain@stable", "with": {"components": "rustfmt, clippy"}},
		{"uses": "Swatinem/rust-cache@v2"},
		{"run": "cargo clippy --all-targets --all-features -- -D warnings"},
	]}}}
	some msg in lint_rust_yml.deny with input as wf with data.template as template_data
	contains(msg, "cargo fmt --all -- --check")
}

test_deny_missing_clippy_run if {
	wf := {"jobs": {"lint": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "dtolnay/rust-toolchain@stable", "with": {"components": "rustfmt, clippy"}},
		{"uses": "Swatinem/rust-cache@v2"},
		{"run": "cargo fmt --all -- --check"},
	]}}}
	some msg in lint_rust_yml.deny with input as wf with data.template as template_data
	contains(msg, "cargo clippy")
}

test_deny_missing_toolchain_uses if {
	wf := {"jobs": {"lint": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"run": "cargo fmt --all -- --check"},
		{"run": "cargo clippy --all-targets --all-features -- -D warnings"},
	]}}}
	some msg in lint_rust_yml.deny with input as wf with data.template as template_data
	contains(msg, "dtolnay/rust-toolchain@stable")
}

test_deny_toolchain_missing_rustfmt_component if {
	wf := {"jobs": {"lint": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "dtolnay/rust-toolchain@stable", "with": {"components": "clippy"}},
		{"uses": "Swatinem/rust-cache@v2"},
		{"run": "cargo fmt --all -- --check"},
		{"run": "cargo clippy --all-targets --all-features -- -D warnings"},
	]}}}
	some msg in lint_rust_yml.deny with input as wf with data.template as template_data
	contains(msg, "rustfmt")
}

test_deny_toolchain_missing_clippy_component if {
	wf := {"jobs": {"lint": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "dtolnay/rust-toolchain@stable", "with": {"components": "rustfmt"}},
		{"uses": "Swatinem/rust-cache@v2"},
		{"run": "cargo fmt --all -- --check"},
		{"run": "cargo clippy --all-targets --all-features -- -D warnings"},
	]}}}
	some msg in lint_rust_yml.deny with input as wf with data.template as template_data
	contains(msg, "clippy")
}

test_deny_toolchain_without_components if {
	wf := {"jobs": {"lint": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"uses": "dtolnay/rust-toolchain@stable"},
		{"uses": "Swatinem/rust-cache@v2"},
		{"run": "cargo fmt --all -- --check"},
		{"run": "cargo clippy --all-targets --all-features -- -D warnings"},
	]}}}
	count(lint_rust_yml.deny) > 0 with input as wf with data.template as template_data
}

test_deny_empty if {
	count(lint_rust_yml.deny) > 0 with input as {} with data.template as template_data
}

# Drift test.
test_data_template_drives_substring if {
	some msg in lint_rust_yml.deny with input as canonical_wf
		with data.template as {"snippet": {"jobs": {"lint": {"steps": [{"run": "custom-runner"}]}}}}
	contains(msg, "custom-runner")
}
