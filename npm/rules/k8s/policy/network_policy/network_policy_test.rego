package k8s.network_policy_test

import rego.v1

import data.k8s.network_policy

# Мінімальні mock'и канонів — достатні для перевірки superset-логіки.
# Не копія повного snippet'а; реальні дані передаються через templateData у runConftest.
mock_deployment_egress := [
	{
		"to": [{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}}, "podSelector": {"matchLabels": {"k8s-app": "kube-dns"}}}],
		"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}],
	},
	{
		"to": [{"ipBlock": {"cidr": "169.254.0.0/16"}}],
		"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}],
	},
]

mock_deployment_ingress := [{"from": [{"podSelector": {}}]}]

# Statefulset mock = deployment + intra-replica (повний канон).
mock_statefulset_egress := array.concat(mock_deployment_egress, [{"to": [{"podSelector": {"matchLabels": {}}}]}])

mock_statefulset_ingress := array.concat(mock_deployment_ingress, [{"from": [{"podSelector": {"matchLabels": {}}}]}])

mock_data := {"template": {
	"deployment_snippet": {"egress": mock_deployment_egress, "ingress": mock_deployment_ingress},
	"statefulset_snippet": {"egress": mock_statefulset_egress, "ingress": mock_statefulset_ingress},
}}

valid_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {"name": "api", "annotations": {"nitra.dev/workload-kind": "Deployment"}},
	"spec": {
		"podSelector": {"matchLabels": {"app": "api"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": mock_deployment_ingress,
		"egress": mock_deployment_egress,
	},
}

valid_ss_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {"name": "postgres", "annotations": {"nitra.dev/workload-kind": "StatefulSet"}},
	"spec": {
		"podSelector": {"matchLabels": {"app": "postgres"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": mock_statefulset_ingress,
		"egress": mock_statefulset_egress,
	},
}

test_valid_deployment_np if {
	count(network_policy.deny) == 0 with input as valid_np with data.template as mock_data.template
}

test_valid_statefulset_np if {
	count(network_policy.deny) == 0 with input as valid_ss_np with data.template as mock_data.template
}

test_wrong_kind if {
	bad := json.patch(valid_np, [{"op": "replace", "path": "/kind", "value": "Service"}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "kind має бути NetworkPolicy")
}

test_missing_match_labels if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels"}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "podSelector.matchLabels")
}

test_deny_missing_app_label if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels/app"}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "matchLabels.app")
}

test_deny_egress_empty if {
	bad := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": []}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "обовʼязкове egress-правило")
}

test_deny_egress_missing_link_local if {
	# Deployment без link-local (зберігаємо лише перше канонічне правило) → fail
	without_link_local := [mock_deployment_egress[0]]
	bad := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": without_link_local}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "169.254.0.0/16")
}

test_allow_extra_egress_rules if {
	# Deployment-канон + одне extra правило → 0 deny (superset дозволяє)
	extra_rule := {"to": [{"ipBlock": {"cidr": "10.20.0.0/24"}}], "ports": [{"protocol": "TCP", "port": 9000}]}
	extended := array.concat(mock_deployment_egress, [extra_rule])
	ok := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": extended}])
	count(network_policy.deny) == 0 with input as ok with data.template as mock_data.template
}

test_deny_statefulset_missing_intra_replica_egress if {
	# StatefulSet, але egress = тільки deployment (без intra-replica) → fail з посиланням на statefulset.snippet
	bad := json.patch(valid_ss_np, [{"op": "replace", "path": "/spec/egress", "value": mock_deployment_egress}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "statefulset.snippet.yaml")
}

test_deny_statefulset_missing_intra_replica_ingress if {
	bad := json.patch(valid_ss_np, [{"op": "replace", "path": "/spec/ingress", "value": mock_deployment_ingress}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "statefulset.snippet.yaml")
}

test_deny_allow_all_egress_blocked_by_safety_net if {
	bad := json.patch(valid_np, [{"op": "add", "path": "/spec/egress/-", "value": {}}])
	some msg in network_policy.deny with input as bad with data.template as mock_data.template
	contains(msg, "allow-all")
}

test_missing_annotation_falls_back_to_deployment_canon if {
	# Без анотації — canon_for_kind повертає deployment_snippet; valid_np має deployment-канон → 0 deny
	without_annotation := json.patch(valid_np, [{"op": "remove", "path": "/metadata/annotations"}])
	count(network_policy.deny) == 0 with input as without_annotation with data.template as mock_data.template
}
