# Тести для `k8s.svc_yaml`. Запуск:
#   conftest verify -p npm/policy/k8s/svc_yaml --namespace k8s.svc_yaml
package k8s.svc_yaml_test

import rego.v1

import data.k8s.svc_yaml

test_deny_service_missing_spec if {
	count(svc_yaml.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "api"},
	}
}

test_deny_service_wrong_type if {
	count(svc_yaml.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "api"},
		"spec": {"type": "LoadBalancer"},
	}
}

test_allow_service_clusterip if {
	count(svc_yaml.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "api"},
		"spec": {"type": "ClusterIP"},
	}
}

test_allow_non_service if {
	count(svc_yaml.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api"},
	}
}
