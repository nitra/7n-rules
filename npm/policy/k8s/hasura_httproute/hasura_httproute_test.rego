# Тести для `k8s.hasura_httproute`. Запуск:
#   conftest verify -p npm/policy/k8s/hasura_httproute --namespace k8s.hasura_httproute
package k8s.hasura_httproute_test

import rego.v1

import data.k8s.hasura_httproute

base_route := {
	"apiVersion": "gateway.networking.k8s.io/v1",
	"kind": "HTTPRoute",
	"metadata": {"name": "db-h", "namespace": "dev"},
}

rule1(prefix) := {
	"matches": [{"path": {"type": "Exact", "value": sprintf("%s/ql", [prefix])}}],
	"filters": [{
		"type": "RequestRedirect",
		"requestRedirect": {
			"path": {"type": "ReplaceFullPath", "replaceFullPath": sprintf("%s/ql/console", [prefix])},
			"statusCode": 302,
		},
	}],
}

rule2(prefix) := {
	"matches": [{"path": {"type": "Exact", "value": sprintf("%s/ql/", [prefix])}}],
	"filters": [{
		"type": "RequestRedirect",
		"requestRedirect": {
			"path": {"type": "ReplaceFullPath", "replaceFullPath": sprintf("%s/ql/console", [prefix])},
			"statusCode": 302,
		},
	}],
}

rule3(prefix, backend) := {
	"matches": [{"path": {"type": "PathPrefix", "value": sprintf("%s/ql", [prefix])}}],
	"filters": [{
		"type": "URLRewrite",
		"urlRewrite": {"path": {"type": "ReplacePrefixMatch", "replacePrefixMatch": "/"}},
	}],
	"backendRefs": [{"name": backend, "port": 8080}],
}

rule4(prefix, backend) := {
	"matches": [{
		"path": {"type": "PathPrefix", "value": sprintf("%s/ql", [prefix])},
		"headers": [{"type": "Exact", "name": "Upgrade", "value": "websocket"}],
	}],
	"filters": [
		{
			"type": "URLRewrite",
			"urlRewrite": {"path": {"type": "ReplacePrefixMatch", "replacePrefixMatch": "/"}},
		},
		{
			"type": "RequestHeaderModifier",
			"requestHeaderModifier": {"remove": ["Authorization"]},
		},
	],
	"backendRefs": [{"name": backend, "port": 8080}],
}

# ── canonical positive case ─────────────────────────────────────────────

test_allow_canonical_route_empty_prefix if {
	count(hasura_httproute.deny) == 0 with input as object.union(base_route, {"spec": {"rules": [
		rule1(""),
		rule2(""),
		rule3("", "db-h-hl"),
		rule4("", "db-h-hl"),
	]}})
}

test_allow_canonical_route_with_prefix if {
	count(hasura_httproute.deny) == 0 with input as object.union(base_route, {"spec": {"rules": [
		rule1("/notify"),
		rule2("/notify"),
		rule3("/notify", "db-h-hl"),
		rule4("/notify", "db-h-hl"),
	]}})
}

# ── deny-кейси ───────────────────────────────────────────────────────────

test_deny_missing_spec if {
	count(hasura_httproute.deny) > 0 with input as base_route
}

test_deny_empty_rules if {
	count(hasura_httproute.deny) > 0 with input as object.union(base_route, {"spec": {"rules": []}})
}

test_deny_missing_rule1 if {
	count(hasura_httproute.deny) > 0 with input as object.union(base_route, {"spec": {"rules": [{
		"matches": [{"path": {"type": "PathPrefix", "value": "/api"}}],
		"backendRefs": [{"name": "api-hl", "port": 8080}],
	}]}})
}

test_deny_rule1_wrong_redirect if {
	bad_rule1 := object.union(rule1(""), {"filters": [{
		"type": "RequestRedirect",
		"requestRedirect": {
			"path": {"type": "ReplaceFullPath", "replaceFullPath": "/wrong"},
			"statusCode": 302,
		},
	}]})
	count(hasura_httproute.deny) > 0 with input as object.union(base_route, {"spec": {"rules": [
		bad_rule1,
		rule2(""),
		rule3("", "db-h-hl"),
		rule4("", "db-h-hl"),
	]}})
}

test_deny_rule2_missing if {
	count(hasura_httproute.deny) > 0 with input as object.union(base_route, {"spec": {"rules": [
		rule1(""),
		rule3("", "db-h-hl"),
		rule4("", "db-h-hl"),
	]}})
}

test_deny_rule3_missing if {
	count(hasura_httproute.deny) > 0 with input as object.union(base_route, {"spec": {"rules": [
		rule1(""),
		rule2(""),
		rule4("", "db-h-hl"),
	]}})
}

test_deny_rule4_missing if {
	count(hasura_httproute.deny) > 0 with input as object.union(base_route, {"spec": {"rules": [
		rule1(""),
		rule2(""),
		rule3("", "db-h-hl"),
	]}})
}

test_deny_rule4_wrong_backend if {
	count(hasura_httproute.deny) > 0 with input as object.union(base_route, {"spec": {"rules": [
		rule1(""),
		rule2(""),
		rule3("", "db-h-hl"),
		rule4("", "other-hl"),
	]}})
}
