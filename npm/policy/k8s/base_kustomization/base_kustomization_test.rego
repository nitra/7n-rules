# Тести для `k8s.base_kustomization`. Запуск:
#   conftest verify -p npm/policy/k8s/base_kustomization --namespace k8s.base_kustomization
package k8s.base_kustomization_test

import rego.v1

import data.k8s.base_kustomization

base_kust := {
	"apiVersion": "kustomize.config.k8s.io/v1beta1",
	"kind": "Kustomization",
}

test_deny_missing_namespace if {
	count(base_kustomization.deny) > 0 with input as base_kust
}

test_deny_empty_namespace if {
	count(base_kustomization.deny) > 0 with input as object.union(base_kust, {"namespace": ""})
}

test_deny_whitespace_namespace if {
	count(base_kustomization.deny) > 0 with input as object.union(base_kust, {"namespace": "   "})
}

test_allow_with_namespace if {
	count(base_kustomization.deny) == 0 with input as object.union(base_kust, {"namespace": "dev"})
}

test_allow_non_kustomization if {
	count(base_kustomization.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "cm"},
	}
}
