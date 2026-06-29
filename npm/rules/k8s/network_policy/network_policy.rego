# Пер-документна структурна перевірка NetworkPolicy.
# Cross-file (metadata.name = workload, podSelector.app = мітка app) — JS (validateNetworkPolicyForWorkload).
#
# Superset-перевірка egress/ingress: кожне правило з обраного canon-snippet'у
# має бути присутнє в input (extra-правила дозволені). Канон обирається за
# анотацією `nitra.dev/workload-kind`:
#   StatefulSet → data.template.stateful_set_snippet (повний канон з intra-replica)
#   решта      → data.template.deployment_snippet  (повний канон, default fallback)
#
# Обидва snippets — самодостатні (без merge на runtime).
#
# Snippets передаються через templateData при виклику runConftestBatch для k8s.network_policy.
#
# Запуск (dev):
#   conftest test path/to/networkpolicy.yaml -p npm/rules/k8s/policy/network_policy \
#     --namespace k8s.network_policy \
#     --data npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml \
#     --data npm/rules/k8s/policy/network_policy/template/stateful-set.snippet.yaml
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

# Superset-check egress: кожне канонічне правило має бути в input.spec.egress.
deny contains msg if {
	is_np_doc
	is_object(object.get(input, "spec", null))
	canon := canon_for_kind(workload_kind)
	some canon_rule in canon.egress
	not contains_item(object.get(input.spec, "egress", []), canon_rule)
	msg := sprintf(
		"NetworkPolicy %v: відсутнє обовʼязкове egress-правило (%v.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, snippet_name_for_kind(workload_kind), json.marshal(canon_rule)],
	)
}

# Superset-check ingress.
deny contains msg if {
	is_np_doc
	is_object(object.get(input, "spec", null))
	canon := canon_for_kind(workload_kind)
	some canon_rule in canon.ingress
	not contains_item(object.get(input.spec, "ingress", []), canon_rule)
	msg := sprintf(
		"NetworkPolicy %v: відсутнє обовʼязкове ingress-правило (%v.snippet.yaml; k8s.mdc): %v",
		[input.metadata.name, snippet_name_for_kind(workload_kind), json.marshal(canon_rule)],
	)
}

# Safety-net: allow-all `egress: [{}]` — заборонено навіть як extra-правило.
deny contains "spec.egress: заборонено allow-all {} — додавай явні правила (k8s.mdc)" if {
	is_np_doc
	some rule in object.get(input.spec, "egress", [])
	is_object(rule)
	count(object.keys(rule)) == 0
}

# Dispatch на повний canon-snippet за анотацією nitra.dev/workload-kind.
# StatefulSet → stateful_set_snippet (з intra-replica), решта → deployment_snippet.
canon_for_kind("StatefulSet") := data.template.stateful_set_snippet

canon_for_kind(kind) := data.template.deployment_snippet if {
	kind != "StatefulSet"
}

snippet_name_for_kind("StatefulSet") := "stateful-set"

snippet_name_for_kind(kind) := "deployment" if {
	kind != "StatefulSet"
}

workload_kind := object.get(object.get(input.metadata, "annotations", {}), "nitra.dev/workload-kind", "")

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

contains_item(items, item) if {
	is_array(items)
	some candidate in items
	candidate == item
}
