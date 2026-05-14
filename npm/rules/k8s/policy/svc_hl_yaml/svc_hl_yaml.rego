# Порт пер-документної структурної перевірки `svc-hl.yaml` з
# `npm/scripts/check-k8s.mjs` (k8s.mdc): headless Service з суфіксом
# `metadata.name` `-hl` і `spec.clusterIP: None`.
#
# Запуск (локально, лише для одного svc-hl.yaml):
#   conftest test path/to/k8s/.../svc-hl.yaml -p npm/policy/k8s/svc_hl_yaml \
#     --namespace k8s.svc_hl_yaml
#
# JS authoritative (`check-k8s.mjs`: `serviceSvcHlYamlHeadlessViolation`,
# вибір файла `svc-hl.yaml` через walk).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.svc_hl_yaml

import rego.v1

svc_hl_name_suffix := "-hl"

name_suffix_template := concat(" ", [
	"Service metadata.name має закінчуватися на %q",
	"(svc-hl.yaml; зараз: %q; k8s.mdc)",
])

deny contains "Service: потрібні metadata.name з суфіксом -hl (svc-hl.yaml; k8s.mdc)" if {
	input.kind == "Service"
	not is_object(object.get(input, "metadata", null))
}

deny contains msg if {
	input.kind == "Service"
	meta := object.get(input, "metadata", null)
	is_object(meta)
	name := object.get(meta, "name", "")
	not endswith(name, svc_hl_name_suffix)
	msg := sprintf(name_suffix_template, [svc_hl_name_suffix, name])
}

deny contains "Service: додай spec.clusterIP: None (svc-hl.yaml; k8s.mdc)" if {
	input.kind == "Service"
	not is_object(object.get(input, "spec", null))
}

deny contains msg if {
	input.kind == "Service"
	spec := object.get(input, "spec", null)
	is_object(spec)
	cluster_ip := object.get(spec, "clusterIP", "<absent>")
	cluster_ip != "None"
	msg := sprintf("Service spec.clusterIP має бути None (headless, svc-hl.yaml; зараз: %v; k8s.mdc)", [cluster_ip])
}
