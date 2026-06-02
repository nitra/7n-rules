# Тести для `k8s.hasura_configmap`. Запуск:
#   conftest verify -p npm/policy/k8s/hasura_configmap --namespace k8s.hasura_configmap
package k8s.hasura_configmap_test

import rego.v1

import data.k8s.hasura_configmap

remote_schema_key := "HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS"

relay_key := "HASURA_GRAPHQL_ENABLE_RELAY"

telemetry_key := "HASURA_GRAPHQL_ENABLE_TELEMETRY"

log_types_key := "HASURA_GRAPHQL_ENABLED_LOG_TYPES"

eventing_key := "HASURA_GRAPHQL_DISABLE_EVENTING"

base_cm := {
	"apiVersion": "v1",
	"kind": "ConfigMap",
	"metadata": {"name": "db-h", "namespace": "dev"},
}

# ConfigMap, що задовольняє всі обов'язкові env-ключі.
valid_data := {
	remote_schema_key: "true",
	relay_key: "false",
	telemetry_key: "false",
	log_types_key: "startup,http-log",
	eventing_key: "true",
}

with_data(d) := object.union(base_cm, {"data": d})

test_deny_missing_data if {
	count(hasura_configmap.deny) > 0 with input as base_cm
}

# Усі ключі відсутні → принаймні п'ять порушень.
test_deny_missing_data_lists_all_keys if {
	count(hasura_configmap.deny) >= 5 with input as base_cm
}

test_allow_all_required_keys if {
	count(hasura_configmap.deny) == 0 with input as with_data(valid_data)
}

# --- REMOTE_SCHEMA_PERMISSIONS: має бути true ---

test_deny_remote_schema_missing if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.remove(valid_data, {remote_schema_key}))
}

test_deny_remote_schema_false if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.union(valid_data, {remote_schema_key: "false"}))
}

test_allow_remote_schema_boolean_true if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {remote_schema_key: true}))
}

test_allow_remote_schema_uppercase_true if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {remote_schema_key: "TRUE"}))
}

# --- ENABLE_RELAY: має бути false ---

test_deny_relay_missing if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.remove(valid_data, {relay_key}))
}

test_deny_relay_true if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.union(valid_data, {relay_key: "true"}))
}

test_allow_relay_boolean_false if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {relay_key: false}))
}

test_allow_relay_uppercase_false if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {relay_key: "FALSE"}))
}

# --- ENABLE_TELEMETRY: має бути false ---

test_deny_telemetry_missing if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.remove(valid_data, {telemetry_key}))
}

test_deny_telemetry_true if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.union(valid_data, {telemetry_key: "true"}))
}

test_allow_telemetry_boolean_false if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {telemetry_key: false}))
}

# --- ENABLED_LOG_TYPES: точний рядок "startup,http-log" ---

test_deny_log_types_missing if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.remove(valid_data, {log_types_key}))
}

test_deny_log_types_wrong_value if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.union(valid_data, {log_types_key: "startup"}))
}

test_deny_log_types_reordered if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.union(valid_data, {log_types_key: "http-log,startup"}))
}

test_allow_log_types_exact if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {log_types_key: "startup,http-log"}))
}

# --- DISABLE_EVENTING: ключ обов'язковий, значення довільне ---

test_deny_eventing_missing if {
	count(hasura_configmap.deny) > 0 with input as with_data(object.remove(valid_data, {eventing_key}))
}

test_allow_eventing_default_true if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {eventing_key: "true"}))
}

test_allow_eventing_arbitrary_value if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {eventing_key: "false"}))
}

test_allow_eventing_boolean_value if {
	count(hasura_configmap.deny) == 0 with input as with_data(object.union(valid_data, {eventing_key: false}))
}

test_allow_non_configmap if {
	count(hasura_configmap.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "x"},
	}
}
