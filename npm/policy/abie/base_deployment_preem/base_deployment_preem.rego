# Порт перевірки `deploymentDocumentHasAbieBasePreemNodeSelector` з
# `npm/scripts/check-abie.mjs` (abie.mdc): кожен `Deployment` у файлах під
# `…/k8s/.../base/…` має `spec.template.spec.nodeSelector.preem` зі
# значенням, що вважається істинним (boolean `true` або рядок `"true"`
# без урахування регістру). Overlay ua далі підміняє селектор
# JSON6902-патчем на `preem: false`.
#
# Запуск (локально, лише для одного base-YAML з Deployment):
#   conftest test path/to/k8s/base/deployment.yaml \
#     -p npm/policy/abie/base_deployment_preem \
#     --namespace abie.base_deployment_preem
#
# JS відбирає файли під `…/k8s/.../base/…` (через `isAbieK8sBaseYamlPath`) і
# викликає conftest з цією намеспейс. JS authoritative (`check-abie.mjs`:
# `deploymentDocumentHasAbieBasePreemNodeSelector` + `ensureAbieBaseDeploymentPreemNodeSelector`).
# Cross-file gating (правило `abie` у `.n-cursor.json`, шлях файла) — у JS.
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
