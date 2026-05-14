# Тести для `k8s.hasura_configmap`. Запуск:
#   conftest verify -p npm/policy/k8s/hasura_configmap --namespace k8s.hasura_configmap
package k8s.hasura_configmap_test

import rego.v1

import data.k8s.hasura_configmap

required_key := "HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS"

base_cm := {
	"apiVersion": "v1",
	"kind": "ConfigMap",
	"metadata": {"name": "db-h", "namespace": "dev"},
}

with_data(value) := object.union(base_cm, {"data": {required_key: value}})

test_deny_missing_data if {
	count(hasura_configmap.deny) > 0 with input as base_cm
}

test_deny_missing_required_key if {
	count(hasura_configmap.deny) > 0 with input as object.union(base_cm, {"data": {"OTHER": "foo"}})
}

test_deny_required_key_value_false if {
	count(hasura_configmap.deny) > 0 with input as with_data("false")
}

test_allow_required_key_string_true if {
	count(hasura_configmap.deny) == 0 with input as with_data("true")
}

test_allow_required_key_boolean_true if {
	count(hasura_configmap.deny) == 0 with input as with_data(true)
}

test_allow_required_key_uppercase_true if {
	count(hasura_configmap.deny) == 0 with input as with_data("TRUE")
}

test_allow_non_configmap if {
	count(hasura_configmap.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "x"},
	}
}
