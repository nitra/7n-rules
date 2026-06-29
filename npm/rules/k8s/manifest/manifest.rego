# Порт пер-документних структурних перевірок з `npm/scripts/rules/k8s/fix.mjs`
# (k8s.mdc). Цей пакет описує лише ті правила, що дивляться на ОДИН манифест
# (один YAML-документ): conftest за замовчуванням розрізає файли по `---` і
# запускає policy на кожен документ окремо.
#
# Запуск (локально, по одному файлу або по дереву):
#   conftest test path/to/k8s/manifest.yaml -p npm/policy/k8s/manifest \
#     --namespace k8s.manifest
#
# Перевіряє:
#  - `kind: Ingress` заборонено (потрібен перехід на Gateway API);
#  - `apiVersion: autoscaling/v1` заборонено (HPA → autoscaling/v2);
#  - `kind: Service` без `cloud.google.com/neg` /
#    `cloud.google.com/backend-config` в `metadata.annotations` (k8s.mdc);
#  - `kind: Deployment` — у кожного контейнера спільно `containers` +
#    `initContainers` має бути `resources.requests.cpu` і
#    `resources.requests.memory` (рядок або додатне число);
#  - `kind: Deployment` з образом `hasura/graphql-engine` — образ має бути
#    у білому списку `allowed_hasura_images` (з digest або без; префікс
#    `docker.io/` дозволено);
#  - `kind: Deployment` — rollout strategy має бути `RollingUpdate` з
#    `maxUnavailable: 0` і `maxSurge: 1`;
#  - `kind: Deployment` — наявність канонічного запису у
#    `spec.template.spec.topologySpreadConstraints` (k8s.mdc).
#
# CROSS-FILE логіка (Kustomize-резолюція ресурсів, парність svc.yaml/svc-hl.yaml,
# HPA/PDB/topologySpreadConstraints за каталогом, BackendConfig-сепарація,
# yaml-language-server schema modeline, namespace-перевірки за деревом
# `…/k8s/base/`) лишається у `rules/k8s/fix.mjs`: вона потребує файлової системи.
# JS authoritative (`rules/k8s/fix.mjs` робить ці ж пер-документні перевірки в ширшому
# контексті); ця Rego — швидкий gate для одиничного маніфеста.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package k8s.manifest

import rego.v1

default_cpu_request := "0.5"

default_memory_request := "512Mi"

forbidden_service_annotations := {
	"cloud.google.com/neg",
	"cloud.google.com/backend-config",
}

# Дозволені посилання на образ `hasura/graphql-engine`. Це **єдине** джерело
# істини для канонічного тега (JS-копія `HASURA_GRAPHQL_ENGINE_IMAGE` видалена —
# пер-документна перевірка делегована цьому rego-пакету). Зараз — один канонічний
# тег у двох варіантах префіксу (із `docker.io/` і без). Digest (`@sha256:…`)
# відрізається перед звіркою.
allowed_hasura_images := {
	"hasura/graphql-engine:v2.49.2.ubuntu.amd64",
	"docker.io/hasura/graphql-engine:v2.49.2.ubuntu.amd64",
}

# Канонічне значення `topologyKey` для `topologySpreadConstraints` (k8s.mdc).
topology_spread_topology_key := "kubernetes.io/hostname"

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

memory_missing_template := concat(" ", [
	"Deployment %q, контейнер %q: відсутнє resources.requests.memory —",
	"додай (за замовчуванням %s) (k8s.mdc)",
])

memory_empty_template := concat(" ", [
	"Deployment %q, контейнер %q: resources.requests.memory має бути непорожнім",
	"значенням (наприклад \"512Mi\") (зараз: %v) (k8s.mdc)",
])

hasura_image_template := concat(" ", [
	"Deployment %q, контейнер %q: образ hasura/graphql-engine має бути одним",
	"із дозволених тегів (зараз: %q) (k8s.mdc)",
])

topology_spread_missing_template := concat(" ", [
	"Deployment %q: відсутній канонічний запис у spec.template.spec.topologySpreadConstraints —",
	"додай maxSkew=1, topologyKey=%s, whenUnsatisfiable=ScheduleAnyway,",
	"labelSelector.matchLabels.app=%q (k8s.mdc)",
])

