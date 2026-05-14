# Тести для `abie.base_deployment_preem`. Запуск:
#   conftest verify -p npm/policy/abie/base_deployment_preem
package abie.base_deployment_preem_test

import rego.v1

import data.abie.base_deployment_preem

mk_deployment(node_selector) := {
	"apiVersion": "apps/v1",
	"kind": "Deployment",
	"metadata": {"name": "api", "namespace": "dev"},
	"spec": {"template": {"spec": object.union(
		{"containers": [{"name": "main", "image": "x"}]},
		{"nodeSelector": node_selector},
	)}},
}

test_deny_no_node_selector if {
	input_doc := {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api"},
		"spec": {"template": {"spec": {"containers": [{"name": "main", "image": "x"}]}}},
	}
	count(base_deployment_preem.deny) > 0 with input as input_doc
}

test_deny_node_selector_without_preem if {
	count(base_deployment_preem.deny) > 0 with input as mk_deployment({"role": "worker"})
}

test_deny_preem_false if {
	count(base_deployment_preem.deny) > 0 with input as mk_deployment({"preem": false})
}

test_deny_preem_string_false if {
	count(base_deployment_preem.deny) > 0 with input as mk_deployment({"preem": "false"})
}

test_allow_preem_boolean_true if {
	count(base_deployment_preem.deny) == 0 with input as mk_deployment({"preem": true})
}

test_allow_preem_string_true if {
	count(base_deployment_preem.deny) == 0 with input as mk_deployment({"preem": "true"})
}

test_allow_preem_string_uppercase_true if {
	count(base_deployment_preem.deny) == 0 with input as mk_deployment({"preem": "TRUE"})
}

# Не Deployment — пакет не діє (дзеркало JS-предиката).
test_allow_non_deployment if {
	count(base_deployment_preem.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "x"},
	}
}
