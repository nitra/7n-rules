package rust.package_json_test

import data.rust.package_json
import rego.v1

template_data := {"contains": {"scripts": {"lint-rust": [
	"cargo fmt --all",
	"cargo clippy --fix --allow-staged --allow-dirty",
	"cargo clippy --all-targets --all-features -- -D warnings",
]}}}

valid_pkg := {"scripts": {"lint-rust": "cargo fmt --all && cargo clippy --fix --allow-staged --allow-dirty --all-targets --all-features && cargo clippy --all-targets --all-features -- -D warnings"}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_missing_lint_rust_script if {
	bad := json.patch(valid_pkg, [{"op": "remove", "path": "/scripts/lint-rust"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_fmt_step if {
	bad := json.patch(valid_pkg, [{
		"op": "replace", "path": "/scripts/lint-rust",
		"value": "cargo clippy --fix --allow-staged --allow-dirty --all-targets --all-features && cargo clippy --all-targets --all-features -- -D warnings",
	}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "cargo fmt --all")
}

test_deny_missing_clippy_fix if {
	bad := json.patch(valid_pkg, [{
		"op": "replace", "path": "/scripts/lint-rust",
		"value": "cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings",
	}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "cargo clippy --fix")
}

test_deny_missing_d_warnings if {
	bad := json.patch(valid_pkg, [{
		"op": "replace", "path": "/scripts/lint-rust",
		"value": "cargo fmt --all && cargo clippy --fix --allow-staged --allow-dirty",
	}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "-D warnings")
}

# Drift test: підміна data.template веде перевірку.
test_data_template_drives_contains if {
	some msg in package_json.deny with input as valid_pkg
		with data.template as {"contains": {"scripts": {"lint-rust": ["custom-cargo"]}}}
	contains(msg, "custom-cargo")
}
