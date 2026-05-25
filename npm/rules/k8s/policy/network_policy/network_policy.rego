# Пер-документна структурна перевірка NetworkPolicy.
# Cross-file (metadata.name = workload, podSelector.app = мітка app) — JS (validateNetworkPolicyForWorkload).
#
# Superset-перевірка egress/ingress: кожне правило з canonical snippet має бути
# присутнє у NetworkPolicy (extra-правила дозволені). Snippet передається через
# templateData при виклику runConftestBatch для k8s.network_policy:
#   data.template.snippet        — common.snippet.yaml (всі workload)
#   data.template.statefulset_snippet — statefulset.snippet.yaml (StatefulSet)
#
# Запуск (dev):
#   conftest test path/to/networkpolicy.yaml -p npm/rules/k8s/policy/network_policy \
#     --namespace k8s.network_policy --data <snippet-as-json>
package k8s.network_policy

import rego.v1

deny contains msg if {
	is_np_doc
	input.kind != "NetworkPolicy"
	msg := sprintf("kind має бути NetworkPolicy (зараз: %v) (k8s.mdc)", [input.kind])
}

deny contains msg if {
	is_np_doc
	input.apiVersion != "networking.k8s.io/v1"
	msg := sprintf("apiVersion має бути networking.k8s.io/v1 (зараз: %v) (k8s.mdc)", [input.apiVersion])
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

deny contains "spec.podSelector.matchLabels.app відсутній або порожній (NetworkPolicy; k8s.mdc)" if {
	is_np_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	selector := object.get(spec, "podSelector", null)
	is_object(selector)
	ml := object.get(selector, "matchLabels", null)
	is_object(ml)
	object.get(ml, "app", null) == null
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

# Superset-check: кожне canonical egress-правило (common.snippet.yaml) має бути присутнє.
deny contains msg if {
	is_np_doc
	is_object(object.get(input, "spec", null))
	some canon_rule in data.template.snippet.egress
	not list_contains(input.spec.egress, canon_rule)
	msg := sprintf(
		"NetworkPolicy %v: відсутнє обов'язкове egress-правило (common.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, json.marshal(canon_rule)],
	)
}

# Superset-check StatefulSet egress (statefulset.snippet.yaml).
deny contains msg if {
	is_np_doc
	input.metadata.annotations["nitra.dev/workload-kind"] == "StatefulSet"
	is_object(object.get(input, "spec", null))
	some canon_rule in data.template.statefulset_snippet.egress
	not list_contains(input.spec.egress, canon_rule)
	msg := sprintf(
		"NetworkPolicy %v (StatefulSet): відсутнє обов'язкове egress-правило (statefulset.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, json.marshal(canon_rule)],
	)
}

# Superset-check StatefulSet ingress (statefulset.snippet.yaml).
deny contains msg if {
	is_np_doc
	input.metadata.annotations["nitra.dev/workload-kind"] == "StatefulSet"
	is_object(object.get(input, "spec", null))
	some canon_rule in data.template.statefulset_snippet.ingress
	not list_contains(input.spec.ingress, canon_rule)
	msg := sprintf(
		"NetworkPolicy %v (StatefulSet): відсутнє обов'язкове ingress-правило (statefulset.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, json.marshal(canon_rule)],
	)
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

list_contains(items, item) if {
	is_array(items)
	some i
	items[i] == item
}
