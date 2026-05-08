# Порт мінімальної структурної перевірки `hasura/k8s/base/svc-hl.yaml` з
# `npm/scripts/check-hasura.mjs` (hasura.mdc): для кожного Service у файлі
# `metadata.name` має закінчуватись на `-h` (headless-сервіс Hasura).
#
# Запуск (локально):
#   conftest test hasura/k8s/base/svc-hl.yaml -p npm/policy/hasura \
#     --namespace hasura.svc_hl
#
# Решта логіки `check-hasura.mjs` (звірення `HASURA_GRAPHQL_ENDPOINT` в `.env`-файлах
# з `<service>.<namespace>.svc.<cluster>` через regex по всьому дереву репо, gating
# на `repository` у кореневому `package.json`) — у JS: вона потребує текстового
# парсингу `.env`-файлів, обходу дерева й cross-file resolution.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package hasura.svc_hl

import rego.v1

deny contains msg if {
	input.kind == "Service"
	name := object.get(object.get(input, "metadata", {}), "name", "")
	name != ""
	not endswith(name, "-h")
	msg := sprintf("hasura svc-hl.yaml: Service %q має закінчуватись на `-h` (hasura.mdc / k8s.mdc)", [name])
}
