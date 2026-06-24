package js_lint.package_json_test

import data.js_lint.package_json
import rego.v1

template_data := {"snippet": {
	"type": "module",
	"devDependencies": {"@nitra/eslint-config": "^3.10.0"},
}}

valid_pkg := {
	"type": "module",
	"engines": {"node": ">=24", "bun": ">=1.3"},
	"devDependencies": {"@nitra/eslint-config": "^3.10.0"},
}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_type_not_module if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/type", "value": "commonjs"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_node_too_old if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/engines/node", "value": ">=20"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

test_deny_eslint_config_too_old if {
	bad := json.patch(valid_pkg, [{"op": "replace", "path": "/devDependencies/@nitra~1eslint-config", "value": "^3.9.9"}])
	count(package_json.deny) > 0 with input as bad with data.template as template_data
}

# Поріг керується snippet: підняли канон у template → раніше валідна версія стає застарілою,
# а повідомлення містить новий поріг.
test_eslint_floor_driven_by_snippet if {
	bumped := json.patch(template_data, [{"op": "replace", "path": "/snippet/devDependencies/@nitra~1eslint-config", "value": "^4.0.0"}])
	some msg in package_json.deny with input as valid_pkg with data.template as bumped
	contains(msg, "4.0.0")
}

test_deny_banned_fastify_in_dependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"@nitra/as-integrations-fastify": "^1.0.0"}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "@nitra/as-integrations-fastify")
}

test_deny_banned_fastify_in_peer_dependencies if {
	bad := json.patch(valid_pkg, [{"op": "add", "path": "/peerDependencies", "value": {"@nitra/as-integrations-fastify": "^1.0.0"}}])
	some msg in package_json.deny with input as bad with data.template as template_data
	contains(msg, "@nitra/as-integrations-fastify")
}

test_allow_upstream_fastify_package if {
	ok := json.patch(valid_pkg, [{"op": "add", "path": "/dependencies", "value": {"@as-integrations/fastify": "^3.1.0"}}])
	count(package_json.deny) == 0 with input as ok with data.template as template_data
}
