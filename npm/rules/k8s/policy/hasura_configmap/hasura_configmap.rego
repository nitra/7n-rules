# Порт перевірки ConfigMap для Hasura-Deployment з
# `npm/scripts/rules/k8s/fix.mjs` (k8s.mdc): у ConfigMap, що сусідствує з
# Hasura-Deployment, у `data` обов'язково мають бути env-ключі зі списку
# `required_env` з очікуваними значеннями:
#   "HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS" → "true"
#   "HASURA_GRAPHQL_ENABLE_RELAY"                      → "false"
#   "HASURA_GRAPHQL_ENABLE_TELEMETRY"                  → "false"
#   "HASURA_GRAPHQL_ENABLED_LOG_TYPES"                 → "startup,http-log" (точний рядок)
#   "HASURA_GRAPHQL_DISABLE_EVENTING"                  → null (ключ обов'язковий,
#       значення довільне; за замовчуванням рекомендовано "true")
#
# Семантика очікуваного значення у `required_env`:
#   "true"  — має читатись як логічне true (boolean true або рядок "true", case-insensitive);
#   "false" — має читатись як логічне false (boolean false або рядок "false", case-insensitive);
#   null    — ключ обов'язковий, значення довільне (за замовчуванням "true");
#   інший рядок — значення має точно дорівнювати рядку (exact match).
#
# Запуск (локально, лише для ConfigMap у каталозі з Hasura-Deployment):
#   conftest test path/to/k8s/.../configmap.yaml \
#     -p npm/policy/k8s/hasura_configmap \
#     --namespace k8s.hasura_configmap
#
# Прив'язка ConfigMap-Deployment cross-file — у JS (`rules/k8s/js/manifests.mjs`:
# `validateHasuraConfigMapRemoteSchemaPermissions` шукає Hasura-Deployment
# у тому ж dir-у і викликає conftest з цією намеспейс лише для відповідних
# ConfigMap-ів). Rego authoritative для пер-документної валідації; JS лишає
# лише cross-file orchestration.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.hasura_configmap

import rego.v1

# Обов'язкові env-ключі у `data` (узгоджено з `rules/k8s/js/manifests.mjs` та k8s.mdc).
# Значення — очікуваний стан ключа (семантика — у шапці файлу).
required_env := {
	"HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS": "true",
	"HASURA_GRAPHQL_ENABLE_RELAY": "false",
	"HASURA_GRAPHQL_ENABLE_TELEMETRY": "false",
	"HASURA_GRAPHQL_ENABLED_LOG_TYPES": "startup,http-log",
	"HASURA_GRAPHQL_DISABLE_EVENTING": null,
}

# Множина "boolean-подібних" очікувань — для них значення читається як логічне,
# а не звіряється точним рядком.
bool_expected := {"true", "false"}

# Підказка про очікуване значення для повідомлення про відсутній ключ.
expected_hint(null) := "(значення довільне, за замовчуванням \"true\")"

expected_hint(expected) := sprintf("зі значенням \"%s\"", [expected]) if is_string(expected)

key_value_wrong_template := concat(" ", ["data.%s: значення має бути \"%s\" (зараз: %v) (k8s.mdc)"])

# Ключ відсутній: `data` не об'єкт або в ньому немає обов'язкового ключа.
deny contains msg if {
	input.kind == "ConfigMap"
	some key, expected in required_env
	not key_present(key)
	msg := sprintf(
		"data.%s: додай ключ %s (Deployment з hasura/graphql-engine — k8s.mdc)",
		[key, expected_hint(expected)],
	)
}

# Очікуване "true", а значення не читається як логічне true.
deny contains msg if {
	input.kind == "ConfigMap"
	d := object.get(input, "data", null)
	is_object(d)
	some key, expected in required_env
	expected == "true"
	key in object.keys(d)
	not is_value_true(d[key])
	msg := sprintf(key_value_wrong_template, [key, "true", d[key]])
}

# Очікуване "false", а значення не читається як логічне false.
deny contains msg if {
	input.kind == "ConfigMap"
	d := object.get(input, "data", null)
	is_object(d)
	some key, expected in required_env
	expected == "false"
	key in object.keys(d)
	not is_value_false(d[key])
	msg := sprintf(key_value_wrong_template, [key, "false", d[key]])
}

# Очікуване — точний рядок (не "true"/"false"/null), а значення не збігається.
deny contains msg if {
	input.kind == "ConfigMap"
	d := object.get(input, "data", null)
	is_object(d)
	some key, expected in required_env
	is_string(expected)
	not expected in bool_expected
	key in object.keys(d)
	d[key] != expected
	msg := sprintf(key_value_wrong_template, [key, expected, d[key]])
}

key_present(key) if {
	d := object.get(input, "data", null)
	is_object(d)
	key in object.keys(d)
}

# Значення вважається "true"/"false", якщо це відповідний boolean або рядок
# (case-insensitive). ConfigMap у Kubernetes тримає рядки, але YAML без лапок
# дає boolean — приймаємо обидва варіанти.
is_value_true(true)

is_value_true(v) if {
	is_string(v)
	lower(trim_space(v)) == "true"
}

is_value_false(false)

is_value_false(v) if {
	is_string(v)
	lower(trim_space(v)) == "false"
}
