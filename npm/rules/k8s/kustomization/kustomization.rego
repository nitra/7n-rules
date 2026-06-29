# Порт пер-документних структурних перевірок `kustomization.yaml` з
# `npm/scripts/rules/k8s/fix.mjs` (k8s.mdc).
#
# Запуск (локально, на одному kustomization.yaml):
#   conftest test path/to/kustomization.yaml -p npm/policy/k8s/kustomization \
#     --namespace k8s.kustomization
#
# Перевіряє (тільки для `kind: Kustomization`, `apiVersion: kustomize.config.k8s.io/...`):
#  - `resources[]` — за алфавітом (en, case-insensitive); порожні рядки ігноруються;
#  - `patches[]` — за tuple `(target.kind, target.name, target.namespace, path)`;
#  - всередині одного inline `patch` (JSON6902) не може бути одночасно
#    операцій `op: remove` і `op: add` на той самий `path` — k8s.mdc вимагає
#    `op: replace` у такому випадку.
#
# JS authoritative: повна резолюція kustomize-дерева, перевірка існування
# refs на диску, парність `svc.yaml`/`svc-hl.yaml`, вибір conftest-цілей за
# patternом `kustomization.yaml` — у `rules/k8s/fix.mjs`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package k8s.kustomization

import rego.v1

# Префікс apiVersion маніфесту Kustomize Kustomization.
api_prefix := "kustomize.config.k8s.io/"

resources_unsorted_template := concat(" ", [
	"Kustomization.resources має бути за алфавітом (en, case-insensitive).",
	"Зараз: %s; очікувано: %s (k8s.mdc)",
])

resources_not_array_template := "Kustomization.resources має бути масивом (k8s.mdc)"

resources_item_not_string_template := "Kustomization.resources[%d] — очікується рядок-шлях (k8s.mdc)"

patches_unsorted_template := concat(" ", [
	"Kustomization.patches має бути за алфавітом",
	"(target.kind → target.name → target.namespace → path).",
	"Зараз: %s; очікувано: %s (k8s.mdc)",
])

patches_not_array_template := "Kustomization.patches має бути масивом (k8s.mdc)"

json6902_conflict_template := concat(" ", [
	"Kustomization.patches[%d]: у наборі JSON6902 операцій є і remove,",
	"і add на той самий path %q — використай op: replace (k8s.mdc)",
])

# ── deny: resources[] не масив / нечитаний елемент ───────────────────────

deny contains resources_not_array_template if {
	is_kustomization
	resources_present
	not is_array(input.resources)
}

deny contains msg if {
	is_kustomization
	some i, item in input.resources
	not is_string(item)
	msg := sprintf(resources_item_not_string_template, [i])
}

# ── deny: resources[] не за алфавітом ────────────────────────────────────

deny contains msg if {
	is_kustomization
	is_array(input.resources)
	count(non_empty_resource_paths) >= 2
	not resources_sorted
	msg := sprintf(
		resources_unsorted_template,
		[concat(", ", non_empty_resource_paths), concat(", ", sorted_resource_paths_alpha)],
	)
}

# ── deny: patches[] не масив ─────────────────────────────────────────────

deny contains patches_not_array_template if {
	is_kustomization
	patches_present
	not is_array(input.patches)
}

# ── deny: patches[] не за tuple-сортом ───────────────────────────────────

deny contains msg if {
	is_kustomization
	is_array(input.patches)
	count(input.patches) >= 2
	not patches_sorted
	msg := sprintf(
		patches_unsorted_template,
		[concat(", ", patches_have_labels), concat(", ", patches_want_labels)],
	)
}

# ── deny: JSON6902 — remove+add на той самий path всередині одного patch ──

deny contains msg if {
	is_kustomization
	is_array(object.get(input, "patches", []))
	some i, p in input.patches
	patch_text := patch_inline_text(p)
	patch_text != ""
	some conflict_path in json6902_remove_add_conflicts(patch_text)
	msg := sprintf(json6902_conflict_template, [i, conflict_path])
}

