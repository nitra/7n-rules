# Порт перевірки `k8s/base/kustomization.yaml` з `npm/scripts/check-k8s.mjs`
# (k8s.mdc): у base-kustomization обов'язково має бути непорожнє поле
# `namespace:`.
#
# Запуск (локально, лише для одного `k8s/base/kustomization.yaml`):
#   conftest test path/to/k8s/base/kustomization.yaml \
#     -p npm/policy/k8s/base_kustomization \
#     --namespace k8s.base_kustomization
#
# JS authoritative (`check-k8s.mjs`: `baseKustomizationNamespaceViolation`,
# `isBaseKustomizationPath` для відбору файла, `ensureBaseKustomizationHasNamespace`
# як оркестратор).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.base_kustomization

import rego.v1

base_namespace_required_msg := concat(" ", [
	"у base/kustomization.yaml завжди додай непорожній namespace:",
	"(наприклад namespace: dev; k8s.mdc)",
])

deny contains base_namespace_required_msg if {
	is_kustomization
	not is_string(object.get(input, "namespace", null))
}

deny contains base_namespace_required_msg if {
	is_kustomization
	ns := object.get(input, "namespace", "")
	is_string(ns)
	trim_space(ns) == ""
}

is_kustomization if {
	input.kind == "Kustomization"
	startswith(object.get(input, "apiVersion", ""), "kustomize.config.k8s.io/")
}
