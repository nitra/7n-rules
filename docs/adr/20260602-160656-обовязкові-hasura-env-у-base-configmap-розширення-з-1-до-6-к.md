---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T16:06:56+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

## ADR Обов'язкові Hasura env у base-ConfigMap: розширення з 1 до 6 ключів

## Context and Problem Statement
Механізм rego-перевірки ConfigMap для Hasura-Deployment (`npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego`) вимагав лише `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS="true"`. Виникла потреба додати ще п'ять обов'язкових env-ключів із різною семантикою очікуваних значень (boolean-false, boolean-true, обов'язкова присутність, точний рядок).

## Considered Options
* Додати нові ключі в rego `required_env` з узагальненою data-driven семантикою (boolean-true / boolean-false / null=будь-яке / exact-string)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "data-driven `required_env` у rego з чотирма типами зіставлення", because rego вже є authoritative для per-document перевірок (конвенція `conftest.mdc`, Plan B ADR), а узагальнений map дозволяє описати різнорідну семантику без дублювання deny-правил.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний deny-предикат покриває всі 6 ключів; `conftest verify` 27/27 pass; `regal lint` — clean.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Додані ключі та їхні вимоги:
- `HASURA_GRAPHQL_ENABLE_RELAY` → `"false"` (boolean case-insensitive)
- `HASURA_GRAPHQL_ENABLE_TELEMETRY` → `"false"` (boolean case-insensitive)
- `HASURA_GRAPHQL_ENABLED_LOG_TYPES` → `"startup,http-log"` (точний рядок)
- `HASURA_GRAPHQL_DISABLE_EVENTING` → ключ обов'язковий, значення довільне (`null` у `required_env`)
- `HASURA_GRAPHQL_ENABLED_APIS` → `"metadata,graphql,pgdump"` (base/dev, exact-string; overlay — окремий механізм, ADR нижче)

Файли: `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego`, `…/hasura_configmap_test.rego`, `npm/rules/k8s/js/manifests.mjs` (`HASURA_REQUIRED_ENV_KEYS`), `npm/rules/k8s/k8s.mdc`.
Команда перевірки: `conftest verify -p npm/rules/k8s/policy/hasura_configmap`.

---

## ADR HASURA_GRAPHQL_ENABLED_APIS: Варіант B — перевірка патча у kustomization.yaml

## Context and Problem Statement
`HASURA_GRAPHQL_ENABLED_APIS` має різні обов'язкові значення залежно від середовища: `"metadata,graphql,pgdump"` для `base`/`dev`, `"metadata,graphql"` (без pgdump) для всіх інших overlays. Виникло питання, де зберігається overlay-значення і який механізм перевірки застосувати.

## Considered Options
* **Варіант A**: кожен overlay має повний `k8s/<env>/configmap.yaml` з `data.HASURA_GRAPHQL_ENABLED_APIS: metadata,graphql`; перевірка — окремий rego-пакет `k8s.hasura_configmap_overlay` + JS-оркестратор по цих файлах.
* **Варіант B**: overlay-значення задається як патч у `k8s/<env>/kustomization.yaml` (JSON 6902 / strategic-merge) поверх base; перевірка — cross-file JS (`validateHasuraOverlayEnabledApisOverride`), що читає `patches[]` у kustomization.

## Decision Outcome
Chosen option: "Варіант B", because користувач явно обрав підхід через kustomization-патч, а не окремий configmap-файл у кожному overlay; паралельна реалізація Варіанта A (створена автономним агентом) була відхилена та видалена.

### Consequences
* Good, because transcript фіксує очікувану користь: overlay-середовища не потребують дублювання повного ConfigMap — достатньо одного `patches[]` у `kustomization.yaml`; логіка JS-оркестратора виявляє відсутній або неправильний патч і повідомляє точний сегмент середовища у fail-повідомленні.
* Bad, because cross-file JS складніший за rego (rego бачить лише вміст одного документа, не шлях); функція `kustomizationTreeHasHasuraDeployment` потребує обходу дерева ресурсів і не може бути перевірена через `conftest verify`. Neutral, because transcript не містить підтвердження щодо покриття крайніх випадків (overlay без kustomization, вкладені компоненти).

## More Information
Класифікація середовищ: `base` і `dev` строго — pgdump-варіант; усі інші (включно з `*-qa`) — `"metadata,graphql"`. Наявна функція `isDevLikeK8sEnvSegment` (яка включає `*-qa` у dev-клас) **не використовується** — рішення покладається на `k8sEnvSegmentFromRelPath` з умовою `segment === 'base' || segment === 'dev'`.

Нові exported-символи: `enabledApisValueFromPatchText`, `hasuraEnabledApisOverrideValue`, `kustomizationTreeHasHasuraDeployment` у `npm/rules/k8s/js/manifests.mjs`.
Оркестратор: `validateHasuraOverlayEnabledApisOverride` — вбудовано у `check()`.
Тести: `describe('enabledApisValueFromPatchText')`, `describe('hasuraEnabledApisOverrideValue')`, `describe('kustomizationTreeHasHasuraDeployment')` у `check-schema.test.mjs`; 189 pass.
Зміни в ізольованому worktree `.worktrees/main-hasura-apis`, закомічено як `feat(k8s): Hasura ENABLED_APIS — base/dev pgdump + Варіант B overlay override`.