rollout_strategy_template := concat(" ", [
	"Deployment %q: spec.strategy має бути RollingUpdate з",
	"rollingUpdate.maxUnavailable=0 і rollingUpdate.maxSurge=1",
	"(оновлення по одному pod без зменшення кількості ready pod-ів) (k8s.mdc)",
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

# ── deny: Deployment — у кожного контейнера resources.requests.memory ─────

deny contains msg if {
	input.kind == "Deployment"
	some container in deployment_all_containers
	not has_non_empty_memory_request(container)
	not has_memory_field(container)
	msg := sprintf(memory_missing_template, [deployment_name, container.name, default_memory_request])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in deployment_all_containers
	not has_non_empty_memory_request(container)
	has_memory_field(container)
	mem := container.resources.requests.memory
	msg := sprintf(memory_empty_template, [deployment_name, container.name, mem])
}

# ── deny: Deployment — образ hasura/graphql-engine з білого списку ────────
#
# Spec вимагає рівно тег зі списку `allowed_hasura_images` (вище)
# (з опційним префіксом `docker.io/`). Digest `@sha256:…` у поточних правилах
# відрізається перед порівнянням (k8s.mdc допускає, але не вимагає його).

deny contains msg if {
	input.kind == "Deployment"
	some container in deployment_all_containers
	is_hasura_graphql_engine_image_ref(container.image)
	stripped := strip_image_digest(container.image)
	not stripped in allowed_hasura_images
	msg := sprintf(hasura_image_template, [deployment_name, container.name, container.image])
}

# ── deny: Deployment — безпечний RollingUpdate rollout ───────────────────

deny contains msg if {
	input.kind == "Deployment"
	not has_canonical_rollout_strategy
	msg := sprintf(rollout_strategy_template, [deployment_name])
}

# ── deny: Deployment — канонічний topologySpreadConstraints ───────────────
#
# Перевіряємо лише Deployment-и, що мають мітку `app` у
# `spec.selector.matchLabels.app` — без неї канон не визначений (так само
# як у JS-перевірці).

deny contains msg if {
	input.kind == "Deployment"
	deployment_app_label != ""
	not has_canonical_topology_spread_constraint(deployment_app_label)
	msg := sprintf(topology_spread_missing_template, [deployment_name, topology_spread_topology_key, deployment_app_label])
}

# ── helpers ────────────────────────────────────────────────────────────────

deployment_name := object.get(object.get(input, "metadata", {}), "name", "<no-name>")

# Усі контейнери (звичайні + ініт) Deployment-а — для перевірки CPU/memory/image.
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
	requests := object.get(object.get(container, "resources", {}), "requests", {})
	"cpu" in object.keys(requests)
}

# Чи у контейнера є непорожнє resources.requests.memory (рядок або число > 0).
has_non_empty_memory_request(container) if {
	mem := container.resources.requests.memory
	is_string(mem)
	trim_space(mem) != ""
}

has_non_empty_memory_request(container) if {
	mem := container.resources.requests.memory
	is_number(mem)
	mem > 0
}

# Чи у контейнера в реальності присутнє поле resources.requests.memory.
has_memory_field(container) if {
	requests := object.get(object.get(container, "resources", {}), "requests", {})
	"memory" in object.keys(requests)
}

# Чи Deployment має rollout strategy, яка під час оновлення спершу додає один
# ready pod і тільки потім прибирає старий.
has_canonical_rollout_strategy if {
	strategy := object.get(object.get(input, "spec", {}), "strategy", {})
	strategy.type == "RollingUpdate"
	rolling := object.get(strategy, "rollingUpdate", {})
	is_zero_int_or_string(rolling.maxUnavailable)
	is_one_int_or_string(rolling.maxSurge)
}

is_zero_int_or_string(v) if {
	is_number(v)
	v == 0
}

is_zero_int_or_string(v) if {
	is_string(v)
	trim_space(v) == "0"
}

is_one_int_or_string(v) if {
	is_number(v)
	v == 1
}

is_one_int_or_string(v) if {
	is_string(v)
	trim_space(v) == "1"
}

# Чи рядок `image` посилається на репозиторій `hasura/graphql-engine` (з тегом
# або без). Digest `@sha256:…` ігнорується.
is_hasura_graphql_engine_image_ref(image) if {
	is_string(image)
	stripped := strip_image_digest(image)
	regex.match(`(^|/)hasura/graphql-engine(:|$)`, stripped)
}

# Прибирає digest (`@sha256:…`) з image-string для звірки тегу.
strip_image_digest(image) := stripped if {
	at_idx := indexof(image, "@")
	at_idx >= 0
	stripped := substring(image, 0, at_idx)
}

strip_image_digest(image) := image if {
	indexof(image, "@") == -1
}

# Витягує мітку `app` з `spec.selector.matchLabels.app`. Повертає "" якщо немає.
default deployment_app_label := ""

deployment_app_label := app if {
	app := object.get(object.get(object.get(input.spec, "selector", {}), "matchLabels", {}), "app", "")
	is_string(app)
}

# Чи серед `spec.template.spec.topologySpreadConstraints` є запис, який
# відповідає канону (maxSkew=1, потрібний topologyKey, whenUnsatisfiable,
# labelSelector.matchLabels.app == очікувана мітка).
has_canonical_topology_spread_constraint(expected_app) if {
	some item in object.get(object.get(input.spec.template, "spec", {}), "topologySpreadConstraints", [])
	is_canonical_topology_spread_constraint(item, expected_app)
}

is_canonical_topology_spread_constraint(item, expected_app) if {
	item.maxSkew == 1
	item.topologyKey == topology_spread_topology_key
	item.whenUnsatisfiable == "ScheduleAnyway"
	object.get(object.get(item, "labelSelector", {}), "matchLabels", {}).app == expected_app
}
