# Тести для `k8s.svc_hl_yaml`. Запуск:
#   conftest verify -p npm/policy/k8s/svc_hl_yaml --namespace k8s.svc_hl_yaml
package k8s.svc_hl_yaml_test

import rego.v1

import data.k8s.svc_hl_yaml

test_deny_service_name_without_hl if {
	count(svc_hl_yaml.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "api"},
		"spec": {"clusterIP": "None"},
	}
}

test_deny_service_clusterip_not_none if {
	count(svc_hl_yaml.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "api-hl"},
		"spec": {"clusterIP": "1.2.3.4"},
	}
}

test_allow_headless_service if {
	count(svc_hl_yaml.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "api-hl"},
		"spec": {"clusterIP": "None"},
	}
}

test_allow_non_service if {
	count(svc_hl_yaml.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api"},
	}
}
