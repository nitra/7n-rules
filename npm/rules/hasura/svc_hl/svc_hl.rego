# Іменування Service у `hasura/k8s/base/svc.yaml` та `svc-hl.yaml`, узгоджене з
# `k8s.svc_hl_yaml` / `k8s.svc_yaml` (пара clusterIP + headless під `k8s/**/`).
#
# Hasura-конвенція: базовий сегмент закінчується на `-h`; headless додає `-hl`
# → повне ім'я `*-h-hl` (також задовольняє k8s-вимогу суфікса `-hl`).
#
# Запуск (локально):
#   conftest test hasura/k8s/base/svc-hl.yaml -p npm/rules/hasura/policy/svc_hl \
#     --namespace hasura.svc_hl
#
# Cross-file (`HASURA_GRAPHQL_ENDPOINT` ↔ YAML) — `js/internal_urls.mjs`.
package hasura.svc_hl

import rego.v1

# Суфікс clusterIP Service у hasura/k8s/base (і база для пари з svc-hl.yaml).
hasura_cluster_suffix := "-h"

# Headless: `<cluster-name>-hl`, напр. `db-h` → `db-h-hl`.
hasura_headless_suffix := "-h-hl"

service_is_headless if {
	input.kind == "Service"
	spec := object.get(input, "spec", {})
	is_object(spec)
	spec.clusterIP == "None"
}

deny contains msg if {
	service_is_headless
	name := object.get(object.get(input, "metadata", {}), "name", "")
	name != ""
	not endswith(name, hasura_headless_suffix)
	msg := sprintf(
		"hasura svc-hl.yaml: headless Service %q має закінчуватись на `%s` (узгоджено з k8s.svc_hl_yaml `-hl`; hasura.mdc)",
		[name, hasura_headless_suffix],
	)
}

deny contains msg if {
	input.kind == "Service"
	not service_is_headless
	name := object.get(object.get(input, "metadata", {}), "name", "")
	name != ""
	not endswith(name, hasura_cluster_suffix)
	msg := sprintf(
		"hasura svc.yaml: clusterIP Service %q має закінчуватись на `%s` (hasura.mdc / k8s.mdc)",
		[name, hasura_cluster_suffix],
	)
}
