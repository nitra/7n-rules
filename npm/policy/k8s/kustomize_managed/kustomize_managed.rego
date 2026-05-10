# Порт перевірки `metadataNamespaceForbiddenViolation` з
# `npm/scripts/check-k8s.mjs` (k8s.mdc): для файлів, які підключено до якогось
# `kustomization.yaml` через `resources` / `patches` / `…`, поле
# `metadata.namespace` забороняється — namespace задає сам kustomization.
#
# Запуск (локально, лише для одного kustomize-managed YAML):
#   conftest test path/to/manifest.yaml -p npm/policy/k8s/kustomize_managed \
#     --namespace k8s.kustomize_managed
#
# JS відбирає kustomize-managed файли через `collectKustomizeManagedRelPaths`
# і викликає conftest з цією намеспейс. JS authoritative
# (`check-k8s.mjs`: `metadataNamespaceForbiddenViolation`,
# `failIfK8sPolicyNamespaceRulesViolated`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.kustomize_managed

import rego.v1

namespace_forbidden_msg := concat(" ", [
	"metadata.namespace заборонено — namespace задає kustomization.yaml",
	"(поле namespace); файл підключено через resources / patches / …",
	"(k8s.mdc)",
])

deny contains namespace_forbidden_msg if {
	meta := object.get(input, "metadata", null)
	is_object(meta)
	"namespace" in object.keys(meta)
}
