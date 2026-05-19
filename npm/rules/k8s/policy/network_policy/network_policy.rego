# Пер-документна структурна перевірка NetworkPolicy (k8s.mdc).
# Cross-file (metadata.name = workload, podSelector.app = мітка app) — JS
# (`networkPolicyManifestViolations`, `validateNetworkPolicyForWorkload`).
#
# Канон egress: kube-dns; TCP 80/443 на 0.0.0.0/0; інші порти — namespaceSelector: {}
# (in-cluster, зокрема *.svc). Заборонено egress: [{}] (allow-all).
#
# Запуск:
#   conftest test path/to/networkpolicy.yaml -p npm/policy/k8s/network_policy \
#     --namespace k8s.network_policy
package k8s.network_policy

import rego.v1

np_kind_template := "kind має бути NetworkPolicy (зараз: %v) (k8s.mdc)"

np_api_template := "apiVersion має бути networking.k8s.io/v1 (зараз: %v) (k8s.mdc)"

deny contains msg if {
	is_np_doc
	input.kind != "NetworkPolicy"
	msg := sprintf(np_kind_template, [input.kind])
}

deny contains msg if {
	is_np_doc
	input.apiVersion != "networking.k8s.io/v1"
	msg := sprintf(np_api_template, [input.apiVersion])
}

deny contains "spec відсутній або некоректний (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	not is_object(object.get(input, "spec", null))
}

deny contains "spec.podSelector.matchLabels відсутній (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	selector := object.get(spec, "podSelector", null)
	is_object(selector)
	not is_object(object.get(selector, "matchLabels", null))
}

deny contains "spec.policyTypes має містити Ingress і Egress (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	types := object.get(spec, "policyTypes", [])
	not policy_types_has_ingress_and_egress(types)
}

deny contains "spec.ingress має містити from.podSelector (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not ingress_has_pod_selector_rule(spec)
}

deny contains "spec.egress має бути непорожнім масивом (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not is_non_empty_array(object.get(spec, "egress", null))
}

deny contains "spec.egress: заборонено allow-all {} — канон k8s.mdc (80/443 назовні, інше — in-cluster)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	egress_allows_all(object.get(spec, "egress", null))
}

deny contains "spec.egress: потрібен ipBlock 0.0.0.0/0 з ports 80 і 443 (HTTP/HTTPS назовні; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not egress_has_internet_http_https(spec)
}

deny contains "spec.egress: потрібен to.namespaceSelector: {} (інші порти лише in-cluster / *.svc; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not egress_has_cluster_namespace_selector(spec)
}

deny contains "spec.egress: to.namespaceSelector: {} мусить мати непорожні ports — catch-all заборонено (k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	cluster_egress_rule_without_ports(spec)
}

is_np_doc if input.kind == "NetworkPolicy"

is_np_doc if startswith(object.get(input, "apiVersion", ""), "networking.k8s.io/")

policy_types_has_ingress_and_egress(types) if {
	is_array(types)
	"Ingress" in types
	"Egress" in types
}

ingress_has_pod_selector_rule(spec) if {
	ingress := object.get(spec, "ingress", null)
	is_array(ingress)
	some rule in ingress
	is_object(rule)
	from_list := object.get(rule, "from", null)
	is_array(from_list)
	some peer in from_list
	is_object(peer)
	object.get(peer, "podSelector", null) != null
}

is_non_empty_array(x) if {
	is_array(x)
	count(x) > 0
}

egress_allows_all(egress) if {
	is_array(egress)
	some rule in egress
	is_object(rule)
	count(object.keys(rule)) == 0
}

egress_has_internet_http_https(spec) if {
	egress := object.get(spec, "egress", null)
	is_array(egress)
	some rule in egress
	is_object(rule)
	to_list := object.get(rule, "to", null)
	is_array(to_list)
	some peer in to_list
	is_object(peer)
	ipb := object.get(peer, "ipBlock", null)
	is_object(ipb)
	ipb.cidr == "0.0.0.0/0"
	ports := object.get(rule, "ports", null)
	is_array(ports)
	egress_ports_include(ports, 80)
	egress_ports_include(ports, 443)
}

egress_ports_include(ports, want) if {
	some p in ports
	is_object(p)
	p.port == want
}

egress_has_cluster_namespace_selector(spec) if {
	egress := object.get(spec, "egress", null)
	is_array(egress)
	some rule in egress
	is_object(rule)
	to_list := object.get(rule, "to", null)
	is_array(to_list)
	some peer in to_list
	is_object(peer)
	ns := object.get(peer, "namespaceSelector", null)
	is_object(ns)
	count(ns) == 0
}

cluster_egress_rule_without_ports(spec) if {
	egress := object.get(spec, "egress", null)
	is_array(egress)
	some rule in egress
	is_object(rule)
	to_list := object.get(rule, "to", null)
	is_array(to_list)
	some peer in to_list
	is_object(peer)
	ns := object.get(peer, "namespaceSelector", null)
	is_object(ns)
	count(ns) == 0
	ports := object.get(rule, "ports", [])
	count(ports) == 0
}
