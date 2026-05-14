# Тести для `abie.http_route_base`. Запуск:
#   conftest verify -p npm/policy/abie/http_route_base
package abie.http_route_base_test

import rego.v1

import data.abie.http_route_base

mk_route(hostnames) := {
	"apiVersion": "gateway.networking.k8s.io/v1",
	"kind": "HTTPRoute",
	"metadata": {"name": "r", "namespace": "dev"},
	"spec": {"hostnames": hostnames},
}

# ── allow ────────────────────────────────────────────────────────────────

test_allow_apex if {
	count(http_route_base.deny) == 0 with input as mk_route(["aiml.live"])
}

test_allow_subdomain if {
	count(http_route_base.deny) == 0 with input as mk_route(["api.aiml.live"])
}

test_allow_wildcard if {
	count(http_route_base.deny) == 0 with input as mk_route(["*.aiml.live"])
}

test_allow_uppercase_apex if {
	count(http_route_base.deny) == 0 with input as mk_route(["AIML.LIVE"])
}

test_allow_multiple_subdomains if {
	count(http_route_base.deny) == 0 with input as mk_route(["api.aiml.live", "admin.aiml.live"])
}

# ── deny ─────────────────────────────────────────────────────────────────

test_deny_other_apex if {
	count(http_route_base.deny) > 0 with input as mk_route(["example.com"])
}

test_deny_wrong_subdomain if {
	count(http_route_base.deny) > 0 with input as mk_route(["api.example.com"])
}

test_deny_mixed_one_bad if {
	count(http_route_base.deny) > 0 with input as mk_route(["api.aiml.live", "evil.com"])
}

test_deny_aiml_live_substring if {
	# "aiml.live.example.com" не має закінчуватись на ".aiml.live" — це інший домен.
	count(http_route_base.deny) > 0 with input as mk_route(["aiml.live.example.com"])
}

# Не HTTPRoute — пакет не діє.
test_allow_non_httproute if {
	count(http_route_base.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "x"},
	}
}
