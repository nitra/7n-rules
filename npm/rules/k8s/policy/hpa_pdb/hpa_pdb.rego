# Порт **структурних** пер-документних перевірок HPA та PDB з
# `npm/scripts/check-k8s.mjs` (k8s.mdc). Перевіряє лише ті властивості, що
# не залежать від cross-file контексту (`expectedDeployName`, `expectedAppLabel`,
# `isDevLike`-сегмента). Cross-file перевірки лишаються в JS
# (`hpaManifestViolations`, `pdbManifestViolations`,
# `validateDeploymentHpaPdbAndTopology`).
#
# Запуск (локально, по одному файлу):
#   conftest test path/to/hpa.yaml -p npm/policy/k8s/hpa_pdb \
#     --namespace k8s.hpa_pdb
#
# Перевіряє:
#  - HPA: `apiVersion: autoscaling/v2`, `kind: HorizontalPodAutoscaler`;
#         `spec` присутній; `spec.behavior.scaleUp` / `scaleDown` з непорожніми
#         `policies`; `spec.metrics` — непорожній масив;
#  - PDB: `apiVersion: policy/v1`, `kind: PodDisruptionBudget`;
#         `spec.selector.matchLabels` присутній.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.hpa_pdb

import rego.v1

hpa_kind_template := "kind має бути HorizontalPodAutoscaler (зараз: %v) (k8s.mdc)"

hpa_api_template := "apiVersion має бути autoscaling/v2 (зараз: %v) (k8s.mdc)"

pdb_kind_template := "kind має бути PodDisruptionBudget (зараз: %v) (k8s.mdc)"

pdb_api_template := "apiVersion має бути policy/v1 (зараз: %v) (k8s.mdc)"

# ── HPA: apiVersion / kind / spec ────────────────────────────────────────

deny contains msg if {
	is_hpa_doc
	input.kind != "HorizontalPodAutoscaler"
	msg := sprintf(hpa_kind_template, [input.kind])
}

deny contains msg if {
	is_hpa_doc
	input.apiVersion != "autoscaling/v2"
	msg := sprintf(hpa_api_template, [input.apiVersion])
}

deny contains "spec відсутній або некоректний (HPA; k8s.mdc)" if {
	is_hpa_doc
	not is_object(object.get(input, "spec", null))
}

# ── HPA: spec.behavior.scaleUp / scaleDown з policies ────────────────────

deny contains "spec.behavior відсутній (має містити scaleUp і scaleDown) (HPA; k8s.mdc)" if {
	is_hpa_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not is_object(object.get(spec, "behavior", null))
}

deny contains msg if {
	is_hpa_doc
	behavior := object.get(object.get(input, "spec", {}), "behavior", null)
	is_object(behavior)
	some key in {"scaleUp", "scaleDown"}
	not is_object(object.get(behavior, key, null))
	msg := sprintf("spec.behavior.%s відсутній (HPA; k8s.mdc)", [key])
}

deny contains msg if {
	is_hpa_doc
	behavior := object.get(object.get(input, "spec", {}), "behavior", null)
	is_object(behavior)
	some key in {"scaleUp", "scaleDown"}
	branch := object.get(behavior, key, null)
	is_object(branch)
	not is_non_empty_array(object.get(branch, "policies", null))
	msg := sprintf("spec.behavior.%s.policies має бути непорожнім масивом (HPA; k8s.mdc)", [key])
}

# ── HPA: spec.metrics — непорожній масив ──────────────────────────────────

deny contains "spec.metrics має бути непорожнім масивом (наприклад Resource/cpu/Utilization) (HPA; k8s.mdc)" if {
	is_hpa_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not is_non_empty_array(object.get(spec, "metrics", null))
}

# ── PDB: apiVersion / kind / spec.selector.matchLabels ───────────────────

deny contains msg if {
	is_pdb_doc
	input.kind != "PodDisruptionBudget"
	msg := sprintf(pdb_kind_template, [input.kind])
}

deny contains msg if {
	is_pdb_doc
	input.apiVersion != "policy/v1"
	msg := sprintf(pdb_api_template, [input.apiVersion])
}

deny contains "spec відсутній або некоректний (PDB; k8s.mdc)" if {
	is_pdb_doc
	not is_object(object.get(input, "spec", null))
}

deny contains "spec.selector відсутній (PDB; k8s.mdc)" if {
	is_pdb_doc
	spec := object.get(input, "spec", null)
	is_object(spec)
	not is_object(object.get(spec, "selector", null))
}

deny contains "spec.selector.matchLabels відсутній (PDB; k8s.mdc)" if {
	is_pdb_doc
	selector := object.get(object.get(input, "spec", {}), "selector", null)
	is_object(selector)
	not is_object(object.get(selector, "matchLabels", null))
}

# ── helpers ───────────────────────────────────────────────────────────────

# Кваліфікуємо як HPA-документ: входить hint `kind == "HorizontalPodAutoscaler"`
# або apiVersion з префіксом autoscaling/. Це уникає false-positive на ConfigMap
# чи інших kind у тому самому файлі.
is_hpa_doc if input.kind == "HorizontalPodAutoscaler"

is_hpa_doc if startswith(object.get(input, "apiVersion", ""), "autoscaling/")

is_pdb_doc if input.kind == "PodDisruptionBudget"

is_pdb_doc if input.apiVersion == "policy/v1"

is_non_empty_array(x) if {
	is_array(x)
	count(x) > 0
}
