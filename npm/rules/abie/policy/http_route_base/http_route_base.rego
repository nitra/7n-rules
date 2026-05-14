# Порт перевірки `HTTPRoute` у шарі `…/k8s/.../base/...` з
# `npm/scripts/check-abie.mjs` (abie.mdc): дозволені лише hostnames з домену
# `aiml.live` (включно з піддоменами та `*.aiml.live`).
#
# Запуск (локально):
#   conftest test path/to/k8s/base/hr.yaml -p npm/policy/abie \
#     --namespace abie.http_route_base
#
# Cross-file gating (саме шлях `…/base/…` визначає, чи застосовувати правило)
# — у JS: conftest викликаємо лише на YAML-ах з base/. Тут — лише валідація вмісту
# `spec.hostnames`. JS authoritative (`check-abie.mjs`) — ця Rego гейт для
# одиничного YAML.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package abie.http_route_base

import rego.v1

allowed_apex := "aiml.live"

deny contains msg if {
	input.kind == "HTTPRoute"
	some host in object.get(object.get(input, "spec", {}), "hostnames", [])
	is_string(host)
	not host_matches_aiml_live(host)
	msg := sprintf("HTTPRoute (base): %q має бути в домені aiml.live (abie.mdc)", [host])
}

# Чи hostname належить до aiml.live (точна відповідність, піддомен `*.aiml.live`
# або довільний субдомен `*.aiml.live`).
host_matches_aiml_live(host) if {
	host_lower := lower(host)
	host_lower == allowed_apex
}

host_matches_aiml_live(host) if {
	host_lower := lower(host)
	endswith(host_lower, sprintf(".%s", [allowed_apex]))
}

host_matches_aiml_live(host) if {
	host_lower := lower(host)
	host_lower == sprintf("*.%s", [allowed_apex])
}
