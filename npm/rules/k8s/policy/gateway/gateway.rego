# Порт пер-документних перевірок для Gateway API і HealthCheckPolicy з
# `npm/scripts/rules/k8s/fix.mjs` (k8s.mdc).
#
# Запуск (локально, по одному файлу або по дереву):
#   conftest test path/to/manifest.yaml -p npm/policy/k8s/gateway \
#     --namespace k8s.gateway
#
# Перевіряє:
#  - HealthCheckPolicy (`networking.gke.io/v1`): `spec.targetRef.name` має
#    закінчуватися на `-hl` (headless Service);
#  - HTTPRoute / GRPCRoute / TCPRoute / TLSRoute / UDPRoute (`gateway.networking.k8s.io/*`):
#    backendRef до Service має ім'я з суфіксом `-hl` (headless);
#  - той самий маршрут: backendRef з полем `namespace`, що збігається з
#    `metadata.namespace` маршруту, — заборонено (надлишкове поле, ламається при
#    overlay-перенесеннях).
#
# JS authoritative (`rules/k8s/fix.mjs` — функції `failIfGatewayRouteUsesNonHeadlessService`,
# `healthCheckPolicyTargetRefHeadlessServiceViolation`,
# `collectGatewayApiRouteBackendServiceNames`,
# `collectGatewayApiRouteBackendRefsWithRedundantNamespace`); ця Rego — швидкий
# gate для одиничного маніфеста.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package k8s.gateway

import rego.v1

# Kind-и маршрутів Gateway API, у `spec` яких шукаємо backendRefs.
route_kinds := {"HTTPRoute", "GRPCRoute", "TCPRoute", "TLSRoute", "UDPRoute"}

# Префікс apiVersion стандартних ресурсів Gateway API.
api_group_prefix := "gateway.networking.k8s.io/"

# Суфікс metadata.name для headless-сервісу (k8s.mdc).
svc_hl_name_suffix := "-hl"

hcp_target_ref_template := concat(" ", [
	"HealthCheckPolicy: spec.targetRef.name має закінчуватись на %q",
	"(зараз: %q) (k8s.mdc)",
])

route_backend_hl_template := concat(" ", [
	"Gateway API %s: backendRef до Service має вказувати headless-сервіс",
	"з суфіксом %q (зараз: %q) (k8s.mdc)",
])

route_backend_redundant_ns_template := concat(" ", [
	"Gateway API %s: backendRef %q має namespace %q,",
	"що збігається з metadata.namespace маршруту —",
	"прибери поле namespace (k8s.mdc)",
])

# ── deny: HealthCheckPolicy — targetRef.name має закінчуватись на `-hl` ───

deny contains msg if {
	is_health_check_policy
	target_ref_kind_is_service
	name := object.get(object.get(input.spec, "targetRef", {}), "name", "")
	name != ""
	not endswith(name, svc_hl_name_suffix)
	msg := sprintf(hcp_target_ref_template, [svc_hl_name_suffix, name])
}

deny contains msg if {
	is_health_check_policy
	not has_target_ref
	msg := "HealthCheckPolicy: відсутній spec.targetRef (k8s.mdc)"
}

# ── deny: Gateway API маршрут — backendRef має суфікс `-hl` ──────────────

deny contains msg if {
	is_gateway_api_route
	some backend_name in route_service_backend_names
	not endswith(backend_name, svc_hl_name_suffix)
	msg := sprintf(route_backend_hl_template, [input.kind, svc_hl_name_suffix, backend_name])
}

# ── deny: Gateway API маршрут — backendRef з redundant namespace ─────────

deny contains msg if {
	is_gateway_api_route
	route_ns := object.get(input.metadata, "namespace", "")
	route_ns != ""
	some redundant in redundant_namespace_backend_names(route_ns)
	msg := sprintf(route_backend_redundant_ns_template, [input.kind, redundant, route_ns])
}

# ── helpers ───────────────────────────────────────────────────────────────

is_health_check_policy if {
	input.kind == "HealthCheckPolicy"
	startswith(object.get(input, "apiVersion", ""), "networking.gke.io/")
}

# targetRef.kind не задано або дорівнює "Service" — звіряємо суфікс імені.
target_ref_kind_is_service if {
	target_ref_kind == ""
}

target_ref_kind_is_service if {
	target_ref_kind == "Service"
}

target_ref_kind := object.get(object.get(input.spec, "targetRef", {}), "kind", "")

has_target_ref if {
	object.get(input, "spec", {}).targetRef
}

is_gateway_api_route if {
	startswith(object.get(input, "apiVersion", ""), api_group_prefix)
	input.kind in route_kinds
}

# Усі імена backend-ів у `spec` що виглядають як backendRef до Service: вузол
# має `name` (string) і `port` (number); якщо поле `kind`/`group` явне — лише
# `Service`/`core` (без явного group теж приймаємо).
route_service_backend_names contains node.name if {
	walk(object.get(input, "spec", {}), [_, node])
	is_gateway_api_backend_ref_to_service(node)
}

# Тільки ті backendRef, у яких `namespace` збігається з namespace маршруту.
redundant_namespace_backend_names(route_ns) := {node.name |
	walk(object.get(input, "spec", {}), [_, node])
	is_gateway_api_backend_ref_to_service(node)
	node.namespace == route_ns
}

is_gateway_api_backend_ref_to_service(obj) if {
	is_object(obj)
	is_string(obj.name)
	is_number(obj.port)
	kind_ok(obj)
	group_ok(obj)
}

# Якщо `kind` не вказано — приймаємо як Service (Gateway API дефолт).
kind_ok(obj) if not obj.kind

kind_ok(obj) if obj.kind == "Service"

# Якщо `group` не вказано / порожній / "core" — приймаємо як Service.
group_ok(obj) if not obj.group

group_ok(obj) if obj.group == ""

group_ok(obj) if obj.group == "core"
