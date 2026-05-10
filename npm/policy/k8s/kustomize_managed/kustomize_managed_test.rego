# Тести для `k8s.kustomize_managed`. Запуск:
#   conftest verify -p npm/policy/k8s/kustomize_managed --namespace k8s.kustomize_managed
package k8s.kustomize_managed_test

import rego.v1

import data.k8s.kustomize_managed

test_deny_metadata_with_namespace if {
	count(kustomize_managed.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "cm", "namespace": "dev"},
	}
}

test_allow_metadata_without_namespace if {
	count(kustomize_managed.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "cm"},
	}
}

test_allow_no_metadata if {
	count(kustomize_managed.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
	}
}
