package rust.package_json_test

import data.rust.package_json
import rego.v1

valid_pkg := {
	"name": "my-tauri-app",
	"devDependencies": {"@7n/rules": "workspace:*"},
}

test_allow_no_rust_tools if {
	count(package_json.deny) == 0 with input as valid_pkg
}

test_deny_cargo_in_devdependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies/cargo", "value": "^1.0.0"}])
	some msg in package_json.deny with input as bad
	contains(msg, "devDependencies.cargo")
}

test_deny_rustfmt_in_devdependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies/rustfmt", "value": "*"}])
	some msg in package_json.deny with input as bad
	contains(msg, "devDependencies.rustfmt")
}

test_deny_clippy_in_dependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"clippy": "^0.1.0"}}])
	some msg in package_json.deny with input as bad
	contains(msg, "dependencies.clippy")
}

test_deny_cargo_in_peer_dependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/peerDependencies", "value": {"cargo": "*"}}])
	some msg in package_json.deny with input as bad
	contains(msg, "peerDependencies.cargo")
}

test_allow_empty_package if {
	count(package_json.deny) == 0 with input as {}
}
