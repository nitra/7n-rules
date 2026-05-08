# Порт пер-документних структурних перевірок з `npm/scripts/check-k8s.mjs`
# (k8s.mdc). Цей пакет описує лише ті правила, що дивляться на ОДИН манифест
# (один YAML-документ): conftest за замовчуванням розрізає файли по `---` і
# запускає policy на кожен документ окремо.
#
# Запуск (локально, по одному файлу або по дереву):
#   conftest test path/to/k8s/manifest.yaml -p npm/policy/k8s \
#     --namespace k8s.manifest
#
# Перевіряє:
#  - `kind: Ingress` заборонено (потрібен перехід на Gateway API);
#  - `apiVersion: autoscaling/v1` заборонено (HPA → autoscaling/v2);
#  - `kind: Service` без `cloud.google.com/neg` /
#    `cloud.google.com/backend-config` в `metadata.annotations` (k8s.mdc);
#  - `kind: Deployment` — у кожного контейнера спільно `containers` +
#    `initContainers` має бути `resources.requests.cpu` (рядок на кшталт
#    `"500m"` чи число), без порожнього значення.
#
# CROSS-FILE логіка (Kustomize-резолюція ресурсів, парність svc.yaml/svc-hl.yaml,
# HPA/PDB/topologySpreadConstraints за каталогом, BackendConfig-сепарація,
# yaml-language-server schema modeline, namespace-перевірки за деревом
# `…/k8s/base/`) лишається у `check-k8s.mjs`: вона потребує файлової системи.
# JS authoritative (`check-k8s.mjs` робить ці ж пер-документні перевірки в ширшому
# контексті); ця Rego — швидкий gate для одиничного маніфеста.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package k8s.manifest

import rego.v1

default_cpu_request := "0.5"

forbidden_service_annotations := {
	"cloud.google.com/neg",
	"cloud.google.com/backend-config",
}

ingress_template := concat(" ", [
	"знайдено kind: Ingress — заміни на Gateway API:",
	"HTTPRoute (hr.yaml), HealthCheckPolicy (hc.yaml) (k8s.mdc)",
])

autoscaling_v1_template := concat(" ", [
	"знайдено apiVersion: autoscaling/v1 (kind: %s) —",
	"мігруй на autoscaling/v2 (k8s.mdc)",
])

cpu_missing_template := concat(" ", [
	"Deployment %q, контейнер %q: відсутнє resources.requests.cpu —",
	"додай (за замовчуванням %s) (k8s.mdc)",
])

cpu_empty_template := concat(" ", [
	"Deployment %q, контейнер %q: resources.requests.cpu має бути непорожнім",
	"значенням (наприклад \"500m\") (зараз: %v) (k8s.mdc)",
])

# ── deny: заборонені kind/apiVersion ──────────────────────────────────────

deny contains ingress_template if {
	input.kind == "Ingress"
}

deny contains msg if {
	input.apiVersion == "autoscaling/v1"
	msg := sprintf(autoscaling_v1_template, [object.get(input, "kind", "<no-kind>")])
}

# ── deny: заборонені анотації Service ─────────────────────────────────────

deny contains msg if {
	input.kind == "Service"
	annotations := object.get(object.get(input, "metadata", {}), "annotations", {})
	some forbidden_key in forbidden_service_annotations
	forbidden_key in object.keys(annotations)
	msg := sprintf("Service %q: видали анотацію %q (k8s.mdc)", [input.metadata.name, forbidden_key])
}

# ── deny: Deployment — у кожного контейнера resources.requests.cpu ────────
#
# Дві гілки: відсутнє/null поле cpu (повідомлення про додавання) і явно
# присутнє, але порожнє/невалідне значення (повідомлення з підставленим value).

deny contains msg if {
	input.kind == "Deployment"
	some container in deployment_all_containers
	not has_non_empty_cpu_request(container)
	not has_cpu_field(container)
	msg := sprintf(cpu_missing_template, [deployment_name, container.name, default_cpu_request])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in deployment_all_containers
	not has_non_empty_cpu_request(container)
	has_cpu_field(container)
	cpu := container.resources.requests.cpu
	msg := sprintf(cpu_empty_template, [deployment_name, container.name, cpu])
}

# ── helpers ────────────────────────────────────────────────────────────────

deployment_name := object.get(object.get(input, "metadata", {}), "name", "<no-name>")

# Усі контейнери (звичайні + ініт) Deployment-а — для перевірки CPU.
deployment_all_containers contains container if {
	some container in object.get(object.get(input.spec.template, "spec", {}), "containers", [])
}

deployment_all_containers contains container if {
	some container in object.get(object.get(input.spec.template, "spec", {}), "initContainers", [])
}

# Чи у контейнера є непорожнє resources.requests.cpu (рядок або число > 0).
has_non_empty_cpu_request(container) if {
	cpu := container.resources.requests.cpu
	is_string(cpu)
	trim_space(cpu) != ""
}

has_non_empty_cpu_request(container) if {
	cpu := container.resources.requests.cpu
	is_number(cpu)
	cpu > 0
}

# Чи у контейнера в реальності присутнє поле resources.requests.cpu (хай і порожнє).
has_cpu_field(container) if {
	_ := container.resources.requests.cpu
}
