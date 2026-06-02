---
session: 1f428343-c999-4b00-81c1-f8e6e25ade37
captured: 2026-06-02T15:49:35+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f428343-c999-4b00-81c1-f8e6e25ade37.jsonl
---

Всі перевірки пройшли. Ось підсумок:

## Що зроблено

**Variant A (hasura_configmap_overlay/) видалено** — стара rego-реалізація, що перевіряла повний overlay ConfigMap-файл, прибрана.

**HASURA_GRAPHQL_ENABLED_APIS додано до base rego** (`k8s.hasura_configmap`) — тепер `k8s/base/configmap.yaml` з Hasura-Deployment повинен мати точно **`"metadata,graphql,pgdump"`**.

**JS-оркестратор Variant B** (`validateHasuraOverlayEnabledApis`) — для кожного non-base/non-dev `kustomization.yaml`, що успадковує Hasura-base через `resources:`, перевіряє `patches[]` на наявність patch, який встановлює `HASURA_GRAPHQL_ENABLED_APIS="metadata,graphql"` у ConfigMap (JSON6902 або strategic-merge).

### Остаточний перелік обов'язкових env для base ConfigMap:

| Ключ | Вимога |
|---|---|
| `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS` | `"true"` |
| `HASURA_GRAPHQL_ENABLE_RELAY` | `"false"` |
| `HASURA_GRAPHQL_ENABLE_TELEMETRY` | `"false"` |
| `HASURA_GRAPHQL_ENABLED_LOG_TYPES` | `"startup,http-log"` |
| `HASURA_GRAPHQL_ENABLED_APIS` | `"metadata,graphql,pgdump"` (base/dev) |
| `HASURA_GRAPHQL_DISABLE_EVENTING` | ключ обов'язковий, значення довільне |

Non-base/non-dev overlay: обов'язковий `patches[]` що знижує до `"metadata,graphql"`.

**Перевірки:** conftest 27/27 ✅ · regal ✅ · bun 184/184 ✅ · fix changelog ✅

---

Повертаючись до ролі аналізатора транскрипту — ось документ рішення:

## ADR Обов'язкові Hasura env у ConfigMap: base vs overlay

## Context and Problem Statement
У репозиторії `npm/rules/k8s/` існує механізм rego-перевірки (`k8s.hasura_configmap`) ConfigMap для Hasura-Deployment. Виникла потреба розширити набір обов'язкових env-змінних (RELAY, EVENTING, TELEMETRY, LOG_TYPES) і, додатково, запровадити env `HASURA_GRAPHQL_ENABLED_APIS` з двома різними очікуваними значеннями залежно від шару: `metadata,graphql,pgdump` для base/dev і `metadata,graphql` для всіх інших overlays.

## Considered Options
* **Variant A** — окремий rego-пакет `k8s.hasura_configmap_overlay`, що перевіряє повний `k8s/<env>/configmap.yaml` в overlay
* **Variant B** — JS-оркестратор, що перевіряє `patches[]` у `k8s/<env>/kustomization.yaml` (cross-file, без окремого configmap-файлу в overlay)

## Decision Outcome
Chosen option: "Variant B — JS-оркестратор перевірки patch у kustomization.yaml", because користувач обрав цей варіант: overlay не копіює configmap-файл, а перекриває значення `HASURA_GRAPHQL_ENABLED_APIS` через `patches[]` у `kustomization.yaml`. Rego-пакет `k8s.hasura_configmap` залишається authoritative для base ConfigMap; JS (`validateHasuraOverlayEnabledApis`) — для cross-file overlay перевірки.

### Consequences
* Good, because transcript фіксує очікувану користь: overlay залишаються тонкими (один `kustomization.yaml` без зайвого `configmap.yaml`), а перевірка зберігає архітектурний принцип "rego per-document, JS cross-file".
* Bad, because JS-оркестратор не покривається rego-тестами (лише unit-тест `extractEnabledApisValueFromPatch`); integraion-сценарій overlay перевіряється лише через bun test на реальних YAML-файлах.

## More Information
* `npm/rules/k8s/policy/hasura_configmap/hasura_configmap.rego` — `required_env` розширено до 6 ключів, додано `HASURA_GRAPHQL_ENABLED_APIS: "metadata,graphql,pgdump"`
* `npm/rules/k8s/policy/hasura_configmap/hasura_configmap_test.rego` — 27 тестів (було 23)
* `npm/rules/k8s/js/manifests.mjs` — нові `extractEnabledApisValueFromPatch` (exported), `validateHasuraOverlayEnabledApis`, виклик у `check()`; `HASURA_REQUIRED_ENV_KEYS` включає `HASURA_GRAPHQL_ENABLED_APIS`
* `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — 184 тести (було 178)
* `npm/rules/k8s/k8s.mdc` — нова підсекція "HASURA_GRAPHQL_ENABLED_APIS у non-dev overlays" з прикладом JSON6902 patch
* Variant A (`npm/rules/k8s/policy/hasura_configmap_overlay/`) видалено до коміту (був untracked)
