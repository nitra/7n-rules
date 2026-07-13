# Перевірка (abie.mdc): кожен `Deployment` у файлах під `…/k8s/.../base/…` має
# `spec.template.spec.nodeSelector.preem` зі значенням, що вважається істинним
# (boolean `true` або рядок `"true"` без урахування регістру). Overlay ua далі
# підміняє селектор JSON6902-патчем на `preem: false`
# (див. `js/ua_node_selector.mjs`).
#
# Запуск (локально, лише для одного base-YAML з Deployment):
#   conftest test path/to/k8s/base/deployment.yaml \
#     -p npm/rules/abie/policy/base_deployment_preem \
#     --namespace abie.base_deployment_preem
#
# Cross-file gating: шлях `…/k8s/.../base/…` фільтрується через
# `policy/base_deployment_preem/target.json` (glob). Rule-level applies-гейт —
# `js/applies.mjs` (поле `rules` у `.n-rules.json`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package abie.base_deployment_preem

import rego.v1

deny_msg := concat(" ", [
	"Deployment у base: потрібен spec.template.spec.nodeSelector.preem:",
	"true (або 'true') — abie.mdc",
])

deny contains deny_msg if {
	input.kind == "Deployment"
	not has_truthy_preem
}

# preem truthy: boolean true або рядок "true" (case-insensitive, з обрізаними пробілами).
has_truthy_preem if {
	preem := object.get(node_selector, "preem", null)
	is_preem_truthy(preem)
}

is_preem_truthy(true)

is_preem_truthy(v) if {
	is_string(v)
	lower(trim_space(v)) == "true"
}

node_selector := object.get(
	object.get(
		object.get(object.get(input, "spec", {}), "template", {}),
		"spec",
		{},
	),
	"nodeSelector",
	{},
)
