# Порт перевірки `k8s/base/kustomization.yaml` з `npm/scripts/check-k8s.mjs`
# (k8s.mdc): у base-kustomization обов'язково має бути непорожнє поле
# `namespace:`.
#
# Запуск (локально, лише для одного `k8s/base/kustomization.yaml`):
#   conftest test path/to/k8s/base/kustomization.yaml \
#     -p npm/policy/k8s/base_kustomization \
#     --namespace k8s.base_kustomization
#
# JS authoritative (`check-k8s.mjs`: `baseKustomizationNamespaceViolation`,
# `isBaseKustomizationPath` для відбору файла, `ensureBaseKustomizationHasNamespace`
# як оркестратор).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.base_kustomization

import rego.v1

base_namespace_required_msg := concat(" ", [
	"у base/kustomization.yaml завжди додай непорожній namespace:",
	"(наприклад namespace: dev; k8s.mdc)",
])

deny contains base_namespace_required_msg if {
	is_kustomization
	not is_string(object.get(input, "namespace", null))
}

deny contains base_namespace_required_msg if {
	is_kustomization
	ns := object.get(input, "namespace", "")
	is_string(ns)
	trim_space(ns) == ""
}

# HPA/PDB у base заборонені — канон k8s.mdc: тримати у sibling каталозі `components/`
# і підключати з overlay (`components: [- ../components]`). Цей deny — швидкий gate
# на *локальний* `resources:` base/kustomization.yaml (точне ім'я `hpa.yaml`/`pdb.yaml`,
# у будь-якому підкаталозі). Рекурсивний обхід `resources:`/`components:`/`bases:`
# (із зануренням у вкладені kustomization.yaml) — JS-оркестратор
# `verifyK8sBaseKustomizeHasNoHpaPdb` у `check-k8s.mjs` (потребує fs-доступу). Цей
# rego-deny — defense-in-depth: спрацює навіть якщо JS-крок упаде з винятку раніше.
deny contains hpa_pdb_in_base_resources_msg(r) if {
	is_kustomization
	some r in object.get(input, "resources", [])
	is_string(r)
	is_hpa_or_pdb_filename(r)
}

hpa_pdb_in_base_resources_msg(file) := sprintf(
	concat("", [
		"у base/kustomization.yaml `resources:` містить '%v' — HPA/PDB заборонені у base, ",
		"перенесіть у sibling каталог components/ і підключайте з overlay (k8s.mdc)",
	]),
	[file],
)

is_kustomization if {
	input.kind == "Kustomization"
	startswith(object.get(input, "apiVersion", ""), "kustomize.config.k8s.io/")
}

is_hpa_or_pdb_filename(p) if {
	basename(p) in {"hpa.yaml", "pdb.yaml", "hpa.yml", "pdb.yml"}
}

basename(p) := parts[count(parts) - 1] if {
	parts := split(p, "/")
}
