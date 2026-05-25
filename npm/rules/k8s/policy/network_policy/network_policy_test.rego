package k8s.network_policy_test

import rego.v1

import data.k8s.network_policy

# Мінімальний mock data.template — достатній для перевірки superset-логіки.
# Навмисно простий: не копія реального snippet.
mock_common_egress := [
	{
		"to": [{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}}, "podSelector": {"matchLabels": {"k8s-app": "kube-dns"}}}],
		"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}],
	},
	{
		"to": [{"ipBlock": {"cidr": "169.254.0.0/16"}}],
		"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}],
	},
]

mock_ss_egress := [{"to": [{"podSelector": {"matchLabels": {}}}]}]

mock_ss_ingress := [{"from": [{"podSelector": {"matchLabels": {}}}]}]

valid_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {"name": "api", "annotations": {}},
	"spec": {
		"podSelector": {"matchLabels": {"app": "api"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": [{"from": [{"podSelector": {}}]}],
		"egress": mock_common_egress,
	},
}

valid_ss_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {"name": "postgres", "annotations": {"nitra.dev/workload-kind": "StatefulSet"}},
	"spec": {
		"podSelector": {"matchLabels": {"app": "postgres"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": array.concat([{"from": [{"podSelector": {}}]}], mock_ss_ingress),
		"egress": array.concat(mock_common_egress, mock_ss_egress),
	},
}

test_valid_network_policy if {
	count(network_policy.deny) == 0 with input as valid_np
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
}

test_valid_statefulset_network_policy if {
	count(network_policy.deny) == 0 with input as valid_ss_np
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
}

test_wrong_kind if {
	bad := json.patch(valid_np, [{"op": "replace", "path": "/kind", "value": "Service"}])
	some msg in network_policy.deny with input as bad
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
	contains(msg, "kind має бути NetworkPolicy")
}

test_missing_match_labels if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels"}])
	some msg in network_policy.deny with input as bad
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
	contains(msg, "podSelector.matchLabels")
}

test_deny_missing_app_label if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels/app"}])
	some msg in network_policy.deny with input as bad
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
	contains(msg, "matchLabels.app")
}

test_deny_egress_not_matching_snippet if {
	# Egress порожній — не містить жодного canonical правила
	bad := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": []}])
	some msg in network_policy.deny with input as bad
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
	contains(msg, "відсутнє обов'язкове egress-правило")
}

test_deny_egress_missing_link_local if {
	# Egress без link-local блоку (169.254.0.0/16) — не відповідає canonical
	without_link_local := [mock_common_egress[0]]
	bad := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": without_link_local}])
	some msg in network_policy.deny with input as bad
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
	contains(msg, "169.254.0.0/16")
}

test_allow_extra_egress_rules if {
	# Extra правило не викликає deny — superset дозволяє розширення
	extra_rule := {"to": [{"ipBlock": {"cidr": "10.20.0.0/24"}}], "ports": [{"protocol": "TCP", "port": 9000}]}
	extended := array.concat(mock_common_egress, [extra_rule])
	ok := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": extended}])
	count(network_policy.deny) == 0 with input as ok
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
}

test_deny_statefulset_missing_ss_egress if {
	# StatefulSet NP без intra-replica egress — deny
	bad := json.patch(valid_ss_np, [{"op": "replace", "path": "/spec/egress", "value": mock_common_egress}])
	some msg in network_policy.deny with input as bad
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
	contains(msg, "StatefulSet")
}

test_deny_statefulset_missing_ss_ingress if {
	# StatefulSet NP без intra-replica ingress — deny
	bad_ingress := [{"from": [{"podSelector": {}}]}]
	bad := json.patch(valid_ss_np, [{"op": "replace", "path": "/spec/ingress", "value": bad_ingress}])
	some msg in network_policy.deny with input as bad
		with data.template.snippet.egress as mock_common_egress
		with data.template.statefulset_snippet.egress as mock_ss_egress
		with data.template.statefulset_snippet.ingress as mock_ss_ingress
	contains(msg, "StatefulSet")
}
