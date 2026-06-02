---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T15:15:56+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

The ADR file already exists and contains the full analysis. The parallel session captured everything correctly. Here's the ADR output from the transcript:

---

## ADR Обов'язкові Hasura env у ConfigMap: base vs overlay

## Context and Problem Statement
Hasura-Deployment у k8s потребував розширення переліку обов'язкових env-змінних у ConfigMap. До цього перевірявся лише `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS`. Виникла потреба додати нові ключі з конкретними значеннями і розрізнити вимоги між `k8s/base/configmap.yaml` та overlay-середовищами (`k8s/<env>/configmap.yaml`, де `<env>` ≠ `base`), зокрема щодо `HASURA_GRAPHQL_ENABLED_APIS`.

## Considered Options
* Один спільний rego-пакет з параметром середовища через `templateData` (Варіант A-alt)
* Два окремих rego-пакети: `k8s.hasura_configmap` (base) і `k8s.hasura_configmap_overlay` (overlay) — Варіант A
* Перевірка cross-file через kustomization-патчі (`patchesStrategicMerge`/JSON6902) — Варіант B (відхилено через складність)

## Decision Outcome
Chosen option: "Два окремих rego-пакети (`k8s.hasura_configmap` і `k8s.hasura_configmap_overlay`) з JS-оркестратором як cross-file детектором", because rego-пакети залишаються per-document authoritative (конвенція `conftest.mdc`), JS відповідає лише за cross-file логіку (sibling `../base/` з Hasura-Deployment); різні очікувані значення `HASURA_GRAPHQL_ENABLED_APIS` природно розкладаються в окремі пакети без template-параметризації.

### Consequences
* Good, because rego-пакети прості і незалежно тестовані (`conftest verify` на кожен окремо), немає template-injection.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego` — base-пакет: 5 env-ключів обов'язкові для `k8s/base/configmap.yaml`, включно з `HASURA_GRAPHQL_ENABLED_APIS="metadata,graphql,pgdump"`, `HASURA_GRAPHQL_ENABLE_RELAY="false"`, `HASURA_GRAPHQL_ENABLE_TELEMETRY="false"`, `HASURA_GRAPHQL_ENABLED_LOG_TYPES="startup,http-log"`, `HASURA_GRAPHQL_DISABLE_EVENTING` (значення довільне)
- `npm/rules/k8s/policy/hasura_configmap_overlay/hasura_configmap_overlay.rego` — overlay-пакет: лише `HASURA_GRAPHQL_ENABLED_APIS="metadata,graphql"` для `k8s/<env>/configmap.yaml`
- JS-оркестратор `validateHasuraConfigMapOverlayApis` у `npm/rules/k8s/js/manifests.mjs` — знаходить overlay ConfigMap-и, перевіряє наявність Hasura-Deployment у sibling `../base/`, запускає `conftest` з пакетом `k8s.hasura_configmap_overlay`
- Варіант B (перевірка через kustomization-патчі) відхилений через значну складність cross-file аналізу патч-файлів
- Conftest base: 27/27 pass; conftest overlay: 6/6 pass; regal lint: чисто; bun test: 178/178 pass
