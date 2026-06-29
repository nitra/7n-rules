# Тести для `k8s.base_manifest`. Запуск:
#   conftest verify -p npm/policy/k8s/base_manifest --namespace k8s.base_manifest
package k8s.base_manifest_test

import rego.v1

import data.k8s.base_manifest

# ── metadata.namespace required ─────────────────────────────────────────

test_deny_namespaced_kind_without_metadata if {
	count(base_manifest.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
	}
}

test_deny_namespaced_kind_empty_namespace if {
	count(base_manifest.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "cm", "namespace": ""},
	}
}

test_allow_cluster_scoped_kind_without_namespace if {
	count(base_manifest.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Namespace",
		"metadata": {"name": "dev"},
	}
}

test_allow_namespaced_kind_with_namespace if {
	count(base_manifest.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "cm", "namespace": "dev"},
	}
}

# ── base canon resources ─────────────────────────────────────────────────

test_deny_deployment_cpu_not_base_canon if {
	count(base_manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "main",
			"image": "x",
			"resources": {"requests": {"cpu": "100m", "memory": "128Mi"}},
		}]}}},
	}
}

test_deny_deployment_memory_not_base_canon if {
	count(base_manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "main",
			"image": "x",
			"resources": {"requests": {"cpu": "0.02", "memory": "256Mi"}},
		}]}}},
	}
}

test_allow_deployment_with_base_canon_string if {
	count(base_manifest.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "main",
			"image": "x",
			"resources": {"requests": {"cpu": "0.02", "memory": "128Mi"}},
		}]}}},
	}
}

test_allow_deployment_with_base_canon_number_cpu if {
	count(base_manifest.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "main",
			"image": "x",
			"resources": {"requests": {"cpu": 0.02, "memory": "128mi"}},
		}]}}},
	}
}
