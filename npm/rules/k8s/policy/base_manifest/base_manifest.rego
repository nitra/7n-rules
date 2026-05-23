# Порт пер-документних структурних перевірок для маніфестів у шарі
# `…/k8s/.../base/...` (k8s.mdc).
#
# Запуск (локально, лише для одного файлу під base/):
#   conftest test path/to/k8s/base/deployment.yaml -p npm/policy/k8s/base_manifest \
#     --namespace k8s.base_manifest
#
# JS відбирає файли під `…/k8s/.../base/…` (окрім `kustomization.yaml`) і
# викликає conftest з цією намеспейс. JS authoritative
# (`rules/k8s/fix.mjs`: `metadataNamespaceRequiredViolation` з `inBaseDir=true`,
# `deploymentResourcesViolation` з `inK8sBaseLayer=true`,
# `isK8sBaseManifestYamlPath`).
#
# Перевіряє:
#  - namespaced kind має непорожній `metadata.namespace` (cluster-scoped kind
#    і Kustomization/List виняток);
#  - Deployment у base має фіксовані `resources.requests.cpu == "0.02"` (або
#    число `0.02`) і `resources.requests.memory == "128Mi"` (case-insensitive
#    суфікс Mi).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.base_manifest

import rego.v1

# Cluster-scoped kind (не вимагають metadata.namespace) — узгоджено з
# `CLUSTER_SCOPED_KINDS` у `rules/k8s/fix.mjs`.
cluster_scoped_kinds := {
	"APIService",
	"CertificateSigningRequest",
	"ClusterCIDR",
	"ClusterRole",
	"ClusterRoleBinding",
	"ComponentStatus",
	"CSIDriver",
	"CSINode",
	"CustomResourceDefinition",
	"FlowSchema",
	"IPAddress",
	"IngressClass",
	"MutatingWebhookConfiguration",
	"Namespace",
	"Node",
	"PersistentVolume",
	"PriorityClass",
	"PriorityLevelConfiguration",
	"RuntimeClass",
	"ServiceCIDR",
	"StorageClass",
	"StorageVersionMigration",
	"ValidatingAdmissionPolicy",
	"ValidatingAdmissionPolicyBinding",
	"ValidatingWebhookConfiguration",
	"VolumeAttachment",
}

# Жорстко зафіксовані значення resources.requests у base-шарі (k8s.mdc).
base_cpu_request := "0.02"

base_memory_request := "128Mi"

base_metadata_missing_msg := concat(" ", [
	"додай metadata з непорожнім metadata.namespace —",
	"у k8s/base у кожному ресурсному YAML має бути явний namespace (k8s.mdc)",
])

base_namespace_required_msg := concat(" ", [
	"metadata.namespace обов'язковий у k8s/base —",
	"додай явний namespace у маніфесті (k8s.mdc)",
])

base_canon_cpu_template := concat(" ", [
	"контейнер %q: у k8s/.../base resources.requests.cpu має бути рівно %q",
	"(допускається число 0.02) — зараз %v (k8s.mdc)",
])

base_canon_memory_template := concat(" ", [
	"контейнер %q: у k8s/.../base resources.requests.memory має бути рівно %q",
	"(суфікс Mi без урахування регістру) — зараз %v (k8s.mdc)",
])

# ── deny: namespaced kind у base/ — обов'язковий metadata.namespace ──────

deny contains base_metadata_missing_msg if {
	is_namespaced_kind
	not is_object(object.get(input, "metadata", null))
}

deny contains base_namespace_required_msg if {
	is_namespaced_kind
	meta := object.get(input, "metadata", null)
	is_object(meta)
	ns := object.get(meta, "namespace", "")
	trim_space(ns) == ""
}

# ── deny: Deployment у base — точне cpu='0.02' / memory='128Mi' ──────────

deny contains msg if {
	input.kind == "Deployment"
	some container in deployment_all_containers
	cpu := object.get(object.get(container, "resources", {}), "requests", {}).cpu
	cpu != null
	not is_base_canon_cpu(cpu)
	msg := sprintf(base_canon_cpu_template, [container.name, base_cpu_request, cpu])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in deployment_all_containers
	mem := object.get(object.get(container, "resources", {}), "requests", {}).memory
	mem != null
	not is_base_canon_memory(mem)
	msg := sprintf(base_canon_memory_template, [container.name, base_memory_request, mem])
}

# ── helpers ───────────────────────────────────────────────────────────────

# Це namespaced ресурс, на який має застосовуватись правило metadata.namespace.
is_namespaced_kind if {
	is_string(input.kind)
	input.kind != ""
	input.kind != "List"
	input.kind != "Kustomization"
	is_string(input.apiVersion)
	input.apiVersion != ""
	not input.kind in cluster_scoped_kinds
}

deployment_all_containers contains container if {
	some container in object.get(object.get(input.spec.template, "spec", {}), "containers", [])
}

deployment_all_containers contains container if {
	some container in object.get(object.get(input.spec.template, "spec", {}), "initContainers", [])
}

# Канон cpu='0.02' — рядок (точно "0.02") або число 0.02.
is_base_canon_cpu(v) if {
	is_string(v)
	trim_space(v) == base_cpu_request
}

is_base_canon_cpu(v) if {
	is_number(v)
	v == 0.02
}

# Канон memory='128Mi' (суфікс Mi без урахування регістру).
is_base_canon_memory(v) if {
	is_string(v)
	lower(trim_space(v)) == "128mi"
}
