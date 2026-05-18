# Тести для `hasura.svc_hl`. Запуск:
#   conftest verify -p npm/rules/hasura/policy/svc_hl --namespace hasura.svc_hl
package hasura.svc_hl_test

import rego.v1

import data.hasura.svc_hl

test_deny_headless_without_h_hl_suffix if {
	count(svc_hl.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "contract-h"},
		"spec": {"clusterIP": "None"},
	}
}

test_allow_headless_h_hl if {
	count(svc_hl.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "db-h-hl"},
		"spec": {"clusterIP": "None"},
	}
}

test_deny_cluster_without_h_suffix if {
	count(svc_hl.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "db-h-hl"},
		"spec": {"type": "ClusterIP"},
	}
}

test_allow_cluster_h_suffix if {
	count(svc_hl.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {"name": "db-h"},
		"spec": {"type": "ClusterIP"},
	}
}

test_allow_non_service if {
	count(svc_hl.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Namespace",
		"metadata": {"name": "dev"},
	}
}
