# Тести для `abie.health_check_policy`. Запуск:
#   conftest verify -p npm/policy/abie/health_check_policy
package abie.health_check_policy_test

import rego.v1

import data.abie.health_check_policy

valid_hcp := {
	"apiVersion": "networking.gke.io/v1",
	"kind": "HealthCheckPolicy",
	"metadata": {"name": "api"},
	"spec": {
		"default": {"config": {
			"type": "HTTP",
			"httpHealthCheck": {"requestPath": "/healthz", "port": 8080},
		}},
		"targetRef": {"group": "", "kind": "Service", "name": "api-hl"},
	},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(health_check_policy.deny) == 0 with input as valid_hcp
}

# ── apiVersion ────────────────────────────────────────────────────────────

test_deny_wrong_api_version if {
	bad := json.patch(valid_hcp, [{"op": "replace", "path": "/apiVersion", "value": "networking.gke.io/v1beta1"}])
	count(health_check_policy.deny) > 0 with input as bad
}

# ── metadata.name ─────────────────────────────────────────────────────────

test_deny_empty_name if {
	bad := json.patch(valid_hcp, [{"op": "replace", "path": "/metadata/name", "value": ""}])
	count(health_check_policy.deny) > 0 with input as bad
}

# ── spec.default.config.type ──────────────────────────────────────────────

test_deny_config_type_not_http if {
	bad := json.patch(valid_hcp, [{"op": "replace", "path": "/spec/default/config/type", "value": "TCP"}])
	count(health_check_policy.deny) > 0 with input as bad
}

# ── requestPath ───────────────────────────────────────────────────────────

test_deny_empty_request_path if {
	bad := json.patch(valid_hcp, [{
		"op": "replace",
		"path": "/spec/default/config/httpHealthCheck/requestPath",
		"value": "",
	}])
	count(health_check_policy.deny) > 0 with input as bad
}

test_deny_request_path_without_slash if {
	bad := json.patch(valid_hcp, [{
		"op": "replace",
		"path": "/spec/default/config/httpHealthCheck/requestPath",
		"value": "healthz",
	}])
	count(health_check_policy.deny) > 0 with input as bad
}

# ── port ──────────────────────────────────────────────────────────────────

test_deny_port_not_8080 if {
	bad := json.patch(valid_hcp, [{
		"op": "replace",
		"path": "/spec/default/config/httpHealthCheck/port",
		"value": 9090,
	}])
	count(health_check_policy.deny) > 0 with input as bad
}

# ── targetRef ─────────────────────────────────────────────────────────────

test_deny_target_ref_kind_not_service if {
	bad := json.patch(valid_hcp, [{"op": "replace", "path": "/spec/targetRef/kind", "value": "Gateway"}])
	count(health_check_policy.deny) > 0 with input as bad
}

test_deny_target_ref_name_without_hl if {
	bad := json.patch(valid_hcp, [{"op": "replace", "path": "/spec/targetRef/name", "value": "api"}])
	count(health_check_policy.deny) > 0 with input as bad
}

# Не HCP — пакет не діє.
test_allow_other_kind if {
	count(health_check_policy.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "x"},
	}
}
