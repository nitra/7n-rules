# Тести для `k8s.gateway`. Запуск:
#   conftest verify -p npm/policy/k8s/gateway --namespace k8s.gateway
package k8s.gateway_test

import rego.v1

import data.k8s.gateway

# ── HealthCheckPolicy ─────────────────────────────────────────────────────

test_deny_hcp_targetref_without_hl_suffix if {
	count(gateway.deny) > 0 with input as {
		"apiVersion": "networking.gke.io/v1",
		"kind": "HealthCheckPolicy",
		"metadata": {"name": "hc"},
		"spec": {"targetRef": {
			"group": "",
			"kind": "Service",
			"name": "auth",
		}},
	}
}

test_allow_hcp_targetref_with_hl_suffix if {
	count(gateway.deny) == 0 with input as {
		"apiVersion": "networking.gke.io/v1",
		"kind": "HealthCheckPolicy",
		"metadata": {"name": "hc"},
		"spec": {"targetRef": {
			"group": "",
			"kind": "Service",
			"name": "auth-hl",
		}},
	}
}

test_deny_hcp_missing_targetref if {
	count(gateway.deny) > 0 with input as {
		"apiVersion": "networking.gke.io/v1",
		"kind": "HealthCheckPolicy",
		"metadata": {"name": "hc"},
		"spec": {},
	}
}

# Без kind=Service у targetRef правило не діє (інші kind не оцінюємо).
test_allow_hcp_targetref_other_kind if {
	count(gateway.deny) == 0 with input as {
		"apiVersion": "networking.gke.io/v1",
		"kind": "HealthCheckPolicy",
		"metadata": {"name": "hc"},
		"spec": {"targetRef": {
			"kind": "Gateway",
			"name": "gw",
		}},
	}
}

# ── HTTPRoute backendRef → Service з суфіксом `-hl` ──────────────────────

test_deny_httproute_backend_without_hl if {
	count(gateway.deny) > 0 with input as {
		"apiVersion": "gateway.networking.k8s.io/v1",
		"kind": "HTTPRoute",
		"metadata": {"name": "r", "namespace": "dev"},
		"spec": {"rules": [{"backendRefs": [{"name": "auth", "port": 8080}]}]},
	}
}

test_allow_httproute_backend_with_hl if {
	count(gateway.deny) == 0 with input as {
		"apiVersion": "gateway.networking.k8s.io/v1",
		"kind": "HTTPRoute",
		"metadata": {"name": "r", "namespace": "dev"},
		"spec": {"rules": [{"backendRefs": [{"name": "auth-hl", "port": 8080}]}]},
	}
}

# ── HTTPRoute backendRef з redundant namespace ───────────────────────────

test_deny_httproute_backend_redundant_namespace if {
	count(gateway.deny) > 0 with input as {
		"apiVersion": "gateway.networking.k8s.io/v1",
		"kind": "HTTPRoute",
		"metadata": {"name": "r", "namespace": "dev"},
		"spec": {"rules": [{"backendRefs": [{
			"name": "auth-hl",
			"namespace": "dev",
			"port": 8080,
		}]}]},
	}
}

test_allow_httproute_backend_different_namespace if {
	count(gateway.deny) == 0 with input as {
		"apiVersion": "gateway.networking.k8s.io/v1",
		"kind": "HTTPRoute",
		"metadata": {"name": "r", "namespace": "dev"},
		"spec": {"rules": [{"backendRefs": [{
			"name": "auth-hl",
			"namespace": "other",
			"port": 8080,
		}]}]},
	}
}

# Перевірка не діє на HTTPHeaderMatch (немає `port`).
test_allow_httproute_header_match_without_port if {
	count(gateway.deny) == 0 with input as {
		"apiVersion": "gateway.networking.k8s.io/v1",
		"kind": "HTTPRoute",
		"metadata": {"name": "r", "namespace": "dev"},
		"spec": {"rules": [{
			"matches": [{"headers": [{
				"type": "Exact",
				"name": "X-Tenant",
				"value": "acme",
			}]}],
			"backendRefs": [{"name": "auth-hl", "port": 8080}],
		}]},
	}
}
