# Порт перевірки ConfigMap для Hasura-Deployment з
# `npm/scripts/rules/k8s/fix.mjs` (k8s.mdc): у ConfigMap, що сусідствує з
# Hasura-Deployment, у `data` обов'язково має бути ключ
# `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS` зі значенням `"true"`.
#
# Запуск (локально, лише для ConfigMap у каталозі з Hasura-Deployment):
#   conftest test path/to/k8s/.../configmap.yaml \
#     -p npm/policy/k8s/hasura_configmap \
#     --namespace k8s.hasura_configmap
#
# Прив'язка ConfigMap-Deployment cross-file — у JS (`rules/k8s/fix.mjs`:
# `validateHasuraConfigMapRemoteSchemaPermissions` шукає Hasura-Deployment
# у тому ж dir-у і викликає conftest з цією намеспейс лише для відповідних
# ConfigMap-ів). JS authoritative (`hasuraConfigMapRemoteSchemaPermissionsViolation`,
# константа `HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.hasura_configmap

import rego.v1

# Обов'язковий ключ у `data` (узгоджено з `rules/k8s/fix.mjs`).
required_key := "HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS"

key_missing_template := concat(" ", [
	"data.%s: додай ключ зі значенням \"true\"",
	"(Deployment з hasura/graphql-engine — k8s.mdc)",
])

key_value_wrong_template := concat(" ", ["data.%s: значення має бути \"true\" (зараз: %v) (k8s.mdc)"])

deny contains msg if {
	input.kind == "ConfigMap"
	not is_object(object.get(input, "data", null))
	msg := sprintf(key_missing_template, [required_key])
}

deny contains msg if {
	input.kind == "ConfigMap"
	d := object.get(input, "data", null)
	is_object(d)
	not key_present(d)
	msg := sprintf(key_missing_template, [required_key])
}

deny contains msg if {
	input.kind == "ConfigMap"
	d := object.get(input, "data", null)
	is_object(d)
	key_present(d)
	value := d[required_key]
	not is_value_true(value)
	msg := sprintf(key_value_wrong_template, [required_key, value])
}

key_present(d) if {
	required_key in object.keys(d)
}

# Значення вважається "true", якщо це boolean true або рядок "true"
# (case-insensitive). ConfigMap у Kubernetes тримає рядки, але YAML без лапок
# дає boolean — приймаємо обидва варіанти.
is_value_true(true)

is_value_true(v) if {
	is_string(v)
	lower(trim_space(v)) == "true"
}
