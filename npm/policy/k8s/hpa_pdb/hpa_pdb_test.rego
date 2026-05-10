# Тести для `k8s.hpa_pdb`. Запуск:
#   conftest verify -p npm/policy/k8s/hpa_pdb --namespace k8s.hpa_pdb
package k8s.hpa_pdb_test

import rego.v1

import data.k8s.hpa_pdb

valid_hpa := {
	"apiVersion": "autoscaling/v2",
	"kind": "HorizontalPodAutoscaler",
	"metadata": {"name": "api"},
	"spec": {
		"scaleTargetRef": {"apiVersion": "apps/v1", "kind": "Deployment", "name": "api"},
		"minReplicas": 1,
		"maxReplicas": 1,
		"metrics": [{
			"type": "Resource",
			"resource": {"name": "cpu", "target": {"type": "Utilization", "averageUtilization": 75}},
		}],
		"behavior": {
			"scaleUp": {"policies": [{"type": "Pods", "value": 1, "periodSeconds": 60}]},
			"scaleDown": {"policies": [{"type": "Pods", "value": 1, "periodSeconds": 60}]},
		},
	},
}

valid_pdb := {
	"apiVersion": "policy/v1",
	"kind": "PodDisruptionBudget",
	"metadata": {"name": "api"},
	"spec": {
		"minAvailable": 1,
		"selector": {"matchLabels": {"app": "api"}},
	},
}

# ── HPA позитив / негатив ────────────────────────────────────────────────

test_allow_valid_hpa if {
	count(hpa_pdb.deny) == 0 with input as valid_hpa
}

test_deny_hpa_v1 if {
	count(hpa_pdb.deny) > 0 with input as object.union(valid_hpa, {"apiVersion": "autoscaling/v1"})
}

test_deny_hpa_missing_metrics if {
	bad := json.patch(valid_hpa, [{"op": "remove", "path": "/spec/metrics"}])
	count(hpa_pdb.deny) > 0 with input as bad
}

test_deny_hpa_empty_metrics if {
	bad := json.patch(valid_hpa, [{"op": "replace", "path": "/spec/metrics", "value": []}])
	count(hpa_pdb.deny) > 0 with input as bad
}

test_deny_hpa_missing_behavior if {
	bad := json.patch(valid_hpa, [{"op": "remove", "path": "/spec/behavior"}])
	count(hpa_pdb.deny) > 0 with input as bad
}

test_deny_hpa_empty_scale_up_policies if {
	bad := json.patch(valid_hpa, [{"op": "replace", "path": "/spec/behavior/scaleUp/policies", "value": []}])
	count(hpa_pdb.deny) > 0 with input as bad
}

test_deny_hpa_missing_scale_down if {
	bad := json.patch(valid_hpa, [{"op": "remove", "path": "/spec/behavior/scaleDown"}])
	count(hpa_pdb.deny) > 0 with input as bad
}

# ── PDB позитив / негатив ────────────────────────────────────────────────

test_allow_valid_pdb if {
	count(hpa_pdb.deny) == 0 with input as valid_pdb
}

test_deny_pdb_wrong_api_version if {
	bad := object.union(valid_pdb, {"apiVersion": "policy/v1beta1"})
	count(hpa_pdb.deny) > 0 with input as bad
}

test_deny_pdb_missing_selector if {
	bad := json.patch(valid_pdb, [{"op": "remove", "path": "/spec/selector"}])
	count(hpa_pdb.deny) > 0 with input as bad
}

test_deny_pdb_missing_match_labels if {
	bad := json.patch(valid_pdb, [{"op": "replace", "path": "/spec/selector", "value": {}}])
	count(hpa_pdb.deny) > 0 with input as bad
}

# Не той kind/apiVersion — пакет не діє.
test_allow_unrelated_manifest if {
	count(hpa_pdb.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "x"},
	}
}
