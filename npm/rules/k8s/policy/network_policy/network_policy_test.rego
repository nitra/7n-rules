package k8s.network_policy_test

import rego.v1

import data.k8s.network_policy

valid_np := {
	"apiVersion": "networking.k8s.io/v1",
	"kind": "NetworkPolicy",
	"metadata": {"name": "api"},
	"spec": {
		"podSelector": {"matchLabels": {"app": "api"}},
		"policyTypes": ["Ingress", "Egress"],
		"ingress": [{"from": [{"podSelector": {}}]}],
		"egress": [
			{
				"to": [{
					"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}},
					"podSelector": {"matchLabels": {"k8s-app": "kube-dns"}},
				}],
				"ports": [
					{"protocol": "UDP", "port": 53},
					{"protocol": "TCP", "port": 53},
				],
			},
			{
				"to": [{"ipBlock": {"cidr": "0.0.0.0/0"}}],
				"ports": [
					{"protocol": "TCP", "port": 80},
					{"protocol": "TCP", "port": 443},
				],
			},
			{
				"to": [{"namespaceSelector": {}}],
				"ports": [
					{"protocol": "TCP", "port": 80},
					{"protocol": "TCP", "port": 443},
					{"protocol": "TCP", "port": 5432},
					{"protocol": "TCP", "port": 3306},
					{"protocol": "TCP", "port": 1433},
					{"protocol": "TCP", "port": 6379},
					{"protocol": "TCP", "port": 8080},
					{"protocol": "TCP", "port": 4317},
					{"protocol": "TCP", "port": 4318},
				],
			},
		],
	},
}

test_valid_network_policy if {
	count(network_policy.deny) == 0 with input as valid_np
}

test_wrong_kind if {
	bad := json.patch(valid_np, [{"op": "replace", "path": "/kind", "value": "Service"}])
	some msg in network_policy.deny with input as bad
	contains(msg, "kind має бути NetworkPolicy")
}

test_missing_match_labels if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/podSelector/matchLabels"}])
	some msg in network_policy.deny with input as bad
	contains(msg, "podSelector.matchLabels")
}

test_deny_egress_allow_all if {
	bad := json.patch(valid_np, [{"op": "replace", "path": "/spec/egress", "value": [{}]}])
	some msg in network_policy.deny with input as bad
	contains(msg, "allow-all")
}

test_deny_missing_internet_ports if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/egress/1"}])
	some msg in network_policy.deny with input as bad
	contains(msg, "80")
}

test_deny_missing_cluster_egress if {
	bad := json.patch(valid_np, [{"op": "remove", "path": "/spec/egress/2"}])
	some msg in network_policy.deny with input as bad
	contains(msg, "namespaceSelector")
}

test_deny_cluster_egress_catch_all if {
	bad := json.patch(valid_np, [{
		"op": "replace",
		"path": "/spec/egress/2",
		"value": {"to": [{"namespaceSelector": {}}]},
	}])
	some msg in network_policy.deny with input as bad
	contains(msg, "catch-all")
}
