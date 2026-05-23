# Структурна перевірка `HealthCheckPolicy` (abie.mdc).
#
# Запуск (локально):
#   conftest test path/to/k8s/.../hc.yaml \
#     -p npm/rules/abie/policy/health_check_policy \
#     --namespace abie.health_check_policy
#
# Перевіряє для `kind: HealthCheckPolicy`:
#  - `apiVersion: networking.gke.io/v1` (точна відповідність);
#  - `metadata.name` — непорожній рядок;
#  - `spec.default.config.type: HTTP`;
#  - `spec.default.config.httpHealthCheck.requestPath` — непорожній і
#    починається з `/`;
#  - `spec.default.config.httpHealthCheck.port: 8080`;
#  - `spec.targetRef.kind: Service`;
#  - `spec.targetRef.name` — `<hcp.metadata.name>-hl` (exact, з нормалізацією
#    суфікса).
#
# Cross-file gating: glob по `hc.yaml` у k8s-дереві — у
# `policy/health_check_policy/target.json`. FS-парність HCP↔Deployment та
# modeline `hc.yaml` — `js/hc_pairing/check.mjs`. Rule-level applies-гейт —
# `js/applies/check.mjs`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package abie.health_check_policy

import rego.v1

expected_api_version := "networking.gke.io/v1"

req_path_starts_with_slash_template := concat(" ", [
	"HealthCheckPolicy: requestPath має починатись з `/`",
	"(зараз %q) (abie.mdc)",
])

target_ref_name_template := concat(" ", [
	"HealthCheckPolicy: targetRef.name має посилатися на headless Service",
	"(очікується %q, суфікс -hl) (зараз %q) (abie.mdc)",
])

# ── deny: apiVersion / kind ───────────────────────────────────────────────

deny contains msg if {
	input.kind == "HealthCheckPolicy"
	api_version := object.get(input, "apiVersion", "")
	api_version != expected_api_version
	msg := sprintf(
		"HealthCheckPolicy: apiVersion має бути %q (зараз %q) (abie.mdc)",
		[expected_api_version, api_version],
	)
}

# ── deny: metadata.name ───────────────────────────────────────────────────

deny contains "HealthCheckPolicy: metadata.name має бути непорожнім рядком (abie.mdc)" if {
	input.kind == "HealthCheckPolicy"
	startswith(object.get(input, "apiVersion", ""), "networking.gke.io/")
	name := object.get(object.get(input, "metadata", {}), "name", "")
	trim_space(name) == ""
}

# ── deny: spec.default.config.type ────────────────────────────────────────

deny contains "HealthCheckPolicy: spec.default.config.type має бути HTTP (abie.mdc)" if {
	is_health_check_policy
	is_object(default_config)
	object.get(default_config, "type", "") != "HTTP"
}

# ── deny: requestPath ─────────────────────────────────────────────────────

deny contains "HealthCheckPolicy: spec.default.config.httpHealthCheck.requestPath має бути непорожнім (abie.mdc)" if {
	is_health_check_policy
	is_object(http_health_check)
	req_path == ""
}

deny contains msg if {
	is_health_check_policy
	is_object(http_health_check)
	req_path != ""
	not startswith(req_path, "/")
	msg := sprintf(req_path_starts_with_slash_template, [req_path])
}

# ── deny: port == 8080 ────────────────────────────────────────────────────

deny contains msg if {
	is_health_check_policy
	is_object(http_health_check)
	port := object.get(http_health_check, "port", null)
	port != null
	port != 8080
	msg := sprintf("HealthCheckPolicy: port має бути 8080 (зараз %v) (abie.mdc)", [port])
}

# ── deny: targetRef.kind == Service ──────────────────────────────────────

deny contains msg if {
	is_health_check_policy
	target_ref := object.get(object.get(input, "spec", {}), "targetRef", null)
	is_object(target_ref)
	kind := object.get(target_ref, "kind", "")
	kind != ""
	kind != "Service"
	msg := sprintf("HealthCheckPolicy: targetRef.kind має бути Service (зараз %q) (abie.mdc)", [kind])
}

# ── deny: targetRef.name = `<hcp.metadata.name>-hl` (exact, з нормалізацією)

deny contains msg if {
	is_health_check_policy
	hcp_name := object.get(object.get(input, "metadata", {}), "name", "")
	hcp_name != ""
	target_name := object.get(object.get(object.get(input, "spec", {}), "targetRef", {}), "name", "")
	target_name != ""
	expected_hl := expected_target_ref_name(hcp_name)
	target_name != expected_hl
	msg := sprintf(target_ref_name_template, [expected_hl, target_name])
}

# Нормалізація: якщо `metadata.name` уже закінчується на `-hl` — використовуємо
# як є; інакше додаємо суфікс.
expected_target_ref_name(name) := name if {
	endswith(name, "-hl")
} else := concat("", [name, "-hl"])

# ── helpers ───────────────────────────────────────────────────────────────

is_health_check_policy if {
	input.kind == "HealthCheckPolicy"
	startswith(object.get(input, "apiVersion", ""), "networking.gke.io/")
}

default_config := object.get(
	object.get(object.get(input, "spec", {}), "default", {}),
	"config",
	{},
)

http_health_check := object.get(default_config, "httpHealthCheck", {})

req_path := object.get(http_health_check, "requestPath", "")
