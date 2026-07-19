# Перевірка ConfigMap (js-run.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/configmap.yaml.contains.yml.
# Контекст: kind=ConfigMap; OTEL_RESOURCE_ATTRIBUTES має містити кожен substring
# зі snippet (`service.name=`, `service.namespace=`).
package js_run.configmap

import rego.v1

deny contains msg if {
	input.kind == "ConfigMap"
	some field, needles in data.template.contains.data
	actual := object.get(object.get(input, "data", {}), field, "")
	actual != ""
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("ConfigMap %q: %s має містити %q (js-run.mdc)", [cm_name, field, needle])
}

cm_name := object.get(object.get(input, "metadata", {}), "name", "?")
