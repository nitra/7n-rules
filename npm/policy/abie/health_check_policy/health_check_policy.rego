# Порт мінімальної структурної перевірки `HealthCheckPolicy` з
# `npm/scripts/check-abie.mjs` (abie.mdc).
#
# Запуск (локально):
#   conftest test path/to/k8s/.../hc.yaml -p npm/policy/abie \
#     --namespace abie.health_check_policy
#
# Перевіряє, для документів з `kind: HealthCheckPolicy` (apiVersion
# `networking.gke.io/v1`):
#  - `spec.config.httpHealthCheck.requestPath` — непорожній шлях, що починається з `/`;
#  - `spec.config.httpHealthCheck.port` (або `spec.targetRef.name` суфікс) — `8080`;
#  - `spec.targetRef.name` має закінчуватись на `-hl` (headless backend).
#
# Cross-file gating (`abie` правило в `.n-cursor.json`, парність з Deployment-каталогу,
# узгодження з `metadata.name` Deployment) — у JS (`check-abie.mjs`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package abie.health_check_policy

import rego.v1

req_path_starts_with_slash_template := concat(" ", [
	"HealthCheckPolicy: requestPath має починатись з `/`",
	"(зараз %q) (abie.mdc)",
])

# ── deny: requestPath ──────────────────────────────────────────────────────

deny contains msg if {
	is_health_check_policy
	req_path == ""
	msg := "HealthCheckPolicy: spec.config.httpHealthCheck.requestPath має бути непорожнім (abie.mdc)"
}

deny contains msg if {
	is_health_check_policy
	req_path != ""
	not startswith(req_path, "/")
	msg := sprintf(req_path_starts_with_slash_template, [req_path])
}

# ── deny: port == 8080 ────────────────────────────────────────────────────

deny contains msg if {
	is_health_check_policy
	port := object.get(http_health_check, "port", null)
	port != null
	port != 8080
	msg := sprintf("HealthCheckPolicy: port має бути 8080 (зараз %v) (abie.mdc)", [port])
}

# ── deny: targetRef.name закінчується на `-hl` ────────────────────────────

deny contains msg if {
	is_health_check_policy
	name := object.get(object.get(input.spec, "targetRef", {}), "name", "")
	name != ""
	not endswith(name, "-hl")
	msg := sprintf("HealthCheckPolicy: targetRef.name має закінчуватись на `-hl` (зараз %q) (abie.mdc)", [name])
}

# ── helpers ────────────────────────────────────────────────────────────────

is_health_check_policy if {
	input.kind == "HealthCheckPolicy"
	startswith(object.get(input, "apiVersion", ""), "networking.gke.io/")
}

http_health_check := object.get(object.get(object.get(input, "spec", {}), "config", {}), "httpHealthCheck", {})

req_path := object.get(http_health_check, "requestPath", "")
