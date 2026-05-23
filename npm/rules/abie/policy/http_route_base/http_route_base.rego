# Перевірка `HTTPRoute` у шарі `…/k8s/.../base/...` (abie.mdc): дозволені лише
# hostnames з домену `aiml.live` (включно з піддоменами та `*.aiml.live`).
#
# Запуск (локально):
#   conftest test path/to/k8s/base/hr.yaml \
#     -p npm/rules/abie/policy/http_route_base \
#     --namespace abie.http_route_base
#
# Cross-file gating (саме шлях `…/k8s/.../base/...` визначає, чи застосовувати
# правило) задає glob у `policy/http_route_base/target.json`. Тут — лише
# валідація вмісту `spec.hostnames`. Rule-level applies-гейт — `fix/applies/check.mjs`.
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
