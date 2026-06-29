# Тести для `k8s.kustomization`. Запуск:
#   conftest verify -p npm/policy/k8s/kustomization --namespace k8s.kustomization
package k8s.kustomization_test

import rego.v1

import data.k8s.kustomization

base_kust := {
	"apiVersion": "kustomize.config.k8s.io/v1beta1",
	"kind": "Kustomization",
}

# ── resources sort ───────────────────────────────────────────────────────

test_deny_resources_unsorted if {
	count(kustomization.deny) > 0 with input as object.union(base_kust, {"resources": [
		"deployment.yaml",
		"configmap.yaml",
	]})
}

test_allow_resources_sorted if {
	count(kustomization.deny) == 0 with input as object.union(base_kust, {"resources": [
		"configmap.yaml",
		"deployment.yaml",
	]})
}

test_allow_resources_case_insensitive_sorted if {
	count(kustomization.deny) == 0 with input as object.union(base_kust, {"resources": [
		"AAA.yaml",
		"bbb.yaml",
		"CCC.yaml",
	]})
}

test_deny_resources_not_array if {
	count(kustomization.deny) > 0 with input as object.union(base_kust, {"resources": "string-not-array"})
}

test_deny_resources_item_not_string if {
	count(kustomization.deny) > 0 with input as object.union(base_kust, {"resources": [
		"a.yaml",
		{"obj": "not allowed"},
	]})
}

# ── patches sort ─────────────────────────────────────────────────────────

test_deny_patches_unsorted_by_kind_name if {
	count(kustomization.deny) > 0 with input as object.union(base_kust, {"patches": [
		{"target": {"kind": "Deployment", "name": "z"}},
		{"target": {"kind": "Deployment", "name": "a"}},
	]})
}

test_allow_patches_sorted_by_kind_name if {
	count(kustomization.deny) == 0 with input as object.union(base_kust, {"patches": [
		{"target": {"kind": "Deployment", "name": "a"}},
		{"target": {"kind": "Deployment", "name": "z"}},
	]})
}

test_deny_patches_not_array if {
	count(kustomization.deny) > 0 with input as object.union(base_kust, {"patches": "string-not-array"})
}

# ── JSON6902 remove+add conflict ─────────────────────────────────────────

test_deny_json6902_remove_and_add_same_path if {
	patch_text := concat("\n", [
		"- op: remove",
		"  path: /spec/replicas",
		"- op: add",
		"  path: /spec/replicas",
		"  value: 3",
	])
	count(kustomization.deny) > 0 with input as object.union(base_kust, {"patches": [{
		"target": {"kind": "Deployment", "name": "api"},
		"patch": patch_text,
	}]})
}

test_allow_json6902_replace_same_path if {
	patch_text := concat("\n", [
		"- op: replace",
		"  path: /spec/replicas",
		"  value: 3",
	])
	count(kustomization.deny) == 0 with input as object.union(base_kust, {"patches": [{
		"target": {"kind": "Deployment", "name": "api"},
		"patch": patch_text,
	}]})
}

test_allow_json6902_remove_and_add_different_paths if {
	patch_text := concat("\n", [
		"- op: remove",
		"  path: /spec/replicas",
		"- op: add",
		"  path: /spec/strategy",
		"  value: {}",
	])
	count(kustomization.deny) == 0 with input as object.union(base_kust, {"patches": [{
		"target": {"kind": "Deployment", "name": "api"},
		"patch": patch_text,
	}]})
}

# Маніфест не Kustomization — правила не діють.
test_allow_non_kustomization if {
	count(kustomization.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "ConfigMap",
		"metadata": {"name": "x"},
		"data": {"key": "value"},
	}
}

# Не той apiVersion — правила не діють.
test_allow_kustomization_other_api_version if {
	count(kustomization.deny) == 0 with input as {
		"apiVersion": "other.example.com/v1",
		"kind": "Kustomization",
		"resources": ["z.yaml", "a.yaml"],
	}
}
