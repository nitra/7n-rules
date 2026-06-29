package rego.package_json_test

import data.rego.package_json
import rego.v1

valid_pkg := {
	"name": "my-app",
	"devDependencies": {"@nitra/cursor": "workspace:*"},
}

test_allow_no_opa_regal if {
	count(package_json.deny) == 0 with input as valid_pkg
}

test_deny_opa_in_devdependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies/opa", "value": "^1.0.0"}])
	some msg in package_json.deny with input as bad
	contains(msg, "devDependencies.opa")
}

test_deny_regal_in_devdependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/devDependencies/regal", "value": "^0.30.0"}])
	some msg in package_json.deny with input as bad
	contains(msg, "devDependencies.regal")
}

test_deny_opa_in_dependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"opa": "^1.0.0"}}])
	some msg in package_json.deny with input as bad
	contains(msg, "dependencies.opa")
}

test_deny_regal_in_peer_dependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/peerDependencies", "value": {"regal": "^0.30.0"}}])
	some msg in package_json.deny with input as bad
	contains(msg, "peerDependencies.regal")
}

test_allow_empty_package if {
	count(package_json.deny) == 0 with input as {}
}
