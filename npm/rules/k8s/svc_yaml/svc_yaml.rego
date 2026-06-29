# Порт пер-документної структурної перевірки `svc.yaml` з
# `npm/scripts/rules/k8s/fix.mjs` (k8s.mdc): `Service` у файлі `svc.yaml` має
# мати `spec.type: ClusterIP`.
#
# Запуск (локально, лише для одного svc.yaml):
#   conftest test path/to/k8s/.../svc.yaml -p npm/policy/k8s/svc_yaml \
#     --namespace k8s.svc_yaml
#
# JS authoritative (`rules/k8s/fix.mjs`: `serviceSvcYamlClusterIpTypeViolation`,
# вибір файла `svc.yaml` через walk). Цю Rego JS викликає окремою таргет-командою
# лише для basename == `svc.yaml`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.svc_yaml

import rego.v1

deny contains "Service: додай spec.type: ClusterIP (svc.yaml; k8s.mdc)" if {
	input.kind == "Service"
	not is_object(object.get(input, "spec", null))
}

deny contains msg if {
	input.kind == "Service"
	spec := object.get(input, "spec", null)
	is_object(spec)
	type_value := object.get(spec, "type", "<absent>")
	type_value != "ClusterIP"
	msg := sprintf("Service spec.type має бути ClusterIP (svc.yaml; зараз: %v; k8s.mdc)", [type_value])
}
