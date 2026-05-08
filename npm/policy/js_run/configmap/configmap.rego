# Порт перевірки `k8s/base/configmap.yaml` з `npm/scripts/check-js-run.mjs`
# (js-run.mdc) — `OTEL_RESOURCE_ATTRIBUTES` має містити `service.name=` і
# `service.namespace=`.
#
# Запуск (локально):
#   conftest test path/to/k8s/base/configmap.yaml -p npm/policy/js_run \
#     --namespace js_run.configmap
#
# Відповідність імені ConfigMap імені Deployment (cross-file) — у JS і `check-k8s.mjs`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_run.configmap

import rego.v1

# Шаблони повідомлень — через `concat` для regal style/line-length.
otel_service_name_template := concat(" ", [
	"ConfigMap %q: OTEL_RESOURCE_ATTRIBUTES має містити",
	"`service.name=` (js-run.mdc)",
])

otel_service_namespace_template := concat(" ", [
	"ConfigMap %q: OTEL_RESOURCE_ATTRIBUTES має містити",
	"`service.namespace=` (js-run.mdc)",
])

deny contains msg if {
	input.kind == "ConfigMap"
	otel := object.get(object.get(input, "data", {}), "OTEL_RESOURCE_ATTRIBUTES", "")
	otel != ""
	not contains(otel, "service.name=")
	msg := sprintf(otel_service_name_template, [cm_name])
}

deny contains msg if {
	input.kind == "ConfigMap"
	otel := object.get(object.get(input, "data", {}), "OTEL_RESOURCE_ATTRIBUTES", "")
	otel != ""
	not contains(otel, "service.namespace=")
	msg := sprintf(otel_service_namespace_template, [cm_name])
}

cm_name := object.get(object.get(input, "metadata", {}), "name", "?")