# ── helpers ───────────────────────────────────────────────────────────────

is_kustomization if {
	input.kind == "Kustomization"
	startswith(object.get(input, "apiVersion", ""), api_prefix)
}

resources_present if {
	"resources" in object.keys(input)
}

patches_present if {
	"patches" in object.keys(input)
}

# Список непорожніх рядкових шляхів resources у порядку файлу (для повідомлення).
non_empty_resource_paths := [trim_space(item) |
	some item in input.resources
	is_string(item)
	trim_space(item) != ""
]

resources_sorted if {
	non_empty_resource_paths == sorted_resource_paths_alpha
}

# Case-insensitive en-сорт: будуємо tuple `[lower(s), s]`, сортуємо
# rego-built-in `sort` (за першою позицією — lower-case), повертаємо оригінали.
# Це відповідає JS `localeCompare('en', { sensitivity: 'base' })` для ASCII.
sorted_resource_paths_alpha := [pair[1] | some pair in sorted_lowered_pairs]

sorted_lowered_pairs := sort([[lower(s), s] | some s in non_empty_resource_paths])

# ── patches sort helpers ─────────────────────────────────────────────────

patch_keys := [patch_sort_key(p) | some p in input.patches]

patch_sort_key(p) := key if {
	target := object.get(p, "target", {})
	key := [
		lower(string_or_empty(target, "kind")),
		lower(string_or_empty(target, "name")),
		lower(string_or_empty(target, "namespace")),
		lower(string_or_empty(p, "path")),
	]
}

string_or_empty(obj, k) := v if {
	v := object.get(obj, k, "")
	is_string(v)
} else := ""

patches_sorted if {
	patch_keys == sort(patch_keys)
}

# Лейбли для повідомлень: «kind/name» якщо обидва є; «path=…» якщо є path; «#i» інакше.
patches_have_labels := [patch_label(input.patches[i], i) |
	some i, _ in input.patches
]

patches_want_labels := [patch_label(pair[1], pair[2]) | some pair in sorted_patches_with_index]

sorted_patches_with_index := sort([[patch_sort_key(input.patches[i]), input.patches[i], i] |
	some i, _ in input.patches
])

patch_label(p, i) := sprintf("%s/%s", [kind, name]) if {
	target := object.get(p, "target", {})
	kind := string_or_empty(target, "kind")
	kind != ""
	name := string_or_empty(target, "name")
	name != ""
} else := sprintf("path=%s", [path]) if {
	path := string_or_empty(p, "path")
	path != ""
} else := sprintf("#%d", [i])

# ── JSON6902 conflict helpers ────────────────────────────────────────────

# Текст inline `patch` у одному записі patches[]. Якщо немає поля `patch` або
# не рядок — повертаємо "" (зовнішні patch-файли через `path` тут не читаємо;
# JS дивиться їх окремо).
patch_inline_text(p) := v if {
	v := object.get(p, "patch", "")
	is_string(v)
} else := ""

# Витягує `op`/`path` пари з тексту JSON6902. Спершу пробуємо JSON, потім YAML
# (типова форма kustomization — YAML literal block).
json6902_ops(text) := ops if {
	yaml.is_valid(text)
	parsed := yaml.unmarshal(text)
	is_array(parsed)
	ops := [{"op": lower(item.op), "path": item.path} |
		some item in parsed
		is_string(object.get(item, "op", null))
		is_string(object.get(item, "path", null))
		trim_space(item.path) != ""
	]
} else := []

# Шляхи з конфліктом `remove` + `add` у одному наборі операцій.
json6902_remove_add_conflicts(text) := paths if {
	ops := json6902_ops(text)
	remove_paths := {op.path | some op in ops; op.op == "remove"}
	add_paths := {op.path | some op in ops; op.op == "add"}
	paths := remove_paths & add_paths
}
